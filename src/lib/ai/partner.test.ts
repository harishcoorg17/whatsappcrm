import { describe, expect, it } from 'vitest';
import { partnerTagName, partnerTypeFromTag } from './partner';

describe('partner tags', () => {
  it('round-trips every partner type through its tag name', () => {
    for (const type of ['dmc', 'hotel', 'transport', 'vendor'] as const) {
      expect(partnerTypeFromTag(partnerTagName(type))).toBe(type);
    }
  });

  it('ignores tags that are not partner tags', () => {
    expect(partnerTypeFromTag('ai-lead')).toBeUndefined();
    expect(partnerTypeFromTag('partner-alien')).toBeUndefined();
    expect(partnerTypeFromTag('partner-')).toBeUndefined();
  });
});
