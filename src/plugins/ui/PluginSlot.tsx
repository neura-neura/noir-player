import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import type { PluginSlotName, PluginSlotProps, PlayerSnapshot, UiContribution } from '@noir-player/plugin-api';
import { usePluginRuntime } from './PluginProvider';

interface ContributionBoundaryProps {
  readonly contribution: UiContribution;
  readonly snapshot: Readonly<PlayerSnapshot>;
}

interface ContributionBoundaryState {
  readonly failed: boolean;
}

class ContributionBoundary extends Component<ContributionBoundaryProps, ContributionBoundaryState> {
  state: ContributionBoundaryState = { failed: false };

  static getDerivedStateFromError(): ContributionBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Each contribution is isolated; the host keeps the media surface visible.
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <span className='plugin-contribution-error' role='status'>Plugin contribution unavailable.</span>;
    }
    const Contribution = this.props.contribution.component;
    return <Contribution snapshot={this.props.snapshot} />;
  }
}

export function PluginSlot({ name, className }: { readonly name: PluginSlotName; readonly className?: string }) {
  const runtime = usePluginRuntime();
  const snapshot = useSyncExternalStore(runtime.player.subscribe.bind(runtime.player), runtime.player.getSnapshot.bind(runtime.player));
  const uiRevision = useSyncExternalStore(runtime.ui.subscribe.bind(runtime.ui), () => runtime.ui.getRevision());
  const contributions = runtime.ui.getContributions(name, snapshot);
  if (contributions.length === 0) return null;
  return (
    <div className={className} data-plugin-slot={name}>
      {contributions.map((contribution) => (
        <ContributionBoundary key={contribution.id} contribution={contribution} snapshot={snapshot} />
      ))}
      <span className='sr-only' aria-hidden='true'>{uiRevision}</span>
    </div>
  );
}
