import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from '../../../../functions/api/support';

function supportRequest(
  fields: Record<string, string>,
  apiKey = 'test-key',
): Promise<Response> {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    formData.set(name, value);
  }

  return onRequestPost({
    request: new Request('https://trymyelin.app/api/support', {
      method: 'POST',
      body: formData,
    }),
    env: { RESEND_API_KEY: apiKey },
  });
}

describe('support form handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends a reply-friendly support email', async () => {
    const send = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ id: 'email-id' }),
    );
    vi.stubGlobal('fetch', send);

    const response = await supportRequest({
      email: 'reader@example.com',
      subject: '  Trouble opening a note  ',
      message: 'The note stays blank after I open it.',
    });

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();

    const [, init] = send.mock.calls[0];
    const payload = JSON.parse(String(init?.body));
    expect(payload).toMatchObject({
      from: 'Myelin Support <support@trymyelin.app>',
      to: ['admin@trymyelin.app'],
      reply_to: 'reader@example.com',
      subject: '[Myelin Support] Trouble opening a note',
    });
    expect(payload.text).toContain('The note stays blank after I open it.');
    expect(payload.text).toContain('Suggested response\nHi,');
  });

  it('rejects invalid fields without calling the email provider', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    const response = await supportRequest({
      email: 'not-an-email',
      subject: 'Help',
      message: 'Something went wrong.',
    });

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('silently accepts honeypot submissions', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);

    const response = await supportRequest({
      email: 'bot@example.com',
      subject: 'Buy this',
      message: 'Spam',
      company: 'Spam Incorporated',
    });

    expect(response.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('reports provider failures without exposing provider details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ message: 'provider detail' }, { status: 422 }),
      ),
    );

    const response = await supportRequest({
      email: 'reader@example.com',
      subject: 'Help',
      message: 'Something went wrong.',
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      message: 'We could not send your message. Please try again.',
    });
  });
});
