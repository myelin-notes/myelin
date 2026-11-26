import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { Logger } from '@myelin/shared/logger';
import { exportTemplate, saveAsTemplate } from '@/lib/note/templates';
import { useRepository, type VFSFileNode } from '@/lib/sync';

const logger = new Logger('TemplateActions');

/** Context-menu handlers; each is undefined when it doesn't apply to `file`. */
export function useTemplateActions(file: VFSFileNode, isTemplate: boolean) {
  const repository = useRepository();
  const strings = useMessages().library.templates;

  if (file.fileType !== 'mcanvas') {
    return {};
  }
  if (isTemplate) {
    return {
      onExportTemplate: () => {
        exportTemplate(repository, file).catch((error) => {
          logger.error('Failed to export template', error);
          toast.error(strings.exportFailed);
        });
      },
    };
  }
  return {
    onSaveAsTemplate: () => {
      saveAsTemplate(repository, file)
        .then(() => toast.success(strings.savedAsTemplate(file.name)))
        .catch((error) => {
          logger.error('Failed to save template', error);
          toast.error(strings.saveFailed);
        });
    },
  };
}
