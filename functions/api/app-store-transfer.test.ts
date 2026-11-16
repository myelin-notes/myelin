import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './app-store-transfer';

async function privateKeyPem(): Promise<string> {
  const { privateKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', privateKey),
  );
  return `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
}

function signedTransaction(payload: object): string {
  const part = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${part({ alg: 'ES256' })}.${part(payload)}.sig`;
}

async function transfer(appleTransaction: object) {
  const fetchMock = vi.fn(async (_url: string | URL | Request) =>
    Response.json({
      signedTransactionInfo: signedTransaction(appleTransaction),
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const response = await onRequestPost({
    request: new Request('https://preview.pages.dev/api/app-store-transfer', {
      method: 'POST',
      body: JSON.stringify({ transactionId: '2000000123', email: 'a@b.co' }),
    }),
    env: {
      RESEND_API_KEY: 'resend',
      POLAR_ACCESS_TOKEN: 'polar',
      POLAR_ORGANIZATION_ID: 'org',
      POLAR_APP_STORE_PRODUCT_ID: 'product',
      APPLE_IAP_KEY_ID: 'kid',
      APPLE_IAP_ISSUER_ID: 'issuer',
      APPLE_IAP_PRIVATE_KEY: await privateKeyPem(),
    },
  });
  return { response, urls: fetchMock.mock.calls.map(([url]) => String(url)) };
}

const purchase = {
  bundleId: 'com.github.wintersteve25.myelin',
  productId: 'com.github.wintersteve25.myelin.pro',
  originalTransactionId: '2000000100',
};

describe('app-store-transfer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['refunded', { ...purchase, revocationDate: 1 }],
    ['another app', { ...purchase, bundleId: 'com.example.other' }],
    ['another product', { ...purchase, productId: 'com.example.tip' }],
  ])('mints nothing for a %s purchase', async (_case, appleTransaction) => {
    const { response, urls } = await transfer(appleTransaction);
    expect(response.status).toBe(404);
    // Only Apple is asked, and its sandbox, since this is not trymyelin.app.
    expect(urls).toEqual([
      'https://api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/2000000123',
    ]);
  });
});
