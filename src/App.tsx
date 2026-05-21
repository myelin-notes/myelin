import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { CommandPalette } from '@/components/command-palette';
import { useTheme } from '@/hooks/useTheme';
import { ImageFileTypes } from '@/lib/sync';
import { CanvasView } from '@/pages/canvas';
import { CanvasCommandProvider } from '@/pages/canvas/command-context';
import { ImageViewerPage } from '@/pages/image-viewer';
import { LibraryPage } from '@/pages/library';
import { SettingsPage } from '@/pages/settings';

function App() {
  useTheme('light');

  return (
    <MemoryRouter>
      <CanvasCommandProvider>
        <Toaster position="bottom-right" />
        <CommandPalette />
        <Routes>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/mcanvas/:id" element={<CanvasView />} />
          {ImageFileTypes.map((fileType) => (
            <Route
              key={fileType}
              path={`/${fileType}/:id`}
              element={<ImageViewerPage />}
            />
          ))}
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </CanvasCommandProvider>
    </MemoryRouter>
  );
}

export default App;
