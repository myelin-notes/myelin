// POST creates a Pro checkout session for the pricing page to embed. A `token`
// from the student email applies the student discount to that inbox's address.
import { createPolar } from '@polar-sh/sdk/2026-10';
import { verifyLink } from './student';

interface Env {
  POLAR_ACCESS_TOKEN?: string;
  POLAR_PRO_PRODUCT_ID?: string;
  POLAR_STUDENT_DISCOUNT_ID?: string;
  STUDENT_LINK_SECRET?: string;
}

interface CheckoutFunctionContext {
  request: Request;
  env: Env;
}

function json(body: { url: string } | { message: string }, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function onRequestPost({
  request,
  env,
}: CheckoutFunctionContext): Promise<Response> {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (!accessToken || !env.POLAR_PRO_PRODUCT_ID) {
    return json({ message: 'Checkout is temporarily unavailable.' }, 503);
  }

  const { token } = (await request.json().catch(() => ({}))) as {
    token?: unknown;
  };
  let studentEmail: string | null = null;
  if (typeof token === 'string') {
    const secret = env.STUDENT_LINK_SECRET?.trim();
    if (!secret || !env.POLAR_STUDENT_DISCOUNT_ID) {
      return json({ message: 'Student checkout is unavailable.' }, 503);
    }
    studentEmail = await verifyLink(token, secret, Date.now());
    if (!studentEmail) {
      return json({ message: 'This link is invalid or has expired.' }, 400);
    }
  }

  // Dev and *.pages.dev previews use sandbox, so a preview can never take a real payment.
  const polar = createPolar({
    accessToken,
    environment:
      new URL(request.url).hostname === 'trymyelin.app'
        ? 'production'
        : 'sandbox',
  });
  try {
    const checkout = await polar.checkouts.create({
      products: [env.POLAR_PRO_PRODUCT_ID],
      // The embed refuses to load on any origin other than this one.
      embed_origin: new URL(request.url).origin,
      // Without it Polar sees the Worker's IP and picks the wrong tax country and currency.
      customer_ip_address: request.headers.get('CF-Connecting-IP'),
      ...(studentEmail && {
        discount_id: env.POLAR_STUDENT_DISCOUNT_ID,
        allow_discount_codes: false,
        customer_email: studentEmail,
      }),
    });
    return json({ url: checkout.url });
  } catch (error) {
    console.error('Polar rejected a checkout', error);
    return json({ message: 'We could not start the checkout.' }, 502);
  }
}
