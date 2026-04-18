import { useEffect, useRef, useState } from 'react';
import {
  FileText as FileTextIcon,
  ImagePlus as ImagePlusIcon,
  Link as LinkIcon,
  Loader2 as LoaderIcon,
  X as XIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useStrings } from '@/lib/i18n';

interface EmbedComposerProps {
  onEmbedFiles: (files: File[]) => void;
  onClose: () => void;
}

type UrlState =
  | { kind: 'idle' }
  | { kind: 'loading'; url: string }
  | { kind: 'ready'; url: string; previewSrc: string; mime: string }
  | { kind: 'error'; url: string; message: string };

const URL_PATTERN = /^https?:\/\/\S+/i;

function isSupportedFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type === 'application/pdf';
}

export function EmbedComposer({ onEmbedFiles, onClose }: EmbedComposerProps) {
  const strings = useStrings();
  const [urlInput, setUrlInput] = useState('');
  const [urlState, setUrlState] = useState<UrlState>({ kind: 'idle' });
  const [isDragOver, setIsDragOver] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const embedBlobs = (blobs: File[]) => {
    if (blobs.length === 0) {
      return;
    }
    onEmbedFiles(blobs);
    setPulseKey((k) => k + 1);
    onClose();
  };

  const handleBrowse = () => fileInputRef.current?.click();

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? []).filter(
      isSupportedFile,
    );
    embedBlobs(files);
    e.currentTarget.value = '';
  };

  const handlePanelDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []).filter(
      isSupportedFile,
    );
    embedBlobs(files);
  };

  const fetchUrl = async (url: string) => {
    setUrlState({ kind: 'loading', url });
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') && blob.type !== 'application/pdf') {
        throw new Error(strings.canvas.embedComposer.errors.unsupportedUrl);
      }
      const previewSrc = URL.createObjectURL(blob);
      setUrlState({ kind: 'ready', url, previewSrc, mime: blob.type });
    } catch (err) {
      const message =
        err instanceof Error && err.message.includes('HTTP')
          ? strings.canvas.embedComposer.errors.fetchFailed
          : err instanceof Error
            ? err.message
            : strings.canvas.embedComposer.errors.fetchFailed;
      setUrlState({ kind: 'error', url, message });
    }
  };

  const handleUrlSubmit = () => {
    const url = urlInput.trim();
    if (!URL_PATTERN.test(url)) {
      return;
    }
    void fetchUrl(url);
  };

  const handleUrlEmbed = async () => {
    if (urlState.kind !== 'ready') {
      return;
    }
    try {
      const res = await fetch(urlState.url, { mode: 'cors' });
      const blob = await res.blob();
      const isPdf = blob.type === 'application/pdf';
      const ext = isPdf ? 'pdf' : blob.type.split('/')[1] || 'png';
      const name = isPdf ? `embed.pdf` : `embed.${ext}`;
      const file = new File([blob], name, { type: blob.type });
      embedBlobs([file]);
      URL.revokeObjectURL(urlState.previewSrc);
      setUrlInput('');
      setUrlState({ kind: 'idle' });
    } catch {
      /* swallow */
    }
  };

  const resetUrl = () => {
    if (urlState.kind === 'ready') {
      URL.revokeObjectURL(urlState.previewSrc);
    }
    setUrlInput('');
    setUrlState({ kind: 'idle' });
  };

  const urlIsValid = URL_PATTERN.test(urlInput.trim());

  const childVariants = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
  };
  const transition = { duration: 0.28, ease: [0.25, 0.1, 0.25, 1] as const };

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, x: -8, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -8, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
      className="ml-2"
      onDragEnter={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          setIsDragOver(true);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!panelRef.current?.contains(e.relatedTarget as Node)) {
          setIsDragOver(false);
        }
      }}
      onDrop={handlePanelDrop}
    >
      <div
        className={`relative w-[296px] overflow-hidden rounded-2xl bg-white/85 shadow-ambient backdrop-blur-[24px] transition-colors duration-200 ${
          isDragOver ? 'ring-2 ring-accent-dark/40' : ''
        }`}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-gradient-to-br from-accent-green/30 via-white/40 to-accent-green/20 backdrop-blur-[2px]">
            <div className="flex flex-col items-center gap-2 text-text-primary">
              <ImagePlusIcon className="size-6" strokeWidth={1.5} />
              <span className="font-heading text-base italic">
                {strings.canvas.embedComposer.dropToEmbed}
              </span>
            </div>
          </div>
        )}

        {/* Header */}
        <motion.div
          variants={childVariants}
          initial="initial"
          animate="animate"
          transition={{ ...transition, delay: 0.02 }}
          className="flex items-start justify-between gap-3 px-4 pt-4 pb-2"
        >
          <div className="flex flex-col">
            <span className="font-heading text-[20px] text-text-primary leading-tight tracking-[-0.01em]">
              {strings.canvas.embedComposer.title}
            </span>
            <span className="mt-0.5 font-medium text-[11px] text-text-muted tracking-[0.02em]">
              {strings.canvas.embedComposer.subtitle}
            </span>
          </div>
          <button
            onClick={onClose}
            className="-mt-1 -mr-1 cursor-pointer rounded-lg border-none bg-transparent p-1.5 text-text-muted transition-colors hover:bg-hover-tint hover:text-text-secondary"
            aria-label={strings.common.close}
          >
            <XIcon className="size-3.5" />
          </button>
        </motion.div>

        {/* URL input */}
        <motion.div
          variants={childVariants}
          initial="initial"
          animate="animate"
          transition={{ ...transition, delay: 0.06 }}
          className="px-4 pb-3"
        >
          <AnimatePresence mode="wait" initial={false}>
            {urlState.kind === 'ready' ? (
              <motion.div
                key="preview"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={transition}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2.5 rounded-xl border border-border-divider bg-card p-2 pr-3">
                  <div className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface">
                    {urlState.mime === 'application/pdf' ? (
                      <FileTextIcon
                        className="size-5 text-text-secondary"
                        strokeWidth={1.5}
                      />
                    ) : (
                      <img
                        src={urlState.previewSrc}
                        alt=""
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-text-primary text-xs">
                      {strings.canvas.embedComposer.readyToEmbed}
                    </span>
                    <span className="truncate text-[10px] text-text-muted">
                      {new URL(urlState.url).hostname}
                    </span>
                  </div>
                  <button
                    onClick={resetUrl}
                    className="cursor-pointer rounded-md border-none bg-transparent p-1 text-text-muted transition-colors hover:bg-hover-tint"
                    aria-label={strings.common.clear}
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
                <button
                  onClick={handleUrlEmbed}
                  className="mt-2 w-full cursor-pointer rounded-xl border-none bg-accent-dark px-3 py-2 font-medium text-[13px] text-white tracking-[0.005em] transition-transform duration-150 hover:scale-[1.01] active:scale-[0.99]"
                >
                  {urlState.mime === 'application/pdf'
                    ? strings.canvas.embedComposer.embedPdf
                    : strings.canvas.embedComposer.embedImage}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="input"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={transition}
              >
                <div className="relative flex items-center">
                  <LinkIcon
                    className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-muted"
                    strokeWidth={1.5}
                  />
                  <input
                    type="url"
                    inputMode="url"
                    spellCheck={false}
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (urlState.kind === 'error') {
                        setUrlState({ kind: 'idle' });
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && urlIsValid) {
                        e.preventDefault();
                        handleUrlSubmit();
                      }
                    }}
                    placeholder={strings.canvas.embedComposer.urlPlaceholder}
                    className="w-full rounded-xl border border-border-divider bg-card py-2 pr-[68px] pl-8 font-normal text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent-dark/50 focus:bg-white"
                  />
                  <button
                    onClick={handleUrlSubmit}
                    disabled={!urlIsValid || urlState.kind === 'loading'}
                    className="absolute top-1/2 right-1.5 flex -translate-y-1/2 cursor-pointer items-center gap-1 rounded-lg border-none bg-transparent px-2 py-1 font-medium text-[11px] text-text-muted uppercase tracking-[0.08em] transition-colors hover:text-text-primary disabled:cursor-default disabled:opacity-40 disabled:hover:text-text-muted"
                  >
                    {urlState.kind === 'loading' ? (
                      <LoaderIcon className="size-3 animate-spin" />
                    ) : (
                      strings.canvas.embedComposer.fetch
                    )}
                  </button>
                </div>
                {urlState.kind === 'error' && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-1.5 px-1 text-[11px] text-destructive"
                  >
                    {urlState.message}
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Separator */}
        <motion.div
          variants={childVariants}
          initial="initial"
          animate="animate"
          transition={{ ...transition, delay: 0.08 }}
          className="flex items-center gap-2.5 px-4 pb-3"
        >
          <div className="h-px flex-1 bg-border-divider" />
          <span className="font-medium text-[10px] text-text-muted uppercase tracking-[0.18em]">
            {strings.common.or}
          </span>
          <div className="h-px flex-1 bg-border-divider" />
        </motion.div>

        {/* Drop zone */}
        <motion.div
          variants={childVariants}
          initial="initial"
          animate="animate"
          transition={{ ...transition, delay: 0.1 }}
          className="px-4 pb-3"
        >
          <button
            onClick={handleBrowse}
            className="group relative flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-border-divider border-dashed bg-surface/40 px-4 py-5 transition-colors duration-150 hover:border-accent-dark/40 hover:bg-surface/70"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(111,251,190,0.12),transparent_70%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            <div className="relative flex size-9 items-center justify-center rounded-full bg-white/80 shadow-[0_1px_3px_rgba(25,28,30,0.05)] transition-transform duration-200 group-hover:scale-110">
              <ImagePlusIcon
                className="size-4 text-text-primary"
                strokeWidth={1.5}
              />
            </div>
            <div className="relative flex flex-col items-center gap-0.5">
              <span className="font-medium text-[12.5px] text-text-primary">
                {strings.canvas.embedComposer.browse}
              </span>
              <span className="text-[10.5px] text-text-muted">
                {strings.canvas.embedComposer.dropFiles}
              </span>
            </div>
          </button>
        </motion.div>

        {/* Footer — shortcut chips */}
        <motion.div
          variants={childVariants}
          initial="initial"
          animate="animate"
          transition={{ ...transition, delay: 0.12 }}
          className="flex items-center justify-between border-border-ghost border-t border-dashed px-4 py-2.5"
        >
          <div className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
            <kbd className="flex min-w-[20px] items-center justify-center rounded-[5px] border border-border-divider bg-white px-1 py-[1px] font-sans font-semibold text-[9.5px] text-text-secondary">
              ⌘V
            </kbd>
            <span>{strings.canvas.embedComposer.pasteFromClipboard}</span>
          </div>
          <AnimatePresence>
            {pulseKey > 0 && (
              <motion.span
                key={pulseKey}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="font-medium text-[10px] text-text-green italic"
              >
                {strings.canvas.embedComposer.embedded}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={handleFileInput}
      />
    </motion.div>
  );
}
