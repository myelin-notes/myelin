import { UserPrefs } from '@myelin/editor/user-prefs';
import { Logger } from '@myelin/shared/logger';
import { isMac, isWindows } from '@myelin/shared/os';
import { fetch } from '@tauri-apps/plugin-http';
import { MOBILE_PLATFORM, WEBSITE_URL } from '@/lib/env';
import { tauriPlatform } from '@/platform/tauri';
import {
  proEntitlement,
  purchasePro,
  storefrontCountry,
} from '@/platform/tauri/apple-compliance';

const logger = new Logger('License');

// Must match the non-consumable in App Store Connect.
const APP_STORE_PRO_PRODUCT_ID = 'com.github.wintersteve25.myelin.pro';

/** `status` 404: the key or this device's activation is gone. 409: the key is on 3 devices. 0: offline. */
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
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new LicenseError(
      response.status,
      data.message ?? response.statusText,
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

type ProCheckout = 'website' | 'appStore';

/** Where this device sells Pro. Every buy-Pro button goes through this. */
async function proCheckout(): Promise<ProCheckout> {
  switch (MOBILE_PLATFORM) {
    case 'ios': {
      // App Review 3.1.1 only allows linking out to the website checkout in the US storefront.
      const country = await storefrontCountry().catch(() => null);
      return country === 'USA' ? 'website' : 'appStore';
    }
    case 'android':
      return 'website';
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
  return buyOnAppStore();
}

async function buyOnAppStore(): Promise<boolean> {
  const { active } = await purchasePro(APP_STORE_PRO_PRODUCT_ID);
  if (active) {
    UserPrefs.set('plan', 'pro');
  }
  return active;
}

export async function restoreAppStorePurchase(): Promise<boolean> {
  const { active } = await proEntitlement(APP_STORE_PRO_PRODUCT_ID, true);
  if (active) {
    UserPrefs.set('plan', 'pro');
  }
  return active;
}

// Offline or server errors keep the last known plan, so Pro keeps working without network.
// shortcut: `plan` lives in localStorage and the app is open source, so this only keeps
// honest users honest; anything stronger needs server-signed entitlements.
export async function refreshPlan(): Promise<void> {
  if (MOBILE_PLATFORM === 'ios') {
    const active = await proEntitlement(APP_STORE_PRO_PRODUCT_ID, false).then(
      (result) => result.active,
      (error: unknown) => {
        logger.warn('Could not read App Store entitlements', error);
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
