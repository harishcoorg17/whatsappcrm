import { describe, expect, it, vi } from 'vitest';
import { MetaGroupsError, createWhatsAppGroup, getGroupInviteLink } from './groups-api';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('createWhatsAppGroup', () => {
  it('posts the subject, description and approval mode to the number’s /groups edge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ request_id: 'req-1', id: 'wa-1' }));
    const out = await createWhatsAppGroup(
      { phoneNumberId: '123', accessToken: 'tok', subject: ' Kerala ', description: 'Led by Ravi' },
      fetchMock as unknown as typeof fetch
    );
    expect(out).toEqual({ requestId: 'req-1', groupId: 'wa-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/123\/groups$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp', subject: 'Kerala', description: 'Led by Ravi', join_approval_mode: 'auto_approve',
    });
  });

  it('cuts the subject to 128 characters and tolerates a response without ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    const out = await createWhatsAppGroup(
      { phoneNumberId: '1', accessToken: 't', subject: 'x'.repeat(300) },
      fetchMock as unknown as typeof fetch
    );
    expect(out).toEqual({ requestId: null, groupId: null });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).subject).toHaveLength(128);
  });

  it('refuses an empty subject without calling Meta', async () => {
    const fetchMock = vi.fn();
    await expect(createWhatsAppGroup({ phoneNumberId: '1', accessToken: 't', subject: '  ' }, fetchMock as unknown as typeof fetch))
      .rejects.toBeInstanceOf(MetaGroupsError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a Meta error into a MetaGroupsError with the useful message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { message: 'Invalid parameter', error_data: { details: 'Not an OBA' } } }, 400));
    await expect(createWhatsAppGroup({ phoneNumberId: '1', accessToken: 't', subject: 's' }, fetchMock as unknown as typeof fetch))
      .rejects.toMatchObject({ message: 'Not an OBA', status: 400 });
  });

  it('reports a network failure without leaking details', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET 10.1.2.3'));
    await expect(createWhatsAppGroup({ phoneNumberId: '1', accessToken: 't', subject: 's' }, fetchMock as unknown as typeof fetch))
      .rejects.toMatchObject({ message: 'Could not reach WhatsApp.', status: 0 });
  });
});

describe('getGroupInviteLink', () => {
  it('returns a chat.whatsapp.com link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ invite_link: 'https://chat.whatsapp.com/AbC_1-2' }));
    expect(await getGroupInviteLink({ groupId: 'wa-1', accessToken: 't' }, fetchMock as unknown as typeof fetch)).toBe('https://chat.whatsapp.com/AbC_1-2');
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/wa-1\/invite_link$/);
  });

  it('returns null for anything that is not a WhatsApp invite link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ invite_link: 'https://evil.example/x' }));
    expect(await getGroupInviteLink({ groupId: 'wa-1', accessToken: 't' }, fetchMock as unknown as typeof fetch)).toBeNull();
  });
});
