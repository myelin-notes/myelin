import { describe, expect, it } from 'vitest';
import { YDocManager } from '../../ydoc-manager';
import { ElementType } from '../element-type';
import { AudioElement } from './element';

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
