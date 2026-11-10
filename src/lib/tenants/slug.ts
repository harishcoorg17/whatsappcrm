const MAX_SLUG_LENGTH = 40;
const MAX_NAME_LENGTH = 80;
const DEFAULT_SLUG_BASE = 'workspace';
const DEFAULT_TENANT_NAME = 'My workspace';

/** Lowercase, dash-separated, URL-safe form of a name. May return ''. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/** A tenant slug: the readable name plus a short suffix for uniqueness. */
export function buildTenantSlug(name: string, suffix: string): string {
  const base = slugify(name) || DEFAULT_SLUG_BASE;
  return `${base}-${suffix}`;
}

/** The workspace name for a new self-serve user. */
export function deriveTenantName(
  fullName: unknown,
  email: string | undefined
): string {
  const fromFullName = typeof fullName === 'string' ? fullName.trim() : '';
  const fromEmail = email?.split('@')[0]?.trim() ?? '';
  const name = fromFullName || fromEmail || DEFAULT_TENANT_NAME;
  return name.slice(0, MAX_NAME_LENGTH);
}
