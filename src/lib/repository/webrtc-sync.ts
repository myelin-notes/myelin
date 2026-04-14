import { WebrtcProvider } from 'y-webrtc';
import type { NoteSession } from './types';

export class WebRTCSync {
  private provider: WebrtcProvider;

  constructor(
    session: NoteSession,
    roomId: string,
    options?: { password?: string; signaling?: string[] },
  ) {
    this.provider = new WebrtcProvider(roomId, session.ydoc.doc, {
      password: options?.password,
      signaling: options?.signaling,
    });
  }

  get awareness() {
    return this.provider.awareness;
  }

  get connected() {
    return this.provider.connected;
  }

  destroy(): void {
    this.provider.destroy();
  }
}
