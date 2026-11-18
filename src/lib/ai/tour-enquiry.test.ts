import { describe, expect, it } from 'vitest';
import {
  findLatestTourEnquiry,
  parseTourEnquiry,
  titleToSlug,
} from './tour-enquiry';

const KERALA =
  'Hi Amstago! Thinking about the Kerala Itinerary 7 Days (7 days) for my next trip. Need some help!';

describe('parseTourEnquiry', () => {
  it('reads the tour and its length from the site message', () => {
    expect(parseTourEnquiry(KERALA)).toEqual({
      title: 'Kerala Itinerary 7 Days',
      days: 7,
    });
  });

  it('works without the days suffix or the word "the"', () => {
    expect(
      parseTourEnquiry('Thinking about Goa Beach Escape for my next trip.')
    ).toEqual({ title: 'Goa Beach Escape', days: null });
  });

  it('ignores case and extra spaces', () => {
    expect(
      parseTourEnquiry(
        'THINKING ABOUT THE  Spiti   Valley (9 Days) FOR MY NEXT TRIP'
      )
    ).toEqual({ title: 'Spiti Valley', days: 9 });
  });

  it.each([
    ['ordinary text', 'Hi, what is the price of Kerala?'],
    ['an empty string', ''],
    ['nothing', null],
    ['text without the trailing phrase', 'Thinking about Kerala'],
  ])('returns null for %s', (_label, text) => {
    expect(parseTourEnquiry(text as string | null)).toBeNull();
  });

  it('refuses an absurdly long title', () => {
    const long = `Thinking about the ${'x'.repeat(200)} for my next trip`;
    expect(parseTourEnquiry(long)).toBeNull();
  });
});

describe('findLatestTourEnquiry', () => {
  it('picks the newest enquiry in the chat', () => {
    const latest = findLatestTourEnquiry([
      'Thinking about the Goa Trip for my next trip',
      'ok',
      KERALA,
      'what is the price?',
    ]);
    expect(latest?.title).toBe('Kerala Itinerary 7 Days');
  });

  it('returns null when nobody asked about a tour', () => {
    expect(findLatestTourEnquiry(['hi', null, 'price?'])).toBeNull();
  });
});

describe('titleToSlug', () => {
  it('lower-cases and joins words with dashes', () => {
    expect(titleToSlug('Kerala Itinerary 7 Days')).toBe(
      'kerala-itinerary-7-days'
    );
  });

  it('strips accents and punctuation', () => {
    expect(titleToSlug("Café & Co: Goa's Best!")).toBe('cafe-co-goa-s-best');
  });

  it('caps the length', () => {
    expect(titleToSlug('a '.repeat(200)).length).toBeLessThanOrEqual(100);
  });
});
