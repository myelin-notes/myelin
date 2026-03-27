import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { useTheme } from "@/hooks/useTheme";
import { LibraryPage } from "@/pages/library";
import { CanvasView } from "@/pages/free-canvas";

function App() {
  useTheme("light");

  return (
    <MemoryRouter>
      <Toaster position="bottom-right" />
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/mcanvas/:id" element={<CanvasView />} />
      </Routes>
    </MemoryRouter>
  );
}

export default App;
