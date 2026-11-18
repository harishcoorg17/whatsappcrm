/**
 * Recognises the pre-filled message a tour page's WhatsApp button sends, e.g.
 *
 *   "Hi Amstago! Thinking about the Kerala Itinerary 7 Days (7 days) for my
 *    next trip. Need some help!"
 *
 * and pulls out the tour the customer is asking about, so the AI can answer
 * from that tour's real details instead of a generic menu.
 */

export interface TourEnquiry {
  /** The tour's title as typed on the site, e.g. "Kerala Itinerary 7 Days". */
  title: string;
  /** The "(7 days)" suffix, when present. */
  days: number | null;
}

const MAX_TITLE_LENGTH = 120;
const MAX_SLUG_LENGTH = 100;

// "Thinking about [the] <title> [(N days)] for my next trip". The title is
// lazy so the optional "(N days)" and the trailing phrase stay out of it.
const ENQUIRY_PATTERN =
  /thinking about (?:the )?(.+?)\s*(?:\((\d{1,3})\s*days?\))?\s*for my next trip/i;

/** The tour a customer message is asking about, or null for any other text. */
export function parseTourEnquiry(
  text: string | null | undefined
): TourEnquiry | null {
  if (!text) return null;
  const match = ENQUIRY_PATTERN.exec(text);
  if (!match) return null;

  const title = match[1].replace(/\s+/g, ' ').trim();
  if (!title || title.length > MAX_TITLE_LENGTH) return null;

  const days = match[2] ? Number(match[2]) : null;
  return { title, days };
}

/** The newest enquiry in a list of customer messages (oldest first). */
export function findLatestTourEnquiry(
  texts: ReadonlyArray<string | null | undefined>
): TourEnquiry | null {
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const enquiry = parseTourEnquiry(texts[i]);
    if (enquiry) return enquiry;
  }
  return null;
}

/** "Kerala Itinerary 7 Days" -> "kerala-itinerary-7-days", for a tour lookup. */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
}
