import { describe, expect, it } from 'vitest';
import { buildTenantSlug, deriveTenantName, slugify } from './slug';

describe('slugify', () => {
  it('lowercases and replaces runs of non-alphanumerics with one dash', () => {
    expect(slugify('Dream  Colors & Co.')).toBe('dream-colors-co');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  --Hello--  ')).toBe('hello');
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(slugify('***')).toBe('');
  });

  it('caps the length so slugs stay readable in URLs', () => {
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe('buildTenantSlug', () => {
  it('appends the suffix to the slugified name', () => {
    expect(buildTenantSlug('Dream Colors', 'ab12')).toBe('dream-colors-ab12');
  });

  it('falls back to "workspace" when the name has no usable characters', () => {
    expect(buildTenantSlug('!!!', 'ab12')).toBe('workspace-ab12');
  });
});

describe('deriveTenantName', () => {
  it('prefers the trimmed full name', () => {
    expect(deriveTenantName('  Asha Rao ', 'asha@example.com')).toBe(
      'Asha Rao'
    );
  });

  it('uses the email local part when there is no full name', () => {
    expect(deriveTenantName(undefined, 'asha@example.com')).toBe('asha');
  });

  it('ignores non-string full names', () => {
    expect(deriveTenantName(42, 'asha@example.com')).toBe('asha');
  });

  it('falls back to a generic name when nothing is available', () => {
    expect(deriveTenantName('', undefined)).toBe('My workspace');
  });

  it('caps the length of very long names', () => {
    expect(deriveTenantName('x'.repeat(200), undefined).length).toBe(80);
  });
});
