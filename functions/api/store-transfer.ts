// Turns a verified store purchase (or an admin grant) into a Polar license key: a $0 checkout
// creates one order per purchase, tagged with the purchase id in metadata.
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
  organizationId: string,
  productId: string,
  metadataKey: string,
  purchaseId: string,
) {
  const orders = await polar.orders.list({
    organization_id: organizationId,
    product_id: productId,
    metadata: { [metadataKey]: purchaseId },
  });
  return orders.items[0] ?? null;
}

/** The key for this purchase, creating its order for `email` on the first call; `null` while Polar is still granting it. Repeat calls keep the first address. */
export async function transferKey(
  polar: Polar,
  organizationId: string,
  productId: string,
  metadataKey: string,
  purchaseId: string,
  email: string,
  /** For a paid product: prices this one checkout at $0. */
  free = false,
): Promise<{ key: string; email: string } | null> {
  const findOrder = () =>
    transferredOrder(polar, organizationId, productId, metadataKey, purchaseId);
  // shortcut: two simultaneous first requests can both create an order; add a lock if that shows up.
  if (!(await findOrder())) {
    const checkout = await polar.checkouts.create({
      products: [productId],
      customer_email: email,
      metadata: { [metadataKey]: purchaseId },
      ...(free && {
        prices: { [productId]: [{ amount_type: 'fixed', price_amount: 0 }] },
      }),
    });
    await polar.checkouts.clientConfirm(checkout.client_secret, {
      customer_email: email,
    });
  }
  for (let attempt = 0; attempt < GRANT_POLL_TRIES; attempt++) {
    const order = await findOrder();
    const key =
      order &&
      (await customerLicenseKey(polar, organizationId, order.customer_id));
    if (order?.customer.email && key) {
      return { key, email: order.customer.email };
    }
    await new Promise((resolve) => setTimeout(resolve, GRANT_POLL_MS));
  }
  return null;
}
