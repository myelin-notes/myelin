import { Toaster } from 'sonner';
import { CommandPalette } from '@/components/command-palette';
import { AppShell } from '@/components/layout/app-shell';
import { useTheme } from '@/hooks/useTheme';
import { TabStateProvider } from '@/lib/tabs/context';
import { CanvasCommandProvider } from '@/pages/canvas/command-context';

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
