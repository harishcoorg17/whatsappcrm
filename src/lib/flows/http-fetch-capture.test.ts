import { describe, expect, it } from 'vitest';
import { runHttpFetch, type HttpFetchConfig } from './http-fetch';
import { validateFlowForActivation } from './validate';

const BASE_CONFIG: HttpFetchConfig = {
  url: '{{api}}/places?search={{vars.q}}',
  items_path: 'data',
  item_template: '• {{item.name}}',
  max_items: 3,
  save_as: 'places',
  empty_text: 'Nothing found.',
  success_next: 'ok',
  failure_next: 'fail',
};

function run(config: HttpFetchConfig, body: unknown) {
  return runHttpFetch({
    config,
    vars: { q: 'x' },
    allowedHosts: [],
    apiBase: 'https://tenant.example.com/api',
    fetchImpl: async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });
}

describe('http_fetch capture', () => {
  it('stores fields of the first item in variables', async () => {
    const result = await run(
      { ...BASE_CONFIG, capture: { place_id: 'id', place_slug: 'slug' } },
      {
        data: [
          { id: 'p-1', slug: 'munnar', name: 'Munnar' },
          { id: 'p-2', slug: 'kochi', name: 'Kochi' },
        ],
      }
    );
    expect(result).toEqual({
      ok: true,
      vars: {
        place_id: 'p-1',
        place_slug: 'munnar',
        places: '• Munnar\n• Kochi',
        places_count: 2,
      },
    });
  });

  it('clears captured variables when nothing is found, so stale ids never linger', async () => {
    const result = await run(
      { ...BASE_CONFIG, capture: { place_id: 'id' } },
      { data: [] }
    );
    expect(result).toEqual({
      ok: true,
      vars: { place_id: '', places: 'Nothing found.', places_count: 0 },
    });
  });

  it('captures an empty string for a missing or non-text field', async () => {
    const result = await run(
      { ...BASE_CONFIG, capture: { a: 'nope', b: 'meta' } },
      { data: [{ name: 'Munnar', meta: { x: 1 } }] }
    );
    expect(result.ok && result.vars).toMatchObject({ a: '', b: '' });
  });

  it('reads nested fields with dotted paths', async () => {
    const result = await run(
      { ...BASE_CONFIG, capture: { city: 'location.city' } },
      { data: [{ name: 'Munnar', location: { city: 'Idukki' } }] }
    );
    expect(result.ok && result.vars).toMatchObject({ city: 'Idukki' });
  });

  it('works when the response body is itself the list', async () => {
    const result = await run(
      { ...BASE_CONFIG, items_path: '', capture: { place_id: 'id' } },
      [{ id: 'p-9', name: 'Goa' }]
    );
    expect(result.ok && result.vars).toMatchObject({
      place_id: 'p-9',
      places: '• Goa',
    });
  });

  it('never lets a capture overwrite the rendered text or count', async () => {
    const result = await run(
      {
        ...BASE_CONFIG,
        capture: { places: 'id', places_count: 'id' },
      },
      { data: [{ id: 'p-1', name: 'Munnar' }] }
    );
    expect(result.ok && result.vars).toMatchObject({
      places: '• Munnar',
      places_count: 1,
    });
  });

  it('ignores invalid variable names and keeps at most five captures', async () => {
    const capture = {
      'bad key': 'id',
      c1: 'id',
      c2: 'id',
      c3: 'id',
      c4: 'id',
      c5: 'id',
      c6: 'id',
    };
    const result = await run(
      { ...BASE_CONFIG, capture },
      {
        data: [{ id: 'p-1', name: 'Munnar' }],
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.vars).not.toHaveProperty('bad key');
      expect(result.vars).not.toHaveProperty('c6');
      expect(result.vars).toHaveProperty('c5', 'p-1');
    }
  });
});

describe('http_fetch item template with empty fields', () => {
  const template =
    '*{{item.name}}*\nBest time: {{item.best}}\nFee: {{item.fee}}\nSee more soon';

  it('leaves out a line when every field on it is empty', async () => {
    const result = await run(
      { ...BASE_CONFIG, item_template: template },
      { data: [{ name: 'Munnar', best: '', fee: 'Free' }] }
    );
    expect(result.ok && result.vars.places).toBe(
      '*Munnar*\nFee: Free\nSee more soon'
    );
  });

  it('treats missing and non-text fields as empty', async () => {
    const result = await run(
      { ...BASE_CONFIG, item_template: template },
      { data: [{ name: 'Munnar', best: null, fee: { x: 1 } }] }
    );
    expect(result.ok && result.vars.places).toBe('*Munnar*\nSee more soon');
  });

  it('keeps a line that has at least one filled field', async () => {
    const result = await run(
      { ...BASE_CONFIG, item_template: '{{item.a}} · {{item.b}}' },
      { data: [{ a: '2 hours', b: '' }] }
    );
    expect(result.ok && result.vars.places).toBe('2 hours · ');
  });

  it('keeps lines that have no fields at all, such as spacing', async () => {
    const result = await run(
      { ...BASE_CONFIG, item_template: '{{item.name}}\n' },
      { data: [{ name: 'A' }, { name: 'B' }] }
    );
    expect(result.ok && result.vars.places).toBe('A\n\nB\n');
  });
});

describe('validate — http_fetch capture', () => {
  const flow = {
    name: 'Capture',
    trigger_type: 'keyword' as const,
    trigger_config: { keywords: ['x'] },
    entry_node_id: 'start',
  };

  function issuesFor(capture: unknown) {
    return validateFlowForActivation(flow, [
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'f' } },
      {
        node_key: 'f',
        node_type: 'http_fetch',
        config: {
          ...BASE_CONFIG,
          capture,
          success_next: 'e',
          failure_next: 'e',
        },
      },
      { node_key: 'e', node_type: 'end', config: {} },
    ]).filter((i) => i.node_key === 'f');
  }

  it('accepts a valid capture map', () => {
    expect(issuesFor({ place_id: 'id', city: 'location.city' })).toEqual([]);
  });

  it('accepts no capture at all', () => {
    expect(issuesFor(undefined)).toEqual([]);
  });

  it('rejects an invalid variable name', () => {
    expect(issuesFor({ 'bad key': 'id' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'capture' })])
    );
  });

  it('rejects an unsafe field path', () => {
    expect(issuesFor({ place_id: 'id; drop' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'capture' })])
    );
  });

  it('rejects capturing into the result variable', () => {
    expect(issuesFor({ places: 'id' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'capture' })])
    );
  });

  it('rejects more than five captures', () => {
    const many = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, 'id'])
    );
    expect(issuesFor(many)).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'capture' })])
    );
  });
});
