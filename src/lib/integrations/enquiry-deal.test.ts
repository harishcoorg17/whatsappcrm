import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildDealNotes,
  describeGroup,
  estimateDealValue,
  executeEnquiryDeal,
  parseEnquiryBody,
  type EnquiryInput,
} from './enquiry-deal';

interface Row {
  [key: string]: unknown;
}

let tables: Record<string, Row[]> = {};
let nextId = 1;

/** Just enough of the Supabase query builder for these flows. */
function fakeDb(): SupabaseClient {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let updateValues: Row | null = null;
    let inserted: Row[] | null = null;

    const matching = () => rows.filter((r) => filters.every((f) => f(r)));
    const result = () => {
      if (updateValues) {
        matching().forEach((r) => Object.assign(r, updateValues));
        return { data: null, error: null };
      }
      return { data: inserted ?? matching(), error: null };
    };

    const query: Record<string, unknown> = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push((r) => r[column] === value);
        return query;
      },
      ilike: (column: string, pattern: string) => {
        const needle = pattern.replace(/^%|%$/g, '').toLowerCase();
        filters.push((r) => String(r[column] ?? '').toLowerCase().includes(needle));
        return query;
      },
      update: (values: Row) => {
        updateValues = values;
        return query;
      },
      insert: (values: Row | Row[]) => {
        inserted = (Array.isArray(values) ? values : [values]).map((v) => ({
          id: `${table}-${nextId++}`,
          created_at: `2026-01-01T00:00:${String(nextId).padStart(2, '0')}Z`,
          ...v,
        }));
        rows.push(...inserted);
        return query;
      },
      maybeSingle: async () => ({ data: (result().data as Row[])[0] ?? null, error: null }),
      single: async () => {
        const first = (result().data as Row[])[0];
        return first ? { data: first, error: null } : { data: null, error: { message: 'no row' } };
      },
      then: (resolve: (value: unknown) => void) => resolve(result()),
    };
    return query;
  };
  return { from } as unknown as SupabaseClient;
}

const auth = { keyId: 'k1', tenantId: 'tenant-1', ownerUserId: 'owner-1' };

const input = (over: Partial<EnquiryInput> = {}): EnquiryInput => ({
  reference: 'e1234567-aaaa-bbbb-cccc-ddddeeeeffff',
  name: 'Asha Rao',
  phone: '919876543210',
  email: 'asha@example.com',
  tourTitle: 'The Perfect 6-Day Kerala Itinerary',
  adults: 2,
  childAges: [7, 3],
  travelDate: '2026-12-05',
  message: 'Need a sea-view room',
  startingPrice: 25000,
  source: 'tour_page',
  pipelineName: 'Quote requests',
  stageName: 'New',
  ...over,
});

beforeEach(() => {
  tables = {};
  nextId = 1;
});

describe('parseEnquiryBody', () => {
  const valid = {
    reference: 'e1234567-aaaa',
    name: ' Asha Rao ',
    phone: '+91 98765 43210',
    tour_title: 'Kerala',
    children: [{ age: 7 }, 3],
  };

  it('accepts a minimal body and applies defaults', () => {
    const r = parseEnquiryBody(valid);
    expect(r).toMatchObject({
      ok: true,
      value: {
        name: 'Asha Rao',
        phone: '919876543210',
        adults: 2,
        childAges: [7, 3],
        pipelineName: 'Quote requests',
        stageName: 'New',
        source: 'tour_page',
      },
    });
  });

  it.each([
    ['a non-object body', 'nope'],
    ['a missing reference', { ...valid, reference: '' }],
    ['a reference with a wildcard character', { ...valid, reference: 'a_b' }],
    ['a missing name', { ...valid, name: '' }],
    ['a short phone number', { ...valid, phone: '123' }],
    ['a missing tour', { ...valid, tour_title: '' }],
    ['zero adults', { ...valid, adults: 0 }],
    ['a child older than 17', { ...valid, children: [{ age: 18 }] }],
    ['a badly formatted date', { ...valid, travel_date: '05/12/2026' }],
    ['a negative starting price', { ...valid, starting_price: -1 }],
  ])('rejects %s', (_label, body) => {
    expect(parseEnquiryBody(body).ok).toBe(false);
  });
});

describe('deal text', () => {
  it('describes the group with kids', () => {
    expect(describeGroup(2, [7, 3])).toBe('2 adults + 2 kids (ages 7, 3)');
    expect(describeGroup(1, [])).toBe('1 adult');
  });

  it('puts the details and the reference marker in the notes', () => {
    const notes = buildDealNotes(input());
    expect(notes).toContain('Tour: The Perfect 6-Day Kerala Itinerary');
    expect(notes).toContain('Group: 2 adults + 2 kids (ages 7, 3)');
    expect(notes).toContain('Travel date: 2026-12-05');
    expect(notes).toContain('Email: asha@example.com');
    expect(notes).toContain('Message: Need a sea-view room');
    expect(notes.endsWith('[ref:e1234567-aaaa-bbbb-cccc-ddddeeeeffff]')).toBe(true);
  });

  it('estimates the value as the per-person price for the adults', () => {
    expect(estimateDealValue(input({ adults: 3, startingPrice: 25000 }))).toBe(75000);
    expect(estimateDealValue(input({ startingPrice: undefined }))).toBe(0);
  });
});

describe('executeEnquiryDeal', () => {
  it('creates the contact, the pipeline with its stages, and the deal', async () => {
    const r = await executeEnquiryDeal({ db: fakeDb(), auth, input: input() });

    expect(r).toMatchObject({ ok: true, status: 'created' });
    expect(tables.contacts).toHaveLength(1);
    expect(tables.contacts[0]).toMatchObject({ tenant_id: 'tenant-1', user_id: 'owner-1', phone: '919876543210', name: 'Asha Rao' });
    expect(tables.pipelines).toHaveLength(1);
    expect(tables.pipeline_stages.map((s) => s.name)).toEqual(['New', 'Contacted', 'Quote sent', 'Won', 'Lost']);

    const stageNew = tables.pipeline_stages.find((s) => s.name === 'New');
    expect(tables.deals).toHaveLength(1);
    expect(tables.deals[0]).toMatchObject({
      user_id: 'owner-1',
      stage_id: stageNew?.id,
      contact_id: tables.contacts[0].id,
      title: 'Asha Rao — The Perfect 6-Day Kerala Itinerary',
      value: 50000,
      currency: 'INR',
      status: 'open',
    });
  });

  it('returns the same deal for a repeated reference without creating more rows', async () => {
    const db = fakeDb();
    const first = await executeEnquiryDeal({ db, auth, input: input() });
    const second = await executeEnquiryDeal({ db, auth, input: input() });

    expect(second).toMatchObject({ ok: true, status: 'duplicate' });
    expect(second.ok && first.ok && second.dealId === first.dealId).toBe(true);
    expect(tables.deals).toHaveLength(1);
    expect(tables.contacts).toHaveLength(1);
  });

  it('reuses an existing contact whose number is written differently and fills in a missing email', async () => {
    tables.contacts = [{ id: 'c-old', user_id: 'owner-1', tenant_id: 'tenant-1', phone: '+91 98765 43210', name: 'Asha', email: null }];
    const r = await executeEnquiryDeal({ db: fakeDb(), auth, input: input() });

    expect(r).toMatchObject({ ok: true, contactId: 'c-old' });
    expect(tables.contacts).toHaveLength(1);
    expect(tables.contacts[0].email).toBe('asha@example.com');
  });

  it("links the deal to the traveller's existing conversation", async () => {
    tables.contacts = [{ id: 'c-old', user_id: 'owner-1', tenant_id: 'tenant-1', phone: '919876543210', name: 'Asha', email: null }];
    tables.conversations = [{ id: 'conv-1', user_id: 'owner-1', tenant_id: 'tenant-1', contact_id: 'c-old' }];
    await executeEnquiryDeal({ db: fakeDb(), auth, input: input() });

    expect(tables.deals[0].conversation_id).toBe('conv-1');
  });

  it('reuses an existing pipeline and the named stage instead of creating new ones', async () => {
    tables.pipelines = [{ id: 'p-1', user_id: 'owner-1', name: 'Quote requests', created_at: '2025-01-01' }];
    tables.pipeline_stages = [
      { id: 's-1', pipeline_id: 'p-1', name: 'Lead', position: 0 },
      { id: 's-2', pipeline_id: 'p-1', name: 'Quoted', position: 1 },
    ];
    await executeEnquiryDeal({ db: fakeDb(), auth, input: input({ stageName: 'quoted' }) });

    expect(tables.pipelines).toHaveLength(1);
    expect(tables.pipeline_stages).toHaveLength(2);
    expect(tables.deals[0]).toMatchObject({ pipeline_id: 'p-1', stage_id: 's-2' });
  });

  it('falls back to the first stage when the named stage does not exist', async () => {
    tables.pipelines = [{ id: 'p-1', user_id: 'owner-1', name: 'Quote requests', created_at: '2025-01-01' }];
    tables.pipeline_stages = [
      { id: 's-2', pipeline_id: 'p-1', name: 'Second', position: 1 },
      { id: 's-1', pipeline_id: 'p-1', name: 'First', position: 0 },
    ];
    await executeEnquiryDeal({ db: fakeDb(), auth, input: input({ stageName: 'Nope' }) });

    expect(tables.deals[0].stage_id).toBe('s-1');
  });

  it("does not touch another owner's pipelines", async () => {
    tables.pipelines = [{ id: 'p-other', user_id: 'someone-else', name: 'Quote requests', created_at: '2025-01-01' }];
    await executeEnquiryDeal({ db: fakeDb(), auth, input: input() });

    expect(tables.pipelines).toHaveLength(2);
    expect(tables.deals[0].pipeline_id).not.toBe('p-other');
  });
});
