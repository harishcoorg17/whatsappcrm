import { NextRequest, NextResponse } from 'next/server';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { authorizeTenantAccess, problem } from '@/lib/tenants/authorize-tenant';
import { canAddAgent } from '@/lib/billing/plans';
import { loadTenantLimits } from '@/lib/billing/server';

/**
 * A tenant's team.
 *
 *   GET  /api/tenants/[slug]/members   list the owner and members
 *   POST /api/tenants/[slug]/members   add { email, role? } ('admin' | 'agent')
 *
 * Allowed for the tenant's owner, platform admins and team admins. Only the
 * owner or a platform admin can grant the 'admin' role. A person without an
 * account gets an invite email and is added straight away, so they land in the
 * team the first time they sign in.
 */

type Context = { params: Promise<{ slug: string }> };
type Role = 'admin' | 'agent';

const MAX_MEMBERS_PER_TENANT = 50;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const UNIQUE_VIOLATION = '23505';

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

const isRole = (value: unknown): value is Role =>
  value === 'admin' || value === 'agent';

/** Escape LIKE wildcards so an address matches exactly (case-insensitively). */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const { data: rows, error } = await auth.db
      .from('crm_tenant_members')
      .select('user_id, role, created_at')
      .eq('tenant_id', auth.tenant.id)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[tenants/members] list failed:', error.message);
      return problem('Could not list the team', 500).response;
    }

    const members = (rows ?? []) as Array<{
      user_id: string;
      role: Role;
      created_at: string;
    }>;
    const ids = [
      ...(auth.tenant.owner_user_id ? [auth.tenant.owner_user_id] : []),
      ...members.map((m) => m.user_id),
    ];
    const { data: profiles } = ids.length
      ? await auth.db
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', ids)
      : { data: [] as ProfileRow[] };
    const byUser = new Map(
      ((profiles ?? []) as ProfileRow[]).map((p) => [p.user_id, p])
    );
    const describe = (userId: string) => ({
      user_id: userId,
      email: byUser.get(userId)?.email ?? null,
      full_name: byUser.get(userId)?.full_name ?? null,
    });

    return NextResponse.json({
      members: [
        ...(auth.tenant.owner_user_id
          ? [{ ...describe(auth.tenant.owner_user_id), role: 'owner' as const }]
          : []),
        ...members.map((m) => ({ ...describe(m.user_id), role: m.role })),
      ],
    });
  } catch (error) {
    console.error('[tenants/members] unexpected error:', error);
    return problem('Could not list the team', 500).response;
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { slug } = await context.params;
    const auth = await authorizeTenantAccess(slug, { allowTeamAdmins: true });
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(
      `tenant-members:${auth.userId}`,
      RATE_LIMITS.tenantSelf
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (
      !email ||
      email.length > MAX_EMAIL_LENGTH ||
      !EMAIL_PATTERN.test(email)
    ) {
      return problem('Enter a valid email address', 400).response;
    }
    const role: Role = body.role === undefined ? 'agent' : (body.role as Role);
    if (!isRole(role)) {
      return problem('Role must be admin or agent', 400).response;
    }
    if (role === 'admin' && auth.level !== 'owner') {
      return problem('Only the owner can make someone an admin', 403).response;
    }

    const { count } = await auth.db
      .from('crm_tenant_members')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', auth.tenant.id);
    if ((count ?? 0) >= MAX_MEMBERS_PER_TENANT) {
      return problem(
        `A team can have at most ${MAX_MEMBERS_PER_TENANT} members`,
        400
      ).response;
    }

    // Plan seat limit: the owner holds a seat too. Re-adding an existing
    // member (a role change through upsert) does not take a new one.
    const limits = await loadTenantLimits(auth.db, auth.tenant.id);
    if (limits) {
      const seats = (count ?? 0) + (auth.tenant.owner_user_id ? 1 : 0);
      const check = canAddAgent(limits, seats);
      if (!check.allowed) {
        return NextResponse.json(
          { error: check.message, code: 'plan_limit', limit: check.limit },
          { status: 402 }
        );
      }
    }

    // Existing account? Otherwise send an invite email and use the new user.
    const { data: profile } = await auth.db
      .from('profiles')
      .select('user_id, full_name, email')
      .ilike('email', escapeLike(email))
      .maybeSingle();

    let userId = (profile as ProfileRow | null)?.user_id ?? null;
    let invited = false;
    if (!userId) {
      const { data: invite, error: inviteError } =
        await auth.db.auth.admin.inviteUserByEmail(email);
      if (inviteError || !invite?.user) {
        console.error('[tenants/members] invite failed:', inviteError?.message);
        return problem(
          'Could not send the invite email. Check the address, or ask them to sign up first.',
          502
        ).response;
      }
      userId = invite.user.id;
      invited = true;
    }

    if (userId === auth.tenant.owner_user_id) {
      return problem('That person already owns this tenant', 400).response;
    }

    const { error: saveError } = await auth.db
      .from('crm_tenant_members')
      .upsert(
        {
          tenant_id: auth.tenant.id,
          user_id: userId,
          role,
          invited_by: auth.userId,
        },
        { onConflict: 'tenant_id,user_id' }
      );
    if (saveError) {
      console.error('[tenants/members] save failed:', saveError.message);
      if (saveError.code === UNIQUE_VIOLATION) {
        return problem('That person is already on the team', 409).response;
      }
      return problem('Could not add the team member', 500).response;
    }

    return NextResponse.json(
      {
        member: {
          user_id: userId,
          email,
          full_name: (profile as ProfileRow | null)?.full_name ?? null,
          role,
        },
        invited,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[tenants/members] unexpected error:', error);
    return problem('Could not add the team member', 500).response;
  }
}
