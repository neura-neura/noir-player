import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Trash2 } from 'lucide-react';
import type { AppMessages } from '@/i18n';

export const DELETE_HOLD_DURATION_MS = 1000;

export function DeleteVideoButton({ fileName, messages, disabled, onRequest, onHold }: {
  fileName: string;
  messages: AppMessages['playlist'];
  disabled: boolean;
  onRequest: () => void;
  onHold: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const pointerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const onHoldRef = useRef(onHold);
  onHoldRef.current = onHold;

  function stopHold(cancelClick = false) {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
    if (pointerRef.current !== null && cancelClick) suppressClickRef.current = true;
    pointerRef.current = null;
    setHolding(false);
  }

  useEffect(() => {
    const cancel = () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      timerRef.current = undefined;
      if (pointerRef.current !== null) suppressClickRef.current = true;
      pointerRef.current = null;
      setHolding(false);
    };
    const onVisibilityChange = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!disabled) return;
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = undefined;
    pointerRef.current = null;
    setHolding(false);
  }, [disabled]);

  return (
    <button type='button' className={`playlist-delete-button${holding ? ' playlist-delete-holding' : ''}`}
      style={{ '--delete-hold-duration': `${DELETE_HOLD_DURATION_MS}ms` } as CSSProperties}
      title={`${messages.deleteVideo}. ${messages.deleteHoldHint}`}
      aria-label={`${messages.deleteVideo}: ${fileName}`} aria-description={messages.deleteHoldHint}
      disabled={disabled}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || !event.isPrimary || pointerRef.current !== null) return;
        suppressClickRef.current = false;
        pointerRef.current = event.pointerId;
        setHolding(true);
        timerRef.current = setTimeout(() => {
          timerRef.current = undefined;
          pointerRef.current = null;
          suppressClickRef.current = true;
          setHolding(false);
          onHoldRef.current();
        }, DELETE_HOLD_DURATION_MS);
      }}
      onPointerUp={(event) => { if (pointerRef.current === event.pointerId) stopHold(); }}
      onPointerLeave={() => stopHold(true)}
      onPointerCancel={() => stopHold(true)}
      onLostPointerCapture={() => stopHold(true)}
      onPointerMove={(event) => {
        if (pointerRef.current !== event.pointerId) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) stopHold(true);
      }}
      onBlur={() => stopHold(true)}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (disabled || (event.detail > 0 && suppressClickRef.current)) return;
        onRequest();
      }}>
      <span className='playlist-delete-fill' aria-hidden='true' />
      <Trash2 size={18} aria-hidden='true' />
    </button>
  );
}
