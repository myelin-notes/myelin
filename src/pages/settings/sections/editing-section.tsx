import { Columns3, Rows3 } from 'lucide-react';
import { useMessages } from '@/lib/i18n';
import { useUserPref } from '@/lib/use-user-pref';
import { UserPrefs } from '@/lib/user-prefs';
import { OptionsRow, type OptionsRowOption } from '../components/options-row';
import { ToggleRow } from '../components/toggle-row';

type DefaultPageLayout = 'vertical' | 'horizontal';

const MODIFIER_KEY_LABEL =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

export function EditingSection() {
  const strings = useMessages();
  const defaultPageLayout = useUserPref('defaultPageLayout');
  const pageFrameEditFitWholePage = useUserPref('pageFrameEditFitWholePage');
  const noteLinkHoverPreview = useUserPref('noteLinkHoverPreview');
  const linkRequireModifier = useUserPref('linkRequireModifier');
  const alwaysRenameNoteReferences = useUserPref('alwaysRenameNoteReferences');

  const orientationOptions =
    strings.settings.pageFrameEditing.defaultOrientation.options;
  const orientationRowOptions: ReadonlyArray<
    OptionsRowOption<DefaultPageLayout>
  > = [
    { value: 'vertical', label: orientationOptions.vertical, Icon: Rows3 },
    {
      value: 'horizontal',
      label: orientationOptions.horizontal,
      Icon: Columns3,
    },
  ];

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
        <OptionsRow
          value={defaultPageLayout}
          onChange={handleDefaultPageLayout}
          label={strings.settings.pageFrameEditing.defaultOrientation.label}
          description={
            strings.settings.pageFrameEditing.defaultOrientation.description
          }
          options={orientationRowOptions}
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
