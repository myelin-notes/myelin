import { Hand, PanelLeft, PanelRight, PenLine } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import type { InputMode } from '@myelin/editor/input-mode';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { useUserPref } from '@/lib/use-user-pref';
import { IS_PHONE_BUILD } from '@/lib/viewport-scale';
import { OptionsRow, type OptionsRowOption } from '../components/options-row';
import { ToggleRow } from '../components/toggle-row';

export function InputModeRow() {
  const strings = useMessages();
  const inputMode = useUserPref('inputMode');

  const modeOptions = strings.settings.input.mode.options;
  const rowOptions: ReadonlyArray<OptionsRowOption<InputMode>> = [
    { value: 'pen', label: modeOptions.pen, Icon: PenLine },
    { value: 'touch', label: modeOptions.touch, Icon: Hand },
  ];

  return (
    <OptionsRow
      value={inputMode}
      onChange={(mode) => UserPrefs.set('inputMode', mode)}
      label={strings.settings.input.mode.label}
      description={strings.settings.input.mode.description}
      options={rowOptions}
    />
  );
}

function ToolbarSideRow() {
  const strings = useMessages();
  const toolbarSide = useUserPref('toolbarSide');
  const sideStrings = strings.settings.input.toolbarSide;
  const rowOptions: ReadonlyArray<OptionsRowOption<'left' | 'right'>> = [
    { value: 'left', label: sideStrings.options.left, Icon: PanelLeft },
    { value: 'right', label: sideStrings.options.right, Icon: PanelRight },
  ];

  return (
    <OptionsRow
      value={toolbarSide}
      onChange={(side) => UserPrefs.set('toolbarSide', side)}
      label={sideStrings.label}
      description={sideStrings.description}
      options={rowOptions}
    />
  );
}

export function InputSection() {
  const strings = useMessages();
  const penBarrelButtonImmediate = useUserPref('penBarrelButtonImmediate');

  return (
    <section id="input" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">{strings.settings.input.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.input.eyebrow}
        </span>
      </div>
      {/* Compact always docks the toolbar along the bottom. */}
      {!IS_PHONE_BUILD && (
        <div className="mb-2">
          <ToolbarSideRow />
        </div>
      )}
      <InputModeRow />
      <div className="mt-2">
        <ToggleRow
          checked={penBarrelButtonImmediate}
          onToggle={() =>
            UserPrefs.set('penBarrelButtonImmediate', !penBarrelButtonImmediate)
          }
          label={strings.settings.input.penBarrelButtonImmediate.label}
          description={
            strings.settings.input.penBarrelButtonImmediate.description
          }
        />
      </div>
    </section>
  );
}
