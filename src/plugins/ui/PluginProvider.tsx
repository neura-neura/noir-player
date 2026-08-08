import { createContext, useContext, useEffect, useRef, type PropsWithChildren } from 'react';
import type { PluginRuntime } from '@/plugins/runtime';

const PluginRuntimeContext = createContext<PluginRuntime | null>(null);

export function PluginSystemProvider({ runtime, children }: PropsWithChildren<{ runtime: PluginRuntime }>) {
  const mountedCount = useRef(0);
  const shutdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedCount.current += 1;
    if (shutdownTimer.current !== null) {
      clearTimeout(shutdownTimer.current);
      shutdownTimer.current = null;
    }
    void runtime.start();
    return () => {
      mountedCount.current -= 1;
      if (mountedCount.current === 0) {
        shutdownTimer.current = setTimeout(() => {
          shutdownTimer.current = null;
          void runtime.disposeAll('react-unmount');
        }, 0);
      }
    };
  }, [runtime]);

  return <PluginRuntimeContext.Provider value={runtime}>{children}</PluginRuntimeContext.Provider>;
}

export function usePluginRuntime(): PluginRuntime {
  const runtime = useContext(PluginRuntimeContext);
  if (!runtime) throw new Error('usePluginRuntime must be used inside PluginSystemProvider.');
  return runtime;
}
