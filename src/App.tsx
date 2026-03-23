import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { useTheme } from "@/hooks/useTheme";
import { LibraryPage } from "@/pages/library";
import { CanvasView } from "@/pages/free-canvas";
import { DocumentView } from "@/pages/document-editor";

function App() {
  useTheme("light");

  return (
    <MemoryRouter>
      <Toaster position="bottom-right" />
      <Routes>
        <Route path="/" element={<Navigate to="/library" replace />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/mcanvas/*" element={<CanvasView />} />
        <Route path="/mdoc/*" element={<DocumentView />} />
      </Routes>
    </MemoryRouter>
  );
}

export default App;
