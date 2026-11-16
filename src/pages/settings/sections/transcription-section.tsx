import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMessages } from '@myelin/editor/i18n';
import { UserPrefs } from '@myelin/editor/user-prefs';
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

  // A selected model that is no longer on disk transcribes with the bundled one; show that.
  const activeModel =
    models.find((m) => m.id === selectedModel && m.downloaded)?.id ?? 'base';

  return (
    <section id="transcription" className="scroll-mt-12">
      <div className="mb-6 flex items-baseline justify-between">
        <h3 className="font-heading text-xl">{sectionStrings.title}</h3>
        <span className="text-[10px] text-text-muted uppercase tracking-widest">
          {sectionStrings.eyebrow}
        </span>
      </div>
      <div className="space-y-2">
        {models.map((model) => {
          const modelStrings =
            sectionStrings.models[
              model.id as keyof typeof sectionStrings.models
            ];
          if (!modelStrings) {
            return null;
          }
          const active = model.id === activeModel;
          const received = progress[model.id] ?? 0;
          return (
            <div
              key={model.id}
              className="flex w-full flex-col gap-3 rounded-xl bg-input/40 px-4 py-3 ring-1 ring-border-subtle/70 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">
                <span className="block font-medium text-sm text-text-primary">
                  {modelStrings.label}
                </span>
                <span className="mt-1 block text-text-muted text-xs leading-relaxed">
                  {model.downloadable
                    ? `${modelStrings.description} · ${sectionStrings.size(Math.round(model.bytes / 1e6))}`
                    : modelStrings.description}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {model.downloading ? (
                  <>
                    <span className="text-text-muted text-xs tabular-nums">
                      {Math.floor((received / model.bytes) * 100)}%
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void invoke('cancel_transcription_model_download', {
                          id: model.id,
                        })
                      }
                    >
                      {strings.common.cancel}
                    </Button>
                  </>
                ) : model.downloaded ? (
                  <>
                    {model.downloadable && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={sectionStrings.delete}
                        onClick={() => void handleDelete(model.id)}
                      >
                        <Trash2 />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant={active ? 'default' : 'outline'}
                      size="sm"
                      aria-pressed={active}
                      onClick={() => {
                        UserPrefs.set('transcriptionModel', model.id);
                        trackEvent('transcription_model_selected', {
                          model: model.id,
                        });
                      }}
                    >
                      {active ? sectionStrings.inUse : sectionStrings.use}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleDownload(model.id)}
                  >
                    {sectionStrings.download}
                  </Button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
