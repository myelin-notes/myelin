import { memo } from 'react';
import type { Tab } from '@/lib/tabs/types';
import { CanvasView } from '@/pages/canvas';
import { CsvViewerPage } from '@/pages/csv-viewer';
import { GraphPage } from '@/pages/graph';
import { ImageViewerPage } from '@/pages/image-viewer';
import { SettingsPage } from '@/pages/settings';

interface PaneContentProps {
  tab: Tab;
}

export const PaneContent = memo(function PaneContent({
  tab,
}: PaneContentProps) {
  switch (tab.target.type) {
    case 'graph':
      return <GraphPage />;
    case 'settings':
      return <SettingsPage />;
    case 'canvas':
      return (
        <CanvasView
          id={tab.target.id}
          initialPageFrameName={tab.target.pageFrameName}
          initialPageFrameId={tab.target.pageFrameId}
        />
      );
    case 'image':
      return <ImageViewerPage id={tab.target.id} />;
    case 'csv':
      return <CsvViewerPage id={tab.target.id} />;
  }
});
