// POST `{ transactionId, email }` turns an App Store Pro purchase into a Polar license key for
// desktop. Apple's server API confirms the purchase, a $0 checkout for the App Store Pro product
// creates the Polar order, and the key is emailed so only the inbox owner receives it.
// One order per `originalTransactionId`: repeat requests re-send the key to the first address.
import type { Polar } from '@polar-sh/sdk/2026-10';
import { polarFor } from './checkout';
import { customerLicenseKey, sendEmail } from './restore';
import { base64url, fromBase64url } from './student';

const BUNDLE_ID = 'com.github.wintersteve25.myelin';
// Must match APP_STORE_PRO_PRODUCT_ID in the app.
const APP_STORE_PRODUCT_ID = 'com.github.wintersteve25.myelin.pro';
const METADATA_KEY = 'apple_original_transaction_id';
// Polar creates the order and grants the license key in background jobs after confirming.
const GRANT_POLL_MS = 1500;
const GRANT_POLL_TRIES = 12;

interface Env {
  RESEND_API_KEY?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_ORGANIZATION_ID?: string;
  /** Free one-time product whose license key benefit allows 1 activation. */
  POLAR_APP_STORE_PRODUCT_ID?: string;
  /** App Store Connect → Users and Access → Integrations → In-App Purchase key. */
  APPLE_IAP_KEY_ID?: string;
  APPLE_IAP_ISSUER_ID?: string;
  /** Contents of the .p8 file. */
  APPLE_IAP_PRIVATE_KEY?: string;
}

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

async function appleToken(env: Env): Promise<string> {
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
async function appleTransaction(
  request: Request,
  env: Env,
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

// True only when Apple reports every App Store purchase behind this customer's transferred
// orders as refunded; a purchase Apple can't find is not treated as refunded.
export async function refundedOnAppStore(
  request: Request,
  env: Env,
  polar: Polar,
  customerId: string,
): Promise<boolean> {
  const orders = await polar.orders.list({
    organization_id: env.POLAR_ORGANIZATION_ID,
    product_id: env.POLAR_APP_STORE_PRODUCT_ID,
    customer_id: customerId,
  });
  const ids = orders.items
    .map((order) => order.metadata[METADATA_KEY])
    .filter((id) => typeof id === 'string');
  if (!ids.length) {
    return false;
  }
  for (const id of ids) {
    const transaction = await appleTransaction(request, env, id);
    if (!transaction?.revocationDate) {
      return false;
    }
  }
  return true;
}

// `null` when no order exists for this App Store purchase yet.
async function transferredOrder(
  polar: Polar,
  env: Env,
  originalTransactionId: string,
) {
  const orders = await polar.orders.list({
    organization_id: env.POLAR_ORGANIZATION_ID,
    product_id: env.POLAR_APP_STORE_PRODUCT_ID,
    metadata: { [METADATA_KEY]: originalTransactionId },
  });
  return orders.items[0] ?? null;
}

// Waits out Polar's background jobs; `null` if the order or key is still missing.
async function waitForKey(
  polar: Polar,
  env: Env,
  originalTransactionId: string,
): Promise<{ key: string; email: string } | null> {
  for (let attempt = 0; attempt < GRANT_POLL_TRIES; attempt++) {
    const order = await transferredOrder(polar, env, originalTransactionId);
    const key =
      order &&
      (await customerLicenseKey(
        polar,
        env.POLAR_ORGANIZATION_ID ?? '',
        order.customer_id,
      ));
    if (order?.customer.email && key) {
      return { key, email: order.customer.email };
    }
    await new Promise((resolve) => setTimeout(resolve, GRANT_POLL_MS));
  }
  return null;
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
    const { originalTransactionId } = transaction;

    // shortcut: two simultaneous first requests can both create an order; add a lock if that shows up.
    if (!(await transferredOrder(polar, env, originalTransactionId))) {
      const checkout = await polar.checkouts.create({
        products: [env.POLAR_APP_STORE_PRODUCT_ID],
        customer_email: email,
        metadata: { [METADATA_KEY]: originalTransactionId },
      });
      await polar.checkouts.clientConfirm(checkout.client_secret, {
        customer_email: email,
      });
    }

    const found = await waitForKey(polar, env, originalTransactionId);
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
