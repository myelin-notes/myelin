import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestPost } from './play-transfer';

async function serviceAccount(): Promise<string> {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign'],
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', privateKey),
  );
  return JSON.stringify({
    client_email: 'play@example.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`,
  });
}

async function transfer(host: string, playPurchase: object) {
  const fetchMock = vi.fn(async (url: string | URL | Request) =>
    String(url).includes('oauth2')
      ? Response.json({ access_token: 'google' })
      : Response.json(playPurchase),
  );
  vi.stubGlobal('fetch', fetchMock);
  const response = await onRequestPost({
    request: new Request(`https://${host}/api/play-transfer`, {
      method: 'POST',
      body: JSON.stringify({ transactionId: 'tok.en-1', email: 'a@b.co' }),
    }),
    env: {
      RESEND_API_KEY: 'resend',
      POLAR_ACCESS_TOKEN: 'polar',
      POLAR_ORGANIZATION_ID: 'org',
      POLAR_APP_STORE_PRODUCT_ID: 'product',
      GOOGLE_PLAY_SERVICE_ACCOUNT: await serviceAccount(),
    },
  });
  return { response, urls: fetchMock.mock.calls.map(([url]) => String(url)) };
}

describe('play-transfer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['refunded', 'preview.pages.dev', { purchaseState: 1 }],
    ['pending', 'preview.pages.dev', { purchaseState: 2 }],
    ['tester', 'trymyelin.app', { purchaseState: 0, purchaseType: 0 }],
  ])('mints nothing for a %s purchase', async (_case, host, playPurchase) => {
    const { response, urls } = await transfer(host, playPurchase);
    expect(response.status).toBe(404);
    // Only Google is asked, about this app's Pro product.
    expect(urls).toEqual([
      'https://oauth2.googleapis.com/token',
      'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.github.wintersteve25.myelin/purchases/products/com.github.wintersteve25.myelin.pro/tokens/tok.en-1',
    ]);
  });
});
