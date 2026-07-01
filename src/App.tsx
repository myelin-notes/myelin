import { Toaster } from 'sonner';
import { CommandPalette } from '@/components/command-palette';
import { RootLayout } from '@/components/layout/root-layout';
import { SidebarProvider } from '@/components/layout/sidebar/context';
import { useTheme } from '@/hooks/useTheme';
import { McpRuntime } from '@/lib/mcp/runtime';
import { TabStateProvider } from '@/lib/tabs/context';
import { CanvasCommandProvider } from '@/pages/canvas/command-context';

function App() {
  useTheme();

  return (
    <TabStateProvider>
      <CanvasCommandProvider>
        <SidebarProvider>
          <McpRuntime />
          <Toaster position="bottom-right" />
          <CommandPalette />
          <RootLayout />
        </SidebarProvider>
      </CanvasCommandProvider>
    </TabStateProvider>
  );
}

export default App;
