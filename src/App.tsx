import { useCallback, useState } from 'react';
import { Toaster } from 'sonner';
import { CanvasCommandProvider } from '@myelin/editor/command-context';
import { CommandPalette } from '@/components/command-palette';
import { RootLayout } from '@/components/layout/root-layout';
import { SidebarProvider } from '@/components/layout/sidebar/context';
import { TourOverlay } from '@/components/tour/tour-overlay';
import { useTheme } from '@/hooks/useTheme';
import { McpRuntime } from '@/lib/mcp/runtime';
import { TabStateProvider } from '@/lib/tabs/context';
import { useUserPref } from '@/lib/use-user-pref';
import { OnboardingFlow } from '@/pages/onboarding';

function App() {
  useTheme();
  const onboardingCompleted = useUserPref('onboardingCompleted');
  const [tourActive, setTourActive] = useState(false);

  const handleOnboardingDone = useCallback(
    ({ startTour }: { startTour: boolean }) => setTourActive(startTour),
    [],
  );
  const handleTourFinish = useCallback(() => setTourActive(false), []);

  return (
    <TabStateProvider>
      <CanvasCommandProvider>
        <SidebarProvider>
          <McpRuntime />
          <Toaster position="bottom-right" />
          {onboardingCompleted ? (
            <>
              <CommandPalette />
              <RootLayout />
              {tourActive && <TourOverlay onFinish={handleTourFinish} />}
            </>
          ) : (
            <OnboardingFlow onDone={handleOnboardingDone} />
          )}
        </SidebarProvider>
      </CanvasCommandProvider>
    </TabStateProvider>
  );
}

export default App;
