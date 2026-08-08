import { definePlugin } from '@noir-player/plugin-api';

export default definePlugin<{ label: string }>({
  manifest: {
    id: 'fixture.external',
    name: 'External fixture',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    description: 'Compiles against public SDK exports only.',
    license: 'MIT',
    requestedCapabilities: ['player.read'],
  },
  defaultConfig: { label: 'fixture' },
  config: {
    parse(value: unknown) {
      if (!value || typeof value !== 'object' || typeof (value as { label?: unknown }).label !== 'string') throw new Error('label required');
      return { label: (value as { label: string }).label };
    },
  },
  setup: () => ({}),
});
