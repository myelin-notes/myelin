import { useCallback, useEffect, useState } from 'react';
import { Download, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { isPro, promptUpgrade } from '@myelin/editor/plan';
import { UserPrefs } from '@myelin/editor/user-prefs';
import { cn } from '@myelin/editor/utils';
import { Logger } from '@myelin/shared/logger';
import { Button } from '@myelin/ui/button';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { trackEvent } from '@/lib/analytics';
import { useUserPref } from '@/lib/use-user-pref';

const logger = new Logger('TranscriptionModels');

interface TranscriptionModelInfo {
  id: string;
  bytes: number;
  /** False only for the bundled model. */
  downloadable: boolean;
  downloaded: boolean;
  downloading: boolean;
}

interface DownloadProgressPayload {
  id: string;
  receivedBytes: number;
}

export function TranscriptionSection() {
  const strings = useMessages();
  const sectionStrings = strings.settings.transcription;
  const selectedModel = useUserPref('transcriptionModel');
  const pro = useUserPref('plan') === 'pro';
  const [models, setModels] = useState<TranscriptionModelInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});

  const refresh = useCallback(async () => {
    setModels(
      await invoke<TranscriptionModelInfo[]>('list_transcription_models'),
    );
  }, []);

  useEffect(() => {
    void refresh();
    const unlisteners = [
      listen<DownloadProgressPayload>(
        'transcription-model-download-progress',
        ({ payload }) => {
          setProgress((current) => ({
            ...current,
            [payload.id]: payload.receivedBytes,
          }));
        },
      ),
      listen<string>('transcription-model-download-finished', ({ payload }) => {
        setProgress(({ [payload]: _, ...rest }) => rest);
        void refresh();
      }),
    ];
    return () => {
      for (const unlisten of unlisteners) {
        void unlisten.then((fn) => fn());
      }
    };
  }, [refresh]);

  const handleDownload = async (id: string) => {
    if (!isPro()) {
      promptUpgrade('transcription');
      return;
    }
    setModels((current) =>
      current.map((m) => (m.id === id ? { ...m, downloading: true } : m)),
    );
    trackEvent('transcription_model_download_started', { model: id });
    try {
      const installed = await invoke<boolean>('download_transcription_model', {
        id,
      });
      trackEvent('transcription_model_download_finished', {
        model: id,
        outcome: installed ? 'completed' : 'cancelled',
      });
    } catch (error) {
      trackEvent('transcription_model_download_finished', {
        model: id,
        outcome: 'failed',
      });
      logger.error('Transcription model download failed', error, { id });
      toast.error(sectionStrings.downloadFailed, {
        description: String(error),
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (selectedModel === id) {
      UserPrefs.remove('transcriptionModel');
    }
    try {
      await invoke('delete_transcription_model', { id });
      trackEvent('transcription_model_deleted', { model: id });
    } catch (error) {
      logger.error('Transcription model delete failed', error, { id });
    }
    await refresh();
  };

  // Without Pro, or once the selected model is off disk, transcription uses the bundled one; show that.
  const activeModel =
    (pro && models.find((m) => m.id === selectedModel && m.downloaded)?.id) ||
    'base';

  return (
    <section id="transcription" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">{sectionStrings.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {sectionStrings.eyebrow}
        </span>
      </div>
      <div className="overflow-hidden rounded-xl bg-input/40 ring-1 ring-border-subtle/70">
        <div className="px-4 py-3">
          <span className="block font-medium text-sm text-text-primary">
            {sectionStrings.label}
          </span>
          <span className="mt-1 block text-text-muted text-xs leading-relaxed">
            {sectionStrings.description}
          </span>
        </div>
        <div
          role="radiogroup"
          aria-label={sectionStrings.label}
          className="divide-y divide-border-subtle/70 border-border-subtle/70 border-t"
        >
          {models.map((model) => {
            const modelStrings =
              sectionStrings.models[
                model.id as keyof typeof sectionStrings.models
              ];
            if (!modelStrings) {
              return null;
            }
            const active = model.id === activeModel;
            const percent = Math.floor(
              ((progress[model.id] ?? 0) / model.bytes) * 100,
            );
            return (
              <div
                key={model.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 transition-colors',
                  model.downloaded && 'hover:bg-input',
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={!model.downloaded}
                  onClick={() => {
                    if (model.downloadable && !pro) {
                      promptUpgrade('transcription');
                      return;
                    }
                    UserPrefs.set('transcriptionModel', model.id);
                    trackEvent('transcription_model_selected', {
                      model: model.id,
                    });
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-default"
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full ring-1',
                      active ? 'ring-primary' : 'ring-text-muted/50',
                      !model.downloaded && 'opacity-40',
                    )}
                  >
                    {active && (
                      <span className="size-2 rounded-full bg-primary" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="font-medium text-sm text-text-primary">
                        {modelStrings.label}
                      </span>
                      <span className="text-text-muted text-xs tabular-nums">
                        {model.downloadable
                          ? sectionStrings.size(Math.round(model.bytes / 1e6))
                          : sectionStrings.included}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-text-muted text-xs leading-relaxed">
                      {modelStrings.description}
                    </span>
                  </span>
                </button>
                {model.downloading ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="h-1 w-20 overflow-hidden rounded-full bg-text-muted/20">
                      <span
                        className="block h-full bg-primary transition-[width]"
                        style={{ width: `${percent}%` }}
                      />
                    </span>
                    <span className="w-8 text-right text-text-muted text-xs tabular-nums">
                      {percent}%
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={strings.common.cancel}
                      onClick={() =>
                        void invoke('cancel_transcription_model_download', {
                          id: model.id,
                        })
                      }
                    >
                      <X />
                    </Button>
                  </span>
                ) : !model.downloaded ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void handleDownload(model.id)}
                  >
                    <Download />
                    {sectionStrings.download}
                  </Button>
                ) : (
                  model.downloadable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-text-muted"
                      aria-label={sectionStrings.delete}
                      onClick={() => void handleDelete(model.id)}
                    >
                      <Trash2 />
                    </Button>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
