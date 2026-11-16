import { invoke } from '@tauri-apps/api/core';

interface WebAuthenticationResult {
  callbackUrl: string;
}

export function authenticateWeb(
  url: string,
  callbackScheme: string,
  sessionId: string,
): Promise<WebAuthenticationResult> {
  return invoke('plugin:apple-compliance|authenticate_web', {
    url,
    callbackScheme,
    sessionId,
  });
}

export function cancelWebAuthentication(sessionId: string): Promise<void> {
  return invoke('plugin:apple-compliance|cancel_web_authentication', {
    sessionId,
  });
}

interface EntitlementResult {
  active: boolean;
  /** Set when `active`. */
  transactionId?: string;
}

// The iOS plugin rejects with a plain `{ message }` object, not an Error.
function toError(error: unknown): never {
  throw new Error(
    (error as { message?: string } | null)?.message ?? String(error),
  );
}

export function purchasePro(productId: string): Promise<EntitlementResult> {
  return invoke<EntitlementResult>('plugin:apple-compliance|purchase_pro', {
    productId,
  }).catch(toError);
}

export function proEntitlement(
  productId: string,
  sync: boolean,
): Promise<EntitlementResult> {
  return invoke<EntitlementResult>('plugin:apple-compliance|pro_entitlement', {
    productId,
    sync,
  }).catch(toError);
}

/** ISO 3166-1 alpha-3 App Store country, e.g. `USA`; `null` when the App Store is unreachable. */
export async function storefrontCountry(): Promise<string | null> {
  const { countryCode } = await invoke<{ countryCode: string | null }>(
    'plugin:apple-compliance|storefront',
  ).catch(toError);
  return countryCode;
}
