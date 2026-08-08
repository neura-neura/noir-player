import { useEffect, useMemo, useState } from 'react';
import type {
  PluginCapability,
  PluginRuntimeStatus,
  PluginRiskAcknowledgement,
} from '@noir-player/plugin-api';
import {
  installGitHubPlugin,
  readPluginCatalog,
  removeGitHubPlugin,
  removePluginEnabledOverride,
  setPluginEnabledOverride,
  updateGitHubPluginEnabled,
  updateGitHubPluginPermissions,
  type InstalledGitHubPlugin,
  type PluginCatalogDocument,
} from '@/plugins/catalog';
import { usePluginRuntime } from './PluginProvider';
import { PLUGIN_MANAGER_MESSAGES } from './plugin-manager-messages';

type PluginManagerPanelProps = {
  readonly locale: 'en' | 'es' | 'zh';
  readonly onClose: () => void;
};

type PluginEntry = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: 'bundled' | 'github';
  readonly manifest?: PluginRuntimeStatus['manifest'];
  readonly remote?: InstalledGitHubPlugin;
  readonly status?: PluginRuntimeStatus;
};

export function PluginManagerPanel({ locale, onClose }: PluginManagerPanelProps) {
  const runtime = usePluginRuntime();
  const messages = PLUGIN_MANAGER_MESSAGES[locale];
  const [catalog, setCatalog] = useState<PluginCatalogDocument>(() => readPluginCatalog());
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [restartNeeded, setRestartNeeded] = useState(false);

  useEffect(() => runtime.subscribe(() => setRuntimeRevision((revision) => revision + 1)), [runtime]);

  const entries = useMemo<readonly PluginEntry[]>(() => {
    void runtimeRevision;
    const statuses = (runtime.getStatus() ?? []) as readonly PluginRuntimeStatus[];
    const statusById = new Map(statuses.map((status) => [status.id, status]));
    const remoteById = new Map(catalog.github.map((plugin) => [plugin.id, plugin]));
    const result: PluginEntry[] = statuses.map((status) => {
      const remote = remoteById.get(status.id);
      return {
        id: status.id,
        name: remote?.manifest.name ?? status.manifest?.name ?? status.id,
        description: remote?.manifest.description ?? status.manifest?.description ?? 'Plugin metadata is still loading.',
        source: remote ? 'github' : 'bundled',
        manifest: remote?.manifest ?? status.manifest,
        remote,
        status,
      };
    });
    for (const remote of catalog.github) {
      if (statusById.has(remote.id)) continue;
      result.push({
        id: remote.id,
        name: remote.manifest.name,
        description: remote.manifest.description,
        source: 'github',
        manifest: remote.manifest,
        remote,
      });
    }
    return result;
  }, [catalog, runtime, runtimeRevision]);

  async function togglePlugin(entry: PluginEntry): Promise<void> {
    const enabled = !(entry.status?.enabled ?? entry.remote?.enabled ?? false);
    setBusyId(entry.id);
    setFeedback('');
    try {
      if (entry.source === 'github') {
        updateGitHubPluginEnabled(entry.id, enabled);
      } else {
        setPluginEnabledOverride(entry.id, enabled);
      }

      if (entry.status) {
        await runtime.setEnabled(entry.id, enabled);
        setFeedback(enabled ? messages.enabled(entry.name) : messages.disabled(entry.name));
      } else {
        setRestartNeeded(true);
        setFeedback(messages.restart);
      }
      setCatalog(readPluginCatalog());
    } catch (error) {
      if (entry.source === 'github') updateGitHubPluginEnabled(entry.id, !enabled);
      else setPluginEnabledOverride(entry.id, !enabled);
      setFeedback(messages.failed(error instanceof Error ? error.message : 'unknown error'));
    } finally {
      setBusyId(null);
    }
  }

  async function restoreBundledPlugin(entry: PluginEntry): Promise<void> {
    setBusyId(entry.id);
    try {
      removePluginEnabledOverride(entry.id);
      await runtime.setEnabled(entry.id, true);
      setCatalog(readPluginCatalog());
      setFeedback(messages.enabled(entry.name));
    } catch (error) {
      setFeedback(messages.failed(error instanceof Error ? error.message : 'unknown error'));
    } finally {
      setBusyId(null);
    }
  }

  async function removePlugin(entry: PluginEntry): Promise<void> {
    if (!entry.remote) return;
    setBusyId(entry.id);
    try {
      await runtime.remove(entry.id);
      removeGitHubPlugin(entry.id);
      setCatalog(readPluginCatalog());
      setFeedback(messages.removed(entry.name));
    } catch (error) {
      setFeedback(messages.failed(error instanceof Error ? error.message : 'unknown error'));
    } finally {
      setBusyId(null);
    }
  }

  function updatePermission(
    plugin: InstalledGitHubPlugin,
    capability: PluginCapability,
    granted: boolean,
  ): void {
    const grants = granted
      ? [...new Set([...plugin.grants, capability])]
      : plugin.grants.filter((candidate) => candidate !== capability);
    const riskAcknowledgements = plugin.riskAcknowledgements.filter((risk) => risk !== capability);
    updateGitHubPluginPermissions(
      plugin.id,
      grants,
      riskAcknowledgements as readonly PluginRiskAcknowledgement[],
    );
    setCatalog(readPluginCatalog());
    setRestartNeeded(true);
    setFeedback(messages.restart);
  }

  function updateRiskAcknowledgement(
    plugin: InstalledGitHubPlugin,
    capability: PluginRiskAcknowledgement,
    acknowledged: boolean,
  ): void {
    const riskAcknowledgements = acknowledged
      ? [...new Set([...plugin.riskAcknowledgements, capability])]
      : plugin.riskAcknowledgements.filter((candidate) => candidate !== capability);
    updateGitHubPluginPermissions(plugin.id, plugin.grants, riskAcknowledgements);
    setCatalog(readPluginCatalog());
    setRestartNeeded(true);
    setFeedback(messages.restart);
  }

  async function submitRepository(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!repositoryUrl.trim()) return;
    setInstalling(true);
    setFeedback('');
    try {
      const installed = await installGitHubPlugin(repositoryUrl);
      setCatalog(readPluginCatalog());
      setRepositoryUrl('');
      setRestartNeeded(true);
      setFeedback(messages.installed(installed.manifest.name));
    } catch (error) {
      setFeedback(messages.failed(error instanceof Error ? error.message : 'unknown error'));
    } finally {
      setInstalling(false);
    }
  }

  return (
    <aside className='plugin-manager-panel' role='dialog' aria-label={messages.title}>
      <div className='plugin-manager-header'>
        <div>
          <p className='eyebrow'>{messages.eyebrow}</p>
          <h2>{messages.title}</h2>
        </div>
        <button type='button' className='panel-close' onClick={onClose}>{messages.close}</button>
      </div>

      <div className='plugin-manager-body'>
        <section className='plugin-manager-install settings-section'>
          <div className='section-heading'>
            <h3>{messages.addTitle}</h3>
          </div>
          <form className='plugin-manager-install-form' onSubmit={(event) => void submitRepository(event)}>
            <input
              className='text-input'
              type='url'
              value={repositoryUrl}
              onChange={(event) => setRepositoryUrl(event.target.value)}
              placeholder={messages.githubPlaceholder}
              aria-label={messages.githubPlaceholder}
              disabled={installing}
            />
            <button type='submit' className='primary-button' disabled={installing || !repositoryUrl.trim()}>
              {installing ? messages.installing : messages.add}
            </button>
          </form>
          <p className='helper-text'>{messages.installHelp}</p>
        </section>

        <div className='plugin-manager-list'>
          {entries.length === 0 ? <p className='helper-text'>{messages.empty}</p> : entries.map((entry) => {
            const enabled = entry.status?.enabled ?? entry.remote?.enabled ?? false;
            const isActive = entry.status?.state === 'active';
            const isPending = !entry.status && entry.source === 'github';
            return (
              <article className='plugin-manager-card' key={entry.id}>
                <div className='plugin-manager-card-heading'>
                  <div>
                    <div className='plugin-manager-title-row'>
                      <h3>{entry.name}</h3>
                      <span className='plugin-manager-source'>{entry.source === 'github' ? messages.github : messages.bundled}</span>
                    </div>
                    <code>{entry.id}</code>
                  </div>
                  <span className={`plugin-manager-state ${isActive ? 'is-active' : ''}`}>
                    {isPending ? messages.pendingRestart : isActive ? messages.active : messages.inactive}
                  </span>
                </div>
                <p>{entry.description}</p>
                {entry.remote ? (
                  <a href={entry.remote.repositoryUrl} target='_blank' rel='noreferrer'>{entry.remote.repositoryUrl}</a>
                ) : null}
                {entry.manifest?.requestedCapabilities?.length ? (
                  <details className='plugin-manager-permissions'>
                    <summary>{messages.permissions}</summary>
                    {entry.source === 'github' && entry.remote ? (
                      <div className='plugin-permission-list'>
                        {entry.manifest.requestedCapabilities.map((capability) => {
                          const granted = entry.remote?.grants.includes(capability) ?? false;
                          const isRisk = capability === 'native.mpv.raw' || capability === 'unsafe.dom';
                          const acknowledged = entry.remote?.riskAcknowledgements.includes(capability as PluginRiskAcknowledgement) ?? false;
                          return (
                            <div className='plugin-permission-item' key={capability}>
                              <label className='switch-row'>
                                <input
                                  type='checkbox'
                                  checked={granted}
                                  onChange={(event) => updatePermission(entry.remote!, capability, event.target.checked)}
                                />
                                <span>{messages.grant}: <code>{capability}</code></span>
                              </label>
                              {isRisk && granted ? (
                                <label className='switch-row plugin-risk-row'>
                                  <input
                                    type='checkbox'
                                    checked={acknowledged}
                                    onChange={(event) => updateRiskAcknowledgement(entry.remote!, capability as PluginRiskAcknowledgement, event.target.checked)}
                                  />
                                  <span>{messages.risk}</span>
                                </label>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <ul>{entry.manifest.requestedCapabilities.map((capability) => <li key={capability}><code>{capability}</code></li>)}</ul>
                    )}
                  </details>
                ) : null}
                <div className='plugin-manager-actions'>
                  <button
                    type='button'
                    className={enabled ? 'ghost-button' : 'primary-button'}
                    disabled={busyId === entry.id}
                    aria-pressed={enabled}
                    onClick={() => void togglePlugin(entry)}
                  >
                    {enabled ? messages.disable : messages.enable}
                  </button>
                  {entry.source === 'bundled' && !enabled ? (
                    <button type='button' className='ghost-button' disabled={busyId === entry.id} onClick={() => void restoreBundledPlugin(entry)}>
                      {messages.restore}
                    </button>
                  ) : null}
                  {entry.source === 'github' ? (
                    <button type='button' className='danger-button' disabled={busyId === entry.id} onClick={() => void removePlugin(entry)}>
                      {messages.remove}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
        {feedback ? <p className='plugin-manager-feedback' role='status'>{feedback}</p> : null}
        {restartNeeded ? <button type='button' className='primary-button plugin-manager-restart' onClick={() => window.location.reload()}>{messages.restart}</button> : null}
      </div>
    </aside>
  );
}
