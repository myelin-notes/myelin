import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { type ProFeature, setUpgradePrompt } from '@myelin/editor/plan';
import { cn } from '@myelin/editor/utils';
import { Button } from '@myelin/ui/button';
import agentsDemo from '@/assets/upsell/agents.webp';
import canvasImageDemo from '@/assets/upsell/canvas-image.webp';
import codeDemo from '@/assets/upsell/code.webp';
import limitsDemo from '@/assets/upsell/limits.webp';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MOBILE_PLATFORM, WEBSITE_URL } from '@/lib/env';
import { buyOnAppStore } from '@/lib/license';
import { useTabController } from '@/lib/tabs/context';
import { tauriPlatform } from '@/platform/tauri';

// Same encoding as the What's New demos (see WhatsNewPage.image).
const DEMOS: Record<ProFeature, string> = {
  agents: agentsDemo,
  code: codeDemo,
  canvasImage: canvasImageDemo,
  limits: limitsDemo,
};
const FEATURES = Object.keys(DEMOS) as ProFeature[];

export function UpgradeDialog() {
  const strings = useMessages();
  const tabController = useTabController();
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<ProFeature>('agents');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUpgradePrompt((next) => {
      setFeature(next);
      setOpen(true);
    });
    return () => setUpgradePrompt(null);
  }, []);

  const planStrings = strings.plan;
  const page = planStrings.features[feature];

  const buy = async () => {
    // App Review 3.1.1: iOS may not point to the website checkout, so it sells through IAP.
    if (MOBILE_PLATFORM !== 'ios') {
      void tauriPlatform.openExternal(`${WEBSITE_URL}/pricing`);
      return;
    }
    setBusy(true);
    try {
      if (await buyOnAppStore()) {
        setOpen(false);
      }
    } catch (error) {
      toast.error(planStrings.purchaseFailed, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  const openLicenseSettings = () => {
    setOpen(false);
    tabController.openTab({ type: 'settings' }, strings.tabBar.settings);
    requestAnimationFrame(() =>
      document.getElementById('pro')?.scrollIntoView({ block: 'start' }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-6 sm:max-w-lg sm:p-8">
        <DialogHeader>
          <DialogTitle className="text-2xl">{planStrings.title}</DialogTitle>
          <DialogDescription>{planStrings.description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-32 flex-col gap-2">
          <img
            src={DEMOS[feature]}
            alt=""
            className="mb-3 w-full rounded-lg border border-border-subtle"
          />
          <p className="font-semibold text-base text-text-primary">
            {page.title}
          </p>
          <p className="text-text-secondary">{page.description}</p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex gap-1">
            {FEATURES.map((f) => (
              <button
                key={f}
                type="button"
                aria-label={planStrings.features[f].title}
                aria-current={f === feature}
                onClick={() => setFeature(f)}
                className="p-1"
              >
                <span
                  className={cn(
                    'block size-1.5 rounded-full bg-border-subtle',
                    f === feature && 'bg-text-primary',
                  )}
                />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={openLicenseSettings}>
              {planStrings.haveLicense}
            </Button>
            <Button disabled={busy} onClick={() => void buy()}>
              {planStrings.upgrade}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
