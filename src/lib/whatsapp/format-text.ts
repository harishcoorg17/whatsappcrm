/**
 * WhatsApp text formatting for display: *bold*, _italic_ and ~strike~.
 *
 * Returns plain data segments rather than HTML, so the caller renders them as
 * React text and message content can never inject markup. A marker only
 * formats when it opens a word, hugs non-space text, closes on the same line
 * and is not glued to letters or digits (so snake_case and "2 * 3" are left
 * alone), the same way WhatsApp itself behaves.
 */

export type TextStyle = 'bold' | 'italic' | 'strike';

export interface TextSegment {
  text: string;
  style: TextStyle | null;
}

const STYLE_BY_MARKER: Record<string, TextStyle> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
};

const FORMAT_PATTERN =
  /(^|[^\p{L}\p{N}])([*_~])(?=\S)([^\n]*?\S)\2(?![\p{L}\p{N}])/gmu;

export function formatWhatsAppText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(FORMAT_PATTERN)) {
    const [whole, prefix, marker, content] = match;
    const start = (match.index ?? 0) + prefix.length;
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), style: null });
    }
    segments.push({ text: content, style: STYLE_BY_MARKER[marker] });
    cursor = (match.index ?? 0) + whole.length;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), style: null });
  }
  return segments;
}
