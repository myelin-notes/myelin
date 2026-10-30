import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost } from '../../../../functions/api/student';

const env = {
  RESEND_API_KEY: 'resend-key',
  POLAR_ACCESS_TOKEN: 'polar-token',
  POLAR_PRO_PRODUCT_ID: 'pro-product',
  POLAR_STUDENT_DISCOUNT_ID: 'student-discount',
  STUDENT_LINK_SECRET: 'link-secret',
};

const swotFiles: Record<string, string> = {
  'stoplist.txt': 'cqut.edu.cn\n',
  'abused.txt': 'mdx.ac\n',
  'tlds.txt': 'edu\nac.uk\n',
  'cn/edu/cqut.txt': 'Chongqing University of Technology\n',
  'de/tum.txt': 'Technical University of Munich\n',
};

function stubServices() {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const swotPath = url.split('/lib/domains/')[1];
    if (swotPath !== undefined) {
      const body = swotFiles[swotPath];
      return body === undefined
        ? new Response('', { status: 404 })
        : new Response(body);
    }
    if (url.startsWith('https://api.resend.com/')) {
      return Response.json({ id: 'email-id' });
    }
    if (url.startsWith('https://api.polar.sh/')) {
      return Response.json({ url: 'https://polar.sh/checkout/abc' });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function requestLink(email: string): Promise<Response> {
  const formData = new FormData();
  formData.set('email', email);
  return onRequestPost({
    request: new Request('https://trymyelin.app/api/student', {
      method: 'POST',
      body: formData,
    }),
    env,
  });
}

function sentEmails(fetch: ReturnType<typeof stubServices>) {
  return fetch.mock.calls
    .filter(([url]) => String(url).startsWith('https://api.resend.com/'))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function openLink(href: string): Promise<Response> {
  return onRequestGet({ request: new Request(href), env });
}

describe('student verification handler', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emails a school address a link that opens a discounted checkout', async () => {
    const fetch = stubServices();

    const response = await requestLink('Ada@TUM.de');
    expect(response.status).toBe(200);

    const [email] = sentEmails(fetch);
    expect(email.to).toEqual(['ada@tum.de']);
    const link = /https:\/\/trymyelin\.app\/api\/student\?token=\S+/.exec(
      email.text,
    )?.[0];
    expect(link).toBeDefined();

    const checkout = await openLink(link as string);
    expect(checkout.status).toBe(303);
    expect(checkout.headers.get('Location')).toBe(
      'https://polar.sh/checkout/abc',
    );
    const polarCall = fetch.mock.calls.find(([url]) =>
      String(url).startsWith('https://api.polar.sh/'),
    );
    expect(JSON.parse(String(polarCall?.[1]?.body))).toMatchObject({
      products: ['pro-product'],
      discount_id: 'student-discount',
      customer_email: 'ada@tum.de',
    });
  });

  it('accepts academic TLDs and rejects unlisted, stoplisted and abused domains', async () => {
    const fetch = stubServices();

    expect((await requestLink('ada@cs.ox.ac.uk')).status).toBe(200);
    expect((await requestLink('ada@gmail.com')).status).toBe(422);
    expect((await requestLink('ada@2012.cqut.edu.cn')).status).toBe(422);
    expect((await requestLink('ada@mdx.ac')).status).toBe(422);
    expect((await requestLink('ada@../tlds')).status).toBe(400);
    expect(sentEmails(fetch)).toHaveLength(1);
  });

  it('refuses forged and expired links without calling Polar', async () => {
    const fetch = stubServices();
    vi.useFakeTimers({ toFake: ['Date'] });

    await requestLink('ada@tum.de');
    const link = new URL(
      /https:\/\/\S+/.exec(sentEmails(fetch)[0].text)?.[0] as string,
    );
    const [payload, signature] = (
      link.searchParams.get('token') as string
    ).split('.');
    const forged = btoa(
      JSON.stringify({ email: 'someone@gmail.com', exp: Date.now() + 1e9 }),
    );
    link.searchParams.set('token', `${forged}.${signature}`);
    expect((await openLink(link.href)).status).toBe(400);

    link.searchParams.set('token', `${payload}.${signature}`);
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    expect((await openLink(link.href)).status).toBe(400);

    expect(
      fetch.mock.calls.some(([url]) =>
        String(url).startsWith('https://api.polar.sh/'),
      ),
    ).toBe(false);
  });
});
