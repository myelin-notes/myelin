import { useEffect, useState } from 'react';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import { getVersion } from '@tauri-apps/api/app';

const logger = new Logger('AboutSection');

export function AboutSection() {
  const strings = useMessages();
  const [version, setVersion] = useState('');
  const aboutStrings = strings.settings.about;

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch((error) => logger.error('Failed to read app version', error));
  }, []);

  return (
    <section id="about" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-xl">{aboutStrings.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {aboutStrings.eyebrow}
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4 rounded-xl bg-input px-4 py-3 ring-1 ring-border-subtle/70">
          <span className="min-w-0">
            <span className="block font-medium text-sm text-text-primary">
              {aboutStrings.version.label}
            </span>
            <span className="mt-1 block text-text-muted text-xs leading-relaxed">
              {aboutStrings.version.description}
            </span>
          </span>
          <span className="shrink-0 font-mono text-sm text-text-muted tabular-nums">
            {version}
          </span>
        </div>
      </div>
    </section>
  );
}
