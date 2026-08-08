import type {
  Disposable,
  MpvEvent,
  MpvPluginFacade,
  MpvPropertyEvent,
  MpvPropertyFormat,
  MpvObservedProperty,
  MpvValue,
  NoirEventPayloadMap,
  PlayerFacade,
  PlayerSnapshot,
  PluginEventBus,
  PluginEventEnvelope,
  PluginLogger,
  PluginStorage,
} from '@noir-player/plugin-api';

export const TEST_EMPTY_SNAPSHOT: PlayerSnapshot = {
  revision: 0,
  sessionId: null,
  status: 'empty',
  media: null,
  playback: { paused: true, rate: 1, volume: 1, muted: false, fullscreen: false },
  subtitles: { trackId: null, displayName: null, cueIndex: -1, cueText: null, offsetMs: 0 },
  playlist: { items: [], activeId: null },
  ui: { panelVisible: false, panelTab: null, playbackControlsVisible: true },
};

export class FakePlayer implements PlayerFacade {
  private snapshot: PlayerSnapshot = TEST_EMPTY_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  getSnapshot(): Readonly<PlayerSnapshot> { return this.snapshot; }
  subscribe(listener: () => void): Disposable { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  setSnapshot(snapshot: PlayerSnapshot): void { this.snapshot = snapshot; for (const listener of [...this.listeners]) listener(); }
  listenerCount(): number { return this.listeners.size; }
}

type EventName = keyof NoirEventPayloadMap;
export class FakeEventBus implements PluginEventBus {
  private readonly listeners = new Map<EventName, Set<(event: PluginEventEnvelope) => void>>();
  on<K extends EventName>(event: K, listener: (envelope: PluginEventEnvelope<K>) => void): Disposable {
    const values = this.listeners.get(event) ?? new Set();
    values.add(listener as (event: PluginEventEnvelope) => void);
    this.listeners.set(event, values);
    return () => values.delete(listener as (event: PluginEventEnvelope) => void);
  }
  once<K extends EventName>(event: K, listener: (envelope: PluginEventEnvelope<K>) => void): Disposable {
    let cleanup: Disposable = () => undefined;
    cleanup = this.on(event, (envelope) => { cleanup(); listener(envelope); });
    return cleanup;
  }
  emit<K extends EventName>(event: K, payload: NoirEventPayloadMap[K]): void {
    const envelope = { name: event, payload, timestamp: Date.now(), revision: 0, sessionId: null } as PluginEventEnvelope<K>;
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(envelope);
  }
  listenerCount(): number { return [...this.listeners.values()].reduce((total, values) => total + values.size, 0); }
}

export class FakeStorage implements PluginStorage {
  readonly schemaVersion = 1;
  private readonly values = new Map<string, unknown>();
  get<T> (key: string): T | undefined { return this.values.get(key) as T | undefined; }
  set<T>(key: string, value: T): void { this.values.set(key, value); }
  remove(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
  size(): number { return this.values.size; }
}

export class FakeMpvFacade implements MpvPluginFacade {
  available = true;
  readonly commands: Array<{ name: string; args: readonly MpvValue[] }> = [];
  readonly properties: Array<{ name: string; value: MpvValue }> = [];
  readonly observed: MpvObservedProperty[] = [];
  readonly listened: string[] = [];
  private readonly propertyListeners = new Set<(event: MpvPropertyEvent) => void>();
  private readonly eventListeners = new Set<(event: MpvEvent) => void>();
  isAvailable(): boolean { return this.available; }
  async getProperty<T extends MpvValue = MpvValue>(name: string, _format?: MpvPropertyFormat): Promise<T> {
    return (this.properties.find((property) => property.name === name)?.value ?? null) as T;
  }
  observeProperties(properties: readonly MpvObservedProperty[], listener: (event: MpvPropertyEvent) => void): Disposable {
    this.observed.push(...properties);
    this.propertyListeners.add(listener);
    return () => this.propertyListeners.delete(listener);
  }
  listenEvents(events: readonly string[], listener: (event: MpvEvent) => void): Disposable {
    this.listened.push(...events);
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  async command<T extends MpvValue = MpvValue>(name: string, args: readonly MpvValue[] = []): Promise<T> {
    this.commands.push({ name, args });
    return undefined as unknown as T;
  }
  async setProperty(name: string, value: MpvValue): Promise<void> {
    this.properties.push({ name, value });
  }
  emitProperty(event: MpvPropertyEvent): void { for (const listener of [...this.propertyListeners]) listener(event); }
  emitEvent(event: MpvEvent): void { for (const listener of [...this.eventListeners]) listener(event); }
  listenerCount(): number { return this.propertyListeners.size + this.eventListeners.size; }
}

export class TestLogger implements PluginLogger {
  readonly entries: Array<{ level: string; message: string; fields: unknown }> = [];
  debug(message: string, fields?: Record<string, unknown>): void { this.entries.push({ level: 'debug', message, fields }); }
  info(message: string, fields?: Record<string, unknown>): void { this.entries.push({ level: 'info', message, fields }); }
  warn(message: string, fields?: Record<string, unknown>): void { this.entries.push({ level: 'warn', message, fields }); }
  error(message: string, fields?: Record<string, unknown>): void { this.entries.push({ level: 'error', message, fields }); }
}

export interface TestPluginHost {
  readonly player: FakePlayer;
  readonly events: FakeEventBus;
  readonly storage: FakeStorage;
  readonly mpv: FakeMpvFacade;
  readonly logger: TestLogger;
  readonly signal: AbortSignal;
  dispose(): void;
}

export function createTestPluginHost(): TestPluginHost {
  const controller = new AbortController();
  const host: TestPluginHost = {
    player: new FakePlayer(),
    events: new FakeEventBus(),
    storage: new FakeStorage(),
    mpv: new FakeMpvFacade(),
    logger: new TestLogger(),
    signal: controller.signal,
    dispose() {
      controller.abort();
    },
  };
  return host;
}

export function assertNoListeners(host: TestPluginHost): void {
  if (host.player.listenerCount() !== 0 || host.events.listenerCount() !== 0 || host.mpv.listenerCount() !== 0) {
    throw new Error('Expected test plugin host to have no listeners.');
  }
}
