import type { ChromeMenuOpener } from '../chrome-menu';
import type { ExportTarget } from '../export/export-controller';
import type { ResolveMediaSrc } from '../page-frame/pm/embed/renderer';
import type { ResolveNoteLink } from '../page-frame/pm/markdown/note-links';
import type { LivePeersSnapshot } from '../sync/live/peers';
import type { EnsureCodeOutputCard } from './code-output/bridge';
import type { DrawableElement } from './drawable-element';

export interface CanvasUiServices {
  openChromeMenu: ChromeMenuOpener;
  openExportDialog: (target: ExportTarget) => void;
  ensureCodeOutputCard?: EnsureCodeOutputCard;
}

export interface CanvasElementContext {
  getElements: () => readonly DrawableElement[];
  resolveNoteLink?: ResolveNoteLink;
  resolveMedia?: ResolveMediaSrc;
  onPageFrameRenamed?: (uuid: string, newName: string, oldName: string) => void;
  localPeerId: string;
  audioRecordingOwnerId: string;
  onAudioRecordingSaved?: () => void | Promise<void>;
  livePeers: LivePeersSnapshot | null;
  uiServices?: CanvasUiServices;
}
