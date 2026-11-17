import { describe, expect, it } from 'vitest';
import {
  adLabel,
  adMatches,
  adTagName,
  parseReferral,
  referralFromRow,
  referralToColumns,
} from './referral';

const RAW = {
  source_url: 'https://fb.me/abc',
  source_id: '1203630',
  source_type: 'AD',
  headline: ' Goa in monsoon ',
  body: 'Book now',
  ctwa_clid: 'clid-1',
  image_url: 'https://cdn.example/a.jpg',
};

describe('parseReferral', () => {
  it('parses a full referral', () => {
    expect(parseReferral(RAW)).toEqual({
      sourceId: '1203630',
      sourceType: 'ad',
      sourceUrl: 'https://fb.me/abc',
      headline: 'Goa in monsoon',
      body: 'Book now',
      ctwaClid: 'clid-1',
      mediaUrl: 'https://cdn.example/a.jpg',
    });
  });

  it('returns null for non-objects and missing source id', () => {
    expect(parseReferral(undefined)).toBeNull();
    expect(parseReferral('x')).toBeNull();
    expect(parseReferral({ headline: 'x' })).toBeNull();
    expect(parseReferral({ source_id: '  ' })).toBeNull();
  });

  it('drops non-http urls', () => {
    const ad = parseReferral({
      source_id: '1',
      source_url: 'javascript:alert(1)',
      image_url: 'data:text/html,x',
    });
    expect(ad?.sourceUrl).toBeNull();
    expect(ad?.mediaUrl).toBeNull();
  });

  it('falls back to video then thumbnail', () => {
    expect(
      parseReferral({ source_id: '1', video_url: 'https://v.example/x.mp4' })
        ?.mediaUrl
    ).toBe('https://v.example/x.mp4');
    expect(
      parseReferral({
        source_id: '1',
        thumbnail_url: 'https://t.example/x.jpg',
      })?.mediaUrl
    ).toBe('https://t.example/x.jpg');
  });

  it('caps long text', () => {
    expect(
      parseReferral({ source_id: '1', body: 'x'.repeat(2000) })?.body
    ).toHaveLength(500);
  });
});

describe('labels', () => {
  it('prefers headline, else ad / post id', () => {
    expect(adLabel({ headline: 'H', sourceId: '1', sourceType: 'ad' })).toBe(
      'H'
    );
    expect(adLabel({ headline: null, sourceId: '1', sourceType: 'ad' })).toBe(
      'Ad 1'
    );
    expect(adLabel({ headline: null, sourceId: '2', sourceType: 'post' })).toBe(
      'Post 2'
    );
  });

  it('truncates long tag names', () => {
    const name = adTagName({
      headline: 'x'.repeat(100),
      sourceId: '1',
      sourceType: 'ad',
    });
    expect(name.startsWith('Ad: ')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(45);
  });
});

describe('adMatches', () => {
  const ad = { sourceId: 'ABC1', headline: 'Goa in Monsoon', body: null };
  it('never matches without an ad', () => {
    expect(adMatches(null, '')).toBe(false);
  });
  it('empty needle matches any ad chat', () => {
    expect(adMatches(ad, '')).toBe(true);
    expect(adMatches(ad, undefined)).toBe(true);
  });
  it('matches id exactly and headline loosely', () => {
    expect(adMatches(ad, 'abc1')).toBe(true);
    expect(adMatches(ad, 'abc')).toBe(false);
    expect(adMatches(ad, 'monsoon')).toBe(true);
    expect(adMatches(ad, 'kerala')).toBe(false);
  });
});

describe('row mapping', () => {
  it('round-trips through conversation columns', () => {
    const ad = parseReferral(RAW)!;
    const cols = referralToColumns(ad);
    expect(cols.ad_source_id).toBe('1203630');
    expect(typeof cols.ad_referred_at).toBe('string');
    expect(referralFromRow(cols)).toEqual(ad);
  });
  it('returns null when no ad stored', () => {
    expect(referralFromRow({ ad_source_id: null })).toBeNull();
    expect(referralFromRow(null)).toBeNull();
  });
});
