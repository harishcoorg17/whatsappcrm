import { describe, expect, it, vi } from 'vitest';
import {
  buildFetchUrl,
  getByPath,
  hostFromTemplate,
  parseAllowedHosts,
  renderItems,
  runHttpFetch,
  type HttpFetchConfig,
} from './http-fetch';

const ALLOWED = ['api.example.com'];

const BASE_CONFIG: HttpFetchConfig = {
  url: 'https://api.example.com/api/tours?search={{vars.destination}}&limit=3',
  items_path: 'data',
  item_template: '• {{item.title}} — {{item.days}} days, from ₹{{item.price}}',
  max_items: 3,
  save_as: 'tours',
  empty_text: 'No matching tours found.',
  success_next: 'ok',
  failure_next: 'fail',
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('parseAllowedHosts', () => {
  it('splits, trims and lowercases a comma separated list', () => {
    expect(parseAllowedHosts(' API.Example.com , b.example.com ,')).toEqual([
      'api.example.com',
      'b.example.com',
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
  });
});

describe('hostFromTemplate', () => {
  it('returns the lowercase host of an https URL', () => {
    expect(hostFromTemplate('https://API.example.com/x?y=1')).toBe(
      'api.example.com'
    );
  });

  it('rejects non-https schemes', () => {
    expect(hostFromTemplate('http://api.example.com/x')).toBeNull();
    expect(hostFromTemplate('ftp://api.example.com/x')).toBeNull();
  });

  it('rejects a placeholder in the host so customers cannot steer it', () => {
    expect(hostFromTemplate('https://{{vars.host}}/x')).toBeNull();
  });

  it('rejects embedded credentials and explicit ports', () => {
    expect(hostFromTemplate('https://u:p@api.example.com/x')).toBeNull();
    expect(hostFromTemplate('https://api.example.com:8443/x')).toBeNull();
  });
});

describe('buildFetchUrl', () => {
  it('URL-encodes substituted variables', () => {
    expect(
      buildFetchUrl('https://api.example.com/s?q={{vars.q}}', {
        q: 'goa & more/../x',
      })
    ).toBe('https://api.example.com/s?q=goa%20%26%20more%2F..%2Fx');
  });

  it('renders missing variables as empty strings', () => {
    expect(buildFetchUrl('https://api.example.com/s?q={{vars.q}}', {})).toBe(
      'https://api.example.com/s?q='
    );
  });
});

describe('getByPath', () => {
  const body = { data: [{ title: 'Kerala', nested: { n: 7 } }] };

  it('walks dotted paths and array indices', () => {
    expect(getByPath(body, 'data.0.title')).toBe('Kerala');
    expect(getByPath(body, 'data.0.nested.n')).toBe(7);
  });

  it('returns undefined for a broken path', () => {
    expect(getByPath(body, 'data.5.title')).toBeUndefined();
    expect(getByPath(body, 'nope.x')).toBeUndefined();
  });

  it('returns the value itself for an empty path', () => {
    expect(getByPath(body, '')).toBe(body);
  });
});

describe('renderItems', () => {
  const body = {
    data: [
      { title: 'A', days: 3, price: 100 },
      { title: 'B', days: 5, price: 200 },
      { title: 'C', days: 7, price: 300 },
      { title: 'D', days: 9, price: 400 },
    ],
  };

  it('renders each item through the template, capped at max_items', () => {
    const out = renderItems(body, BASE_CONFIG);
    expect(out.count).toBe(3);
    expect(out.text).toBe(
      '• A — 3 days, from ₹100\n• B — 5 days, from ₹200\n• C — 7 days, from ₹300'
    );
  });

  it('uses empty_text and count 0 when there are no items', () => {
    const out = renderItems({ data: [] }, BASE_CONFIG);
    expect(out).toEqual({ text: 'No matching tours found.', count: 0 });
  });

  it('treats a non-array at items_path as empty', () => {
    expect(renderItems({ data: 'x' }, BASE_CONFIG).count).toBe(0);
  });

  it('hard caps max_items at 10', () => {
    const many = { data: Array.from({ length: 30 }, (_, i) => ({ title: i })) };
    const out = renderItems(many, {
      ...BASE_CONFIG,
      item_template: '{{item.title}}',
      max_items: 99,
    });
    expect(out.count).toBe(10);
  });

  it('keeps the message under the WhatsApp text limit', () => {
    const long = { data: [{ title: 'x'.repeat(5000) }] };
    const out = renderItems(long, {
      ...BASE_CONFIG,
      item_template: '{{item.title}}',
    });
    expect(out.text.length).toBeLessThanOrEqual(3500);
  });
});

describe('runHttpFetch', () => {
  it('fetches, renders and returns variables on success', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ title: 'Kerala', days: 7, price: 28240 }] })
    );
    const result = await runHttpFetch({
      config: BASE_CONFIG,
      vars: { destination: 'kerala' },
      allowedHosts: ALLOWED,
      fetchImpl,
    });
    expect(result).toEqual({
      ok: true,
      vars: {
        tours: '• Kerala — 7 days, from ₹28240',
        tours_count: 1,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      'https://api.example.com/api/tours?search=kerala&limit=3'
    );
    expect(init.redirect).toBe('manual');
    expect(init.method).toBe('GET');
  });

  it('fails without calling out when the host is not allowed', async () => {
    const fetchImpl = vi.fn();
    const result = await runHttpFetch({
      config: { ...BASE_CONFIG, url: 'https://evil.example.org/x' },
      vars: {},
      allowedHosts: ALLOWED,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when no hosts are allowed at all', async () => {
    const fetchImpl = vi.fn();
    const result = await runHttpFetch({
      config: BASE_CONFIG,
      vars: {},
      allowedHosts: [],
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails on a non-2xx status', async () => {
    const result = await runHttpFetch({
      config: BASE_CONFIG,
      vars: {},
      allowedHosts: ALLOWED,
      fetchImpl: async () => jsonResponse({}, { status: 500 }),
    });
    expect(result).toEqual({ ok: false, reason: 'bad_status_500' });
  });

  it('does not follow redirects', async () => {
    const result = await runHttpFetch({
      config: BASE_CONFIG,
      vars: {},
      allowedHosts: ALLOWED,
      fetchImpl: async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/' },
        }),
    });
    expect(result).toEqual({ ok: false, reason: 'bad_status_302' });
  });

  it('fails on invalid JSON', async () => {
    const result = await runHttpFetch({
      config: BASE_CONFIG,
      vars: {},
      allowedHosts: ALLOWED,
      fetchImpl: async () => new Response('<html>', { status: 200 }),
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('fails when the response is too large', async () => {
    const result = await runHttpFetch({
      config: BASE_CONFIG,
      vars: {},
      allowedHosts: ALLOWED,
      maxBytes: 10,
      fetchImpl: async () =>
        jsonResponse({ data: [{ title: 'x'.repeat(100) }] }),
    });
    expect(result).toEqual({ ok: false, reason: 'response_too_large' });
  });

  it('fails when the request errors or times out', async () => {
    const result = await runHttpFetch({
      config: BASE_CONFIG,
      vars: {},
      allowedHosts: ALLOWED,
      fetchImpl: async () => {
        throw new Error('boom');
      },
    });
    expect(result).toEqual({ ok: false, reason: 'request_failed' });
  });

  it('returns empty_text with count 0 when the API finds nothing', async () => {
    const result = await runHttpFetch({
      config: BASE_CONFIG,
      vars: { destination: 'nowhere' },
      allowedHosts: ALLOWED,
      fetchImpl: async () => jsonResponse({ data: [] }),
    });
    expect(result).toEqual({
      ok: true,
      vars: { tours: 'No matching tours found.', tours_count: 0 },
    });
  });
});
