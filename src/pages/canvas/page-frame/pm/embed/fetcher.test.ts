import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setPlatform } from '@/platform';
import { createFakePlatform } from '@/test/fake-platform';
import { fetchEmbed } from './fetcher';

const fetchMock = vi.fn();

function response(opts: {
  ok?: boolean;
  status?: number;
  contentType?: string | null;
  text?: string;
}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? (opts.contentType ?? null)
          : null,
    },
    text: () => Promise.resolve(opts.text ?? ''),
    json: () => Promise.resolve({}),
  };
}

// fetchEmbed caches by URL, so each case uses a fresh URL.
let counter = 0;
function uniqueUrl(): string {
  counter += 1;
  return `https://example.com/resource-${counter}`;
}

describe('fetchEmbed content-type detection', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    setPlatform(createFakePlatform({ fetch: fetchMock }));
  });

  it('treats an image content-type as a media embed', async () => {
    fetchMock.mockResolvedValue(response({ contentType: 'image/png' }));
    const url = uniqueUrl();
    await expect(fetchEmbed(url)).resolves.toEqual({
      kind: 'media',
      mediaKind: 'image',
      url,
    });
  });

  it('treats a video content-type as a media embed', async () => {
    fetchMock.mockResolvedValue(response({ contentType: 'video/mp4' }));
    const url = uniqueUrl();
    await expect(fetchEmbed(url)).resolves.toEqual({
      kind: 'media',
      mediaKind: 'video',
      url,
    });
  });

  it('ignores a content-type charset suffix', async () => {
    fetchMock.mockResolvedValue(
      response({ contentType: 'IMAGE/JPEG; charset=binary' }),
    );
    const result = await fetchEmbed(uniqueUrl());
    expect(result.kind).toBe('media');
  });

  it('falls back to a link card for html responses', async () => {
    fetchMock.mockResolvedValue(
      response({ contentType: 'text/html', text: '<title>Hello</title>' }),
    );
    const result = await fetchEmbed(uniqueUrl());
    expect(result.kind).toBe('link');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
