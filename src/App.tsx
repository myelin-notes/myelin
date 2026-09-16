import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { CanvasCommandProvider } from '@myelin/editor/command-context';
import { CommandPalette } from '@/components/command-palette';
import { RootLayout } from '@/components/layout/root-layout';
import { SidebarProvider } from '@/components/layout/sidebar/context';
import { useTheme } from '@/hooks/useTheme';
import { MOBILE_PLATFORM } from '@/lib/env';
import { McpRuntime } from '@/lib/mcp/runtime';
import { syncAppleTrackingConsent } from '@/lib/posthog';
import { TabStateProvider } from '@/lib/tabs/context';
import { useUserPref } from '@/lib/use-user-pref';
import { OnboardingFlow } from '@/pages/onboarding';

function App() {
  useTheme();
  const onboardingCompleted = useUserPref('onboardingCompleted');

  useEffect(() => {
    if (MOBILE_PLATFORM !== 'ios' || !onboardingCompleted) {
      return;
    }
    const syncConsent = () => {
      if (document.visibilityState === 'visible') {
        void syncAppleTrackingConsent();
      }
    };
    syncConsent();
    window.addEventListener('focus', syncConsent);
    document.addEventListener('visibilitychange', syncConsent);
    return () => {
      window.removeEventListener('focus', syncConsent);
      document.removeEventListener('visibilitychange', syncConsent);
    };
  }, [onboardingCompleted]);

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
