import { describe, expect, it } from 'vitest';
import {
  buildInviteText,
  buildTemplateParams,
  templateVariableCount,
} from './invite-message';

describe('invite message', () => {
  it('greets by first name and includes the link', () => {
    const t = buildInviteText({
      kind: 'group',
      name: 'Goa Dec 12',
      url: 'https://chat.whatsapp.com/abc',
      contactName: 'Asha Rao',
    });
    expect(t).toContain('Hi Asha!');
    expect(t).toContain('https://chat.whatsapp.com/abc');
  });

  it('words channels differently and copes with no name', () => {
    const t = buildInviteText({
      kind: 'channel',
      name: 'Amstago',
      url: 'https://whatsapp.com/channel/x',
      contactName: null,
    });
    expect(t.startsWith('Hi! ')).toBe(true);
    expect(t).toContain('Channel');
  });

  it('counts template variables and fills them in order', () => {
    expect(templateVariableCount('Hi {{1}}, join {{2}}: {{3}}')).toBe(3);
    expect(templateVariableCount('no vars')).toBe(0);
    expect(
      buildTemplateParams(2, { name: 'Goa', url: 'u', contactName: 'Asha Rao' })
    ).toEqual(['Asha', 'Goa']);
    expect(buildTemplateParams(0, { name: 'Goa', url: 'u', contactName: null })).toEqual([]);
  });
});
