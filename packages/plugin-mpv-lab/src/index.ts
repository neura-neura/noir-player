import {
  definePlugin,
  type MpvEvent,
  type MpvPropertyEvent,
} from '@noir-player/plugin-api';

export interface MpvLabConfig {
  readonly property: string;
  readonly command: string;
}

function parseConfig(input: unknown): MpvLabConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('mpv-lab config must be an object.');
  const value = input as Record<string, unknown>;
  if (typeof value.property !== 'string' || value.property.trim() === '') throw new TypeError('mpv-lab property is required.');
  if (typeof value.command !== 'string' || value.command.trim() === '') throw new TypeError('mpv-lab command is required.');
  return Object.freeze({ property: value.property, command: value.command });
}

export default definePlugin<MpvLabConfig, {
  readProperty(): Promise<unknown>;
  observe(): void;
  listen(): void;
  runRawCommand(): Promise<unknown>;
  setRawProperty(value: boolean): Promise<void>;
  getEvents(): readonly MpvEvent[];
  getProperties(): readonly MpvPropertyEvent[];
}>({
  manifest: {
    id: 'fixture.mpv-lab',
    name: 'mpv lab fixture',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    description: 'Validation fixture for capability-gated mpv operations.',
    license: 'MIT',
    requestedCapabilities: ['native.mpv.read', 'native.mpv.raw'],
  },
  defaultConfig: { property: 'pause', command: 'get-version' },
  config: { parse: parseConfig },
  setup(context, config) {
    const events: MpvEvent[] = [];
    const properties: MpvPropertyEvent[] = [];
    const cleanups: Array<() => void> = [];
    return {
      api: {
        readProperty: () => context.mpv.getProperty(config.property, 'node'),
        observe: () => {
          const cleanup = context.mpv.observeProperties([{ name: config.property, format: 'node' }], (event) => properties.push(event));
          cleanups.push(cleanup);
        },
        listen: () => {
          const cleanup = context.mpv.listenEvents(['file-loaded', 'end-file'], (event) => events.push(event));
          cleanups.push(cleanup);
        },
        runRawCommand: () => context.mpv.command(config.command),
        setRawProperty: (value) => context.mpv.setProperty(config.property, value),
        getEvents: () => [...events],
        getProperties: () => [...properties],
      },
      dispose() {
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      },
    };
  },
});

export { parseConfig as parseMpvLabConfig };
