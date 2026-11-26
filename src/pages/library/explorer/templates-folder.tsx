import { Folder, LayoutTemplate } from 'lucide-react';
import { useMessages } from '@myelin/editor/i18n';
import { cn } from '@myelin/editor/utils';
import type { VFSFolderNode } from '@/lib/sync';
import { isTemplatesRoot } from '@/lib/sync/repo/shared';
import { folderIconStyle } from './folder-colors';

export function FolderGlyph({
  folder,
  className,
}: {
  folder: VFSFolderNode;
  className?: string;
}) {
  return isTemplatesRoot(folder) ? (
    <LayoutTemplate
      className={cn(className, 'text-emerald-600 dark:text-accent')}
    />
  ) : (
    <Folder className={className} style={folderIconStyle(folder.color)} />
  );
}

/** The templates root is stored under a dotfile name; users see it as "Templates". */
export function useFolderLabel(folder: VFSFolderNode): string {
  const strings = useMessages();
  return isTemplatesRoot(folder)
    ? strings.library.templates.title
    : folder.name;
}
