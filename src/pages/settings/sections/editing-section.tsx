import { Columns3, Rows3 } from 'lucide-react';
import { useMessages } from '@/lib/i18n';
import { useUserPref } from '@/lib/use-user-pref';
import { UserPrefs } from '@/lib/user-prefs';
import { cn } from '@/lib/utils';

type DefaultPageLayout = 'vertical' | 'horizontal';

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

function OrientationRow({
  value,
  onChange,
}: {
  value: DefaultPageLayout;
  onChange: (value: DefaultPageLayout) => void;
}) {
  const strings = useMessages();
  const options = strings.settings.pageFrameEditing.defaultOrientation.options;
  return (
    <div className="flex w-full flex-col gap-3 rounded-xl bg-input px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0">
        <span className="block font-medium text-sm text-text-primary">
          {strings.settings.pageFrameEditing.defaultOrientation.label}
        </span>
        <span className="mt-1 block text-text-muted text-xs leading-relaxed">
          {strings.settings.pageFrameEditing.defaultOrientation.description}
        </span>
      </span>
      <span className="grid w-full shrink-0 grid-cols-2 gap-1 rounded-lg bg-card/70 p-1 sm:w-64">
        {(
          [
            { value: 'vertical', label: options.vertical, Icon: Rows3 },
            { value: 'horizontal', label: options.horizontal, Icon: Columns3 },
          ] as const
        ).map(({ value: optionValue, label, Icon }) => {
          const selected = value === optionValue;
          return (
            <button
              key={optionValue}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(optionValue)}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-xs transition-colors',
                selected
                  ? 'bg-accent-dark text-text-on-dark shadow-sm'
                  : 'text-text-muted hover:text-text-primary',
              )}
            >
              <Icon className="size-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </span>
    </div>
  );
}

export function EditingSection() {
  const strings = useMessages();
  const defaultPageLayout = useUserPref('defaultPageLayout');
  const pageFrameEditFitWholePage = useUserPref('pageFrameEditFitWholePage');
  const noteLinkHoverPreview = useUserPref('noteLinkHoverPreview');
  const linkRequireModifier = useUserPref('linkRequireModifier');
  const alwaysRenameNoteReferences = useUserPref('alwaysRenameNoteReferences');

  const handleDefaultPageLayout = (layout: DefaultPageLayout) => {
    UserPrefs.set('defaultPageLayout', layout);
  };

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
        <OrientationRow
          value={defaultPageLayout}
          onChange={handleDefaultPageLayout}
        />
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
