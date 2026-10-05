import {
  FileText,
  Film,
  ImageIcon,
  type LucideIcon,
  Table2,
} from 'lucide-react';
import { type FileType, getFileIconKind } from '@/lib/sync';

/** Icon for a library file row. Canvases keep the document glyph; media and data get their own. */
export function getFileTypeIcon(fileType: FileType): LucideIcon {
  switch (getFileIconKind(fileType)) {
    case 'table':
      return Table2;
    case 'image':
      return ImageIcon;
    case 'video':
      return Film;
    case 'document':
      return FileText;
  }
}
