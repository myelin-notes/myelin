// Turns a verified store purchase into a Polar license key for desktop: a $0 checkout for the
// store Pro product creates one order per purchase, tagged with the purchase id in metadata.
import type { Polar } from '@polar-sh/sdk/2026-10';
import { customerLicenseKey } from './restore';

// Polar creates the order and grants the license key in background jobs after confirming.
const GRANT_POLL_MS = 1500;
const GRANT_POLL_TRIES = 12;

export interface StoreTransferEnv {
  POLAR_ORGANIZATION_ID?: string;
  /** Free one-time product whose license key benefit allows 1 activation. */
  POLAR_APP_STORE_PRODUCT_ID?: string;
}

// `null` when no order exists for this purchase yet.
async function transferredOrder(
  polar: Polar,
  env: StoreTransferEnv,
  metadataKey: string,
  purchaseId: string,
) {
  const orders = await polar.orders.list({
    organization_id: env.POLAR_ORGANIZATION_ID,
    product_id: env.POLAR_APP_STORE_PRODUCT_ID,
    metadata: { [metadataKey]: purchaseId },
  });
  return orders.items[0] ?? null;
}

/** The key for this purchase, creating its order for `email` on the first call; `null` while Polar is still granting it. Repeat calls keep the first address. */
export async function transferKey(
  polar: Polar,
  env: StoreTransferEnv,
  metadataKey: string,
  purchaseId: string,
  email: string,
): Promise<{ key: string; email: string } | null> {
  // shortcut: two simultaneous first requests can both create an order; add a lock if that shows up.
  if (!(await transferredOrder(polar, env, metadataKey, purchaseId))) {
    const checkout = await polar.checkouts.create({
      products: [env.POLAR_APP_STORE_PRODUCT_ID ?? ''],
      customer_email: email,
      metadata: { [metadataKey]: purchaseId },
    });
    await polar.checkouts.clientConfirm(checkout.client_secret, {
      customer_email: email,
    });
  }
  for (let attempt = 0; attempt < GRANT_POLL_TRIES; attempt++) {
    const order = await transferredOrder(polar, env, metadataKey, purchaseId);
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
