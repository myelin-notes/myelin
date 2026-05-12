const TAR_BLOCK_SIZE = 512;

async function gunzip(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(input)])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function parseTarOctal(bytes: Uint8Array): number {
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === 0 || byte === 0x20) {
      break;
    }
    text += String.fromCharCode(byte);
  }
  return text ? Number.parseInt(text, 8) : 0;
}

function parseTarString(bytes: Uint8Array): string {
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  return new TextDecoder().decode(bytes.subarray(0, end));
}

// Minimal tar reader: returns regular file entries keyed by path. Handles
// ustar `prefix` and GNU long-name records ('L'); skips pax/global headers.
function parseTar(tar: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset + TAR_BLOCK_SIZE <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_SIZE);
    offset += TAR_BLOCK_SIZE;

    let allZero = true;
    for (let i = 0; i < header.length; i++) {
      if (header[i] !== 0) {
        allZero = false;
        break;
      }
    }
    if (allZero) {
      break;
    }

    const size = parseTarOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] || 0);
    const contentEnd = offset + size;
    const paddedEnd =
      offset + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;

    if (typeflag === 'L') {
      pendingLongName = parseTarString(tar.subarray(offset, contentEnd));
      offset = paddedEnd;
      continue;
    }

    // Pax 'x' headers can carry a `path=` override; we ignore them, so a file
    // whose path exceeds the 100-char ustar field is silently keyed under its
    // truncated name. Safe today (our paths are `files/<uuid>.<ext>`, well
    // under 100 chars including GitHub's `<owner>-<repo>-<sha>/` wrapper) but
    // a future schema change that lengthens stored paths must add pax parsing.
    if (typeflag === 'x' || typeflag === 'g') {
      offset = paddedEnd;
      continue;
    }

    if (typeflag === '0' || typeflag === '\0') {
      let name = pendingLongName ?? parseTarString(header.subarray(0, 100));
      const prefix = parseTarString(header.subarray(345, 500));
      if (!pendingLongName && prefix) {
        name = `${prefix}/${name}`;
      }
      entries.set(name, tar.slice(offset, contentEnd));
    }

    pendingLongName = null;
    offset = paddedEnd;
  }

  return entries;
}

function stripTopLevelDir(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? '' : path.slice(slash + 1);
}

// Decompresses a gzipped tarball and returns regular-file entries keyed by
// path with the top-level directory stripped (matching how GitHub's tarball
// endpoint wraps repo contents under a single `<owner>-<repo>-<sha>/` dir).
export async function readGzippedTarballEntries(
  gzipped: Uint8Array,
): Promise<Map<string, Uint8Array>> {
  const tar = await gunzip(gzipped);
  const entries = parseTar(tar);

  const stripped = new Map<string, Uint8Array>();
  for (const [path, bytes] of entries) {
    const trimmed = stripTopLevelDir(path);
    if (trimmed) {
      stripped.set(trimmed, bytes);
    }
  }
  return stripped;
}
