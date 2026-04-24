import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { CommandPalette } from '@/components/command-palette';
import { useTheme } from '@/hooks/useTheme';
import { CanvasView } from '@/pages/canvas';
import { DebugPage } from '@/pages/debug';
import { LibraryPage } from '@/pages/library';
import { SettingsPage } from '@/pages/settings';

function App() {
  useTheme('light');

  return (
    <MemoryRouter>
      <Toaster position="bottom-right" />
      <CommandPalette />
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/mcanvas/:id" element={<CanvasView />} />
        <Route path="/debug" element={<DebugPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

export default App;
