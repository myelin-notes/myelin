import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasViewport } from '../../canvas-viewport';
import type { Vector2 } from '../../geometry';
import { YDocManager } from '../../ydoc-manager';
import { ElementType } from '../element-type';
import { AudioElement } from './element';

const render = vi.hoisted(() => vi.fn());
vi.mock('react-dom/client', () => ({
  createRoot: () => ({ render, unmount: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  render.mockClear();
});

it('passes long recordings to React without enumerable byte properties', () => {
  vi.stubGlobal('document', {
    createElement: () => ({
      dataset: {},
      style: { getPropertyValue: () => '', setProperty: vi.fn() },
    }),
  });
  const host = {
    closest: () => null,
    appendChild: vi.fn(),
  } as unknown as HTMLElement;
  const viewport = {
    zoom: 1,
    worldToScreen: (point: Vector2) => point,
  } as CanvasViewport;
  const element = new AudioElement('long-audio', 'peer-a');
  element.syncDOM(viewport, host);
  const bytes = new Uint8Array(20 * 1024 * 1024);
  bytes[0] = 123;
  bytes[bytes.length - 1] = 234;

  element.setAudioData(
    bytes,
    'recording.webm',
    1200,
    'audio/webm',
    new Float32Array(80),
  );

  const view = render.mock.lastCall![0] as ReactElement<{
    children: ReactElement<{ audioBuffer: ArrayBuffer }>;
  }>;
  const buffer = view.props.children.props.audioBuffer;
  expect(buffer).toBeInstanceOf(ArrayBuffer);
  expect(Object.keys(buffer)).toEqual([]);
  expect(buffer.byteLength).toBe(bytes.byteLength);
  expect(new Uint8Array(buffer)[0]).toBe(123);
  expect(new Uint8Array(buffer)[bytes.length - 1]).toBe(234);
  expect(buffer).toBe(element.audioData!.buffer);
});

describe('AudioElement ownership', () => {
  it('includes the local peer as creator when created locally', () => {
    const element = new AudioElement('audio-1', 'peer-a');

    expect(element.getYMapProps().creatorPeerId).toBe('peer-a');
  });

  it('loads the creator peer from synced state', () => {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.AUDIO, 'audio-1', {
      creatorPeerId: 'peer-a',
    });
    const element = new AudioElement('audio-1', 'peer-b');

    element.bindToYMap(yMap);

    expect(element.creatorPeerId).toBe('peer-a');
  });
});

describe('AudioElement transcription claims', () => {
  function bindElement(localPeerId: string, props: Record<string, unknown>) {
    const ydoc = new YDocManager();
    const yMap = ydoc.createElementMap(ElementType.AUDIO, 'audio-1', props);
    const element = new AudioElement('audio-1', localPeerId);
    element.bindToYMap(yMap);
    return { element, yMap };
  }

  it('writes the local peer id to the shared claim field', () => {
    const { element, yMap } = bindElement('peer-a', {});

    element.claimTranscription();

    expect(element.transcribingPeerId).toBe('peer-a');
    expect(yMap.get('transcribingPeerId')).toBe('peer-a');
  });

  it('releases only its own claim', () => {
    const { element, yMap } = bindElement('peer-b', {
      transcribingPeerId: 'peer-a',
    });

    element.releaseTranscriptionClaim();
    expect(yMap.get('transcribingPeerId')).toBe('peer-a');

    element.claimTranscription();
    element.releaseTranscriptionClaim();
    expect(yMap.get('transcribingPeerId')).toBe('');
  });

  it('loads a synced claim from the YMap', () => {
    const { element } = bindElement('peer-b', {
      transcribingPeerId: 'peer-a',
    });

    expect(element.transcribingPeerId).toBe('peer-a');
  });
});
