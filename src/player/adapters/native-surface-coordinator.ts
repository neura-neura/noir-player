import { command, setVideoMarginRatio } from 'tauri-plugin-libmpv-api';
import type { NativeBridge } from './native-bridge';

export type NativeSurfacePhase = 'hidden' | 'loading' | 'ready' | 'covering' | 'fading';
export interface SurfaceMargins { left: number; right: number; top: number; bottom: number }

export interface NativeSurfaceCoordinatorOptions {
  readonly bridge: NativeBridge;
  readonly isMpvAvailable: () => boolean;
  readonly logger?: (message: string, fields?: Record<string, string | number | boolean>) => void;
}

/** Host-owned coordination for the child libmpv surface. Never exposed to plugins. */
export class NativeSurfaceCoordinator {
  private margins: SurfaceMargins = { left: 0, right: 0, top: 0, bottom: 0 };
  private phase: NativeSurfacePhase = 'hidden';
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: NativeSurfaceCoordinatorOptions) {}

  getPhase(): NativeSurfacePhase { return this.phase; }
  getMargins(): SurfaceMargins { return { ...this.margins }; }

  setPhase(phase: NativeSurfacePhase): void {
    if (this.disposed) return;
    this.phase = phase;
  }

  setMargins(next: Partial<SurfaceMargins>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.margins = {
      left: clamp(next.left ?? this.margins.left),
      right: clamp(next.right ?? this.margins.right),
      top: clamp(next.top ?? this.margins.top),
      bottom: clamp(next.bottom ?? this.margins.bottom),
    };
    const operation = this.queue.catch(() => undefined).then(() => this.applyMargins());
    this.queue = operation.catch((error) => {
      this.options.logger?.('Unable to update native video margins.', { recoverable: true });
      return undefined;
    });
    return operation;
  }

  async redraw(): Promise<void> {
    if (this.disposed || !this.options.isMpvAvailable()) return;
    try {
      await command('redraw-frame');
    } catch {
      // Older mpv builds do not expose redraw-frame; margin updates remain valid.
    }
  }

  async resize(next: Partial<SurfaceMargins>): Promise<void> {
    await this.setMargins(next);
    await this.redraw();
  }

  async beginFullscreenTransition(): Promise<void> {
    this.setPhase('covering');
    await this.redraw();
  }

  async finishFullscreenTransition(): Promise<void> {
    this.setPhase('fading');
    await this.redraw();
    this.setPhase('ready');
  }

  async reset(): Promise<void> {
    await this.setMargins({ left: 0, right: 0, top: 0, bottom: 0 });
    this.setPhase('hidden');
  }

  dispose(): void {
    this.disposed = true;
    this.phase = 'hidden';
    this.margins = { left: 0, right: 0, top: 0, bottom: 0 };
  }

  private async applyMargins(): Promise<void> {
    if (this.disposed || !this.options.isMpvAvailable()) return;
    await setVideoMarginRatio(this.margins);
  }
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
