import { StrictMode, lazy, Suspense, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { PluginRuntime } from './plugins/runtime';
import { PluginSystemProvider } from './plugins/ui';
import './styles.css';

const App = lazy(() => import('./App'));

function BootstrapStatus({ message }: { readonly message: string }) {
  return (
    <main className='app-splash' role='status'>
      <div className='app-splash-card'>
        <p>{message}</p>
      </div>
    </main>
  );
}

function NoirPlayerRoot() {
  const [pluginRuntime, setPluginRuntime] = useState<PluginRuntime | null>(null);
  const [runtimeError, setRuntimeError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    void import('./app/plugin-system')
      .then(({ createNoirPluginRuntime }) => {
        if (active) setPluginRuntime(createNoirPluginRuntime());
      })
      .catch((error: unknown) => {
        if (!active) return;
        setRuntimeError(error instanceof Error ? error : new Error(String(error)));
      });

    return () => {
      active = false;
    };
  }, []);

  if (runtimeError) {
    return <BootstrapStatus message={`Plugin runtime unavailable: ${runtimeError.message}`} />;
  }

  if (!pluginRuntime) {
    return <BootstrapStatus message='Loading Noir Player…' />;
  }

  return (
    <PluginSystemProvider runtime={pluginRuntime}>
      <Suspense fallback={<BootstrapStatus message='Loading player…' />}>
        <App />
      </Suspense>
    </PluginSystemProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NoirPlayerRoot />
  </StrictMode>,
);
