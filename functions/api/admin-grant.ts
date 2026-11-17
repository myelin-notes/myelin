// POST `{ email }` from behind Cloudflare Access gives that address Pro as if they had bought it
// on the website: a $0 Pro order, so Polar grants the key and sends its own emails.
// We send nothing; the key comes back for the admin page. Repeat grants return the first key.
import { polarFor } from './checkout';
import { transferKey } from './store-transfer';
import { fromBase64url } from './student';

const ADMIN_METADATA_KEY = 'admin_grant';

interface Env {
  POLAR_ACCESS_TOKEN?: string;
  POLAR_ORGANIZATION_ID?: string;
  POLAR_PRO_PRODUCT_ID?: string;
  /** e.g. `myelin.cloudflareaccess.com`. */
  CF_ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application covering /api/admin-grant. */
  CF_ACCESS_AUD?: string;
}

interface AdminGrantFunctionContext {
  request: Request;
  env: Env;
}

function json(body: { key: string } | { message: string }, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

// Checked here too because the *.pages.dev aliases serve this function without the Access policy.
async function signedByAccess(
  request: Request,
  teamDomain: string,
  aud: string,
): Promise<boolean> {
  const [header, payload, signature] =
    request.headers.get('Cf-Access-Jwt-Assertion')?.split('.') ?? [];
  if (!signature) {
    return false;
  }
  const decode = (part: string) =>
    JSON.parse(new TextDecoder().decode(fromBase64url(part)));
  try {
    const { kid } = decode(header) as { kid: string };
    const { keys } = (await (
      await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
    ).json()) as { keys: (JsonWebKey & { kid: string })[] };
    const jwk = keys.find((candidate) => candidate.kid === kid);
    if (!jwk) {
      return false;
    }
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const key = await crypto.subtle.importKey('jwk', jwk, algorithm, false, [
      'verify',
    ]);
    const claims = decode(payload) as { aud: string | string[]; exp: number };
    return (
      (await crypto.subtle.verify(
        algorithm,
        key,
        fromBase64url(signature),
        new TextEncoder().encode(`${header}.${payload}`),
      )) &&
      [claims.aud].flat().includes(aud) &&
      claims.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

export async function onRequestPost({
  request,
  env,
}: AdminGrantFunctionContext): Promise<Response> {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (
    !accessToken ||
    !env.CF_ACCESS_TEAM_DOMAIN ||
    !env.CF_ACCESS_AUD ||
    !env.POLAR_ORGANIZATION_ID ||
    !env.POLAR_PRO_PRODUCT_ID
  ) {
    return json({ message: 'Granting is not configured.' }, 503);
  }
  if (
    !(await signedByAccess(
      request,
      env.CF_ACCESS_TEAM_DOMAIN,
      env.CF_ACCESS_AUD,
    ))
  ) {
    return json({ message: 'Sign in through Cloudflare Access.' }, 401);
  }

  const body = (await request.json().catch(() => ({}))) as { email?: unknown };
  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ message: 'Please enter a valid email address.' }, 400);
  }

  try {
    const found = await transferKey(
      polarFor(request, accessToken),
      env.POLAR_ORGANIZATION_ID,
      env.POLAR_PRO_PRODUCT_ID,
      ADMIN_METADATA_KEY,
      email,
      email,
      true,
    );
    return found
      ? json({ key: found.key })
      : json(
          { message: 'Order created; the key is still being granted. Retry.' },
          502,
        );
  } catch (error) {
    console.error('Could not grant Pro', error);
    return json({ message: `Polar rejected the grant: ${error}` }, 502);
  }
}
