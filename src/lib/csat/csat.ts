/**
 * CSAT (customer satisfaction) survey helpers. Pure: no I/O.
 *
 * The survey is a WhatsApp list message with five rows. Each row's id is
 * `csat_<score>`, which comes back in the webhook as the interactive reply id.
 */

export const CSAT_REPLY_PREFIX = 'csat_';
export const MAX_CSAT_MESSAGE_LENGTH = 600;
export const DEFAULT_CSAT_MESSAGE =
  'Thanks for chatting with us! How would you rate the support you received?';
/** Do not survey the same chat again within this window. */
export const CSAT_RESEND_WINDOW_MS = 24 * 60 * 60 * 1000;

const SCORE_LABELS: Record<number, string> = {
  5: '⭐⭐⭐⭐⭐ Excellent',
  4: '⭐⭐⭐⭐ Good',
  3: '⭐⭐⭐ Okay',
  2: '⭐⭐ Poor',
  1: '⭐ Very poor',
};

/** `csat_4` -> 4. Anything else (including `csat_9`, `csat_4x`) -> null. */
export function parseCsatReplyId(
  replyId: string | null | undefined
): number | null {
  if (!replyId) return null;
  const m = /^csat_([1-5])$/.exec(replyId.trim().toLowerCase());
  return m ? Number(m[1]) : null;
}

export function pickCsatMessage(custom: string | null | undefined): string {
  const t = custom?.trim();
  return t ? t.slice(0, MAX_CSAT_MESSAGE_LENGTH) : DEFAULT_CSAT_MESSAGE;
}

export function buildCsatList(custom: string | null | undefined) {
  return {
    bodyText: pickCsatMessage(custom),
    buttonLabel: 'Rate us',
    sections: [
      {
        rows: [5, 4, 3, 2, 1].map((score) => ({
          id: `${CSAT_REPLY_PREFIX}${score}`,
          title: SCORE_LABELS[score],
        })),
      },
    ],
  };
}

/** Survey only when switched on and not surveyed recently. */
export function shouldSendCsat(args: {
  enabled: boolean;
  lastRequestedAt: string | null | undefined;
  now?: Date;
}): boolean {
  if (!args.enabled) return false;
  if (!args.lastRequestedAt) return true;
  const last = Date.parse(args.lastRequestedAt);
  if (Number.isNaN(last)) return true;
  return (args.now ?? new Date()).getTime() - last >= CSAT_RESEND_WINDOW_MS;
}

export interface CsatSummary {
  responses: number;
  /** 1-5 with two decimals; null with no responses. */
  average: number | null;
}

/** Defensive parse of the `csat_summary` RPC JSON. */
export function parseCsatSummary(raw: unknown): CsatSummary {
  if (typeof raw !== 'object' || raw === null) {
    return { responses: 0, average: null };
  }
  const r = raw as Record<string, unknown>;
  const responses = Number(r.responses);
  const average = r.average === null ? NaN : Number(r.average);
  return {
    responses: Number.isFinite(responses) ? responses : 0,
    average: Number.isFinite(average) ? average : null,
  };
}
