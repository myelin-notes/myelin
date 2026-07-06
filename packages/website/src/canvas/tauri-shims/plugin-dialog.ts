// Browser stand-in for @tauri-apps/plugin-dialog: dialogs always cancel.
export async function save(): Promise<string | null> {
  return null;
}

export async function open(): Promise<string | string[] | null> {
  return null;
}

export async function message(): Promise<void> {}

export async function confirm(): Promise<boolean> {
  return false;
}

export async function ask(): Promise<boolean> {
  return false;
}
