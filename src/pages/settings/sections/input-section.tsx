import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Hand, PenLine } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import type { InputMode } from '@myelin/editor/input-mode';
import {
  bindPenButton,
  type PenButtonAction,
} from '@myelin/editor/pen-buttons';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { IS_MOBILE_BUILD } from '@/lib/env';
import { useUserPref } from '@/lib/use-user-pref';
import { OptionsRow, type OptionsRowOption } from '../components/options-row';
import { ToggleRow } from '../components/toggle-row';

const PEN_BUTTON_ACTIONS: readonly PenButtonAction[] = [
  'eraser',
  'toolWheel',
  'pan',
];

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

function PenButtonCapture({
  action,
  onDone,
}: {
  action: PenButtonAction;
  onDone: () => void;
}) {
  const strings = useMessages();
  const ref = useRef<HTMLButtonElement>(null);
  const [sawMouse, setSawMouse] = useState(false);
  const finish = useEffectEvent(onDone);

  useEffect(() => {
    ref.current?.focus();
    // Window-wide: a screenless tablet's pen may be anywhere when the button is pressed. A press
    // while the tip is down arrives as a pointermove.
    const onPointer = (event: PointerEvent) => {
      // 0 is the tip and 5 the eraser end, which keep their own jobs.
      if (event.button < 1 || event.button > 4) {
        return;
      }
      event.preventDefault();
      if (event.pointerType !== 'pen') {
        setSawMouse(true);
        return;
      }
      bindPenButton(action, event.button);
      finish();
    };
    const preventContextMenu = (event: Event) => event.preventDefault();
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('pointermove', onPointer, true);
    window.addEventListener('contextmenu', preventContextMenu, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('pointermove', onPointer, true);
      window.removeEventListener('contextmenu', preventContextMenu, true);
    };
  }, [action]);

  return (
    <button
      type="button"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onDone();
        }
      }}
      onBlur={onDone}
      className="fade-in-0 zoom-in-95 flex h-7 min-w-20 animate-in items-center justify-center rounded-lg bg-accent-navy px-4 font-semibold text-[10px] text-text-on-dark uppercase tracking-widest outline-none duration-100"
    >
      {sawMouse
        ? strings.settings.input.penButtons.notPen
        : strings.settings.input.penButtons.pressButton}
    </button>
  );
}

function PenButtonsRow() {
  const strings = useMessages();
  const bindings = useUserPref('penButtons');
  const [capturing, setCapturing] = useState<PenButtonAction | null>(null);
  const copy = strings.settings.input.penButtons;

  return (
    <div className="rounded-xl bg-input/40 px-4 py-3 ring-1 ring-border-subtle/70">
      <span className="block font-medium text-sm text-text-primary">
        {copy.label}
      </span>
      <span className="mt-1 block text-text-muted text-xs leading-relaxed">
        {copy.description}
      </span>
      <div className="mt-3 flex flex-col gap-2">
        {PEN_BUTTON_ACTIONS.map((action) => {
          const button = bindings[action];
          return (
            <div
              key={action}
              className="flex items-center justify-between gap-4"
            >
              <span className="text-sm text-text-secondary">
                {copy.actions[action]}
              </span>
              {capturing === action ? (
                <PenButtonCapture
                  action={action}
                  onDone={() => setCapturing(null)}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setCapturing(action)}
                  className="flex h-7 cursor-pointer items-center justify-center rounded-md border-border-key border-b-2 bg-bg-key px-4 font-bold text-text-secondary text-xs shadow-key"
                >
                  {button === null
                    ? strings.settings.keybinds.unbound
                    : (copy.buttons[button as keyof typeof copy.buttons] ??
                      button)}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
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
      {/* Apple Pencil has no barrel buttons, and Android rewrites every S Pen button to the eraser. */}
      {!IS_MOBILE_BUILD && (
        <div className="mt-2">
          <PenButtonsRow />
        </div>
      )}
    </section>
  );
}
