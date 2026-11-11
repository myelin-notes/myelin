import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost as startCheckout } from '../../../../functions/api/checkout';
import { onRequestPost } from '../../../../functions/api/restore';

const env = {
  RESEND_API_KEY: 'resend-key',
  POLAR_ACCESS_TOKEN: 'polar-token',
  POLAR_ORGANIZATION_ID: 'org',
  POLAR_PRO_PRODUCT_ID: 'pro-product',
  POLAR_STUDENT_DISCOUNT_ID: 'student-discount',
  STUDENT_LINK_SECRET: 'student-secret',
  RESTORE_SECRET: 'restore-secret',
};

// One buyer, ada@example.com, whose order granted license key `lk-1`.
function stubServices() {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.resend.com') {
      return Response.json({ id: 'email-id' });
    }
    if (url.pathname === '/v1/payments/') {
      const bought =
        url.searchParams.get('customer_email') === 'ada@example.com';
      return Response.json({
        items: bought ? [{ order_id: 'order-1' }] : [],
        pagination: { total_count: bought ? 1 : 0, max_page: 1 },
      });
    }
    if (url.pathname === '/v1/orders/order-1') {
      return Response.json({ customer_id: 'customer-1' });
    }
    if (url.pathname === '/v1/benefit-grants/') {
      return Response.json({
        items: [{ properties: { license_key_id: 'lk-1' } }],
        pagination: { total_count: 1, max_page: 1 },
      });
    }
    if (url.pathname === '/v1/license-keys/lk-1') {
      return Response.json({ key: 'MYELIN-KEY' });
    }
    if (url.pathname === '/v1/checkouts/') {
      return Response.json({ url: 'https://polar.sh/checkout/abc' });
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function post(body: object): Promise<Response> {
  return onRequestPost({
    request: new Request('https://trymyelin.app/api/restore', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    env,
  });
}

function sentEmails(fetch: ReturnType<typeof stubServices>) {
  return fetch.mock.calls
    .filter(([url]) => String(url).startsWith('https://api.resend.com/'))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

describe('restore handler', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the license key only for the code emailed to the buyer', async () => {
    const fetch = stubServices();

    const { challenge } = await (
      await post({ email: 'Ada@example.com' })
    ).json();
    const code = /\d{8}/.exec(sentEmails(fetch)[0].text)?.[0];
    expect(code).toBeDefined();

    const wrong = String((Number(code) + 1) % 100_000_000).padStart(8, '0');
    expect((await post({ challenge, code: wrong })).status).toBe(400);

    const restored = await post({ challenge, code });
    expect(await restored.json()).toEqual({ key: 'MYELIN-KEY' });
  });

  it('answers a non-buyer the same way but emails no code', async () => {
    const fetch = stubServices();

    const response = await post({ email: 'eve@example.com' });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty('challenge');
    expect(sentEmails(fetch)[0].text).not.toMatch(/\d{8}/);
  });

  it('does not accept a restore challenge as a student checkout link', async () => {
    stubServices();

    const { challenge } = await (
      await post({ email: 'eve@example.com' })
    ).json();
    const checkout = await startCheckout({
      request: new Request('https://trymyelin.app/api/checkout', {
        method: 'POST',
        body: JSON.stringify({ token: challenge }),
      }),
      env,
    });
    expect(checkout.status).toBe(400);
  });
});
