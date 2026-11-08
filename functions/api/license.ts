// POST forwards the app's license key calls to Polar, which caps each key at 3 activations.
// Status codes are the contract with the app: 404 means the key or activation is gone,
// 409 means the key is already on 3 devices.
import { polarFor } from './checkout';

interface Env {
  POLAR_ACCESS_TOKEN?: string;
  POLAR_ORGANIZATION_ID?: string;
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
      return json({ activationId: activation.id });
    }
    if (typeof activationId !== 'string' || !activationId) {
      return json({ message: 'Missing activation.' }, 400);
    }
    if (action === 'validate') {
      await polar.licenseKeys.validate({
        ...base,
        activation_id: activationId,
      });
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
    // Polar answers 403 when the activation limit is reached.
    if (status === 403) {
      return json({ message: 'This key is already active on 3 devices.' }, 409);
    }
    if (status === 404 || status === 422) {
      return json({ message: 'This license key is not valid.' }, 404);
    }
    console.error('Polar rejected a license call', error);
    return json({ message: 'We could not reach the license server.' }, 502);
  }
}
