import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function DebugPage() {
  const navigate = useNavigate();
  const [noteId, setNoteId] = useState('');

  const handleConnect = () => {
    const trimmed = noteId.trim();
    if (trimmed) {
      navigate(`/mcanvas/${trimmed}`);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-page">
      <div className="flex w-80 flex-col gap-4">
        <h1 className="font-semibold text-lg text-text-primary">
          Debug: Connect to Note
        </h1>
        <input
          type="text"
          value={noteId}
          onChange={(e) => setNoteId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
          placeholder="Paste note ID"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={handleConnect}
          className="rounded-lg bg-primary px-3 py-2 font-medium text-sm text-white transition-colors hover:bg-primary/90"
        >
          Connect
        </button>
      </div>
    </div>
  );
}
