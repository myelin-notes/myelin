import { Toaster } from 'sonner';
import { CommandPalette } from '@/components/command-palette';
import { AppShell } from '@/components/layout/app-shell';
import { useTheme } from '@/hooks/useTheme';
import { McpRuntime } from '@/lib/mcp/runtime';
import { TabStateProvider } from '@/lib/tabs/context';
import { CanvasCommandProvider } from '@/pages/canvas/command-context';

function App() {
  useTheme();

  return (
    <TabStateProvider>
      <CanvasCommandProvider>
        <McpRuntime />
        <Toaster position="bottom-right" />
        <CommandPalette />
        <AppShell />
      </CanvasCommandProvider>
    </TabStateProvider>
  );
}

export default App;
