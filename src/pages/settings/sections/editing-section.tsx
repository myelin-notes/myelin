import { useMessages } from '@/lib/i18n';
import { useUserPref } from '@/lib/use-user-pref';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';

const MODIFIER_KEY_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

function ToggleRow({
  checked,
  onToggle,
  label,
  description,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-xl bg-input px-4 py-3 text-left transition-colors hover:bg-hover-tint"
    >
      <span className="min-w-0">
        <span className="block font-medium text-sm text-text-primary">
          {label}
        </span>
        <span className="mt-1 block text-text-muted text-xs leading-relaxed">
          {description}
        </span>
      </span>
      <span
        className={cn(
          'relative flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors',
          checked ? 'bg-accent-dark' : 'bg-text-muted/20',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-card shadow-sm transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}

export function EditingSection() {
  const strings = useMessages();
  const pageFrameEditFitWholePage = useUserPref('pageFrameEditFitWholePage');
  const noteLinkHoverPreview = useUserPref('noteLinkHoverPreview');
  const linkRequireModifier = useUserPref('linkRequireModifier');
  const alwaysRenameNoteReferences = useUserPref('alwaysRenameNoteReferences');

  const handlePageFrameEditFitWholePage = () => {
    UserPrefs.set('pageFrameEditFitWholePage', !pageFrameEditFitWholePage);
  };

  const handleNoteLinkHoverPreview = () => {
    UserPrefs.set('noteLinkHoverPreview', !noteLinkHoverPreview);
  };

  const handleLinkRequireModifier = () => {
    UserPrefs.set('linkRequireModifier', !linkRequireModifier);
  };

  const handleAlwaysRenameNoteReferences = () => {
    UserPrefs.set('alwaysRenameNoteReferences', !alwaysRenameNoteReferences);
  };

  return (
    <section id="editing" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">
          {strings.settings.pageFrameEditing.title}
        </h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.pageFrameEditing.eyebrow}
        </span>
      </div>
      <div className="space-y-2">
        <ToggleRow
          checked={pageFrameEditFitWholePage}
          onToggle={handlePageFrameEditFitWholePage}
          label={strings.settings.pageFrameEditing.fitWholePage.label}
          description={
            strings.settings.pageFrameEditing.fitWholePage.description
          }
        />
        <ToggleRow
          checked={noteLinkHoverPreview}
          onToggle={handleNoteLinkHoverPreview}
          label={strings.settings.pageFrameEditing.hoverPreview.label}
          description={
            strings.settings.pageFrameEditing.hoverPreview.description
          }
        />
        <ToggleRow
          checked={linkRequireModifier}
          onToggle={handleLinkRequireModifier}
          label={strings.settings.pageFrameEditing.requireModifier.label(
            MODIFIER_KEY_LABEL,
          )}
          description={strings.settings.pageFrameEditing.requireModifier.description(
            MODIFIER_KEY_LABEL,
          )}
        />
        <ToggleRow
          checked={alwaysRenameNoteReferences}
          onToggle={handleAlwaysRenameNoteReferences}
          label={strings.settings.pageFrameEditing.renameReferences.label}
          description={
            strings.settings.pageFrameEditing.renameReferences.description
          }
        />
      </div>
    </section>
  );
}
