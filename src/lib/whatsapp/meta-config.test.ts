import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPH_VERSION,
  graphBaseUrl,
  resolveGraphVersion,
} from './meta-config';

describe('resolveGraphVersion', () => {
  it('falls back to the default when nothing is configured', () => {
    expect(resolveGraphVersion(undefined, undefined)).toBe(
      DEFAULT_GRAPH_VERSION
    );
  });

  it('prefers the server-side value over the public one', () => {
    expect(resolveGraphVersion('v30.0', 'v28.0')).toBe('v30.0');
  });

  it('uses the public value when no server value is set', () => {
    expect(resolveGraphVersion(undefined, 'v28.0')).toBe('v28.0');
  });

  it('ignores malformed values instead of building a broken URL', () => {
    expect(resolveGraphVersion('latest', '27')).toBe(DEFAULT_GRAPH_VERSION);
    expect(resolveGraphVersion('v27.0/../me', undefined)).toBe(
      DEFAULT_GRAPH_VERSION
    );
  });
});

describe('graphBaseUrl', () => {
  it('builds the versioned Graph API base URL', () => {
    expect(graphBaseUrl('v27.0')).toBe('https://graph.facebook.com/v27.0');
  });
});
