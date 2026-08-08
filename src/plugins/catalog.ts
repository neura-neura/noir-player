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

export interface GitHubPluginCandidate {
  readonly id: PluginId;
  readonly repositoryUrl: string;
  readonly descriptorUrl: string;
  readonly entryUrl: string;
  readonly manifest: NoirPluginManifest;
  readonly integrity?: string;
}

export interface GitHubPluginRepository {
  readonly repositoryUrl: string;
  readonly catalogUrl: string;
  readonly name: string;
  readonly description: string;
  readonly plugins: readonly GitHubPluginCandidate[];
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

export async function discoverGitHubPluginRepository(
  repositoryInput: string,
): Promise<GitHubPluginRepository> {
  const source = await resolveGitHubSource(repositoryInput);
  let repositoryName = source.repositoryUrl.split('/').pop() || 'GitHub plugin repository';
  let repositoryDescription = '';
  let descriptorUrls: readonly string[] = [];

  if (source.descriptorUrl) {
    descriptorUrls = [source.descriptorUrl];
  } else if (source.catalogUrl) {
    const catalogValue = await fetchJsonOptional<unknown>(source.catalogUrl);
    if (catalogValue) {
      const catalog = parseRepositoryCatalog(catalogValue);
      repositoryName = catalog.name || repositoryName;
      repositoryDescription = catalog.description;
      descriptorUrls = catalog.plugins.map((descriptor) =>
        resolveRepositoryFileUrl(source.catalogUrl!, descriptor),
      );
    } else if (source.legacyDescriptorUrl) {
      descriptorUrls = [source.legacyDescriptorUrl];
    }
  }

  if (!descriptorUrls.length) {
    throw new Error('The repository must expose noir.plugins.json or noir.plugin.json.');
  }

  const plugins = await Promise.all(descriptorUrls.map(async (descriptorUrl) => {
    const descriptor = await fetchDescriptor(descriptorUrl);
    validateDescriptor(descriptor);
    return {
      id: descriptor.manifest.id,
      repositoryUrl: source.repositoryUrl,
      descriptorUrl,
      entryUrl: resolveEntryUrl(descriptorUrl, descriptor.entry),
      manifest: descriptor.manifest,
      integrity: normalizeIntegrity(descriptor.integrity),
    } satisfies GitHubPluginCandidate;
  }));

  const uniquePlugins = plugins.filter((plugin, index, all) =>
    all.findIndex((candidate) => candidate.id === plugin.id) === index,
  );
  if (!uniquePlugins.length) {
    throw new Error('The repository catalog does not contain any valid plugins.');
  }

  return {
    repositoryUrl: source.repositoryUrl,
    catalogUrl: source.catalogUrl || source.descriptorUrl || source.legacyDescriptorUrl || source.repositoryUrl,
    name: repositoryName,
    description: repositoryDescription,
    plugins: uniquePlugins,
  };
}

export async function installGitHubPluginCandidate(
  candidate: GitHubPluginCandidate,
): Promise<InstalledGitHubPlugin> {
  const entrySource = await fetchText(candidate.entryUrl);
  if (candidate.integrity) await assertIntegrity(entrySource, candidate.integrity);

  const current = readPluginCatalog();
  const existing = current.github.find((plugin) => plugin.id === candidate.id);
  const installed: InstalledGitHubPlugin = {
    id: candidate.id,
    repositoryUrl: candidate.repositoryUrl,
    descriptorUrl: candidate.descriptorUrl,
    entryUrl: candidate.entryUrl,
    manifest: candidate.manifest,
    grants: existing?.grants ?? getPluginDefaultGrants(candidate.manifest),
    riskAcknowledgements: existing?.riskAcknowledgements ?? [],
    integrity: candidate.integrity,
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

/** Backward-compatible one-plugin API for callers that still pass a repository URL. */
export async function installGitHubPlugin(repositoryInput: string): Promise<InstalledGitHubPlugin> {
  const repository = await discoverGitHubPluginRepository(repositoryInput);
  const [candidate] = repository.plugins;
  if (!candidate) throw new Error('The repository does not contain an installable plugin.');
  return installGitHubPluginCandidate(candidate);
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

type GitHubSource = {
  readonly repositoryUrl: string;
  readonly catalogUrl?: string;
  readonly descriptorUrl?: string;
  readonly legacyDescriptorUrl?: string;
};

async function resolveGitHubSource(input: string): Promise<GitHubSource> {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:') throw new Error('GitHub plugin links must use HTTPS.');

  if (url.hostname === 'raw.githubusercontent.com') {
    if (!url.pathname.endsWith('.json')) throw new Error('A raw GitHub plugin link must point to a JSON plugin catalog or descriptor.');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('Invalid raw GitHub plugin link.');
    const repositoryUrl = `https://github.com/${parts.slice(0, 2).join('/')}`;
    const isRepositoryCatalog = url.pathname.toLowerCase().endsWith('/noir.plugins.json');
    return {
      repositoryUrl,
      ...(isRepositoryCatalog ? { catalogUrl: url.toString() } : { descriptorUrl: url.toString() }),
    };
  }

  if (url.hostname !== 'github.com') throw new Error('Plugin sources must point to github.com.');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length >= 4 && parts[2] === 'blob') {
    const [owner, repo, , ref, ...path] = parts;
    if (!owner || !repo || !ref || path.length === 0) throw new Error('Invalid GitHub file link.');
    const repositoryUrl = `https://github.com/${owner}/${repo.replace(/\.git$/i, '')}`;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path.join('/')}`;
    const isRepositoryCatalog = path.join('/').toLowerCase() === 'noir.plugins.json';
    return {
      repositoryUrl,
      ...(isRepositoryCatalog ? { catalogUrl: rawUrl } : { descriptorUrl: rawUrl }),
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
    catalogUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch.split('/').map(encodeURIComponent).join('/')}/noir.plugins.json`,
    legacyDescriptorUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch.split('/').map(encodeURIComponent).join('/')}/noir.plugin.json`,
  };
}

function parseRepositoryCatalog(value: unknown): {
  readonly name: string;
  readonly description: string;
  readonly plugins: readonly string[];
} {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.plugins)) {
    throw new Error('noir.plugins.json must contain schemaVersion 1 and a plugins array.');
  }

  const plugins = value.plugins.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (isRecord(entry) && typeof entry.descriptor === 'string') return entry.descriptor;
    throw new Error('Every repository plugin entry must contain a descriptor path.');
  }).filter((descriptor) => descriptor.trim().length > 0);

  return {
    name: typeof value.name === 'string' ? value.name.trim() : '',
    description: typeof value.description === 'string' ? value.description.trim() : '',
    plugins,
  };
}

function resolveRepositoryFileUrl(catalogUrl: string, descriptor: string): string {
  const descriptorUrl = new URL(descriptor, catalogUrl);
  if (descriptorUrl.protocol !== 'https:' || descriptorUrl.hostname !== 'raw.githubusercontent.com') {
    throw new Error('Repository plugin descriptors must resolve to raw.githubusercontent.com over HTTPS.');
  }
  return descriptorUrl.toString();
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

async function fetchJsonOptional<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { headers: requestHeaders(url) });
  if (response.status === 404) return null;
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
