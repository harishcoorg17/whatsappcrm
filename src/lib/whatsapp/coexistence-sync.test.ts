import { describe, expect, it } from 'vitest';
import {
  ONBOARDED_EVENT,
  SYNC_EVENT,
  planSync,
  readSyncState,
  type SyncState,
} from './coexistence-sync';

const T0 = '2026-11-10T10:00:00.000Z';
const T1 = '2026-11-10T10:05:00.000Z';
const T2 = '2026-11-10T10:10:00.000Z';

describe('readSyncState', () => {
  it('reports a tenant with no coexistence connection', () => {
    expect(readSyncState([])).toEqual({
      coexistence: false,
      onboardedAt: null,
      deadline: null,
      contactsRequested: false,
      historyRequested: false,
    });
    expect(
      readSyncState([{ event_type: 'completed', created_at: T0 }]).coexistence
    ).toBe(false);
  });

  it('gives the 24-hour deadline from the connection time', () => {
    const state = readSyncState([
      { event_type: ONBOARDED_EVENT, created_at: T0 },
    ]);
    expect(state).toMatchObject({
      coexistence: true,
      onboardedAt: T0,
      deadline: '2026-11-11T10:00:00.000Z',
      contactsRequested: false,
      historyRequested: false,
    });
  });

  it('notices which syncs were already requested', () => {
    const state = readSyncState([
      { event_type: ONBOARDED_EVENT, created_at: T0 },
      { event_type: SYNC_EVENT.contacts, created_at: T1 },
    ]);
    expect(state).toMatchObject({
      contactsRequested: true,
      historyRequested: false,
    });
  });

  it('starts fresh after the tenant is connected again', () => {
    const state = readSyncState([
      { event_type: ONBOARDED_EVENT, created_at: T0 },
      { event_type: SYNC_EVENT.contacts, created_at: T1 },
      { event_type: SYNC_EVENT.history, created_at: T1 },
      { event_type: ONBOARDED_EVENT, created_at: T2 },
    ]);
    expect(state).toMatchObject({
      onboardedAt: T2,
      contactsRequested: false,
      historyRequested: false,
    });
  });
});

describe('planSync', () => {
  const base: SyncState = {
    coexistence: true,
    onboardedAt: T0,
    deadline: '2026-11-11T10:00:00.000Z',
    contactsRequested: false,
    historyRequested: false,
  };

  it('refuses a tenant that is not a coexistence connection', () => {
    expect(planSync({ ...base, coexistence: false }, 'contacts')).toMatchObject(
      {
        ok: false,
        status: 400,
      }
    );
  });

  it('allows contacts first, then history', () => {
    expect(planSync(base, 'contacts')).toEqual({ ok: true });
    expect(planSync({ ...base, contactsRequested: true }, 'history')).toEqual({
      ok: true,
    });
  });

  it('refuses history before contacts', () => {
    expect(planSync(base, 'history')).toMatchObject({ ok: false, status: 409 });
  });

  it('refuses to run either sync twice', () => {
    expect(
      planSync({ ...base, contactsRequested: true }, 'contacts')
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      planSync(
        { ...base, contactsRequested: true, historyRequested: true },
        'history'
      )
    ).toMatchObject({ ok: false, status: 409 });
  });
});
