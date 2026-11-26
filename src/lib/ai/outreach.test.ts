import { describe, expect, it } from 'vitest';
import { THANK_YOU_REPLY, decideOutreach, isPartnerTagName } from './outreach';

describe('isPartnerTagName', () => {
  it('recognises the DMC tag and the partner tags the AI saves, in any case', () => {
    for (const name of [
      'dmc',
      'DMC',
      ' Dmc ',
      'partner-dmc',
      'partner-hotel',
      'partner-transport',
    ]) {
      expect(isPartnerTagName(name)).toBe(true);
    }
  });

  it('ignores ordinary tags', () => {
    for (const name of ['vip', 'lead', 'dmc-supplier-list', 'partnership']) {
      expect(isPartnerTagName(name)).toBe(false);
    }
  });
});

describe('decideOutreach', () => {
  it('treats a tagged partner as outreach, whoever spoke first', () => {
    expect(decideOutreach({ tagNames: ['dmc'], firstSender: 'customer' })).toBe(
      'partner_tag'
    );
    expect(
      decideOutreach({ tagNames: ['vip', 'partner-dmc'], firstSender: 'bot' })
    ).toBe('partner_tag');
  });

  it('treats a chat the business started as outreach', () => {
    expect(decideOutreach({ tagNames: [], firstSender: 'bot' })).toBe(
      'business_initiated'
    );
    expect(decideOutreach({ tagNames: ['vip'], firstSender: 'agent' })).toBe(
      'business_initiated'
    );
  });

  it('leaves an ordinary customer chat alone', () => {
    expect(
      decideOutreach({ tagNames: [], firstSender: 'customer' })
    ).toBeNull();
    expect(decideOutreach({ tagNames: ['vip'], firstSender: null })).toBeNull();
  });
});

describe('THANK_YOU_REPLY', () => {
  it('thanks them without asking for trip details', () => {
    expect(THANK_YOU_REPLY).toMatch(/thank you/i);
    expect(THANK_YOU_REPLY).not.toMatch(/tour|travel|trip|destination/i);
  });
});
