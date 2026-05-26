import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { CommandPalette } from '@/components/command-palette';
import { useTheme } from '@/hooks/useTheme';
import { CanvasCommandProvider } from '@/pages/canvas/command-context';
import { TabStateProvider } from '@/lib/tabs/context';

function App() {
  useTheme('light');

  return (
    <TabStateProvider>
      <CanvasCommandProvider>
        <Toaster position="bottom-right" />
        <CommandPalette />
        <AppShell />
      </CanvasCommandProvider>
    </TabStateProvider>
  );
}

export default App;
