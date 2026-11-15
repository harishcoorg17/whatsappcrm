import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { createClient } from '@/lib/supabase/server';
import { recordConsent, type ConsentStatus } from '@/lib/whatsapp/consent';

/**
 * A contact's marketing consent.
 *
 *   GET  /api/contacts/[id]/consent   current status + recent history
 *   POST /api/contacts/[id]/consent   { status: 'opted_in' | 'opted_out' | 'unknown', note? }
 *
 * Allowed for anyone who can see the contact (its owner, or a member of its
 * tenant): row level security answers that question, so a contact you cannot
 * see is simply "not found". Every change is logged with who made it.
 */

type Context = { params: Promise<{ id: string }> };

const STATUSES: readonly ConsentStatus[] = ['unknown', 'opted_in', 'opted_out'];
const MAX_NOTE_LENGTH = 500;
const HISTORY_LIMIT = 10;

async function loadContact(contactId: string) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { user: null, contact: null, supabase };

  const { data } = await supabase
    .from('contacts')
    .select('id, opt_in_status, opt_in_at, opt_out_at, consent_source')
    .eq('id', contactId)
    .maybeSingle();
  return { user, contact: data, supabase };
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const { user, contact, supabase } = await loadContact(id);
    if (!user)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const { data: history } = await supabase
      .from('contact_consent_events')
      .select('status, source, note, created_at')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);

    return NextResponse.json({ consent: contact, history: history ?? [] });
  } catch (error) {
    console.error('[contacts/consent] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not load consent' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const { user, contact } = await loadContact(id);
    if (!user)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!STATUSES.includes(body.status as ConsentStatus)) {
      return NextResponse.json(
        { error: 'status must be unknown, opted_in or opted_out' },
        { status: 400 }
      );
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > MAX_NOTE_LENGTH) {
      return NextResponse.json(
        { error: `Keep the note under ${MAX_NOTE_LENGTH} characters` },
        { status: 400 }
      );
    }

    const changed = await recordConsent(supabaseAdmin(), {
      contactId: id,
      status: body.status as ConsentStatus,
      source: 'manual',
      note: note || null,
      changedBy: user.id,
    });
    return NextResponse.json({ changed, status: body.status });
  } catch (error) {
    console.error('[contacts/consent] unexpected error:', error);
    return NextResponse.json(
      { error: 'Could not update consent' },
      { status: 500 }
    );
  }
}
