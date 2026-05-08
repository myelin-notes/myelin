/**
 * Escape syntax for note-link titles (`[[…]]`).
 *
 * The syntax is `[[note ('#' frame)? ('|' alias)?]]`, where note may contain
 * `/`-separated path segments. Inside any segment, the characters `\`, `#`, and
 * `|` are special and may be escaped with a leading `\`. The rules:
 *
 * - `\\` → literal `\`
 * - `\#` → literal `#` (does not start the frame)
 * - `\|` → literal `|` (does not start the alias)
 * - `\X` for any other X → literal `X` (forgiving; never an error)
 * - A trailing lone `\` is preserved as a literal backslash
 *
 * `[[`, `]]`, and `/` are NOT escapable. `]]` always ends the link, and `/`
 * always separates path segments — file systems disallow them in names.
 */

const SPECIAL_CHARS = new Set(['\\', '#', '|']);

export function escapeNoteLinkSegment(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (SPECIAL_CHARS.has(ch)) {
      out += '\\';
    }
    out += ch;
  }
  return out;
}

export function unescapeNoteLinkSegment(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      out += text[i + 1];
      i++;
      continue;
    }
    out += text[i];
  }
  return out;
}

function findUnescaped(text: string, delimiter: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === delimiter) {
      return i;
    }
  }
  return -1;
}

export interface NoteLinkTitleParts {
  target: string;
  alias: string | null;
}

export function splitNoteLinkTitle(title: string): NoteLinkTitleParts {
  const aliasIndex = findUnescaped(title, '|');
  if (aliasIndex === -1) {
    return { target: title, alias: null };
  }
  return {
    target: title.slice(0, aliasIndex),
    alias: title.slice(aliasIndex + 1),
  };
}

export interface NoteLinkTargetParts {
  noteTarget: string;
  frame: string | null;
}

export function splitNoteLinkTargetFrame(target: string): NoteLinkTargetParts {
  const frameIndex = findUnescaped(target, '#');
  if (frameIndex === -1) {
    return { noteTarget: target, frame: null };
  }
  return {
    noteTarget: target.slice(0, frameIndex),
    frame: target.slice(frameIndex + 1),
  };
}

export function joinNoteLinkTitle(
  noteTarget: string,
  frame: string | null,
  alias: string | null,
): string {
  let result = noteTarget;
  if (frame !== null) {
    result += `#${frame}`;
  }
  if (alias !== null) {
    result += `|${alias}`;
  }
  return result;
}

export function escapeNoteLinkPath(path: string): string {
  return path.split('/').map(escapeNoteLinkSegment).join('/');
}
