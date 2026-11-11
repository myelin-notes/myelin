import { type FormEvent, type ReactNode, useState } from 'react';
import {
  ArrowRight,
  KeyRound,
  Loader2,
  LogOut,
  type LucideIcon,
  Mail,
  Monitor,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import { MOBILE_PLATFORM } from '@/lib/env';
import {
  activateLicense,
  buyPro,
  deactivateLicense,
  emailDesktopLicense,
  LicenseError,
  redeemRestoreCode,
  requestRestoreCode,
  restoreAppStorePurchase,
} from '@/lib/license';
import { useUserPref } from '@/lib/use-user-pref';
import { ActionCard } from '../components/action-card';

function Row({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-3 rounded-xl bg-input/40 px-4 py-3.5 ring-1 ring-border-subtle/70 sm:flex-row sm:items-center">
      <span className="flex min-w-0 flex-1 items-center gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-hover-tint text-text-secondary">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-sm text-text-primary">
            {label}
          </span>
          <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
            {description}
          </span>
        </span>
      </span>
      {children}
    </div>
  );
}

// Text-style submit inside the field so form rows read like ActionCard's action, not a filled button.
function InlineForm({
  onSubmit,
  action,
  loading,
  disabled,
  className,
  ...input
}: {
  onSubmit: (event: FormEvent) => void;
  action: string;
  loading: boolean;
  disabled: boolean;
  className: string;
} & React.ComponentProps<'input'>) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        'flex h-9 w-full items-center rounded-lg bg-card pr-3 ring-1 ring-border-subtle/70 transition-shadow focus-within:ring-2 focus-within:ring-accent-navy/20',
        className,
      )}
    >
      <input
        {...input}
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-text-primary outline-none"
      />
      <button
        type="submit"
        disabled={disabled}
        className="group flex shrink-0 items-center gap-1.5 font-medium text-text-muted text-xs uppercase tracking-[0.08em] transition-colors duration-200 hover:text-text-brand disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <>
            {action}
            <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}

export function ProSection() {
  const strings = useMessages().settings.pro;
  const plan = useUserPref('plan');
  const license = useUserPref('license');
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
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
      setBusy(null);
    }
  };

  const submit =
    (key: string, action: () => Promise<unknown>) => (event: FormEvent) => {
      event.preventDefault();
      if (draft.trim()) {
        void run(key, action);
      }
    };

  const ios = MOBILE_PLATFORM === 'ios';
  const isBusy = busy !== null;

  return (
    <section id="pro" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-xl">{strings.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {plan === 'pro' ? strings.active : strings.eyebrow}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {plan === 'pro' && (
          <Row
            icon={Sparkles}
            label={strings.thanks.label}
            description={strings.thanks.description}
          />
        )}

        {license && (
          <ActionCard
            icon={LogOut}
            label={strings.deactivate.label}
            description={strings.deactivate.description}
            action={strings.deactivate.action}
            onClick={() => void run('deactivate', deactivateLicense)}
            loading={busy === 'deactivate'}
            disabled={isBusy}
          />
        )}

        {plan === 'pro' && ios && !license && (
          <Row
            icon={Monitor}
            label={strings.desktop.label}
            description={strings.desktop.description}
          >
            <InlineForm
              className="sm:w-72"
              onSubmit={submit('desktop', async () => {
                await emailDesktopLicense(draft);
                setDraft('');
                toast(strings.desktop.sent);
              })}
              action={strings.desktop.send}
              loading={busy === 'desktop'}
              disabled={isBusy}
              type="email"
              inputMode="email"
              autoComplete="email"
              aria-label={strings.desktop.label}
              placeholder="you@example.com"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </Row>
        )}

        {plan !== 'pro' && ios && (
          <>
            <ActionCard
              icon={Sparkles}
              label={strings.buy.label}
              description={strings.buy.descriptionIos}
              action={strings.buy.action}
              onClick={() => void run('buy', buyPro)}
              loading={busy === 'buy'}
              disabled={isBusy}
            />
            <ActionCard
              icon={RotateCcw}
              label={strings.restore.label}
              description={strings.restore.description}
              action={strings.restore.action}
              onClick={() =>
                void run('restore', async () => {
                  if (!(await restoreAppStorePurchase())) {
                    toast(strings.restore.none);
                  }
                })
              }
              loading={busy === 'restore'}
              disabled={isBusy}
            />
            <Row
              icon={Mail}
              label={strings.email.label}
              description={
                challenge ? strings.email.codeSent : strings.email.description
              }
            >
              <InlineForm
                className="sm:w-72"
                onSubmit={submit('email', async () => {
                  if (challenge) {
                    await redeemRestoreCode(challenge, draft);
                    setChallenge(null);
                  } else {
                    setChallenge(await requestRestoreCode(draft));
                  }
                  setDraft('');
                })}
                action={challenge ? strings.email.verify : strings.email.send}
                loading={busy === 'email'}
                disabled={isBusy}
                type={challenge ? 'text' : 'email'}
                inputMode={challenge ? 'numeric' : 'email'}
                autoComplete={challenge ? 'one-time-code' : 'email'}
                aria-label={
                  challenge ? strings.email.codeLabel : strings.email.label
                }
                placeholder={challenge ? '12345678' : 'you@example.com'}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
            </Row>
          </>
        )}

        {plan !== 'pro' && !ios && (
          <>
            <ActionCard
              icon={Sparkles}
              label={strings.buy.label}
              description={strings.buy.description}
              action={strings.buy.action}
              onClick={() => void run('buy', buyPro)}
              loading={busy === 'buy'}
              disabled={isBusy}
            />
            <Row
              icon={KeyRound}
              label={strings.key.label}
              description={strings.key.description}
            >
              <InlineForm
                className="sm:w-80"
                onSubmit={submit('key', async () => {
                  await activateLicense(draft);
                  setDraft('');
                })}
                action={strings.key.action}
                loading={busy === 'key'}
                disabled={isBusy}
                aria-label={strings.key.label}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
            </Row>
          </>
        )}
      </div>
    </section>
  );
}
