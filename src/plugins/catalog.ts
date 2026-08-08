import type {
  NoirPluginManifest,
  PluginCapability,
  PluginId,
  PluginRiskAcknowledgement,
  PluginSelection,
} from '@noir-player/plugin-api';

const CATALOG_STORAGE_KEY = 'noir-player:plugin-catalog:v1';
const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export interface InstalledGitHubPlugin {
  readonly id: PluginId;
  readonly repositoryUrl: string;
  readonly descriptorUrl: string;
  readonly entryUrl: string;
  readonly manifest: NoirPluginManifest;
  readonly grants: readonly PluginCapability[];
  readonly riskAcknowledgements: readonly PluginRiskAcknowledgement[];
  readonly integrity?: string;
  readonly enabled: boolean;
  readonly installedAt: number;
}

export interface PluginCatalogDocument {
  readonly schemaVersion: 1;
  readonly enabledOverrides: Readonly<Record<string, boolean>>;
  readonly github: readonly InstalledGitHubPlugin[];
}

export interface GitHubPluginDescriptor {
  readonly manifest: NoirPluginManifest;
  readonly entry: string;
  readonly integrity?: string;
}

const DEFAULT_CATALOG: PluginCatalogDocument = {
  schemaVersion: 1,
  enabledOverrides: {},
  github: [],
};

const HIGH_RISK_CAPABILITIES = new Set<PluginCapability>([
  'native.mpv.raw',
  'unsafe.dom',
]);

export function readPluginCatalog(): PluginCatalogDocument {
  try {
    const raw = globalThis.localStorage?.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return DEFAULT_CATALOG;
    const parsed = JSON.parse(raw) as Partial<PluginCatalogDocument>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.github)) {
      return DEFAULT_CATALOG;
    }

    return {
      schemaVersion: 1,
      enabledOverrides: isRecord(parsed.enabledOverrides)
        ? Object.fromEntries(
          Object.entries(parsed.enabledOverrides).filter(([, value]) => typeof value === 'boolean'),
        )
        : {},
      github: parsed.github.filter(isInstalledGitHubPlugin),
    };
  } catch {
    return DEFAULT_CATALOG;
  }
}

export function writePluginCatalog(catalog: PluginCatalogDocument): void {
  try {
    globalThis.localStorage?.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // A private or restricted webview can keep the catalog for this session only.
  }
}

export function setPluginEnabledOverride(id: string, enabled: boolean): PluginCatalogDocument {
  const current = readPluginCatalog();
  const next: PluginCatalogDocument = {
    ...current,
    enabledOverrides: { ...current.enabledOverrides, [id]: enabled },
  };
  writePluginCatalog(next);
  return next;
}

export function removePluginEnabledOverride(id: string): PluginCatalogDocument {
  const current = readPluginCatalog();
  const enabledOverrides = { ...current.enabledOverrides };
  delete enabledOverrides[id];
  const next: PluginCatalogDocument = { ...current, enabledOverrides };
  writePluginCatalog(next);
  return next;
}

export function removeGitHubPlugin(id: string): PluginCatalogDocument {
  const current = readPluginCatalog();
  const next: PluginCatalogDocument = {
    ...current,
    github: current.github.filter((plugin) => plugin.id !== id),
  };
  writePluginCatalog(next);
  return next;
}

export function applyPluginCatalogToSelections(
  selections: readonly PluginSelection[],
): readonly PluginSelection[] {
  const catalog = readPluginCatalog();
  const bundled = selections.map((selection) => {
    const override = catalog.enabledOverrides[selection.id];
    return override === undefined ? selection : { ...selection, enabled: override };
  });
  const selectedIds = new Set(bundled.map((selection) => selection.id));
  const remote = catalog.github
    .filter((plugin) => !selectedIds.has(plugin.id))
    .map(createGitHubPluginSelection);
  return [...bundled, ...remote];
}

export function getPluginDefaultGrants(manifest: NoirPluginManifest): readonly PluginCapability[] {
  return manifest.requestedCapabilities.filter((capability) => !HIGH_RISK_CAPABILITIES.has(capability));
}

export function getHighRiskCapabilities(manifest: NoirPluginManifest): readonly PluginCapability[] {
  return manifest.requestedCapabilities.filter((capability) => HIGH_RISK_CAPABILITIES.has(capability));
}

export async function installGitHubPlugin(repositoryInput: string): Promise<InstalledGitHubPlugin> {
  const descriptorInfo = await resolveDescriptor(repositoryInput);
  const descriptor = await fetchDescriptor(descriptorInfo.descriptorUrl);
  validateDescriptor(descriptor);
  const entryUrl = resolveEntryUrl(descriptorInfo.descriptorUrl, descriptor.entry);
  const entrySource = await fetchText(entryUrl);
  const integrity = normalizeIntegrity(descriptor.integrity);
  if (integrity) await assertIntegrity(entrySource, integrity);

  const current = readPluginCatalog();
  const existing = current.github.find((plugin) => plugin.id === descriptor.manifest.id);
  const installed: InstalledGitHubPlugin = {
    id: descriptor.manifest.id,
    repositoryUrl: descriptorInfo.repositoryUrl,
    descriptorUrl: descriptorInfo.descriptorUrl,
    entryUrl,
    manifest: descriptor.manifest,
    grants: existing?.grants ?? getPluginDefaultGrants(descriptor.manifest),
    riskAcknowledgements: existing?.riskAcknowledgements ?? [],
    integrity: integrity ?? undefined,
    enabled: existing?.enabled ?? false,
    installedAt: existing?.installedAt ?? Date.now(),
  };
  const next: PluginCatalogDocument = {
    ...current,
    github: [...current.github.filter((plugin) => plugin.id !== installed.id), installed],
  };
  writePluginCatalog(next);
  return installed;
}

export function updateGitHubPluginPermissions(
  id: string,
  grants: readonly PluginCapability[],
  riskAcknowledgements: readonly PluginRiskAcknowledgement[],
): PluginCatalogDocument {
  const current = readPluginCatalog();
  const next: PluginCatalogDocument = {
    ...current,
    github: current.github.map((plugin) => plugin.id === id
      ? { ...plugin, grants: [...grants], riskAcknowledgements: [...riskAcknowledgements] }
      : plugin),
  };
  writePluginCatalog(next);
  return next;
}

export function updateGitHubPluginEnabled(id: string, enabled: boolean): PluginCatalogDocument {
  const current = readPluginCatalog();
  const next: PluginCatalogDocument = {
    ...current,
    github: current.github.map((plugin) => plugin.id === id ? { ...plugin, enabled } : plugin),
  };
  writePluginCatalog(next);
  return next;
}

function createGitHubPluginSelection(plugin: InstalledGitHubPlugin): PluginSelection {
  return {
    id: plugin.id,
    enabled: plugin.enabled,
    loader: async () => {
      const source = await fetchText(plugin.entryUrl);
      if (plugin.integrity) await assertIntegrity(source, plugin.integrity);
      const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try {
        return await import(/* @vite-ignore */ moduleUrl) as { default: never };
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    },
    grants: plugin.grants,
    riskAcknowledgements: plugin.riskAcknowledgements,
    trust: 'reviewed-third-party',
  };
}

async function resolveDescriptor(input: string): Promise<{ repositoryUrl: string; descriptorUrl: string }> {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:') throw new Error('GitHub plugin links must use HTTPS.');

  if (url.hostname === 'raw.githubusercontent.com') {
    if (!url.pathname.endsWith('.json')) throw new Error('A raw GitHub plugin link must point to a JSON descriptor.');
    return {
      repositoryUrl: `https://github.com/${url.pathname.split('/').slice(1, 3).join('/')}`,
      descriptorUrl: url.toString(),
    };
  }

  if (url.hostname !== 'github.com') throw new Error('Plugin sources must point to github.com.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 4 && parts[2] === 'blob') {
    const [owner, repo, , ref, ...path] = parts;
    if (!owner || !repo || !ref || path.length === 0) throw new Error('Invalid GitHub file link.');
    const repositoryUrl = `https://github.com/${owner}/${repo.replace(/\.git$/i, '')}`;
    return {
      repositoryUrl,
      descriptorUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path.join('/')}`,
    };
  }

  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/i, '');
  if (!owner || !repo) throw new Error('Use a GitHub repository URL such as https://github.com/owner/repository.');
  const repositoryUrl = `https://github.com/${owner}/${repo}`;
  const repository = await fetchJson<{ default_branch?: string }>(`https://api.github.com/repos/${owner}/${repo}`);
  const branch = typeof repository.default_branch === 'string' && repository.default_branch
    ? repository.default_branch
    : 'main';
  return {
    repositoryUrl,
    descriptorUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch.split('/').map(encodeURIComponent).join('/')}/noir.plugin.json`,
  };
}

async function fetchDescriptor(url: string): Promise<GitHubPluginDescriptor> {
  const value = await fetchJson<unknown>(url);
  if (!isRecord(value)) throw new Error('GitHub plugin descriptor must be a JSON object.');
  const manifest = isRecord(value.manifest) ? value.manifest : value;
  const entry = value.entry;
  if (!isRecord(manifest) || typeof entry !== 'string') {
    throw new Error('Descriptor must contain a manifest object and an entry path.');
  }
  return {
    manifest: manifest as unknown as NoirPluginManifest,
    entry,
    integrity: typeof value.integrity === 'string' ? value.integrity : undefined,
  };
}

function validateDescriptor(descriptor: GitHubPluginDescriptor): void {
  const manifest = descriptor.manifest;
  if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(manifest.id)) throw new Error('Plugin manifest id must use namespace.name.');
  if (!manifest.name || !manifest.description || !manifest.license) throw new Error('Plugin manifest is missing required metadata.');
  if (!Array.isArray(manifest.requestedCapabilities)) throw new Error('Plugin manifest capabilities must be an array.');
  if (!descriptor.entry.trim()) throw new Error('Plugin entry path cannot be empty.');
}

function resolveEntryUrl(descriptorUrl: string, entry: string): string {
  const entryUrl = new URL(entry, descriptorUrl);
  if (entryUrl.protocol !== 'https:' || entryUrl.hostname !== 'raw.githubusercontent.com') {
    throw new Error('Plugin entry must resolve to raw.githubusercontent.com over HTTPS.');
  }
  return entryUrl.toString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: requestHeaders(url) });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status}).`);
  return await response.json() as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: requestHeaders(url) });
  if (!response.ok) throw new Error(`Plugin download failed (${response.status}).`);
  return await response.text();
}

function requestHeaders(url: string): Record<string, string> {
  return url.startsWith('https://api.github.com/')
    ? GITHUB_API_HEADERS
    : { Accept: 'text/plain, application/json' };
}

function normalizeIntegrity(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (/^sha256:[a-f0-9]{64}$/i.test(normalized)) return normalized.slice(7).toLowerCase();
  if (/^[a-f0-9]{64}$/i.test(normalized)) return normalized.toLowerCase();
  throw new Error('Plugin integrity must be a SHA-256 hexadecimal digest.');
}

async function assertIntegrity(source: string, expected: string): Promise<void> {
  if (!globalThis.crypto?.subtle) throw new Error('This runtime cannot verify plugin integrity.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error('Plugin entry integrity verification failed.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInstalledGitHubPlugin(value: unknown): value is InstalledGitHubPlugin {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.repositoryUrl === 'string'
    && typeof value.descriptorUrl === 'string'
    && typeof value.entryUrl === 'string'
    && isRecord(value.manifest)
    && Array.isArray(value.grants)
    && Array.isArray(value.riskAcknowledgements)
    && typeof value.enabled === 'boolean'
    && typeof value.installedAt === 'number';
}
