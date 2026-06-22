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
