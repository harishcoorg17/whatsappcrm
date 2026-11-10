import { describe, expect, it } from 'vitest';
import { formatWhatsAppText } from './format-text';

describe('formatWhatsAppText', () => {
  it('returns plain text as one unstyled segment', () => {
    expect(formatWhatsAppText('hello world')).toEqual([
      { text: 'hello world', style: null },
    ]);
  });

  it('marks *bold*, _italic_ and ~strike~', () => {
    expect(formatWhatsAppText('a *b* c _d_ e ~f~ g')).toEqual([
      { text: 'a ', style: null },
      { text: 'b', style: 'bold' },
      { text: ' c ', style: null },
      { text: 'd', style: 'italic' },
      { text: ' e ', style: null },
      { text: 'f', style: 'strike' },
      { text: ' g', style: null },
    ]);
  });

  it('formats at the very start and end of the text', () => {
    expect(formatWhatsAppText('*Amstago* trips')).toEqual([
      { text: 'Amstago', style: 'bold' },
      { text: ' trips', style: null },
    ]);
  });

  it('does not format when the marker touches a space inside', () => {
    expect(formatWhatsAppText('2 * 3 * 4')).toEqual([
      { text: '2 * 3 * 4', style: null },
    ]);
  });

  it('leaves an unmatched marker alone', () => {
    expect(formatWhatsAppText('5 * stars')).toEqual([
      { text: '5 * stars', style: null },
    ]);
  });

  it('does not span lines', () => {
    expect(formatWhatsAppText('*one\ntwo*')).toEqual([
      { text: '*one\ntwo*', style: null },
    ]);
  });

  it('keeps snake_case words intact', () => {
    expect(formatWhatsAppText('send some_file_name now')).toEqual([
      { text: 'send some_file_name now', style: null },
    ]);
  });

  it('returns nothing for an empty string', () => {
    expect(formatWhatsAppText('')).toEqual([]);
  });

  it('never produces markup: the text is data, not HTML', () => {
    const segments = formatWhatsAppText('*<b>x</b>*');
    expect(segments).toEqual([{ text: '<b>x</b>', style: 'bold' }]);
  });
});
