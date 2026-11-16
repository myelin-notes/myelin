import { invoke } from '@tauri-apps/api/core';

interface EntitlementResult {
  active: boolean;
  /** The Play purchase token, set when `active`. */
  transactionId?: string;
}

// The Android plugin rejects with a plain `{ message }` object, not an Error.
function toError(error: unknown): never {
  throw new Error(
    (error as { message?: string } | null)?.message ?? String(error),
  );
}

/** Resolves inactive for a cancelled or pending purchase. */
export function purchasePro(productId: string): Promise<EntitlementResult> {
  return invoke<EntitlementResult>('plugin:play-billing|purchase_pro', {
    productId,
  }).catch(toError);
}

export function proEntitlement(productId: string): Promise<EntitlementResult> {
  return invoke<EntitlementResult>('plugin:play-billing|pro_entitlement', {
    productId,
  }).catch(toError);
}
