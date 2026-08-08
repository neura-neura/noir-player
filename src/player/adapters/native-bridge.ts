import { convertFileSrc, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type NativeUnsubscribe = () => void | Promise<void>;
export type NativeDragDropEvent =
  | { readonly type: 'enter'; readonly paths: readonly string[]; readonly position: { readonly x: number; readonly y: number } }
  | { readonly type: 'over'; readonly position: { readonly x: number; readonly y: number } }
  | { readonly type: 'drop'; readonly paths: readonly string[]; readonly position: { readonly x: number; readonly y: number } }
  | { readonly type: 'leave' };

export interface NativeBridge {
  readonly isDesktop: boolean;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, callback: EventCallback<T>): Promise<UnlistenFn>;
  convertFileSrc(path: string): string;
  showWindow(): Promise<void>;
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  onDragDrop(callback: EventCallback<NativeDragDropEvent>): Promise<NativeUnsubscribe>;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function createTauriNativeBridge(): NativeBridge {
  const desktop = isTauri();
  return {
    isDesktop: desktop,
    invoke<T>(command: string, args?: Record<string, unknown>) {
      if (!desktop) return Promise.reject(new Error(`Tauri command ${command} is unavailable in browser preview.`));
      return tauriInvoke<T>(command, args);
    },
    listen<T>(event: string, callback: EventCallback<T>) {
      if (!desktop) return Promise.reject(new Error(`Tauri event ${event} is unavailable in browser preview.`));
      return tauriListen<T>(event, callback);
    },
    convertFileSrc(path) {
      return desktop ? convertFileSrc(path) : path;
    },
    async showWindow() {
      if (desktop) await getCurrentWindow().show();
    },
    async isFullscreen() {
      return desktop ? getCurrentWindow().isFullscreen() : Boolean(document.fullscreenElement);
    },
    async setFullscreen(fullscreen) {
      if (desktop) {
        await getCurrentWindow().setFullscreen(fullscreen);
        return;
      }
      if (fullscreen) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
    },
    async onDragDrop(callback) {
      if (!desktop) return () => undefined;
      const webview = getCurrentWebview();
      return webview.onDragDropEvent(callback as unknown as Parameters<typeof webview.onDragDropEvent>[0]);
    },
  };
}
