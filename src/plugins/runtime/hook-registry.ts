import {
  PluginHookTimeoutError,
  type Disposable,
  type HostHookMap,
  type HookInvocationContext,
  type PluginHookHandler,
} from '@noir-player/plugin-api';

type HookName = keyof HostHookMap;
type RegisteredHook = {
  owner: string;
  handler: PluginHookHandler<HookName>;
};

const FAIL_OPEN_HOOKS = new Set<HookName>([
  'media:resolve-source',
  'player:select-engine',
  'player:configure-engine',
  'subtitle:after-parse',
]);

export interface HookRunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  correlationId?: string;
}

export class HookRegistry {
  private readonly handlers = new Map<HookName, RegisteredHook[]>();
  private readonly activeRuns = new Set<string>();

  registerForPlugin<K extends HookName>(
    owner: string,
    hook: K,
    handler: PluginHookHandler<K>,
  ): Disposable {
    const registered = { owner, handler: handler as unknown as PluginHookHandler<HookName> };
    const handlers = this.handlers.get(hook) ?? [];
    handlers.push(registered);
    this.handlers.set(hook, handlers);
    return () => {
      const current = this.handlers.get(hook);
      if (!current) return;
      const index = current.indexOf(registered);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.handlers.delete(hook);
    };
  }

  async run<K extends HookName>(
    hook: K,
    input: HostHookMap[K]['input'],
    options: HookRunOptions = {},
  ): Promise<HostHookMap[K]['output'][]> {
    const runKey = `${hook}:${options.correlationId ?? 'anonymous'}`;
    if (this.activeRuns.has(runKey)) {
      throw new Error(`Hook re-entry rejected for ${hook}.`);
    }
    this.activeRuns.add(runKey);
    try {
      const results: HostHookMap[K]['output'][] = [];
      const handlers = [...(this.handlers.get(hook) ?? [])];
      for (const registered of handlers) {
        if (options.signal?.aborted) break;
        const controller = new AbortController();
        const signal = controller.signal;
        const timeoutMs = Math.max(1, options.timeoutMs ?? 2_000);
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        const context: HookInvocationContext = {
          signal,
          deadline: Date.now() + timeoutMs,
          correlationId: options.correlationId ?? `${hook}:${Date.now()}`,
        };
        try {
          const result = await Promise.race([
            Promise.resolve((registered.handler as unknown as PluginHookHandler<K>)(input, context)),
            new Promise<never>((_, reject) => {
              signal.addEventListener('abort', () => reject(new PluginHookTimeoutError(registered.owner as never, hook)), { once: true });
            }),
          ]);
          if (result !== undefined) {
            results.push(result as HostHookMap[K]['output']);
            if ((result as { decision?: string }).decision === 'cancel') break;
          }
        } catch (error) {
          if (error instanceof PluginHookTimeoutError && !FAIL_OPEN_HOOKS.has(hook)) {
            throw error;
          }
          if (!FAIL_OPEN_HOOKS.has(hook)) {
            throw error;
          }
        } finally {
          clearTimeout(timeout);
        }
      }
      return results;
    } finally {
      this.activeRuns.delete(runKey);
    }
  }

  count(hook?: HookName): number {
    if (hook) return this.handlers.get(hook)?.length ?? 0;
    return [...this.handlers.values()].reduce((total, values) => total + values.length, 0);
  }

  clear(): void {
    this.handlers.clear();
    this.activeRuns.clear();
  }
}
