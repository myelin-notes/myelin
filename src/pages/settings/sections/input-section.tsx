import { Hand, PenLine } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import type { InputMode } from '@myelin/editor/input-mode';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { useUserPref } from '@/lib/use-user-pref';
import { OptionsRow, type OptionsRowOption } from '../components/options-row';

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

export function InputSection() {
  const strings = useMessages();

  return (
    <section id="input" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">{strings.settings.input.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.input.eyebrow}
        </span>
      </div>
      <InputModeRow />
    </section>
  );
}
