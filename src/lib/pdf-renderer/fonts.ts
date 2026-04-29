import { OPS, type PDFPageProxy } from 'pdfjs-dist';
import { Logger } from '@/lib/logger';
import type { PdfDocument } from './document';

const logger = new Logger('PdfRendererFonts');

interface FontLike {
  loadedName?: string;
  data?: Uint8Array;
  mimetype?: string;
  cssFontInfo?: {
    fontFamily: string;
    fontWeight?: number | string;
    italicAngle?: number;
  };
  disableFontFace?: boolean;
}

export async function injectPageFonts(
  doc: PdfDocument,
  page: PDFPageProxy,
): Promise<void> {
  const opList = await page.getOperatorList();
  const fontRefs = new Set<string>();
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== OPS.setFont) {
      continue;
    }
    const ref = opList.argsArray[i]?.[0];
    if (typeof ref === 'string') {
      fontRefs.add(ref);
    }
  }

  const pending: Promise<void>[] = [];
  for (const ref of fontRefs) {
    const font = page.commonObjs.has(ref)
      ? (page.commonObjs.get(ref) as FontLike | null)
      : null;
    if (!font?.loadedName || !font.data || font.disableFontFace) {
      continue;
    }
    if (doc.injectedFontIds.has(font.loadedName)) {
      continue;
    }
    doc.injectedFontIds.add(font.loadedName);

    const descriptors: FontFaceDescriptors = {};
    let family = font.loadedName;
    if (font.cssFontInfo) {
      family = font.cssFontInfo.fontFamily;
      if (font.cssFontInfo.fontWeight != null) {
        descriptors.weight = String(font.cssFontInfo.fontWeight);
      }
      if (font.cssFontInfo.italicAngle) {
        descriptors.style = `oblique ${font.cssFontInfo.italicAngle}deg`;
      }
    }
    const src = font.data as BufferSource;
    const face = new FontFace(family, src, descriptors);
    document.fonts.add(face);
    pending.push(
      face.load().then(
        () => undefined,
        (err) => {
          logger.error('Font load failed', {
            loadedName: font.loadedName,
            family,
            error: `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`,
          });
          document.fonts.delete(face);
          doc.injectedFontIds.delete(font.loadedName!);
        },
      ),
    );
  }
  await Promise.all(pending);
}
