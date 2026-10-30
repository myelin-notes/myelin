// POST emails a signed checkout link to a school address that JetBrains swot
// recognises; GET follows that link into a Polar checkout with the student discount.
const SWOT_DOMAINS =
  'https://raw.githubusercontent.com/JetBrains/swot/master/lib/domains';
const POLAR_CHECKOUTS = 'https://api.polar.sh/v1/checkouts/';
const STUDENT_FROM = 'Myelin Notes <support@trymyelin.app>';
const LINK_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EMAIL_LENGTH = 254;

interface Env {
  RESEND_API_KEY?: string;
  POLAR_ACCESS_TOKEN?: string;
  POLAR_PRO_PRODUCT_ID?: string;
  POLAR_STUDENT_DISCOUNT_ID?: string;
  /** Signs the emailed link, so only the inbox owner can open the discounted checkout. */
  STUDENT_LINK_SECRET?: string;
}

interface StudentFunctionContext {
  request: Request;
  env: Env;
}

function json(message: string, status = 200): Response {
  return Response.json(
    { message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

// `null` for anything that is not a plain ASCII domain: the domain becomes a
// path into the swot repo, so dots, slashes and empty labels must not slip through.
function emailDomain(email: string): string | null {
  if (email.length > MAX_EMAIL_LENGTH) {
    return null;
  }
  const match = /^[^\s@]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/.exec(email);
  return match ? match[1] : null;
}

// `null` on 404, which for a school file means the domain is not listed.
async function fetchSwot(path: string): Promise<string | null> {
  const response = await fetch(`${SWOT_DOMAINS}/${path}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`swot returned ${response.status} for ${path}`);
  }
  return response.text();
}

async function fetchSwotList(name: string): Promise<Set<string>> {
  const body = await fetchSwot(`${name}.txt`);
  if (body === null) {
    throw new Error(`swot list ${name} is missing`);
  }
  return new Set(body.split('\n').map((line) => line.trim()));
}

// Mirrors swot's `isAcademic`, plus its abused list: a domain is rejected if any
// suffix is stoplisted or abused, and accepted if a suffix is an academic TLD
// or has a school file at its reversed path (ox.ac.uk -> uk/ac/ox.txt).
async function isAcademic(domain: string): Promise<boolean> {
  const labels = domain.split('.').reverse();
  const paths = labels.map((_, i) => labels.slice(0, i + 1).join('/'));
  const suffixes = paths.map((path) => path.split('/').reverse().join('.'));

  const [stoplist, abused, tlds, ...schools] = await Promise.all([
    fetchSwotList('stoplist'),
    fetchSwotList('abused'),
    fetchSwotList('tlds'),
    ...paths.map((path) => fetchSwot(`${path}.txt`)),
  ]);
  const listed = (list: Set<string>) =>
    suffixes.some((suffix) => list.has(suffix));

  if (listed(stoplist) || listed(abused)) {
    return false;
  }
  return listed(tlds) || schools.some((school) => school !== null);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signLink(
  email: string,
  secret: string,
  now: number,
): Promise<string> {
  const payload = new TextEncoder().encode(
    JSON.stringify({ email, exp: now + LINK_TTL_MS }),
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    payload,
  );
  return `${base64url(payload)}.${base64url(new Uint8Array(signature))}`;
}

// The email the link was issued to, or `null` if it is forged, malformed or expired.
async function verifyLink(
  token: string,
  secret: string,
  now: number,
): Promise<string | null> {
  try {
    const [payloadPart, signaturePart] = token.split('.');
    const payload = fromBase64url(payloadPart);
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64url(signaturePart),
      payload,
    );
    if (!valid) {
      return null;
    }
    const { email, exp } = JSON.parse(new TextDecoder().decode(payload)) as {
      email: string;
      exp: number;
    };
    return exp > now ? email : null;
  } catch {
    return null;
  }
}

function studentEmailText(link: string): string {
  return `Hi,

Your school email address is verified. Use this link to buy Myelin Pro at the student price of $29.99:

${link}

The link works for 24 hours. If it expires, request a new one at https://trymyelin.app/pricing.

If you did not ask for this, you can ignore this email.

Myelin Notes`;
}

export async function onRequestPost({
  request,
  env,
}: StudentFunctionContext): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json('Please enter your school email address.', 400);
  }

  const company = formData.get('company');
  if (typeof company === 'string' && company.trim()) {
    return json('Check your inbox for the student checkout link.');
  }

  const rawEmail = formData.get('email');
  const email =
    typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  const domain = emailDomain(email);
  if (!domain) {
    return json('Please enter a valid email address.', 400);
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  const secret = env.STUDENT_LINK_SECRET?.trim();
  if (!apiKey || !secret) {
    return json(
      'Student verification is temporarily unavailable. Please try again later.',
      503,
    );
  }

  try {
    if (!(await isAcademic(domain))) {
      return json('We do not recognise that as a school email address.', 422);
    }
  } catch (error) {
    console.error('Could not check a student domain', error);
    return json('We could not check that address. Please try again.', 502);
  }

  const link = new URL('/api/student', request.url);
  link.searchParams.set('token', await signLink(email, secret, Date.now()));

  let result: Response;
  try {
    result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: STUDENT_FROM,
        to: [email],
        subject: 'Your Myelin Pro student price',
        text: studentEmailText(link.href),
      }),
    });
  } catch {
    return json('We could not send the email. Please try again.', 502);
  }

  if (!result.ok) {
    console.error(
      'Resend rejected a student verification email',
      result.status,
    );
    return json('We could not send the email. Please try again.', 502);
  }

  return json('Check your inbox for the student checkout link.');
}

export async function onRequestGet({
  request,
  env,
}: StudentFunctionContext): Promise<Response> {
  const secret = env.STUDENT_LINK_SECRET?.trim();
  const polarToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (
    !secret ||
    !polarToken ||
    !env.POLAR_PRO_PRODUCT_ID ||
    !env.POLAR_STUDENT_DISCOUNT_ID
  ) {
    return text(
      'Student checkout is temporarily unavailable. Please try again later.',
      503,
    );
  }

  const token = new URL(request.url).searchParams.get('token') ?? '';
  const email = await verifyLink(token, secret, Date.now());
  if (!email) {
    return text(
      'This link is invalid or has expired. Request a new one at https://trymyelin.app/pricing.',
      400,
    );
  }

  let checkout: Response;
  try {
    checkout = await fetch(POLAR_CHECKOUTS, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${polarToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        products: [env.POLAR_PRO_PRODUCT_ID],
        discount_id: env.POLAR_STUDENT_DISCOUNT_ID,
        allow_discount_codes: false,
        customer_email: email,
      }),
    });
  } catch {
    return text('We could not start the checkout. Please try again.', 502);
  }

  if (!checkout.ok) {
    console.error('Polar rejected a student checkout', checkout.status);
    return text('We could not start the checkout. Please try again.', 502);
  }

  const { url } = (await checkout.json()) as { url: string };
  return Response.redirect(url, 303);
}
