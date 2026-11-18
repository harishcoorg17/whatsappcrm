import { describe, expect, it, vi } from 'vitest';
import {
  MAX_TOUR_FACTS_CHARS,
  fetchTourFacts,
  formatTourFacts,
} from './tour-facts';

const PAYLOAD = {
  success: true,
  data: {
    package: {
      title: 'Kerala Itinerary 7 Days',
      short_description: 'Backwaters, hills and beaches.',
      duration_days: 7,
      inclusions: ['Hotels', 'Breakfast'],
      exclusions: ['Flights'],
      fixed_departure_dates: [
        { date: '2026-12-05', slots: 8, status: 'open' },
        { date: '2026-12-20', slots: 0, status: 'closed' },
      ],
      terms: { cancellation_policy: 'Free cancellation up to 30 days.' },
    },
    variants: [
      { variant_type: 'budget', price_per_adult: 24999, discount_price: null },
      {
        variant_type: 'premium',
        price_per_adult: 32000,
        discount_price: 29999,
      },
      { variant_type: 'broken', price_per_adult: 0 },
    ],
    itinerary: [
      { day_title: 'Arrive in Kochi', highlights: ['Fort Kochi walk'] },
      { day_title: 'Munnar', highlights: [] },
    ],
  },
};

describe('formatTourFacts', () => {
  it('writes the tour, prices, itinerary, lists, dates and policy', () => {
    const text = formatTourFacts(PAYLOAD) as string;
    expect(text).toContain('Kerala Itinerary 7 Days (7 days)');
    expect(text).toContain('- budget: Rs 24,999 per adult');
    expect(text).toContain('- premium: Rs 29,999 per adult');
    expect(text).not.toContain('broken');
    expect(text).toContain('- Day 1: Arrive in Kochi: Fort Kochi walk');
    expect(text).toContain('- Day 2: Munnar');
    expect(text).toContain('- Hotels');
    expect(text).toContain('Not included:\n- Flights');
    expect(text).toContain('2026-12-05 (8 slots left)');
    expect(text).not.toContain('2026-12-20');
    expect(text).toContain('Free cancellation up to 30 days.');
  });

  it.each([[null], [{}], [{ data: {} }], [{ data: { package: {} } }]])(
    'returns null for an unusable payload %#',
    (payload) => {
      expect(formatTourFacts(payload)).toBeNull();
    }
  );

  it('keeps the text under the cap', () => {
    const big = {
      data: {
        package: {
          title: 'Big',
          inclusions: Array.from({ length: 12 }, () => 'x'.repeat(900)),
        },
      },
    };
    expect((formatTourFacts(big) as string).length).toBeLessThanOrEqual(
      MAX_TOUR_FACTS_CHARS
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('fetchTourFacts', () => {
  it('asks the tour endpoint by slug and formats the answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    const text = await fetchTourFacts({
      apiBase: 'https://api.example.com/api/',
      title: 'Kerala Itinerary 7 Days',
      fetchImpl,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.example.com/api/tours/kerala-itinerary-7-days/details'
    );
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(text).toContain('Kerala Itinerary 7 Days');
  });

  it('returns null when the tour is not found', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    expect(
      await fetchTourFacts({
        apiBase: 'https://api.example.com/api',
        title: 'Nowhere',
        fetchImpl,
      })
    ).toBeNull();
  });

  it('returns null when the request fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    expect(
      await fetchTourFacts({
        apiBase: 'https://api.example.com/api',
        title: 'Kerala',
        fetchImpl,
      })
    ).toBeNull();
  });

  it('does not call a host the guard refuses', async () => {
    const fetchImpl = vi.fn();
    const text = await fetchTourFacts({
      apiBase: 'https://api.example.com/api',
      title: 'Kerala',
      fetchImpl,
      hostGuard: async () => false,
    });
    expect(text).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a non-https base', async () => {
    const fetchImpl = vi.fn();
    expect(
      await fetchTourFacts({
        apiBase: 'http://api.example.com/api',
        title: 'Kerala',
        fetchImpl,
      })
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
