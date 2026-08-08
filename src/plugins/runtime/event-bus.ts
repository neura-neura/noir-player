import type {
  CoreEventName,
  Disposable,
  NoirEventPayloadMap,
  PluginEventBus,
  PluginEventEnvelope,
  PluginEventMeta,
} from '@noir-player/plugin-api';

type Listener<K extends CoreEventName> = (envelope: PluginEventEnvelope<K>) => void;

export interface HostEventBus extends PluginEventBus {
  emit<K extends CoreEventName>(
    event: K,
    payload: NoirEventPayloadMap[K],
    meta?: Partial<PluginEventMeta>,
  ): void;
  flush(): void;
  listenerCount(event?: CoreEventName): number;
  dispose(): void;
}

const COALESCED_TIME_EVENT: CoreEventName = 'media:time-update';

export class TypedEventBus implements HostEventBus {
  private readonly listeners = new Map<CoreEventName, Set<Listener<CoreEventName>>>();
  private readonly onceListeners = new Map<CoreEventName, Set<Listener<CoreEventName>>>();
  private readonly anyListeners = new Set<(envelope: PluginEventEnvelope) => void>();
  private pendingTimeUpdate: PluginEventEnvelope<'media:time-update'> | null = null;
  private timeUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly timeUpdateIntervalMs = 250) {}

  on<K extends CoreEventName>(event: K, listener: Listener<K>): Disposable {
    const listeners = this.listeners.get(event) ?? new Set<Listener<CoreEventName>>();
    listeners.add(listener as Listener<CoreEventName>);
    this.listeners.set(event, listeners);
    return () => {
      listeners.delete(listener as Listener<CoreEventName>);
      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  once<K extends CoreEventName>(event: K, listener: Listener<K>): Disposable {
    const listeners = this.onceListeners.get(event) ?? new Set<Listener<CoreEventName>>();
    listeners.add(listener as Listener<CoreEventName>);
    this.onceListeners.set(event, listeners);
    return () => {
      listeners.delete(listener as Listener<CoreEventName>);
      if (listeners.size === 0) {
        this.onceListeners.delete(event);
      }
    };
  }

  onAny(listener: (envelope: PluginEventEnvelope) => void): Disposable {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  emit<K extends CoreEventName>(
    event: K,
    payload: NoirEventPayloadMap[K],
    meta: Partial<PluginEventMeta> = {},
  ): void {
    const envelope = Object.freeze({
      name: event,
      payload: Object.freeze(payload),
      timestamp: meta.timestamp ?? Date.now(),
      revision: meta.revision ?? 0,
      sessionId: meta.sessionId ?? null,
      correlationId: meta.correlationId,
    }) as PluginEventEnvelope<K>;

    if (event === COALESCED_TIME_EVENT) {
      this.pendingTimeUpdate = envelope as PluginEventEnvelope<'media:time-update'>;
      if (this.timeUpdateTimer === null) {
        this.timeUpdateTimer = setTimeout(() => {
          this.timeUpdateTimer = null;
          this.flush();
        }, this.timeUpdateIntervalMs);
      }
      return;
    }

    this.dispatch(envelope);
  }

  flush(): void {
    if (this.pendingTimeUpdate) {
      const pending = this.pendingTimeUpdate;
      this.pendingTimeUpdate = null;
      this.dispatch(pending);
    }
  }

  listenerCount(event?: CoreEventName): number {
    if (event) {
      return (this.listeners.get(event)?.size ?? 0) + (this.onceListeners.get(event)?.size ?? 0);
    }
    let count = this.anyListeners.size;
    for (const listeners of this.listeners.values()) count += listeners.size;
    for (const listeners of this.onceListeners.values()) count += listeners.size;
    return count;
  }

  dispose(): void {
    if (this.timeUpdateTimer !== null) {
      clearTimeout(this.timeUpdateTimer);
      this.timeUpdateTimer = null;
    }
    this.pendingTimeUpdate = null;
    this.listeners.clear();
    this.onceListeners.clear();
    this.anyListeners.clear();
  }

  private dispatch<K extends CoreEventName>(envelope: PluginEventEnvelope<K>): void {
    const listeners = [...(this.listeners.get(envelope.name) ?? [])];
    const onceListeners = [...(this.onceListeners.get(envelope.name) ?? [])];
    this.onceListeners.delete(envelope.name);

    for (const listener of [...listeners, ...onceListeners]) {
      try {
        listener(envelope as PluginEventEnvelope<CoreEventName>);
      } catch {
        // Observers cannot break the event source or other plugins.
      }
    }
    for (const listener of [...this.anyListeners]) {
      try {
        listener(envelope as PluginEventEnvelope);
      } catch {
        // Diagnostics are handled by the owner; the bus remains isolated.
      }
    }
  }
}
