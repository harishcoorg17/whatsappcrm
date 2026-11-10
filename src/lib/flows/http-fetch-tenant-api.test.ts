import { describe, expect, it, vi } from 'vitest';
import {
  isApiBaseTemplate,
  runHttpFetch,
  type HttpFetchConfig,
} from './http-fetch';

const CONFIG: HttpFetchConfig = {
  url: '{{api}}/tours?search={{vars.destination}}&limit=3',
  items_path: 'data',
  item_template: '• {{item.title}}',
  max_items: 3,
  save_as: 'tours',
  empty_text: 'Nothing found.',
  success_next: 'ok',
  failure_next: 'fail',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function okFetch() {
  return vi.fn(async () => jsonResponse({ data: [{ title: 'Kerala' }] }));
}

describe('isApiBaseTemplate', () => {
  it('recognises {{api}}/ at the start', () => {
    expect(isApiBaseTemplate('{{api}}/tours')).toBe(true);
    expect(isApiBaseTemplate('  {{api}}/tours')).toBe(true);
  });

  it('rejects other shapes', () => {
    expect(isApiBaseTemplate('{{api}}tours')).toBe(false);
    expect(isApiBaseTemplate('https://x.example.com/{{api}}/tours')).toBe(
      false
    );
  });
});

describe('runHttpFetch with a tenant API base', () => {
  it('resolves {{api}} against the tenant base, with no allow-list entry needed', async () => {
    const fetchImpl = okFetch();
    const result = await runHttpFetch({
      config: CONFIG,
      vars: { destination: 'kerala' },
      allowedHosts: [],
      apiBase: 'https://tenant-a.example.com/api',
      fetchImpl,
    });
    expect(result).toEqual({
      ok: true,
      vars: { tours: '• Kerala', tours_count: 1 },
    });
    const [calledUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(calledUrl).toBe(
      'https://tenant-a.example.com/api/tours?search=kerala&limit=3'
    );
  });

  it('uses a different host for a different tenant', async () => {
    const fetchImpl = okFetch();
    await runHttpFetch({
      config: CONFIG,
      vars: { destination: 'goa' },
      allowedHosts: [],
      apiBase: 'https://tenant-b.example.org/v2',
      fetchImpl,
    });
    const [calledUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(calledUrl).toBe(
      'https://tenant-b.example.org/v2/tours?search=goa&limit=3'
    );
  });

  it('fails without calling out when the tenant has no API configured', async () => {
    const fetchImpl = vi.fn();
    const result = await runHttpFetch({
      config: CONFIG,
      vars: {},
      allowedHosts: [],
      apiBase: null,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: 'no_api_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails when the stored base is not a plain https URL', async () => {
    const fetchImpl = vi.fn();
    const result = await runHttpFetch({
      config: CONFIG,
      vars: {},
      allowedHosts: [],
      apiBase: 'http://tenant-a.example.com/api',
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_api_base' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never substitutes variables inside the tenant base', async () => {
    const fetchImpl = okFetch();
    await runHttpFetch({
      config: CONFIG,
      vars: { destination: 'kerala', secret: 'LEAK' },
      allowedHosts: [],
      apiBase: 'https://tenant-a.example.com/{{vars.secret}}',
      fetchImpl,
    });
    const [calledUrl] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(calledUrl).toContain('/{{vars.secret}}/tours');
    expect(calledUrl).not.toContain('LEAK');
  });

  it('keeps absolute URLs on the operator allow-list even when a tenant base is set', async () => {
    const fetchImpl = vi.fn();
    const result = await runHttpFetch({
      config: { ...CONFIG, url: 'https://other.example.net/x' },
      vars: {},
      allowedHosts: [],
      apiBase: 'https://tenant-a.example.com/api',
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('runHttpFetch host guard', () => {
  it('blocks the call when the guard says the host is not public', async () => {
    const fetchImpl = vi.fn();
    const hostGuard = vi.fn(async () => false);
    const result = await runHttpFetch({
      config: CONFIG,
      vars: {},
      allowedHosts: [],
      apiBase: 'https://tenant-a.example.com/api',
      hostGuard,
      fetchImpl,
    });
    expect(result).toEqual({ ok: false, reason: 'host_not_public' });
    expect(hostGuard).toHaveBeenCalledWith('tenant-a.example.com');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('proceeds when the guard approves the host', async () => {
    const fetchImpl = okFetch();
    const result = await runHttpFetch({
      config: CONFIG,
      vars: { destination: 'kerala' },
      allowedHosts: [],
      apiBase: 'https://tenant-a.example.com/api',
      hostGuard: async () => true,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
  });
});
