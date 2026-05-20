export interface OEmbedProvider {
  name: string;
  match: RegExp;
  endpoint: (url: string) => string;
}

const json = (base: string, url: string): string =>
  `${base}${base.includes('?') ? '&' : '?'}format=json&url=${encodeURIComponent(url)}`;

export const OEMBED_PROVIDERS: OEmbedProvider[] = [
  {
    name: 'YouTube',
    match: /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i,
    endpoint: (url) => json('https://www.youtube.com/oembed', url),
  },
  {
    name: 'Vimeo',
    match: /^(https?:\/\/)?(www\.)?vimeo\.com\//i,
    endpoint: (url) => json('https://vimeo.com/api/oembed.json', url),
  },
  {
    name: 'Twitter',
    match: /^(https?:\/\/)?(www\.)?(twitter|x)\.com\//i,
    endpoint: (url) =>
      `${json('https://publish.twitter.com/oembed', url)}&dnt=true`,
  },
  {
    name: 'Spotify',
    match: /^(https?:\/\/)?(open\.)?spotify\.com\//i,
    endpoint: (url) => json('https://open.spotify.com/oembed', url),
  },
  {
    name: 'SoundCloud',
    match: /^(https?:\/\/)?(www\.)?soundcloud\.com\//i,
    endpoint: (url) => json('https://soundcloud.com/oembed', url),
  },
  {
    name: 'Loom',
    match: /^(https?:\/\/)?(www\.)?loom\.com\//i,
    endpoint: (url) => json('https://www.loom.com/v1/oembed', url),
  },
  {
    name: 'CodePen',
    match: /^(https?:\/\/)?(www\.)?codepen\.io\//i,
    endpoint: (url) => json('https://codepen.io/api/oembed', url),
  },
  {
    name: 'Figma',
    match: /^(https?:\/\/)?(www\.)?figma\.com\//i,
    endpoint: (url) => json('https://www.figma.com/api/oembed', url),
  },
  {
    name: 'TikTok',
    match: /^(https?:\/\/)?(www\.)?tiktok\.com\//i,
    endpoint: (url) => json('https://www.tiktok.com/oembed', url),
  },
  {
    name: 'Reddit',
    match: /^(https?:\/\/)?(www\.)?reddit\.com\//i,
    endpoint: (url) => json('https://www.reddit.com/oembed', url),
  },
];

export function matchProvider(url: string): OEmbedProvider | null {
  return OEMBED_PROVIDERS.find((p) => p.match.test(url)) ?? null;
}
