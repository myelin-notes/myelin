import type { ResolveMediaSrc } from '../page-frame/pm/embed/renderer';
import type { ResolveNoteLink } from '../page-frame/pm/markdown/note-links';
import type { LivePeersSnapshot } from '../sync/live/peers';
import type { DrawableElement } from './drawable-element';

export interface CanvasElementContext {
  getElements: () => readonly DrawableElement[];
  resolveNoteLink?: ResolveNoteLink;
  resolveMedia?: ResolveMediaSrc;
  onPageFrameRenamed?: (uuid: string, newName: string, oldName: string) => void;
  localPeerId: string;
  audioRecordingOwnerId: string;
  onAudioRecordingSaved?: () => void | Promise<void>;
  livePeers: LivePeersSnapshot | null;
}
