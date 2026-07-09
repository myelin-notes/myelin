import { Toaster } from 'sonner';
import { CanvasCommandProvider } from '@myelin/editor/command-context';
import { CommandPalette } from '@/components/command-palette';
import { RootLayout } from '@/components/layout/root-layout';
import { SidebarProvider } from '@/components/layout/sidebar/context';
import { useTheme } from '@/hooks/useTheme';
import { McpRuntime } from '@/lib/mcp/runtime';
import { TabStateProvider } from '@/lib/tabs/context';

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
