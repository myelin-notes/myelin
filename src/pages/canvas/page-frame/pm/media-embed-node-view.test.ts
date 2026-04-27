import { describe, expect, it } from 'vitest';
import {
  shouldPreserveMediaEmbedFocus,
  shouldStopMediaEmbedEvent,
} from './media-embed-node-view';

describe('media embed interaction helpers', () => {
  it('preserves focus for interactive video embeds', () => {
    expect(shouldPreserveMediaEmbedFocus('video')).toBe(true);
    expect(shouldPreserveMediaEmbedFocus('image')).toBe(false);
  });

  it('stops editor event handling only for events inside video embeds', () => {
    expect(shouldStopMediaEmbedEvent('video', true)).toBe(true);
    expect(shouldStopMediaEmbedEvent('video', false)).toBe(false);
    expect(shouldStopMediaEmbedEvent('image', true)).toBe(false);
  });
});
