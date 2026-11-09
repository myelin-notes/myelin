import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './license';

async function privateKeyPem(): Promise<string> {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', privateKey),
  );
  return btoa(String.fromCharCode(...der));
}

async function validate(appleTransaction: object) {
  const part = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '');
  const writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = request.url;
      if (url.includes('storekit')) {
        return Response.json({
          signedTransactionInfo: `${part({})}.${part(appleTransaction)}.sig`,
        });
      }
      if (url.includes('/v1/license-keys/validate')) {
        return Response.json({
          id: 'key1',
          benefit_id: 'app-store-benefit',
          customer_id: 'cus1',
        });
      }
      if (url.includes('/v1/orders/')) {
        return Response.json({
          items: [
            { metadata: { apple_original_transaction_id: '2000000100' } },
          ],
          pagination: { total_count: 1, max_page: 1 },
        });
      }
      writes.push({ url, body: await request.json() });
      return Response.json({ id: 'key1' });
    }),
  );
  const response = await onRequestPost({
    request: new Request('https://preview.pages.dev/api/license', {
      method: 'POST',
      body: JSON.stringify({
        action: 'validate',
        key: 'KEY',
        activationId: 'act1',
      }),
    }),
    env: {
      POLAR_ACCESS_TOKEN: 'polar',
      POLAR_ORGANIZATION_ID: 'org',
      POLAR_APP_STORE_PRODUCT_ID: 'product',
      POLAR_APP_STORE_BENEFIT_ID: 'app-store-benefit',
      APPLE_IAP_KEY_ID: 'kid',
      APPLE_IAP_ISSUER_ID: 'issuer',
      APPLE_IAP_PRIVATE_KEY: await privateKeyPem(),
    },
  });
  return { status: response.status, writes };
}

const purchase = {
  bundleId: 'com.github.wintersteve25.myelin',
  productId: 'com.github.wintersteve25.myelin.pro',
  originalTransactionId: '2000000100',
};

describe('license validate for App Store keys', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('revokes the key once the App Store purchase is refunded', async () => {
    const { status, writes } = await validate({
      ...purchase,
      revocationDate: 1,
    });
    expect(status).toBe(404);
    expect(writes).toEqual([
      {
        url: expect.stringContaining('/v1/license-keys/key1'),
        body: { status: 'revoked' },
      },
    ]);
  });

  it('keeps the key while the purchase stands', async () => {
    const { status, writes } = await validate(purchase);
    expect(status).toBe(200);
    expect(writes).toEqual([]);
  });
});
