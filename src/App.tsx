import { Toaster } from 'sonner';
import { CanvasCommandProvider } from '@myelin/editor/command-context';
import { CommandPalette } from '@/components/command-palette';
import { RootLayout } from '@/components/layout/root-layout';
import { SidebarProvider } from '@/components/layout/sidebar/context';
import { WhatsNewDialog } from '@/components/whats-new-dialog';
import { useTheme } from '@/hooks/useTheme';
import { McpRuntime } from '@/lib/mcp/runtime';
import { TabStateProvider } from '@/lib/tabs/context';
import { useUserPref } from '@/lib/use-user-pref';
import { OnboardingFlow } from '@/pages/onboarding';

// Sonner's default offsets, measured from the system bars rather than the window edge.
const TOAST_OFFSET = {
  bottom: 'calc(24px + env(safe-area-inset-bottom))',
  right: 'calc(24px + env(safe-area-inset-right))',
};
const TOAST_MOBILE_OFFSET = {
  bottom: 'calc(16px + env(safe-area-inset-bottom))',
  right: 'calc(16px + env(safe-area-inset-right))',
  left: 'calc(16px + env(safe-area-inset-left))',
};

function App() {
  useTheme();
  const onboardingCompleted = useUserPref('onboardingCompleted');

  return (
    <TabStateProvider>
      <CanvasCommandProvider>
        <SidebarProvider>
          <McpRuntime />
          <Toaster
            position="bottom-right"
            offset={TOAST_OFFSET}
            mobileOffset={TOAST_MOBILE_OFFSET}
          />
          {onboardingCompleted ? (
            <>
              <CommandPalette />
              <RootLayout />
              <WhatsNewDialog />
            </>
          ) : (
            <OnboardingFlow />
          )}
        </SidebarProvider>
      </CanvasCommandProvider>
    </TabStateProvider>
  );
}

export default App;
