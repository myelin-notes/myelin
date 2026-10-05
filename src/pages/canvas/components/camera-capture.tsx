import { useEffect, useRef, useState } from 'react';
import {
  Camera as CameraIcon,
  Loader2 as LoaderIcon,
  X as XIcon,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { useMessages } from '@myelin/editor/i18n';
import { captureVideoFrame } from '../photo-capture';

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  onClose: () => void;
}

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const strings = useMessages().canvas.camera;
  const videoRef = useRef<HTMLVideoElement>(null);
  const closedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stream: MediaStream | null = null;
    const openCamera = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(strings.unavailable);
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } },
        });
        if (disposed || !videoRef.current) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (!disposed) {
          setReady(true);
        }
      } catch (cause) {
        if (!disposed) {
          for (const track of stream?.getTracks() ?? []) {
            track.stop();
          }
          if (videoRef.current) {
            videoRef.current.srcObject = null;
          }
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    };
    void openCamera();
    return () => {
      disposed = true;
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [strings.unavailable]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closedRef.current = true;
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video || capturing) {
      return;
    }
    setCapturing(true);
    setError(null);
    try {
      const photo = await captureVideoFrame(video);
      if (!closedRef.current) {
        onCapture(photo);
      }
    } catch (cause) {
      if (!closedRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setCapturing(false);
      }
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={strings.takePhoto}
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-popover shadow-ambient"
      >
        <div className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 font-medium text-text-primary">
            <CameraIcon className="size-4" />
            {strings.takePhoto}
          </span>
          <button
            type="button"
            autoFocus
            aria-label={strings.cancel}
            onClick={() => {
              closedRef.current = true;
              onClose();
            }}
            className="rounded-lg p-1.5 text-text-secondary hover:bg-hover-tint"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="relative flex min-h-56 items-center justify-center bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="max-h-[65vh] w-full object-contain"
          />
          {!ready && !error && (
            <span className="absolute flex items-center gap-2 text-sm text-white">
              <LoaderIcon className="size-4 animate-spin" />
              {strings.requesting}
            </span>
          )}
          {!ready && error && (
            <span className="absolute px-4 text-center text-sm text-white">
              {strings.unavailable}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span
            role="alert"
            className="min-w-0 truncate text-text-muted text-xs"
          >
            {error}
          </span>
          <button
            type="button"
            disabled={!ready || capturing}
            onClick={() => void takePhoto()}
            className="shrink-0 rounded-lg bg-text-primary px-4 py-2 font-medium text-page text-sm disabled:opacity-50"
          >
            {strings.takePhoto}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
