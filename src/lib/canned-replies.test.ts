import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_LENGTH,
  normalizeShortcut,
  readSlashQuery,
  renderReply,
  searchReplies,
  validateReplyDraft,
  type CannedReply,
} from './canned-replies';

const reply = (
  shortcut: string,
  body: string,
  title: string | null = null
): CannedReply => ({
  id: shortcut,
  shortcut,
  title,
  body,
  tenant_id: null,
});

describe('normalizeShortcut', () => {
  it('lowercases and drops a leading slash and spaces', () => {
    expect(normalizeShortcut(' /Hours ')).toBe('hours');
    expect(normalizeShortcut('//refund')).toBe('refund');
  });
});

describe('validateReplyDraft', () => {
  it('accepts a normal reply', () => {
    expect(
      validateReplyDraft({ shortcut: '/hours', body: 'We open at 9' })
    ).toEqual({});
  });

  it('rejects bad shortcuts', () => {
    expect(
      validateReplyDraft({ shortcut: 'two words', body: 'x' }).shortcut
    ).toBeTruthy();
    expect(
      validateReplyDraft({ shortcut: '', body: 'x' }).shortcut
    ).toBeTruthy();
    expect(
      validateReplyDraft({ shortcut: 'a'.repeat(33), body: 'x' }).shortcut
    ).toBeTruthy();
  });

  it('rejects an empty or oversized body and a long title', () => {
    expect(
      validateReplyDraft({ shortcut: 'a', body: '   ' }).body
    ).toBeTruthy();
    expect(
      validateReplyDraft({
        shortcut: 'a',
        body: 'x'.repeat(MAX_BODY_LENGTH + 1),
      }).body
    ).toBeTruthy();
    expect(
      validateReplyDraft({ shortcut: 'a', body: 'x', title: 't'.repeat(81) })
        .title
    ).toBeTruthy();
  });
});

describe('renderReply', () => {
  it('fills the first name and phone', () => {
    expect(
      renderReply('Hi {{name}}, we will call {{phone}}.', {
        name: 'Asha Menon',
        phone: '+919000000001',
      })
    ).toBe('Hi Asha, we will call +919000000001.');
  });

  it('is case and space tolerant in placeholders', () => {
    expect(renderReply('Hi {{ NAME }}!', { name: 'Ravi' })).toBe('Hi Ravi!');
  });

  it('never leaves a raw placeholder or a dangling gap when data is missing', () => {
    expect(renderReply('Hi {{name}}, thanks.', { name: null })).toBe(
      'Hi, thanks.'
    );
    expect(renderReply('Call {{phone}} now', {})).toBe('Call now');
  });

  it('leaves text without placeholders untouched', () => {
    expect(renderReply('We open at 9.\nSee you!', { name: 'Asha' })).toBe(
      'We open at 9.\nSee you!'
    );
  });
});

describe('readSlashQuery', () => {
  it('opens only for a slash command with no spaces', () => {
    expect(readSlashQuery('/')).toBe('');
    expect(readSlashQuery('/Hou')).toBe('hou');
    expect(readSlashQuery('hello')).toBeNull();
    expect(readSlashQuery('/hours now')).toBeNull();
    expect(readSlashQuery(' /hours')).toBeNull();
  });
});

describe('searchReplies', () => {
  const replies = [
    reply('hours', 'We open 9 to 6', 'Opening hours'),
    reply('hello', 'Hi, how can we help?'),
    reply('refund', 'Refunds take 5 days'),
    reply('thanks', 'Thanks for waiting, hours are long'),
  ];

  it('returns everything for an empty query, capped', () => {
    expect(searchReplies(replies, '').length).toBe(4);
    expect(searchReplies(replies, '', 2).length).toBe(2);
  });

  it('ranks shortcut matches above body matches', () => {
    const result = searchReplies(replies, 'hours').map((r) => r.shortcut);
    expect(result[0]).toBe('hours');
    expect(result).toContain('thanks');
  });

  it('matches prefixes and titles', () => {
    expect(searchReplies(replies, 'he').map((r) => r.shortcut)).toEqual([
      'hello',
    ]);
    expect(searchReplies(replies, 'opening').map((r) => r.shortcut)).toEqual([
      'hours',
    ]);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchReplies(replies, 'zzz')).toEqual([]);
  });
});
