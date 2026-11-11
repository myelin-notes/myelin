// POST `{ transactionId, email }` turns a Google Play Pro purchase into a Polar license key for
// desktop, like app-store-transfer. `transactionId` is the Play purchase token; the Play
// Developer API confirms it, and the key is emailed so only the inbox owner receives it.
import { polarFor } from './checkout';
import { sendEmail } from './restore';
import { type StoreTransferEnv, transferKey } from './store-transfer';
import { base64url, fromBase64url } from './student';

const PACKAGE_NAME = 'com.github.wintersteve25.myelin';
// Must match PRO_PRODUCT_ID in the app.
const PLAY_PRODUCT_ID = 'com.github.wintersteve25.myelin.pro';
export const PLAY_METADATA_KEY = 'google_play_purchase_token';

interface Env extends StoreTransferEnv {
  RESEND_API_KEY?: string;
  POLAR_ACCESS_TOKEN?: string;
  /** JSON key of a service account invited in Play Console with "View financial data". */
  GOOGLE_PLAY_SERVICE_ACCOUNT?: string;
}

type PlayEnv = Pick<Env, 'GOOGLE_PLAY_SERVICE_ACCOUNT'>;

interface TransferFunctionContext {
  request: Request;
  env: Env;
}

/** Subset of the Play Developer API's `ProductPurchase`. */
interface PlayPurchase {
  /** 0 purchased, 1 cancelled (refunded or voided), 2 pending. */
  purchaseState: number;
  /** Absent for real purchases; 0 for license-tester purchases. */
  purchaseType?: number;
}

function json(body: { ok: true } | { message: string }, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function googleToken(env: PlayEnv): Promise<string> {
  const account = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT ?? '') as {
    client_email: string;
    private_key: string;
  };
  const key = await crypto.subtle.importKey(
    'pkcs8',
    fromBase64url(account.private_key.replace(/-----[^-]+-----|\s/g, '')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 300,
  })}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google OAuth returned ${response.status}`);
  }
  return ((await response.json()) as { access_token: string }).access_token;
}

// `null` when Play has no Pro purchase for this token. The package and product are part of the
// URL, so a token from another app or product is never found.
export async function playPurchase(
  env: PlayEnv,
  purchaseToken: string,
): Promise<PlayPurchase | null> {
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE_NAME}/purchases/products/${PLAY_PRODUCT_ID}/tokens/${encodeURIComponent(purchaseToken)}`,
    { headers: { Authorization: `Bearer ${await googleToken(env)}` } },
  );
  if (
    response.status === 404 ||
    response.status === 400 ||
    response.status === 410
  ) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Play Developer API returned ${response.status}`);
  }
  return (await response.json()) as PlayPurchase;
}

export async function onRequestPost({
  request,
  env,
}: TransferFunctionContext): Promise<Response> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (
    !apiKey ||
    !accessToken ||
    !env.POLAR_ORGANIZATION_ID ||
    !env.POLAR_APP_STORE_PRODUCT_ID ||
    !env.GOOGLE_PLAY_SERVICE_ACCOUNT
  ) {
    return json({ message: 'This is temporarily unavailable.' }, 503);
  }

  const body = (await request.json().catch(() => ({}))) as {
    transactionId?: unknown;
    email?: unknown;
  };
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ message: 'Please enter a valid email address.' }, 400);
  }
  if (
    typeof body.transactionId !== 'string' ||
    !/^[\w.-]{1,500}$/.test(body.transactionId)
  ) {
    return json({ message: 'No Google Play purchase was found.' }, 400);
  }

  const polar = polarFor(request, accessToken);
  try {
    const purchase = await playPurchase(env, body.transactionId);
    // Same split as `polarFor`, so tester purchases can never mint production keys.
    const production = new URL(request.url).hostname === 'trymyelin.app';
    if (
      !purchase ||
      purchase.purchaseState !== 0 ||
      (production && purchase.purchaseType === 0)
    ) {
      return json({ message: 'No Google Play purchase was found.' }, 404);
    }
    const found = await transferKey(
      polar,
      env,
      PLAY_METADATA_KEY,
      body.transactionId,
      email,
    );
    if (!found) {
      return json(
        { message: 'Your key is still being created. Try again in a minute.' },
        502,
      );
    }
    await sendEmail(
      apiKey,
      found.email,
      `Here is your Myelin Notes Pro license key for Mac, Windows, or Linux:\n\n${found.key}\n\nPaste it in Settings → Myelin Notes Pro on your computer. It works on 1 computer; your Android devices stay unlocked through Google Play.\n\nMyelin Notes`,
      'Your Myelin Notes Pro license key',
    );
    return json({ ok: true });
  } catch (error) {
    console.error('Could not transfer a Google Play purchase', error);
    return json(
      { message: 'We could not reach the license server. Please try again.' },
      502,
    );
  }
}
