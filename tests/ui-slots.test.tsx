/* @vitest-environment jsdom */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createPluginRuntime, CommandBus, TypedEventBus, HookRegistry, UiRegistry, ServiceRegistry, MemoryStorageAdapter } from '@/plugins/runtime';
import { PluginSlot, PluginSystemProvider } from '@/plugins/ui';

afterAll(() => vi.restoreAllMocks());

function runtime() {
  return createPluginRuntime({
    selections: [],
    commands: new CommandBus(),
    events: new TypedEventBus(),
    hooks: new HookRegistry(),
    ui: new UiRegistry(),
    services: new ServiceRegistry(),
    storage: new MemoryStorageAdapter(),
  });
}

describe('nominal React plugin slots', () => {
  it('orders contributions deterministically and keeps the empty slot invisible', () => {
    const host = runtime();
    host.ui.contribute({ id: 'fixture.slot/late', slot: 'stage.info', order: 20, component: () => <span>late</span> });
    host.ui.contribute({ id: 'fixture.slot/early', slot: 'stage.info', order: 10, component: () => <span>early</span> });
    const { container } = render(
      <PluginSystemProvider runtime={host}>
        <PluginSlot name='stage.info' />
        <PluginSlot name='notifications' />
      </PluginSystemProvider>,
    );
    expect(screen.getByText('early')).toBeInTheDocument();
    expect(screen.getByText('late')).toBeInTheDocument();
    expect(container.textContent).toMatch(/earlylate/);
  });

  it('isolates a broken contribution with an accessible status fallback', () => {
    const host = runtime();
    host.ui.contribute({ id: 'fixture.slot/broken', slot: 'stage.info', component: () => { throw new Error('broken'); } });
    const preventExpectedWindowError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', preventExpectedWindowError);
    render(<PluginSystemProvider runtime={host}><PluginSlot name='stage.info' /></PluginSystemProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('Plugin contribution unavailable.');
    window.removeEventListener('error', preventExpectedWindowError);
  });
});
