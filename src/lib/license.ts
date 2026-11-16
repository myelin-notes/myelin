import { UserPrefs } from '@myelin/editor/user-prefs';
import { Logger } from '@myelin/shared/logger';
import { isMac, isWindows } from '@myelin/shared/os';
import { fetch } from '@tauri-apps/plugin-http';
import { MOBILE_PLATFORM, WEBSITE_URL } from '@/lib/env';
import { tauriPlatform } from '@/platform/tauri';
import {
  proEntitlement as appStoreEntitlement,
  purchasePro as appStorePurchase,
  storefrontCountry,
} from '@/platform/tauri/apple-compliance';
import {
  proEntitlement as playEntitlement,
  purchasePro as playPurchase,
} from '@/platform/tauri/play-billing';

const logger = new Logger('License');

// Must match the non-consumable in App Store Connect and the one-time product in Play Console.
const PRO_PRODUCT_ID = 'com.github.wintersteve25.myelin.pro';

/** `status` 404: the key or this device's activation is gone. 409: the key is on all the devices it allows. 0: offline. */
export class LicenseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${WEBSITE_URL}/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((error: unknown) => {
    throw new LicenseError(0, String(error));
  });
  // `null` for non-JSON, e.g. a Cloudflare Access login page that fetch followed a redirect to.
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new LicenseError(
      response.status,
      data?.message ?? response.statusText,
    );
  }
  return data as T;
}

function deviceLabel(): string {
  return MOBILE_PLATFORM ?? (isMac ? 'macOS' : isWindows ? 'Windows' : 'Linux');
}

export async function activateLicense(key: string): Promise<void> {
  const { activationId } = await post<{ activationId: string }>('license', {
    action: 'activate',
    key: key.trim(),
    label: deviceLabel(),
  });
  UserPrefs.set('license', { key: key.trim(), activationId });
  UserPrefs.set('plan', 'pro');
}

// Frees this device's slot so the key can be used on another device.
export async function deactivateLicense(): Promise<void> {
  const license = UserPrefs.get('license');
  if (license) {
    await post('license', { action: 'deactivate', ...license }).catch(
      (error: unknown) => {
        if (!(error instanceof LicenseError && error.status === 404)) {
          throw error;
        }
      },
    );
  }
  UserPrefs.set('license', null);
  await refreshPlan();
}

/** Emails a code to `email`; pass the returned challenge to {@link redeemRestoreCode}. */
export async function requestRestoreCode(email: string): Promise<string> {
  const { challenge } = await post<{ challenge: string }>('restore', { email });
  return challenge;
}

export async function redeemRestoreCode(
  challenge: string,
  code: string,
): Promise<void> {
  const { key } = await post<{ key: string }>('restore', { challenge, code });
  await activateLicense(key);
}

type ProCheckout = 'website' | 'store';

/** Where this device sells Pro. Every buy-Pro button goes through this. */
async function proCheckout(): Promise<ProCheckout> {
  switch (MOBILE_PLATFORM) {
    case 'ios': {
      // App Review 3.1.1 only allows linking out to the website checkout in the US storefront.
      const country = await storefrontCountry().catch(() => null);
      return country === 'USA' ? 'website' : 'store';
    }
    case 'android':
      return 'store';
    default:
      return 'website';
  }
}

/** Resolves whether Pro is now active; `false` for the website checkout or a cancelled or pending purchase. */
export async function buyPro(): Promise<boolean> {
  if ((await proCheckout()) === 'website') {
    await tauriPlatform.openExternal(`${WEBSITE_URL}/pricing`);
    return false;
  }
  const { active } = await (MOBILE_PLATFORM === 'android'
    ? playPurchase(PRO_PRODUCT_ID)
    : appStorePurchase(PRO_PRODUCT_ID));
  if (active) {
    UserPrefs.set('plan', 'pro');
  }
  return active;
}

// `sync` asks the App Store for this Apple ID's purchases first; Play always reports them.
function storeEntitlement(sync: boolean) {
  return MOBILE_PLATFORM === 'android'
    ? playEntitlement(PRO_PRODUCT_ID)
    : appStoreEntitlement(PRO_PRODUCT_ID, sync);
}

export async function restoreStorePurchase(): Promise<boolean> {
  const { active } = await storeEntitlement(true);
  if (active) {
    UserPrefs.set('plan', 'pro');
  }
  return active;
}

/** Emails a desktop license key for this device's store purchase to `email`. */
export async function emailDesktopLicense(email: string): Promise<void> {
  const { transactionId } = await storeEntitlement(false);
  if (!transactionId) {
    throw new LicenseError(404, 'No store purchase was found.');
  }
  await post(
    MOBILE_PLATFORM === 'android' ? 'play-transfer' : 'app-store-transfer',
    { transactionId, email: email.trim() },
  );
}

// Offline or server errors keep the last known plan, so Pro keeps working without network.
// shortcut: `plan` lives in localStorage and the app is open source, so this only keeps
// honest users honest; anything stronger needs server-signed entitlements.
export async function refreshPlan(): Promise<void> {
  if (MOBILE_PLATFORM) {
    const active = await storeEntitlement(false).then(
      (result) => result.active,
      (error: unknown) => {
        logger.warn('Could not read store entitlements', error);
        return UserPrefs.get('plan') === 'pro';
      },
    );
    if (active) {
      UserPrefs.set('plan', 'pro');
      return;
    }
  }
  const license = UserPrefs.get('license');
  if (!license) {
    UserPrefs.set('plan', 'free');
    return;
  }
  try {
    await post('license', { action: 'validate', ...license });
    UserPrefs.set('plan', 'pro');
  } catch (error) {
    if (error instanceof LicenseError && error.status === 404) {
      UserPrefs.set('license', null);
      UserPrefs.set('plan', 'free');
    }
  }
}
