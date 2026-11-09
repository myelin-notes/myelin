import { type FormEvent, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { Button } from '@myelin/ui/button';
import { MOBILE_PLATFORM, WEBSITE_URL } from '@/lib/env';
import {
  activateLicense,
  buyOnAppStore,
  deactivateLicense,
  LicenseError,
  redeemRestoreCode,
  requestRestoreCode,
  restoreAppStorePurchase,
} from '@/lib/license';
import { useUserPref } from '@/lib/use-user-pref';
import { tauriPlatform } from '@/platform/tauri';

const INPUT_CLASS =
  'h-9 min-w-0 flex-1 rounded-lg bg-card px-3 text-sm text-text-primary outline-none ring-1 ring-border-subtle/70 transition-shadow focus:ring-2 focus:ring-accent-navy/20';

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-3 rounded-xl bg-input/40 px-4 py-3 ring-1 ring-border-subtle/70 sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0">
        <span className="block font-medium text-sm text-text-primary">
          {label}
        </span>
        <span className="mt-1 block text-text-muted text-xs leading-relaxed">
          {description}
        </span>
      </span>
      {children}
    </div>
  );
}

export function ProSection() {
  const strings = useMessages().settings.pro;
  const plan = useUserPref('plan');
  const license = useUserPref('license');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (!(error instanceof LicenseError)) {
        // App Store failures reject with the plugin's own message.
        toast.error(error instanceof Error ? error.message : String(error));
        return;
      }
      toast.error(
        error.status === 409
          ? strings.errors.limit
          : error.status === 404 || error.status === 400
            ? strings.errors.invalid
            : strings.errors.failed,
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent, action: () => Promise<unknown>) => {
    event.preventDefault();
    if (draft.trim()) {
      void run(action);
    }
  };

  const ios = MOBILE_PLATFORM === 'ios';

  return (
    <section id="pro" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-xl">{strings.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {plan === 'pro' ? strings.active : strings.eyebrow}
        </span>
      </div>
      <div className="space-y-2">
        {license && (
          <Row
            label={strings.deactivate.label}
            description={strings.deactivate.description}
          >
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void run(deactivateLicense)}
            >
              {strings.deactivate.action}
            </Button>
          </Row>
        )}

        {plan !== 'pro' && ios && (
          <>
            <Row
              label={strings.buy.label}
              description={strings.buy.descriptionIos}
            >
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void run(buyOnAppStore)}
              >
                {strings.buy.action}
              </Button>
            </Row>
            <Row
              label={strings.restore.label}
              description={strings.restore.description}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!(await restoreAppStorePurchase())) {
                      toast(strings.restore.none);
                    }
                  })
                }
              >
                {strings.restore.action}
              </Button>
            </Row>
            <Row
              label={strings.email.label}
              description={
                challenge ? strings.email.codeSent : strings.email.description
              }
            >
              <form
                className="flex w-full gap-2 sm:w-72"
                onSubmit={(event) =>
                  submit(event, async () => {
                    if (challenge) {
                      await redeemRestoreCode(challenge, draft);
                      setChallenge(null);
                    } else {
                      setChallenge(await requestRestoreCode(draft));
                    }
                    setDraft('');
                  })
                }
              >
                <input
                  type={challenge ? 'text' : 'email'}
                  inputMode={challenge ? 'numeric' : 'email'}
                  autoComplete={challenge ? 'one-time-code' : 'email'}
                  aria-label={
                    challenge ? strings.email.codeLabel : strings.email.label
                  }
                  placeholder={challenge ? '12345678' : 'you@example.com'}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  className={INPUT_CLASS}
                />
                <Button type="submit" size="sm" disabled={busy}>
                  {challenge ? strings.email.verify : strings.email.send}
                </Button>
              </form>
            </Row>
          </>
        )}

        {plan !== 'pro' && !ios && (
          <>
            <Row
              label={strings.key.label}
              description={strings.key.description}
            >
              <form
                className="flex w-full gap-2 sm:w-80"
                onSubmit={(event) =>
                  submit(event, async () => {
                    await activateLicense(draft);
                    setDraft('');
                  })
                }
              >
                <input
                  aria-label={strings.key.label}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  className={INPUT_CLASS}
                />
                <Button type="submit" size="sm" disabled={busy}>
                  {strings.key.action}
                </Button>
              </form>
            </Row>
            <Row
              label={strings.buy.label}
              description={strings.buy.description}
            >
              <Button
                size="sm"
                onClick={() =>
                  void tauriPlatform.openExternal(`${WEBSITE_URL}/pricing`)
                }
              >
                {strings.buy.action}
              </Button>
            </Row>
          </>
        )}
      </div>
    </section>
  );
}
