// POST lets the iOS app recover a website purchase without showing a license key field
// (App Review 3.1.1). `{ email }` mails an 8-digit code and returns a signed challenge;
// `{ challenge, code }` returns the Polar license key, which the app then activates.
import type { Polar } from '@polar-sh/sdk/2026-10';
import { polarFor } from './checkout';
import { hmacKey, signLink, verifyLink } from './student';

const RESTORE_FROM = 'Myelin Notes <support@trymyelin.app>';
// 8 digits over this window keeps brute force at >100k guesses/s per challenge.
const CODE_TTL_MS = 15 * 60 * 1000;

interface Env {
  RESEND_API_KEY?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_ORGANIZATION_ID?: string;
  /** Separate from STUDENT_LINK_SECRET, or a challenge would pass as a student checkout link. */
  RESTORE_SECRET?: string;
}

interface RestoreFunctionContext {
  request: Request;
  env: Env;
}

interface RestoreRequest {
  email?: unknown;
  challenge?: unknown;
  code?: unknown;
}

function json(
  body: { challenge: string } | { key: string } | { message: string },
  status = 200,
) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

// Derived from the challenge, so nothing has to be stored between the two requests.
export async function restoreCode(
  challenge: string,
  secret: string,
): Promise<string> {
  const mac = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(`restore-code:${challenge}`),
  );
  const value = new DataView(mac).getUint32(0) % 100_000_000;
  return value.toString().padStart(8, '0');
}

// `null` when no paid order for this email carries a license key.
async function findLicenseKey(
  polar: Polar,
  organizationId: string,
  email: string,
): Promise<string | null> {
  const payments = await polar.payments.list({
    organization_id: organizationId,
    customer_email: email,
    status: 'succeeded',
  });
  for (const payment of payments.items) {
    if (!payment.order_id) {
      continue;
    }
    const order = await polar.orders.get(payment.order_id);
    const key = await customerLicenseKey(
      polar,
      organizationId,
      order.customer_id,
    );
    if (key) {
      return key;
    }
  }
  return null;
}

// `null` until Polar has granted the customer a license key benefit.
export async function customerLicenseKey(
  polar: Polar,
  organizationId: string,
  customerId: string,
): Promise<string | null> {
  const grants = await polar.benefitGrants.list({
    organization_id: organizationId,
    customer_id: customerId,
    is_granted: true,
  });
  for (const grant of grants.items) {
    if (
      'license_key_id' in grant.properties &&
      grant.properties.license_key_id
    ) {
      return (await polar.licenseKeys.get(grant.properties.license_key_id)).key;
    }
  }
  return null;
}

export async function sendEmail(
  apiKey: string,
  to: string,
  text: string,
  subject = 'Your Myelin Notes Pro code',
) {
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESTORE_FROM,
      to: [to],
      subject,
      text,
    }),
  });
  if (!result.ok) {
    throw new Error(`Resend returned ${result.status}`);
  }
}

export async function onRequestPost({
  request,
  env,
}: RestoreFunctionContext): Promise<Response> {
  const apiKey = env.RESEND_API_KEY?.trim();
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  const organizationId = env.POLAR_ORGANIZATION_ID?.trim();
  const secret = env.RESTORE_SECRET?.trim();
  if (!apiKey || !accessToken || !organizationId || !secret) {
    return json({ message: 'Restoring is temporarily unavailable.' }, 503);
  }
  const polar = polarFor(request, accessToken);
  const body = (await request.json().catch(() => ({}))) as RestoreRequest;

  if (typeof body.challenge === 'string' && typeof body.code === 'string') {
    const email = await verifyLink(body.challenge, secret, Date.now());
    const expected = await restoreCode(body.challenge, secret);
    if (!email || body.code.trim() !== expected) {
      return json({ message: 'That code is wrong or has expired.' }, 400);
    }
    try {
      const key = await findLicenseKey(polar, organizationId, email);
      return key
        ? json({ key })
        : json({ message: 'No Pro purchase was found.' }, 404);
    } catch (error) {
      console.error('Could not look up a license key', error);
      return json({ message: 'We could not reach the license server.' }, 502);
    }
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ message: 'Please enter a valid email address.' }, 400);
  }

  // Every address gets an email, so the response never reveals who has bought Pro.
  try {
    const challenge = await signLink(email, secret, Date.now(), CODE_TTL_MS);
    const found = await findLicenseKey(polar, organizationId, email);
    await sendEmail(
      apiKey,
      email,
      found
        ? `Your Myelin Notes Pro code is ${await restoreCode(challenge, secret)}\n\nEnter it in the Myelin app within 15 minutes. If you did not ask for this, you can ignore this email.\n\nMyelin Notes`
        : 'We could not find a Myelin Notes Pro purchase for this email address. If you bought Pro with a different address, try that one.\n\nMyelin Notes',
    );
    return json({ challenge });
  } catch (error) {
    console.error('Could not send a restore email', error);
    return json(
      { message: 'We could not send the email. Please try again.' },
      502,
    );
  }
}
