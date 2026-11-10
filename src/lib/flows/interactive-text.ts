/**
 * Plain-text description of an interactive (buttons / list) message.
 *
 * WhatsApp shows the customer the options as tappable buttons, but the inbox
 * stores a message as text. Saving the options with the body lets an agent
 * see what the customer was offered. The conversation-list preview keeps
 * using the body alone.
 */

interface ListRow {
  title: string;
  description?: string;
}

export type InteractiveDescription =
  | {
      kind: 'buttons';
      bodyText: string;
      buttons: Array<{ title: string }>;
    }
  | {
      kind: 'list';
      bodyText: string;
      buttonLabel: string;
      sections: Array<{ title?: string; rows: ListRow[] }>;
    };

export function describeInteractiveMessage(
  input: InteractiveDescription
): string {
  if (input.kind === 'buttons') {
    const options = input.buttons
      .filter((button) => button.title)
      .map((button) => `• ${button.title}`);
    return options.length > 0
      ? `${input.bodyText}\n\n${options.join('\n')}`
      : input.bodyText;
  }

  const options = input.sections
    .flatMap((section) => section.rows)
    .filter((row) => row.title)
    .map((row) =>
      row.description ? `• ${row.title} — ${row.description}` : `• ${row.title}`
    );
  if (options.length === 0) return input.bodyText;
  return `${input.bodyText}\n\n☰ ${input.buttonLabel}\n${options.join('\n')}`;
}
