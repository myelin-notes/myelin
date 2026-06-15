import { useCallback, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import { useMessages } from '@/lib/i18n';
import { KeybindsSection } from './keybinds-section';
import { AppearanceSection } from './sections/appearance-section';
import { DataSection } from './sections/data-section';
import { EditingSection } from './sections/editing-section';
import { LanguageSection } from './sections/language-section';
import { McpSection } from './sections/mcp-section';
import { SyncSection } from './sections/sync-section';
import { SettingsRail } from './settings-rail';
import { SETTINGS_SECTIONS, type SettingsSectionId } from './settings-sections';
import { useScrollSpy } from './use-scroll-spy';

const SECTION_IDS: readonly SettingsSectionId[] = SETTINGS_SECTIONS.map(
  (s) => s.id,
);

export function SettingsPage() {
  const strings = useMessages();
  const mainRef = useRef<HTMLElement>(null);
  const ids = useMemo(() => SECTION_IDS, []);
  const activeId = useScrollSpy(ids, mainRef);

  const handleJump = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    el.scrollIntoView({
      block: 'start',
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, []);

  return (
    <div className="relative flex h-full w-full bg-page">
      <a href="#settings-main" data-skip-link className="skip-link">
        {strings.settings.title}
      </a>

      <main
        ref={mainRef}
        id="settings-main"
        className="flex-1 overflow-y-auto px-6 pt-8 pb-12 sm:px-8 md:px-10 md:pt-12 lg:px-12"
      >
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="flex gap-12"
        >
          <SettingsRail activeId={activeId} onJump={handleJump} />

          <div className="min-w-0 max-w-3xl flex-1">
            <header className="mb-10 md:mb-14">
              <h1
                className="font-extralight font-heading text-text-primary tracking-tight"
                style={{ fontSize: 'var(--fluid-display)' }}
              >
                {strings.settings.title}
              </h1>
              <p className="mt-3 text-text-muted leading-relaxed">
                {strings.settings.description}
              </p>
            </header>

            <div className="space-y-12 md:space-y-16">
              <AppearanceSection />
              <LanguageSection />
              <EditingSection />
              <SyncSection />
              <DataSection />
              <McpSection />
              <KeybindsSection />
            </div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
