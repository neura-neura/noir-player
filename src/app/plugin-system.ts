import selections from '../../noir.plugins.config';
import { createTauriMpvBackend } from '@/player/engines/libmpv-playback-engine';
import { createPluginRuntime } from '@/plugins/runtime';
import { applyPluginCatalogToSelections } from '@/plugins/catalog';

/** One host-owned runtime is created for the React tree; plugins never create it. */
export function createNoirPluginRuntime() {
  return createPluginRuntime({
    selections: applyPluginCatalogToSelections(selections),
    appVersion: '0.1.13',
    mpvBackend: createTauriMpvBackend(),
    development: import.meta.env.DEV,
  });
}
