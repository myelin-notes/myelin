import { memo } from 'react';
import type { Tab } from '@/lib/tabs/types';
import { CanvasView } from '@/pages/canvas';
import { ImageViewerPage } from '@/pages/image-viewer';
import { LibraryPage } from '@/pages/library';
import { SettingsPage } from '@/pages/settings';

interface PaneContentProps {
  tab: Tab;
}

export const PaneContent = memo(function PaneContent({ tab }: PaneContentProps) {
  switch (tab.target.type) {
    case 'library':
      return <LibraryPage />;
    case 'settings':
      return <SettingsPage />;
    case 'canvas':
      return (
        <CanvasView
          id={tab.target.id}
          initialPageFrameName={tab.target.pageFrameName}
        />
      );
    case 'image':
      return (
        <ImageViewerPage id={tab.target.id} fileType={tab.target.fileType} />
      );
  }
});
