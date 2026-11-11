// POST `{ transactionId, email }` turns an App Store Pro purchase into a Polar license key for
// desktop. Apple's server API confirms the purchase, a $0 checkout for the App Store Pro product
// creates the Polar order, and the key is emailed so only the inbox owner receives it.
// One order per `originalTransactionId`: repeat requests re-send the key to the first address.
import { polarFor } from './checkout';
import { sendEmail } from './restore';
import { type StoreTransferEnv, transferKey } from './store-transfer';
import { base64url, fromBase64url } from './student';

const BUNDLE_ID = 'com.github.wintersteve25.myelin';
// Must match APP_STORE_PRO_PRODUCT_ID in the app.
const APP_STORE_PRODUCT_ID = 'com.github.wintersteve25.myelin.pro';
export const APPLE_METADATA_KEY = 'apple_original_transaction_id';

interface Env extends StoreTransferEnv {
  RESEND_API_KEY?: string;
  POLAR_ACCESS_TOKEN?: string;
  /** App Store Connect → Users and Access → Integrations → In-App Purchase key. */
  APPLE_IAP_KEY_ID?: string;
  APPLE_IAP_ISSUER_ID?: string;
  /** Contents of the .p8 file. */
  APPLE_IAP_PRIVATE_KEY?: string;
}

type AppleEnv = Pick<
  Env,
  'APPLE_IAP_KEY_ID' | 'APPLE_IAP_ISSUER_ID' | 'APPLE_IAP_PRIVATE_KEY'
>;

interface TransferFunctionContext {
  request: Request;
  env: Env;
}

interface AppleTransaction {
  bundleId: string;
  productId: string;
  originalTransactionId: string;
  revocationDate?: number;
}

function json(body: { ok: true } | { message: string }, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function appleToken(env: AppleEnv): Promise<string> {
  const der = fromBase64url(
    (env.APPLE_IAP_PRIVATE_KEY ?? '').replace(/-----[^-]+-----|\s/g, ''),
  );
  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: object) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: 'ES256', kid: env.APPLE_IAP_KEY_ID, typ: 'JWT' })}.${encode(
    {
      iss: env.APPLE_IAP_ISSUER_ID,
      iat: now,
      exp: now + 300,
      aud: 'appstoreconnect-v1',
      bid: BUNDLE_ID,
    },
  )}`;
  // WebCrypto's ECDSA output is already the raw r||s form JWS wants.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

// `null` when Apple has no such transaction. The payload is trusted without checking its JWS
// signature because it comes straight from Apple over TLS.
export async function appleTransaction(
  request: Request,
  env: AppleEnv,
  transactionId: string,
): Promise<AppleTransaction | null> {
  // Same split as `polarFor`, so sandbox purchases can never mint production keys.
  const host =
    new URL(request.url).hostname === 'trymyelin.app'
      ? 'api.storekit.itunes.apple.com'
      : 'api.storekit-sandbox.itunes.apple.com';
  const response = await fetch(
    `https://${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    { headers: { Authorization: `Bearer ${await appleToken(env)}` } },
  );
  if (response.status === 404 || response.status === 400) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`App Store Server API returned ${response.status}`);
  }
  const { signedTransactionInfo } = (await response.json()) as {
    signedTransactionInfo: string;
  };
  return JSON.parse(
    new TextDecoder().decode(
      fromBase64url(signedTransactionInfo.split('.')[1]),
    ),
  ) as AppleTransaction;
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
    !env.APPLE_IAP_KEY_ID ||
    !env.APPLE_IAP_ISSUER_ID ||
    !env.APPLE_IAP_PRIVATE_KEY
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
    !/^\d+$/.test(body.transactionId)
  ) {
    return json({ message: 'No App Store purchase was found.' }, 400);
  }

  const polar = polarFor(request, accessToken);
  try {
    const transaction = await appleTransaction(
      request,
      env,
      body.transactionId,
    );
    if (
      !transaction ||
      transaction.bundleId !== BUNDLE_ID ||
      transaction.productId !== APP_STORE_PRODUCT_ID ||
      transaction.revocationDate
    ) {
      return json({ message: 'No App Store purchase was found.' }, 404);
    }
    const found = await transferKey(
      polar,
      env,
      APPLE_METADATA_KEY,
      transaction.originalTransactionId,
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
      `Here is your Myelin Notes Pro license key for Mac, Windows, or Linux:\n\n${found.key}\n\nPaste it in Settings → Myelin Notes Pro on your computer. It works on 1 computer; your iPhone and iPad stay unlocked through the App Store.\n\nMyelin Notes`,
      'Your Myelin Notes Pro license key',
    );
    return json({ ok: true });
  } catch (error) {
    console.error('Could not transfer an App Store purchase', error);
    return json(
      { message: 'We could not reach the license server. Please try again.' },
      502,
    );
  }
}
