import { type KeyboardEvent, useState } from 'react';
import { useMessages } from '@/lib/i18n';
import { useUserPref } from '@/lib/use-user-pref';
import { UserPrefs } from '@/lib/user-prefs';
import { ToggleRow } from '../components/toggle-row';

const MIN_PORT = 1;
const MAX_PORT = 65535;

export function McpSection() {
  const strings = useMessages();
  const mcpEnabled = useUserPref('mcpEnabled');
  const mcpPort = useUserPref('mcpPort');
  const mcpAllowDirectWrites = useUserPref('mcpAllowDirectWrites');
  const [portDraft, setPortDraft] = useState<string | null>(null);
  const endpoint = `http://127.0.0.1:${mcpPort}/mcp`;

  const handleEnabled = () => {
    UserPrefs.set('mcpEnabled', !mcpEnabled);
  };

  const handleDirectWrites = () => {
    UserPrefs.set('mcpAllowDirectWrites', !mcpAllowDirectWrites);
  };

  const commitPort = () => {
    if (portDraft === null) {
      return;
    }
    const nextPort = Number(portDraft);
    if (
      Number.isInteger(nextPort) &&
      nextPort >= MIN_PORT &&
      nextPort <= MAX_PORT
    ) {
      UserPrefs.set('mcpPort', nextPort);
    }
    setPortDraft(null);
  };

  const handlePortKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  };

  return (
    <section id="mcp" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-xl">{strings.settings.mcp.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {strings.settings.mcp.eyebrow}
        </span>
      </div>
      <div className="space-y-2">
        <ToggleRow
          checked={mcpEnabled}
          onToggle={handleEnabled}
          label={strings.settings.mcp.enabled.label}
          description={strings.settings.mcp.enabled.description}
        />
        <label className="flex w-full items-center justify-between gap-4 rounded-xl bg-input px-4 py-3 ring-1 ring-border-subtle/70">
          <span className="min-w-0">
            <span className="block font-medium text-sm text-text-primary">
              {strings.settings.mcp.port.label}
            </span>
            <span className="mt-1 block text-text-muted text-xs leading-relaxed">
              {strings.settings.mcp.port.description}
            </span>
          </span>
          <input
            type="number"
            min={MIN_PORT}
            max={MAX_PORT}
            value={portDraft ?? mcpPort}
            onChange={(event) => setPortDraft(event.currentTarget.value)}
            onBlur={commitPort}
            onKeyDown={handlePortKeyDown}
            className="h-9 w-24 rounded-lg bg-card px-3 text-right text-sm text-text-primary outline-none ring-1 ring-border-subtle/70 transition-shadow focus:ring-2 focus:ring-accent-navy/20"
          />
        </label>
        <div className="rounded-xl bg-input px-4 py-3 ring-1 ring-border-subtle/70">
          <div className="font-medium text-sm text-text-primary">
            {strings.settings.mcp.endpoint.label}
          </div>
          <div className="mt-1 break-all font-mono text-text-muted text-xs">
            {endpoint}
          </div>
        </div>
        <ToggleRow
          checked={mcpAllowDirectWrites}
          onToggle={handleDirectWrites}
          label={strings.settings.mcp.directWrites.label}
          description={strings.settings.mcp.directWrites.description}
        />
      </div>
    </section>
  );
}
