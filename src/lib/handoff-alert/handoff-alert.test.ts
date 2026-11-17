import { describe, it, expect } from 'vitest';
import {
  HANDOFF_ALERT_COOLDOWN_MS,
  buildHandoffAlertContent,
  describeHandoffReason,
  normalizeAlertNumber,
  pickEmailRecipients,
  planHandoffAlert,
} from './handoff-alert';

const now = new Date('2026-01-01T12:00:00Z');
const on = { email: true, whatsapp: true, whatsappNumber: '+91 98765 43210' };

describe('normalizeAlertNumber', () => {
  it('keeps digits within E.164 length', () => {
    expect(normalizeAlertNumber('+91 98765-43210')).toBe('919876543210');
    expect(normalizeAlertNumber('123')).toBeNull();
    expect(normalizeAlertNumber('1'.repeat(16))).toBeNull();
    expect(normalizeAlertNumber(null)).toBeNull();
  });
});

describe('planHandoffAlert', () => {
  it('does nothing when every channel is off', () => {
    expect(
      planHandoffAlert({ settings: { email: false, whatsapp: false, whatsappNumber: null }, lastAlertedAt: null, now })
    ).toBeNull();
  });
  it('ignores WhatsApp with a bad number, keeps email', () => {
    const plan = planHandoffAlert({ settings: { ...on, whatsappNumber: 'abc' }, lastAlertedAt: null, now });
    expect(plan).toMatchObject({ email: true, whatsappTo: null });
  });
  it('is null when WhatsApp is the only channel and the number is bad', () => {
    expect(
      planHandoffAlert({ settings: { email: false, whatsapp: true, whatsappNumber: '' }, lastAlertedAt: null, now })
    ).toBeNull();
  });
  it('plans both channels for a fresh handoff', () => {
    const plan = planHandoffAlert({ settings: on, lastAlertedAt: null, now });
    expect(plan).toEqual({
      email: true,
      whatsappTo: '919876543210',
      claimBefore: new Date(now.getTime() - HANDOFF_ALERT_COOLDOWN_MS).toISOString(),
    });
  });
  it('rate limits: quiet inside the cooldown, alerts again after it', () => {
    const recent = new Date(now.getTime() - 60_000).toISOString();
    const old = new Date(now.getTime() - HANDOFF_ALERT_COOLDOWN_MS).toISOString();
    expect(planHandoffAlert({ settings: on, lastAlertedAt: recent, now })).toBeNull();
    expect(planHandoffAlert({ settings: on, lastAlertedAt: old, now })).not.toBeNull();
  });
  it('treats an unparseable last-alert time as never alerted', () => {
    expect(planHandoffAlert({ settings: on, lastAlertedAt: 'nope', now })).not.toBeNull();
  });
});

describe('pickEmailRecipients', () => {
  it('prefers the assigned agent', () => {
    expect(pickEmailRecipients({ assigneeEmail: 'A@x.com ', adminEmails: ['b@x.com'] })).toEqual(['a@x.com']);
  });
  it('falls back to de-duplicated, valid admin emails', () => {
    expect(
      pickEmailRecipients({ assigneeEmail: null, adminEmails: ['b@x.com', 'B@x.com', null, 'bad'] })
    ).toEqual(['b@x.com']);
  });
});

describe('content', () => {
  it('escapes HTML and includes the link', () => {
    const c = buildHandoffAlertContent({
      contactName: '<b>Eve</b>',
      contactPhone: '1',
      reason: 'customer_requested',
      inboxUrl: 'https://app.test/inbox?c=1',
    });
    expect(c.html).not.toContain('<b>Eve');
    expect(c.html).toContain('&lt;b&gt;Eve');
    expect(c.text).toContain('https://app.test/inbox?c=1');
    expect(c.subject).toContain('Eve');
  });
  it('has fallbacks', () => {
    expect(describeHandoffReason('weird')).toBe('A chat needs a person');
    expect(
      buildHandoffAlertContent({ contactName: null, contactPhone: '+9199', reason: null, inboxUrl: null }).subject
    ).toContain('+9199');
  });
});
