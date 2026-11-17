import type { GroupKind } from './invite-url';

/** Plain-text invite sent inside the 24-hour window. */
export function buildInviteText(args: {
  kind: GroupKind;
  name: string;
  url: string;
  contactName: string | null;
}): string {
  const first = args.contactName?.trim().split(/\s+/)[0];
  const hello = first ? `Hi ${first}! ` : 'Hi! ';
  return args.kind === 'channel'
    ? `${hello}Follow our WhatsApp Channel "${args.name}" for updates: ${args.url}`
    : `${hello}Here is the WhatsApp group for ${args.name}. Tap to join: ${args.url}`;
}

/** Highest {{n}} variable used in a template body (0 when none). */
export function templateVariableCount(body: string): number {
  let max = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * Template body variables in a fixed order: {{1}} first name, {{2}} group
 * name, {{3}} invite link. A template may use fewer (first N are filled).
 */
export function buildTemplateParams(
  count: number,
  args: { name: string; url: string; contactName: string | null }
): string[] {
  const first = args.contactName?.trim().split(/\s+/)[0] || 'there';
  return [first, args.name, args.url].slice(0, count);
}
