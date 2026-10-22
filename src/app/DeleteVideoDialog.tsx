import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import type { AppMessages } from '@/i18n';

export function DeleteVideoDialog({ fileName, messages, busy, error, onCancel, onConfirm }: {
  fileName: string;
  messages: AppMessages['playlist'];
  busy: boolean;
  error: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (busy) dialogRef.current?.focus();
    else cancelRef.current?.focus();
  }, [busy]);

  return createPortal(
    <dialog ref={dialogRef} tabIndex={-1} className='delete-video-dialog' aria-labelledby='delete-video-title'
      aria-describedby='delete-video-description' aria-busy={busy} data-player-control
      onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <Trash2 className='delete-video-symbol' size={28} aria-hidden='true' />
      <h3 id='delete-video-title'>{messages.deleteTitle}</h3>
      <p className='delete-video-filename' title={fileName}>{fileName}</p>
      <p id='delete-video-description'>{messages.deleteDescription}</p>
      {busy ? (
        <div role='status' aria-live='polite'>
          <p>{messages.deleting}</p>
          <div className='delete-video-progress' role='progressbar' aria-label={messages.deleting}>
            <span aria-hidden='true' />
          </div>
        </div>
      ) : (
        <>
          {error ? <p className='delete-video-error' role='alert'>{messages.deleteFailed}</p> : null}
          <div className='delete-video-actions'>
            <button ref={cancelRef} type='button' className='ghost-button' onClick={onCancel}>{messages.deleteCancel}</button>
            <button type='button' className='delete-video-confirm' onClick={onConfirm}>{messages.deleteConfirm}</button>
          </div>
        </>
      )}
    </dialog>, document.fullscreenElement ?? document.body,
  );
}
