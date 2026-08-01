export { cn } from '@myelin/ui';

export function getDevicePixelRatio(): number {
  return window.devicePixelRatio || 1;
}

export { removeStyleIfPresent, setStyleIfChanged } from './style-cache';
