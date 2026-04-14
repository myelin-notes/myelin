import * as Y from 'yjs';
import { DEBUG } from '@/lib/debug';
import type { YDocManager } from '@/pages/free-canvas/ydoc-manager';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export class PeerSync {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private updateHandler: (update: Uint8Array, origin: unknown) => void;

  onSignal: ((signal: string) => void) | null = null;
  onConnect: (() => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(
    private readonly ydoc: YDocManager,
    private readonly initiator: boolean,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (e) => {
      if (DEBUG) {
        if (e.candidate) {
          console.log(`[PeerSync] ICE candidate: ${e.candidate.candidate}`);
        } else {
          console.log('[PeerSync] ICE gathering complete');
        }
      }
      if (e.candidate === null) {
        const encoded = btoa(JSON.stringify(this.pc.localDescription));
        if (DEBUG) {
          console.log(
            `[PeerSync] signal generated (${initiator ? 'offer' : 'answer'})`,
          );
        }
        this.onSignal?.(encoded);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (DEBUG) {
        console.log(
          `[PeerSync] ICE state: ${this.pc.iceConnectionState}`,
        );
      }
    };

    this.pc.onconnectionstatechange = () => {
      if (DEBUG) {
        console.log(`[PeerSync] state: ${this.pc.connectionState}`);
      }
      if (
        this.pc.connectionState === 'disconnected' ||
        this.pc.connectionState === 'failed' ||
        this.pc.connectionState === 'closed'
      ) {
        this.onClose?.();
      }
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel('yjs');
      this.setupDataChannel(this.dc);
      this.pc.createOffer().then((offer) => this.pc.setLocalDescription(offer));
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.setupDataChannel(this.dc);
      };
    }

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'remote-peer' && this.dc?.readyState === 'open') {
        this.dc.send(new Uint8Array(update));
      }
    };
    this.ydoc.doc.on('update', this.updateHandler);
  }

  async acceptSignal(encoded: string): Promise<void> {
    try {
      const desc = JSON.parse(atob(encoded)) as RTCSessionDescriptionInit;
      if (DEBUG) {
        console.log(`[PeerSync] accepting signal, type=${desc.type}`);
      }
      await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
      if (!this.initiator) {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        if (DEBUG) {
          console.log('[PeerSync] local description set (answer)');
        }
      }
    } catch (err) {
      if (DEBUG) {
        console.error('[PeerSync] acceptSignal error:', err);
      }
    }
  }

  get connected(): boolean {
    return this.dc?.readyState === 'open';
  }

  destroy(): void {
    this.ydoc.doc.off('update', this.updateHandler);
    this.dc?.close();
    this.pc.close();
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      if (DEBUG) {
        console.log('[PeerSync] data channel open');
      }
      const state = Y.encodeStateAsUpdate(this.ydoc.doc);
      dc.send(new Uint8Array(state));
      this.onConnect?.();
    };

    dc.onmessage = (e) => {
      const update = new Uint8Array(e.data as ArrayBuffer);
      if (DEBUG) {
        console.log(`[PeerSync] received ${update.byteLength} bytes`);
      }
      Y.applyUpdate(this.ydoc.doc, update, 'remote-peer');
    };

    dc.onclose = () => {
      if (DEBUG) {
        console.log('[PeerSync] data channel closed');
      }
      this.onClose?.();
    };
  }
}
