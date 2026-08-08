import type { Disposable, PluginResourceScope } from '@noir-player/plugin-api';

export class ResourceScope implements PluginResourceScope {
  private readonly disposables: Disposable[] = [];
  private disposed = false;

  add<T extends Disposable>(disposable: T): T {
    if (this.disposed) {
      disposable();
      return disposable;
    }

    this.disposables.push(disposable);
    return disposable;
  }

  addAbortController(controller: AbortController): AbortSignal {
    this.add(() => controller.abort());
    return controller.signal;
  }

  addTimer(timer: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> {
    this.add(() => clearTimeout(timer));
    return timer;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    for (let index = this.disposables.length - 1; index >= 0; index -= 1) {
      try {
        this.disposables[index]();
      } catch {
        // Cleanup is best effort; the runtime records lifecycle failures around
        // plugin callbacks while resource cleanup must keep going.
      }
    }
    this.disposables.length = 0;
  }

  get size(): number {
    return this.disposables.length;
  }
}
