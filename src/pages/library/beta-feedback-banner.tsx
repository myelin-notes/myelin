import { ArrowUpRight, MessageSquarePlus } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { getPlatform } from '@myelin/editor/platform';

const FEEDBACK_FORM_URL = 'https://forms.gle/7afeEmmFsuwSSCyF9';

/**
 * Beta-only prompt pointing testers at the feedback form. Shown on both home
 * surfaces ({@link HomePage} on desktop, {@link MobileLibrary} on tablet and
 * phone). The whole card is the hit target so it stays comfortably tappable
 * on touch. Remove once the beta ends.
 */
export function BetaFeedbackBanner() {
  const strings = useMessages().library.betaFeedback;

  return (
    <button
      type="button"
      onClick={() => void getPlatform().openExternal(FEEDBACK_FORM_URL)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-card/75 px-4 py-3.5 text-left ring-1 ring-border-subtle/70 transition-colors duration-150 hover:bg-card"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-text-muted">
        <MessageSquarePlus className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-sm text-text-primary">
          {strings.title}
        </span>
        <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
          {strings.description}
        </span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-text-muted" />
    </button>
  );
}
