/**
 * Rules for Meta's one-time coexistence data sync.
 *
 * After a business connects a WhatsApp Business app number, Meta lets the CRM
 * request its contacts and its chat history, each exactly once, contacts
 * first, within 24 hours. Re-running either means offboarding and starting the
 * connection again. These helpers read that state from the audit events the
 * CRM already records and decide what is allowed next.
 */

export type SyncKind = 'contacts' | 'history';

export const ONBOARDED_EVENT = 'completed_coexistence';

export const SYNC_EVENT: Record<SyncKind, string> = {
  contacts: 'coexistence_sync_contacts',
  history: 'coexistence_sync_history',
};

/** The `sync_type` Meta's smb_app_data endpoint expects. */
export const META_SYNC_TYPE: Record<SyncKind, string> = {
  contacts: 'smb_app_state_sync',
  history: 'history',
};

export const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AuditEvent {
  event_type: string;
  created_at: string;
}

export interface SyncState {
  /** True once the tenant was connected through the coexistence flow. */
  coexistence: boolean;
  onboardedAt: string | null;
  /** When Meta's 24-hour window closes. */
  deadline: string | null;
  contactsRequested: boolean;
  historyRequested: boolean;
}

export const SYNC_EVENT_TYPES = [
  ONBOARDED_EVENT,
  SYNC_EVENT.contacts,
  SYNC_EVENT.history,
];

/**
 * Reads the sync state from audit events. Only requests made at or after the
 * latest coexistence connection count, because connecting again starts a
 * fresh onboarding with a fresh one-time allowance.
 */
export function readSyncState(events: AuditEvent[]): SyncState {
  const onboardedAt =
    events
      .filter((e) => e.event_type === ONBOARDED_EVENT)
      .map((e) => e.created_at)
      .sort()
      .at(-1) ?? null;

  if (!onboardedAt) {
    return {
      coexistence: false,
      onboardedAt: null,
      deadline: null,
      contactsRequested: false,
      historyRequested: false,
    };
  }

  const requested = (kind: SyncKind) =>
    events.some(
      (e) => e.event_type === SYNC_EVENT[kind] && e.created_at >= onboardedAt
    );

  return {
    coexistence: true,
    onboardedAt,
    deadline: new Date(Date.parse(onboardedAt) + SYNC_WINDOW_MS).toISOString(),
    contactsRequested: requested('contacts'),
    historyRequested: requested('history'),
  };
}

export type SyncPlan =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Whether `kind` may be requested now, given what has already been asked. */
export function planSync(state: SyncState, kind: SyncKind): SyncPlan {
  if (!state.coexistence) {
    return {
      ok: false,
      status: 400,
      error: 'This tenant was not connected through WhatsApp coexistence.',
    };
  }
  if (kind === 'contacts' && state.contactsRequested) {
    return {
      ok: false,
      status: 409,
      error: 'Contacts were already requested. Meta allows this only once.',
    };
  }
  if (kind === 'history' && !state.contactsRequested) {
    return {
      ok: false,
      status: 409,
      error: 'Sync contacts first. Meta requires contacts before history.',
    };
  }
  if (kind === 'history' && state.historyRequested) {
    return {
      ok: false,
      status: 409,
      error: 'History was already requested. Meta allows this only once.',
    };
  }
  return { ok: true };
}
