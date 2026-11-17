import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadMedia } from './meta-api';

function stubFetch(body: Uint8Array, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body as BodyInit, { status: 200, headers }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const args = { downloadUrl: 'https://cdn.example/audio', accessToken: 't' };

describe('downloadMedia size cap', () => {
  it('returns the bytes when no cap is given', async () => {
    stubFetch(new Uint8Array([1, 2, 3]), { 'content-type': 'audio/ogg' });
    const { buffer, contentType } = await downloadMedia(args);
    expect(buffer.length).toBe(3);
    expect(contentType).toBe('audio/ogg');
  });

  it('returns the bytes when under the cap', async () => {
    stubFetch(new Uint8Array(10));
    const { buffer } = await downloadMedia({ ...args, maxBytes: 10 });
    expect(buffer.length).toBe(10);
  });

  it('refuses a file whose declared size is over the cap', async () => {
    stubFetch(new Uint8Array(4), { 'content-length': '999999' });
    await expect(downloadMedia({ ...args, maxBytes: 100 })).rejects.toThrow(
      /larger than 100/
    );
  });

  it('refuses a file that turns out larger than the cap', async () => {
    stubFetch(new Uint8Array(50));
    await expect(downloadMedia({ ...args, maxBytes: 10 })).rejects.toThrow(
      /larger than 10/
    );
  });
});
