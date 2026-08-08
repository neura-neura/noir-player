import { useEffect, useState } from 'react';
import {
  definePlugin,
  type NoirPluginContext,
  type PluginSlotProps,
  type PlayerSnapshot,
  type UiContribution,
} from '@noir-player/plugin-api';

export interface PlaybackStatsConfig {
  readonly sampleIntervalMs: number;
  readonly showByDefault: boolean;
  readonly throwOnSetup?: boolean;
}

const PLUGIN_ID = 'noir.playback-stats' as const;
const TOGGLE_COMMAND = `${PLUGIN_ID}.toggle` as const;
const INTERVAL_COMMAND = `${PLUGIN_ID}.set-sample-interval` as const;

function parsePlaybackStatsConfig(input: unknown): PlaybackStatsConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('playback-stats config must be an object.');
  }
  const value = input as Record<string, unknown>;
  const sampleIntervalMs = value.sampleIntervalMs;
  if (typeof sampleIntervalMs !== 'number' || !Number.isInteger(sampleIntervalMs) || sampleIntervalMs < 250 || sampleIntervalMs > 10_000) {
    throw new TypeError('playback-stats sampleIntervalMs must be an integer between 250 and 10000.');
  }
  if (typeof value.showByDefault !== 'boolean') {
    throw new TypeError('playback-stats showByDefault must be a boolean.');
  }
  if (value.throwOnSetup !== undefined && typeof value.throwOnSetup !== 'boolean') {
    throw new TypeError('playback-stats throwOnSetup must be a boolean.');
  }
  return Object.freeze({
    sampleIntervalMs,
    showByDefault: value.showByDefault,
    throwOnSetup: value.throwOnSetup === true,
  });
}

interface StatsState {
  visible: boolean;
  sampleIntervalMs: number;
  snapshot: Readonly<PlayerSnapshot>;
  engine: string;
  samples: number;
}

type StateListener = () => void;

class StatsController {
  readonly listeners = new Set<StateListener>();
  state: StatsState;
  private timer: ReturnType<typeof setInterval> | null = null;
  private timerCleanupRegistered = false;

  constructor(config: PlaybackStatsConfig, initialSnapshot: Readonly<PlayerSnapshot>, readonly context: NoirPluginContext) {
    const persistedVisible = context.storage.get<boolean>('visible');
    const persistedInterval = context.storage.get<number>('sampleIntervalMs');
    this.state = {
      visible: persistedVisible ?? config.showByDefault,
      sampleIntervalMs: typeof persistedInterval === 'number' && Number.isInteger(persistedInterval) && persistedInterval >= 250 && persistedInterval <= 10_000
        ? persistedInterval
        : config.sampleIntervalMs,
      snapshot: initialSnapshot,
      engine: initialSnapshot.media?.engine ?? 'none',
      samples: 0,
    };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateSnapshot(snapshot: Readonly<PlayerSnapshot>): void {
    this.state = { ...this.state, snapshot, engine: snapshot.media?.engine ?? 'none' };
    this.notify();
  }

  setVisible(visible: boolean): void {
    this.state = { ...this.state, visible };
    this.context.storage.set('visible', visible);
    this.notify();
  }

  setIntervalMs(sampleIntervalMs: number): void {
    this.state = { ...this.state, sampleIntervalMs };
    this.startTimer();
    this.notify();
  }

  startTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.context.signal.aborted) return;
      this.state = { ...this.state, samples: this.state.samples + 1 };
      this.context.telemetry.record('plugin.performance', { sampleIntervalMs: this.state.sampleIntervalMs });
      this.notify();
    }, this.state.sampleIntervalMs);
    if (!this.timerCleanupRegistered) {
      this.timerCleanupRegistered = true;
      this.context.resources.add(() => {
        if (this.timer !== null) {
          clearInterval(this.timer);
          this.timer = null;
        }
      });
    }
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function useStats(controller: StatsController): StatsState {
  const [, setRevision] = useState(0);
  useEffect(() => controller.subscribe(() => setRevision((revision) => revision + 1)), [controller]);
  return controller.state;
}

function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function StatsChip({ snapshot, controller }: PluginSlotProps & { readonly controller: StatsController }) {
  const state = useStats(controller);
  if (!state.visible) return null;
  return <span className='info-chip plugin-playback-stats-chip' data-plugin='noir.playback-stats'>Engine: {state.engine}</span>;
}

function StatsDock({ snapshot, controller }: PluginSlotProps & { readonly controller: StatsController }) {
  const state = useStats(controller);
  return (
    <span className='plugin-playback-stats-dock'>
      <button
        type='button'
        className='dock-button plugin-playback-stats-toggle'
        aria-pressed={state.visible}
        aria-label={state.visible ? 'Hide playback statistics' : 'Show playback statistics'}
        onClick={() => void controller.context.commands.executePlugin(TOGGLE_COMMAND)}
      >
        {state.visible ? 'Stats on' : 'Stats'}
      </button>
      <button
        type='button'
        className='dock-button plugin-playback-stats-playback'
        aria-label={snapshot.playback.paused ? 'Play media' : 'Pause media'}
        onClick={() => void controller.context.commands.execute('media.toggle', undefined)}
      >
        {snapshot.playback.paused ? 'Play' : 'Pause'}
      </button>
    </span>
  );
}

function StatsOverlay({ snapshot, controller }: PluginSlotProps & { readonly controller: StatsController }) {
  const state = useStats(controller);
  if (!state.visible || !snapshot.media) return null;
  return (
    <div className='plugin-playback-stats-overlay' role='status' aria-live='polite'>
      <strong>Playback stats</strong>
      <span>{snapshot.status} · {formatSeconds(snapshot.playback.paused ? snapshot.media.currentTime : snapshot.media.currentTime)} / {formatSeconds(snapshot.media.duration ?? 0)}</span>
      <span>{snapshot.playback.rate.toFixed(2)}× · {state.engine}</span>
    </div>
  );
}

function StatsSettings({ snapshot: _snapshot, controller }: PluginSlotProps & { readonly controller: StatsController }) {
  const state = useStats(controller);
  const [value, setValue] = useState(String(state.sampleIntervalMs));
  return (
    <section className='plugin-settings-section' aria-labelledby='playback-stats-settings-title'>
      <h3 id='playback-stats-settings-title'>Playback statistics</h3>
      <label>
        Sample interval (ms)
        <input
          type='number'
          min={250}
          max={10_000}
          step={250}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void controller.context.commands.executePlugin(INTERVAL_COMMAND, { sampleIntervalMs: Number(value) })}
        />
      </label>
    </section>
  );
}

export default definePlugin<PlaybackStatsConfig, { readonly getState: () => Readonly<StatsState> }>({
  manifest: {
    id: PLUGIN_ID,
    name: 'Playback statistics',
    version: '1.0.0',
    apiVersion: '^1.0.0',
    appVersion: '>=0.1.0 <1.0.0',
    description: 'A portable, first-party playback statistics panel.',
    license: 'MIT',
    authors: ['Noir Player'],
    platforms: ['windows', 'browser-preview'],
    requestedCapabilities: [
      'player.read',
      'player.control',
      'ui.contribute',
      'commands.contribute',
      'storage',
      'telemetry',
    ],
  },
  defaultConfig: {
    sampleIntervalMs: 1_000,
    showByDefault: true,
    throwOnSetup: false,
  },
  config: { parse: parsePlaybackStatsConfig },
  setup(context, config) {
    if (config.throwOnSetup) throw new Error('Intentional playback-stats setup failure for tests.');
    const controller = new StatsController(config, context.player.getSnapshot(), context);
    context.i18n.register('en', {
      'noir.playback-stats.name': 'Playback statistics',
      'noir.playback-stats.interval': 'Sample interval',
    });
    context.resources.add(context.events.on('media:time-update', (event) => controller.updateSnapshot(context.player.getSnapshot())));
    context.resources.add(context.events.on('media:play', () => controller.updateSnapshot(context.player.getSnapshot())));
    context.resources.add(context.events.on('media:pause', () => controller.updateSnapshot(context.player.getSnapshot())));
    context.resources.add(context.events.on('media:engine-changed', () => controller.updateSnapshot(context.player.getSnapshot())));
    context.resources.add(context.player.subscribe(() => controller.updateSnapshot(context.player.getSnapshot())));
    context.resources.add(context.commands.register(TOGGLE_COMMAND, () => {
      controller.setVisible(!controller.state.visible);
      context.logger.info('Playback statistics visibility changed', { visible: controller.state.visible });
      return { visible: controller.state.visible };
    }));
    context.resources.add(context.commands.register(INTERVAL_COMMAND, (input) => {
      const parsed = parsePlaybackStatsConfig({
        sampleIntervalMs: (input as { sampleIntervalMs?: unknown })?.sampleIntervalMs,
        showByDefault: true,
      });
      controller.setIntervalMs(parsed.sampleIntervalMs);
      context.storage.set('sampleIntervalMs', parsed.sampleIntervalMs);
      return { sampleIntervalMs: parsed.sampleIntervalMs };
    }));
    context.resources.add(context.ui.contribute({
      id: `${PLUGIN_ID}/stage-info`,
      slot: 'stage.info',
      order: 50,
      component: (props) => <StatsChip {...props} controller={controller} />,
      ariaLabel: 'Playback engine',
    } as UiContribution));
    context.resources.add(context.ui.contribute({
      id: `${PLUGIN_ID}/dock-toggle`,
      slot: 'player.dock',
      order: 50,
      component: (props) => <StatsDock {...props} controller={controller} />,
      ariaLabel: 'Playback statistics',
    } as UiContribution));
    context.resources.add(context.ui.contribute({
      id: `${PLUGIN_ID}/overlay`,
      slot: 'player.overlay',
      order: 50,
      component: (props) => <StatsOverlay {...props} controller={controller} />,
    } as UiContribution));
    context.resources.add(context.ui.contribute({
      id: `${PLUGIN_ID}/settings`,
      slot: 'settings.sections',
      order: 50,
      component: (props) => <StatsSettings {...props} controller={controller} />,
    } as UiContribution));
    context.logger.info('Playback statistics setup complete');
    return {
      api: { getState: () => Object.freeze({ ...controller.state }) },
      start() {
        controller.startTimer();
      },
      onConfigChange(next) {
        controller.setIntervalMs(next.sampleIntervalMs);
      },
      stop() {
        controller.dispose();
      },
      dispose() {
        controller.dispose();
      },
    };
  },
});

export { parsePlaybackStatsConfig };
