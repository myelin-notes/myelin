/** BOMs that pin an encoding outright. Order matters: UTF-8's is longer than the UTF-16 pair. */
const BOMS = [
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
] as const;

export interface DecodedText {
  text: string;
  /** Label of the decoder used, for display when it is not plain UTF-8. */
  encoding: string;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return (
    bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b)
  );
}

/**
 * Decode file bytes, picking the encoding from a BOM when there is one and otherwise falling back
 * to windows-1252 for anything that is not valid UTF-8 — the usual shape of a spreadsheet export.
 */
export function decodeText(bytes: Uint8Array): DecodedText {
  for (const bom of BOMS) {
    if (hasPrefix(bytes, bom.bytes)) {
      return {
        text: new TextDecoder(bom.encoding).decode(
          bytes.subarray(bom.bytes.length),
        ),
        encoding: bom.encoding,
      };
    }
  }

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'utf-8',
    };
  } catch {
    // windows-1252 maps every byte value, so this decode cannot itself fail.
    return {
      text: new TextDecoder('windows-1252').decode(bytes),
      encoding: 'windows-1252',
    };
  }
}
