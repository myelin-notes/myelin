import {
  FileText,
  Film,
  ImageIcon,
  type LucideIcon,
  Table2,
} from 'lucide-react';
import {
  type FileType,
  isDataFileType,
  isImageFileType,
  isVideoFileType,
} from '@/lib/sync';

/** Icon for a library file row. Canvases keep the document glyph; media and data get their own. */
export function getFileTypeIcon(fileType: FileType): LucideIcon {
  if (isDataFileType(fileType)) {
    return Table2;
  }
  if (isImageFileType(fileType)) {
    return ImageIcon;
  }
  if (isVideoFileType(fileType)) {
    return Film;
  }
  return FileText;
}
