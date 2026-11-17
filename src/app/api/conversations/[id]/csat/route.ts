import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { createClient } from '@/lib/supabase/server';
import { requestCsat } from '@/lib/csat/csat-server';

/**
 * POST /api/conversations/[id]/csat
 *
 * Called by the inbox right after an agent closes a chat. Sends the rating
 * survey when the tenant turned CSAT on (and has not surveyed this chat in the
 * last 24 hours). Always 200 for a signed-in member: `sent: false` just means
 * nothing was sent.
 */
type Context = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: Context) {
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Row level security: only someone who can see the chat may survey it.
    const { data: visible } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (!visible) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (visible.status !== 'closed') {
      return NextResponse.json({ sent: false, outcome: 'not_closed' });
    }

    const outcome = await requestCsat(supabaseAdmin(), id);
    return NextResponse.json({ sent: outcome === 'sent', outcome });
  } catch (error) {
    console.error('[conversations/csat] unexpected error:', error);
    return NextResponse.json({ error: 'Could not send the survey' }, { status: 500 });
  }
}
