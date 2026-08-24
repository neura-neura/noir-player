import { check as tauriCheck, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch as tauriRelaunch } from '@tauri-apps/plugin-process';

/** The lifecycle reported while checking, downloading and installing an update. */
export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'relaunching'
  | 'up-to-date'
  | 'error';

/** A serialisable description of a release returned by the updater plugin. */
export interface UpdaterUpdateInfo {
  version: string;
  currentVersion: string | null;
  notes: string | null;
  date: string | null;
}

/** State safe to keep in React state and announce through an aria-live region. */
export interface UpdaterState {
  phase: UpdaterPhase;
  version: string | null;
  currentVersion: string | null;
  notes: string | null;
  date: string | null;
  progress: number | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
}

/** The small subset of a Tauri Update resource used by this module. */
export interface UpdaterResource {
  version: string;
  currentVersion?: string;
  body?: string;
  date?: string;
  downloadAndInstall(
    onEvent?: (event: DownloadEvent) => void,
  ): Promise<void>;
  close?(): Promise<void>;
}

/** Injectable dependencies keep the state machine deterministic in frontend tests. */
export interface UpdaterDependencies {
  check: () => Promise<UpdaterResource | null>;
  relaunch: () => Promise<void>;
  isWindows?: () => boolean;
}

export type UpdaterListener = (state: UpdaterState) => void;

export interface UpdaterController {
  getState(): UpdaterState;
  subscribe(listener: UpdaterListener): () => void;
  check(): Promise<UpdaterUpdateInfo | null>;
  update(): Promise<void>;
  dispose(): void;
}

const initialState: UpdaterState = {
  phase: 'idle',
  version: null,
  currentVersion: null,
  notes: null,
  date: null,
  progress: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
};

const defaultDependencies: UpdaterDependencies = {
  check: tauriCheck,
  relaunch: tauriRelaunch,
};

function isWindowsDesktop(): boolean {
  return typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
}

function toUpdateInfo(update: UpdaterResource): UpdaterUpdateInfo {
  return {
    version: update.version,
    currentVersion: update.currentVersion ?? null,
    notes: update.body ?? null,
    date: update.date ?? null,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'No se pudo buscar o instalar la actualización.';
}

/**
 * Creates an updater state machine. The default instance talks to the Tauri
 * updater/process plugins; tests can provide the small dependency interface.
 */
export function createUpdaterController(
  dependencies: UpdaterDependencies = defaultDependencies,
): UpdaterController {
  let state: UpdaterState = { ...initialState };
  let updateResource: UpdaterResource | null = null;
  let operation: Promise<unknown> | null = null;
  let disposed = false;
  const listeners = new Set<UpdaterListener>();

  const emit = () => {
    if (disposed) {
      return;
    }

    const snapshot = { ...state };
    listeners.forEach((listener) => listener(snapshot));
  };

  const setState = (patch: Partial<UpdaterState>) => {
    if (disposed) {
      return;
    }

    state = { ...state, ...patch };
    emit();
  };

  const closeResource = async () => {
    const resource = updateResource;
    updateResource = null;
    if (resource?.close) {
      await resource.close();
    }
  };

  const check = async (): Promise<UpdaterUpdateInfo | null> => {
    try {
      await closeResource();
      setState({
        phase: 'checking',
        version: null,
        currentVersion: null,
        notes: null,
        date: null,
        progress: null,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      });

      const resource = await dependencies.check();
      if (!resource) {
        setState({ phase: 'up-to-date' });
        return null;
      }

      updateResource = resource;
      const info = toUpdateInfo(resource);
      setState({
        phase: 'available',
        version: info.version,
        currentVersion: info.currentVersion,
        notes: info.notes,
        date: info.date,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      });
      return info;
    } catch (error) {
      setState({ phase: 'error', error: errorMessage(error), progress: null });
      throw error;
    }
  };

  const runCheck = (): Promise<UpdaterUpdateInfo | null> => {
    if (operation) {
      return operation as Promise<UpdaterUpdateInfo | null>;
    }

    const currentOperation = Promise.resolve().then(check);
    operation = currentOperation;
    void currentOperation.then(() => undefined, () => undefined).finally(() => {
      if (operation === currentOperation) {
        operation = null;
      }
    });
    return currentOperation;
  };

  const update = async (): Promise<void> => {
    let resource = updateResource;
    if (!resource) {
      await check();
      resource = updateResource;
    }

    if (!resource) {
      return;
    }

    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    setState({
      phase: 'downloading',
      progress: 0,
      downloadedBytes,
      totalBytes,
      error: null,
    });

    try {
      await resource.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes =
            typeof event.data.contentLength === 'number' && event.data.contentLength > 0
              ? event.data.contentLength
              : null;
          setState({ totalBytes, progress: totalBytes === null ? null : 0 });
          return;
        }

        if (event.event === 'Progress') {
          downloadedBytes += Math.max(0, event.data.chunkLength);
          const progress = totalBytes
            ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            : null;
          setState({ downloadedBytes, totalBytes, progress });
          return;
        }

        // Finished means the download is complete and the native installer is
        // about to run. Windows exits the app from the installer itself.
        setState({
          phase: 'installing',
          progress: 100,
          downloadedBytes,
          totalBytes,
        });
      });

      if (dependencies.isWindows?.() ?? isWindowsDesktop()) {
        setState({ phase: 'installing', progress: 100 });
        return;
      }

      setState({ phase: 'relaunching', progress: 100 });
      await dependencies.relaunch();
    } catch (error) {
      setState({ phase: 'error', error: errorMessage(error), progress: null });
      throw error;
    }
  };

  const runUpdate = (): Promise<void> => {
    if (operation) {
      return operation as Promise<void>;
    }

    const currentOperation = Promise.resolve().then(update);
    operation = currentOperation;
    void currentOperation.then(() => undefined, () => undefined).finally(() => {
      if (operation === currentOperation) {
        operation = null;
      }
    });
    return currentOperation;
  };

  return {
    getState: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener);
      listener({ ...state });
      return () => listeners.delete(listener);
    },
    check: runCheck,
    update: runUpdate,
    dispose() {
      disposed = true;
      listeners.clear();
      const resource = updateResource;
      updateResource = null;
      if (resource?.close) {
        void resource.close();
      }
    },
  };
}

/** Shared controller for simple consumers; complex screens can create one per mount. */
export const updater = createUpdaterController();

export const checkForUpdate = (): Promise<UpdaterUpdateInfo | null> => updater.check();
export const installUpdate = (): Promise<void> => updater.update();
export const getUpdaterState = (): UpdaterState => updater.getState();
export const subscribeToUpdater = (listener: UpdaterListener): (() => void) =>
  updater.subscribe(listener);
