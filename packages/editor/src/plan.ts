import { MAX_PEN_PRESETS } from './sync/repo/config';
import { UserPrefs } from './user-prefs';

export type PlanLimit = keyof (typeof PLAN_LIMITS)['free'];
export const PLAN_LIMITS = {
  free: { flagTypes: 2, penPresets: 6, flagsPerNote: 25 },
  pro: { flagTypes: 8, penPresets: MAX_PEN_PRESETS, flagsPerNote: Infinity },
};

export function isPro(): boolean {
  return UserPrefs.get('plan') === 'pro';
}

export function planLimit(limit: PlanLimit): number {
  return PLAN_LIMITS[isPro() ? 'pro' : 'free'][limit];
}

export type ProFeature = 'agents' | 'code' | 'canvasImage' | 'limits';

let upgradePrompt: ((feature: ProFeature) => void) | null = null;

export function setUpgradePrompt(
  next: ((feature: ProFeature) => void) | null,
): void {
  upgradePrompt = next;
}

export function promptUpgrade(feature: ProFeature): void {
  upgradePrompt?.(feature);
}
