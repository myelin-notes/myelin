// POST forwards the app's license key calls to Polar, which caps each key's activations.
// Status codes are the contract with the app: 404 means the key or activation is gone,
// 409 means the key is already on as many devices as it allows.
import type { Polar } from '@polar-sh/sdk/2026-10';
import { refundedOnAppStore } from './app-store-transfer';
import { polarFor } from './checkout';

interface Env {
  POLAR_ACCESS_TOKEN?: string;
  POLAR_ORGANIZATION_ID?: string;
  POLAR_APP_STORE_PRODUCT_ID?: string;
  /** License key benefit of POLAR_APP_STORE_PRODUCT_ID; only its keys are checked with Apple. */
  POLAR_APP_STORE_BENEFIT_ID?: string;
  APPLE_IAP_KEY_ID?: string;
  APPLE_IAP_ISSUER_ID?: string;
  APPLE_IAP_PRIVATE_KEY?: string;
}

interface LicenseFunctionContext {
  request: Request;
  env: Env;
}

interface LicenseRequest {
  action?: unknown;
  key?: unknown;
  activationId?: unknown;
  label?: unknown;
}

function json(
  body: { activationId: string } | { message: string },
  status = 200,
) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function polarStatus(error: unknown): number | undefined {
  return (error as { statusCode?: number } | null)?.statusCode;
}

// Revokes a key from app-store-transfer once its App Store purchase is refunded.
async function revokeIfRefunded(
  request: Request,
  env: Env,
  polar: Polar,
  key: { id: string; benefit_id: string; customer_id: string },
): Promise<boolean> {
  if (
    !env.POLAR_APP_STORE_BENEFIT_ID ||
    key.benefit_id !== env.POLAR_APP_STORE_BENEFIT_ID
  ) {
    return false;
  }
  try {
    if (!(await refundedOnAppStore(request, env, polar, key.customer_id))) {
      return false;
    }
  } catch (error) {
    // An Apple or Polar outage must not lock out people who paid.
    console.error('Could not check an App Store refund', error);
    return false;
  }
  await polar.licenseKeys.update(key.id, { status: 'revoked' });
  return true;
}

export async function onRequestPost({
  request,
  env,
}: LicenseFunctionContext): Promise<Response> {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  const organizationId = env.POLAR_ORGANIZATION_ID?.trim();
  if (!accessToken || !organizationId) {
    return json({ message: 'Licensing is temporarily unavailable.' }, 503);
  }

  const { action, key, activationId, label } = (await request
    .json()
    .catch(() => ({}))) as LicenseRequest;
  if (typeof key !== 'string' || !key.trim()) {
    return json({ message: 'Enter a license key.' }, 400);
  }
  const base = { key: key.trim(), organization_id: organizationId };
  const polar = polarFor(request, accessToken);

  try {
    if (action === 'activate') {
      const activation = await polar.licenseKeys.activate({
        ...base,
        label:
          typeof label === 'string' && label ? label.slice(0, 100) : 'Device',
      });
      if (await revokeIfRefunded(request, env, polar, activation.license_key)) {
        return json({ message: 'This purchase was refunded.' }, 404);
      }
      return json({ activationId: activation.id });
    }
    if (typeof activationId !== 'string' || !activationId) {
      return json({ message: 'Missing activation.' }, 400);
    }
    if (action === 'validate') {
      const validated = await polar.licenseKeys.validate({
        ...base,
        activation_id: activationId,
      });
      if (await revokeIfRefunded(request, env, polar, validated)) {
        return json({ message: 'This purchase was refunded.' }, 404);
      }
      return json({ activationId });
    }
    if (action === 'deactivate') {
      await polar.licenseKeys.deactivate({
        ...base,
        activation_id: activationId,
      });
      return json({ activationId });
    }
    return json({ message: 'Unknown action.' }, 400);
  } catch (error) {
    const status = polarStatus(error);
    // Polar also answers 403 for a revoked key. Validate never hits the activation limit, so
    // there it means revoked, and 404 makes the app drop Pro instead of keeping its last plan.
    if (status === 403 && action === 'validate') {
      return json({ message: 'This license key is no longer active.' }, 404);
    }
    // On activate, 403 is usually the activation limit.
    if (status === 403) {
      return json(
        {
          message:
            'This key is already active on as many devices as it allows.',
        },
        409,
      );
    }
    if (status === 404 || status === 422) {
      return json({ message: 'This license key is not valid.' }, 404);
    }
    console.error('Polar rejected a license call', error);
    return json({ message: 'We could not reach the license server.' }, 502);
  }
}
