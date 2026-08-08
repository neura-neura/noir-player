import {
  PluginCommandError,
  PluginPermissionError,
  type Disposable,
  type HostCommandMap,
  type MaybePromise,
  type PluginCapability,
  type PluginCommandBus,
  type PluginCommandHandler,
  type PluginCommandName,
} from '@noir-player/plugin-api';

type CoreCommandName = keyof HostCommandMap;
type CoreHandler<K extends CoreCommandName> = (
  input: HostCommandMap[K]['input'],
  context: { readonly signal: AbortSignal },
) => MaybePromise<HostCommandMap[K]['output']>;

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('The command was aborted.', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('The command was aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function validateCoreInput<K extends CoreCommandName>(command: K, input: HostCommandMap[K]['input']): void {
  const value = input as unknown as Record<string, unknown> | undefined;
  if (command === 'media.open' && (!value || typeof value.path !== 'string' || value.path.trim() === '')) {
    throw new TypeError('media.open requires a non-empty path.');
  }
  if ((command === 'media.seekTo' || command === 'media.seekBy') && (!value || !Number.isFinite(value.seconds as number))) {
    throw new TypeError(`${command} requires a finite seconds value.`);
  }
  if (command === 'media.setRate' && (!value || !Number.isFinite(value.rate as number) || (value.rate as number) <= 0 || (value.rate as number) > 16)) {
    throw new TypeError('media.setRate requires a rate between 0 and 16.');
  }
  if (command === 'media.setVolume' && (!value || !Number.isFinite(value.volume as number) || (value.volume as number) < 0 || (value.volume as number) > 1)) {
    throw new TypeError('media.setVolume requires a volume between 0 and 1.');
  }
}

export class CommandBus {
  private readonly coreHandlers = new Map<CoreCommandName, CoreHandler<CoreCommandName>>();
  private readonly pluginHandlers = new Map<PluginCommandName, { owner: string; handler: PluginCommandHandler }>();

  registerCore<K extends CoreCommandName>(command: K, handler: CoreHandler<K>): Disposable {
    this.coreHandlers.set(command, handler as unknown as CoreHandler<CoreCommandName>);
    return () => {
      if (this.coreHandlers.get(command) === (handler as unknown as CoreHandler<CoreCommandName>)) {
        this.coreHandlers.delete(command);
      }
    };
  }

  async execute<K extends CoreCommandName>(
    command: K,
    input: HostCommandMap[K]['input'],
    options: { signal?: AbortSignal } = {},
  ): Promise<HostCommandMap[K]['output']> {
    return this.executeCore(command, input, options.signal ?? new AbortController().signal, 'noir.core');
  }

  async executeCore<K extends CoreCommandName>(
    command: K,
    input: HostCommandMap[K]['input'],
    signal: AbortSignal,
    owner: string,
  ): Promise<HostCommandMap[K]['output']> {
    validateCoreInput(command, input);
    const handler = this.coreHandlers.get(command) as CoreHandler<K> | undefined;
    if (!handler) {
      throw new PluginCommandError(owner as never, `No host handler is registered for ${command}.`);
    }
    try {
      return await withAbort(Promise.resolve(handler(input, { signal })), signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof PluginCommandError) throw error;
      throw new PluginCommandError(owner as never, `Command ${command} failed.`, error);
    }
  }

  async executePlugin<T = unknown>(
    command: PluginCommandName,
    input?: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const entry = this.pluginHandlers.get(command);
    if (!entry) {
      throw new PluginCommandError('noir.core' as never, `No plugin command is registered for ${command}.`);
    }
    const signal = options.signal ?? new AbortController().signal;
    try {
      return (await withAbort(Promise.resolve(entry.handler(input, { signal })), signal)) as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (error instanceof PluginCommandError) throw error;
      throw new PluginCommandError(entry.owner as never, `Plugin command ${command} failed.`, error);
    }
  }

  registerPlugin(
    owner: string,
    command: PluginCommandName,
    handler: PluginCommandHandler,
  ): Disposable {
    if (!command.startsWith(`${owner}.`)) {
      throw new PluginCommandError(owner as never, `Command ${command} must be namespaced by ${owner}.`);
    }
    if (this.pluginHandlers.has(command)) {
      throw new PluginCommandError(owner as never, `Command ${command} is already registered.`);
    }
    const entry = { owner, handler };
    this.pluginHandlers.set(command, entry);
    return () => {
      if (this.pluginHandlers.get(command) === entry) this.pluginHandlers.delete(command);
    };
  }

  createScoped(pluginId: string, hasCapability: (capability: PluginCapability) => boolean, signal: AbortSignal): PluginCommandBus {
    return new ScopedCommandBus(this, pluginId, hasCapability, signal);
  }

  commandCount(): number {
    return this.coreHandlers.size + this.pluginHandlers.size;
  }

  pluginCommandCount(): number {
    return this.pluginHandlers.size;
  }

  clear(): void {
    this.coreHandlers.clear();
    this.pluginHandlers.clear();
  }
}

class ScopedCommandBus implements PluginCommandBus {
  constructor(
    private readonly host: CommandBus,
    private readonly pluginId: string,
    private readonly hasCapability: (capability: PluginCapability) => boolean,
    private readonly signal: AbortSignal,
  ) {}

  execute<K extends keyof HostCommandMap>(
    command: K,
    input: HostCommandMap[K]['input'],
    options: { signal?: AbortSignal } = {},
  ): Promise<HostCommandMap[K]['output']> {
    if (!this.hasCapability('player.control')) {
      return Promise.reject(new PluginPermissionError(this.pluginId as never, 'player.control'));
    }
    return this.host.executeCore(command, input, options.signal ?? this.signal, this.pluginId);
  }

  executePlugin<T = unknown>(
    command: PluginCommandName,
    input?: unknown,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    return this.host.executePlugin(command, input, options.signal ? options : { signal: this.signal });
  }

  register(command: PluginCommandName, handler: PluginCommandHandler): Disposable {
    if (!this.hasCapability('commands.contribute')) {
      throw new PluginPermissionError(this.pluginId as never, 'commands.contribute');
    }
    return this.host.registerPlugin(this.pluginId, command, handler);
  }
}
