import { Hand, PenLine, Wand2 } from 'lucide-react';
import type { InputMode } from '@myelin/editor/input-mode';
import { useMessages } from '@/lib/i18n';
import { useUserPref } from '@/lib/use-user-pref';
import { UserPrefs } from '@/lib/user-prefs';
import { OptionsRow, type OptionsRowOption } from '../components/options-row';

export function InputSection() {
  const strings = useMessages();
  const inputMode = useUserPref('inputMode');

  const modeOptions = strings.settings.input.mode.options;
  const rowOptions: ReadonlyArray<OptionsRowOption<InputMode>> = [
    { value: 'auto', label: modeOptions.auto, Icon: Wand2 },
    { value: 'pen', label: modeOptions.pen, Icon: PenLine },
    { value: 'touch', label: modeOptions.touch, Icon: Hand },
  ];

  const handleInputMode = (mode: InputMode) => {
    UserPrefs.set('inputMode', mode);
  };

  return (
    <section id="input" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">{strings.settings.input.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.input.eyebrow}
        </span>
      </div>
      <OptionsRow
        value={inputMode}
        onChange={handleInputMode}
        label={strings.settings.input.mode.label}
        description={strings.settings.input.mode.description}
        options={rowOptions}
      />
    </section>
  );
}
