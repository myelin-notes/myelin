// Browser stand-in for @tauri-apps/plugin-opener: open links in a new tab.
export async function openUrl(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function openPath(): Promise<void> {}

export async function revealItemInDir(): Promise<void> {}
