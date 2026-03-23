import { MemoryRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { ExplorerPage } from "@/pages/FileExplorer/ExplorerPage";
import { FreeCanvas } from "@/pages/FreeCanvas";
import { DocumentView } from "@/pages/DocumentEditor/DocumentView";

function App() {
  return (
    <MemoryRouter>
      <Toaster position="bottom-right" />
      <Routes>
        <Route path="/" element={<Navigate to="/file/Home" replace />} />
        <Route path="/file/*" element={<ExplorerPage />} />
        <Route path="/mcanvas/*" element={<FreeCanvas />} />
        <Route path="/mdoc/*" element={<DocumentView />} />
      </Routes>
    </MemoryRouter>
  );
}

export default App;
