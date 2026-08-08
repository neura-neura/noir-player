import { defineNoirPlugins, type PluginSelection } from '@noir-player/plugin-api';

/**
 * Auditable build-time selection. The import is intentionally literal so Vite
 * creates a lazy chunk and the runtime never evaluates an unselected plugin.
 */
const selectedPlugins: readonly PluginSelection[] = import.meta.env.VITE_NOIR_DISABLE_PLUGINS === '1'
  ? []
  : [
    {
      id: 'noir.playback-stats',
      loader: () => import('@noir-player/plugin-playback-stats'),
      enabled: true,
      grants: [
        'player.read',
        'player.control',
        'ui.contribute',
        'commands.contribute',
        'storage',
        'telemetry',
      ],
      trust: 'first-party',
      config: {
        sampleIntervalMs: 1_000,
        showByDefault: true,
      },
    },
  ];

export default defineNoirPlugins(selectedPlugins);
