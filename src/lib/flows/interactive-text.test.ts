import { describe, expect, it } from 'vitest';
import { describeInteractiveMessage } from './interactive-text';

describe('describeInteractiveMessage', () => {
  it('lists button titles under the body', () => {
    expect(
      describeInteractiveMessage({
        kind: 'buttons',
        bodyText: 'What next?',
        buttons: [{ title: 'See tours' }, { title: 'Plan this trip' }],
      })
    ).toBe('What next?\n\n• See tours\n• Plan this trip');
  });

  it('lists list rows with their descriptions', () => {
    expect(
      describeInteractiveMessage({
        kind: 'list',
        bodyText: 'Welcome!',
        buttonLabel: 'Choose an option',
        sections: [
          {
            title: 'Plan your trip',
            rows: [
              { title: 'Find a tour', description: 'Search live packages' },
              { title: 'Talk to a person' },
            ],
          },
        ],
      })
    ).toBe(
      'Welcome!\n\n☰ Choose an option\n• Find a tour — Search live packages\n• Talk to a person'
    );
  });

  it('flattens several sections in order', () => {
    const text = describeInteractiveMessage({
      kind: 'list',
      bodyText: 'Pick',
      buttonLabel: 'Open',
      sections: [
        { rows: [{ title: 'A' }] },
        { rows: [{ title: 'B' }, { title: 'C' }] },
      ],
    });
    expect(text.endsWith('• A\n• B\n• C')).toBe(true);
  });

  it('returns just the body when there are no options', () => {
    expect(
      describeInteractiveMessage({
        kind: 'buttons',
        bodyText: 'Hello',
        buttons: [],
      })
    ).toBe('Hello');
  });

  it('skips options that have no title', () => {
    expect(
      describeInteractiveMessage({
        kind: 'buttons',
        bodyText: 'Hi',
        buttons: [{ title: '' }, { title: 'Yes' }],
      })
    ).toBe('Hi\n\n• Yes');
  });
});
