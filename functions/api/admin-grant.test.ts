import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './admin-grant';
import { base64url } from './student';

const RSA = {
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};
const accessKey = await crypto.subtle.generateKey(RSA, true, [
  'sign',
  'verify',
]);
const forgerKey = await crypto.subtle.generateKey(RSA, true, [
  'sign',
  'verify',
]);

async function accessToken(signer: CryptoKey, aud = 'admin-aud') {
  const part = (value: object) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${part({ alg: 'RS256', kid: 'kid-1' })}.${part({
    aud: [aud],
    exp: Date.now() / 1000 + 60,
  })}`;
  const signature = await crypto.subtle.sign(
    RSA,
    signer,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

function stubPolar() {
  let confirmed = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'team.cloudflareaccess.com') {
      const jwk = await crypto.subtle.exportKey('jwk', accessKey.publicKey);
      return Response.json({ keys: [{ ...jwk, kid: 'kid-1' }] });
    }
    if (url.pathname === '/v1/orders/') {
      const items = confirmed
        ? [
            {
              customer_id: 'customer-1',
              customer: { email: 'ada@example.com' },
            },
          ]
        : [];
      return Response.json({
        items,
        pagination: { total_count: items.length, max_page: 1 },
      });
    }
    if (url.pathname === '/v1/checkouts/') {
      return Response.json({ client_secret: 'cs' });
    }
    if (url.pathname === '/v1/checkouts/client/cs/confirm') {
      confirmed = true;
      return Response.json({});
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
    throw new Error(`Unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

function grant(token: string | null) {
  return onRequestPost({
    request: new Request('https://trymyelin.app/api/admin-grant', {
      method: 'POST',
      headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
      body: JSON.stringify({ email: ' Ada@example.com ' }),
    }),
    env: {
      POLAR_ACCESS_TOKEN: 'polar',
      POLAR_ORGANIZATION_ID: 'org',
      POLAR_PRO_PRODUCT_ID: 'pro-product',
      CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      CF_ACCESS_AUD: 'admin-aud',
    },
  });
}

describe('admin grant', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['no token', async () => null],
    ['a forged token', () => accessToken(forgerKey.privateKey)],
    ['another Access app', () => accessToken(accessKey.privateKey, 'other')],
  ])('touches nothing in Polar with %s', async (_case, token) => {
    const fetch = stubPolar();
    expect((await grant(await token())).status).toBe(401);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes('polar')),
    ).toEqual([]);
  });

  it('creates a $0 Pro order and returns its key without emailing', async () => {
    const fetch = stubPolar();
    const response = await grant(await accessToken(accessKey.privateKey));

    expect(await response.json()).toEqual({ key: 'MYELIN-KEY' });
    const checkout = fetch.mock.calls.find(
      ([url]) => new URL(String(url)).pathname === '/v1/checkouts/',
    );
    expect(JSON.parse(String(checkout?.[1]?.body))).toMatchObject({
      products: ['pro-product'],
      customer_email: 'ada@example.com',
      prices: { 'pro-product': [{ amount_type: 'fixed', price_amount: 0 }] },
    });
    // Only Access and Polar are called, so no email of ours goes out.
    expect(
      new Set(fetch.mock.calls.map(([url]) => new URL(String(url)).hostname)),
    ).toEqual(new Set(['team.cloudflareaccess.com', 'api.polar.sh']));
  });
});
