/**
 * WhatsApp Cloud API Groups API: create a group and read its invite link.
 *
 * Creating a group is asynchronous. Meta answers the request, then later sends a
 * `group_lifecycle_update` webhook that carries the invite link (see group-events.ts).
 * Needs an Official Business Account and a Cloud-API-only number.
 */

import { GRAPH_BASE_URL } from './meta-config';

export const MAX_GROUP_SUBJECT = 128;
export const MAX_GROUP_DESCRIPTION = 2048;
const REQUEST_TIMEOUT_MS = 15_000;

export type JoinApprovalMode = 'auto_approve' | 'approval_required';

export class MetaGroupsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'MetaGroupsError';
  }
}

export interface CreateGroupArgs {
  phoneNumberId: string;
  accessToken: string;
  subject: string;
  description?: string | null;
  joinApprovalMode?: JoinApprovalMode;
}

export interface CreatedGroupRequest {
  /** Matches the `request_id` of the later webhook. */
  requestId: string | null;
  /** Present only if Meta returns it straight away. */
  groupId: string | null;
}

type FetchLike = typeof fetch;

function metaMessage(data: unknown, fallback: string): string {
  const error = (data as { error?: Record<string, unknown> } | null)?.error;
  if (!error) return fallback;
  const errorData = error.error_data as { details?: unknown } | undefined;
  const parts = [error.error_user_msg, errorData?.details, error.message]
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  return parts[0] ?? fallback;
}

async function callMeta(
  url: string,
  accessToken: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
  fetchImpl: FetchLike
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new MetaGroupsError('Could not reach WhatsApp.', 0);
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    // an empty or non-JSON body is handled below
  }
  if (!response.ok) {
    throw new MetaGroupsError(
      metaMessage(data, 'WhatsApp rejected the request.'),
      response.status
    );
  }
  return data;
}

export async function createWhatsAppGroup(
  args: CreateGroupArgs,
  fetchImpl: FetchLike = fetch
): Promise<CreatedGroupRequest> {
  const subject = args.subject.trim().slice(0, MAX_GROUP_SUBJECT);
  if (!subject) throw new MetaGroupsError('A group name is required.', 400);
  const description = args.description?.trim().slice(0, MAX_GROUP_DESCRIPTION);

  const data = await callMeta(
    `${GRAPH_BASE_URL}/${encodeURIComponent(args.phoneNumberId)}/groups`,
    args.accessToken,
    {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        subject,
        ...(description ? { description } : {}),
        join_approval_mode: args.joinApprovalMode ?? 'auto_approve',
      },
    },
    fetchImpl
  );

  const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
  return {
    requestId: text(data.request_id),
    groupId: text(data.id) ?? text(data.group_id),
  };
}

export const INVITE_LINK_PATTERN = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/;

/** The group's current invite link, or null if Meta returns none. */
export async function getGroupInviteLink(
  args: { groupId: string; accessToken: string },
  fetchImpl: FetchLike = fetch
): Promise<string | null> {
  const data = await callMeta(
    `${GRAPH_BASE_URL}/${encodeURIComponent(args.groupId)}/invite_link`,
    args.accessToken,
    { method: 'GET' },
    fetchImpl
  );
  const link = data.invite_link;
  return typeof link === 'string' && INVITE_LINK_PATTERN.test(link) ? link : null;
}
