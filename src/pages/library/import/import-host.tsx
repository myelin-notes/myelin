import { memo } from 'react';
import { ImportDialog } from './dialog';
import { ImportPickerDialog } from './picker-dialog';
import type { ImportHostProps } from './use-imports';

/**
 * Every piece of import UI, so the pages that offer importing render one element
 * and never change when a source is added.
 */
export const ImportHost = memo(function ImportHost({
  pickerOpen,
  onPickerOpenChange,
  onSelectProvider,
  fileInputRef,
  onFileInputChange,
  job,
  onImported,
  onCloseJob,
}: ImportHostProps) {
  return (
    <>
      <ImportPickerDialog
        open={pickerOpen}
        onOpenChange={onPickerOpenChange}
        onSelect={onSelectProvider}
      />
      {/* One input for every file-based source; `accept` is set per provider
          immediately before it is clicked. */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={onFileInputChange}
      />
      {job !== null && (
        <ImportDialog job={job} onImported={onImported} onClose={onCloseJob} />
      )}
    </>
  );
});
