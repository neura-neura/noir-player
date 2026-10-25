import { useEffect, useId, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { AppMessages } from '@/i18n';

export function RenameVideoEditor({ fileName, messages, busy, error, onSave, onCancel }: {
  fileName: string;
  messages: AppMessages['playlist'];
  busy: boolean;
  error: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const dot = fileName.lastIndexOf('.');
  const [name, setName] = useState(dot > 0 ? fileName.slice(0, dot) : fileName);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form className='playlist-rename-editor' data-player-control aria-busy={busy}
      onSubmit={(event) => { event.preventDefault(); if (!busy) onSave(name); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !busy) { event.preventDefault(); onCancel(); }
      }}>
      <label htmlFor={id}>{messages.renameLabel}</label>
      <div className='playlist-rename-controls'>
        <input ref={inputRef} id={id} value={name} disabled={busy} autoComplete='off' spellCheck={false}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} aria-invalid={!!error}
          onChange={(event) => setName(event.target.value)} />
        <span className='playlist-rename-extension'>{dot > 0 ? fileName.slice(dot) : ''}</span>
        <button className='playlist-rename-button' type='submit' disabled={busy || !name.trim()}
          title={messages.renameSave} aria-label={messages.renameSave}><Check size={18} aria-hidden='true' /></button>
        <button className='playlist-rename-button' type='button' disabled={busy} onClick={onCancel}
          title={messages.deleteCancel} aria-label={messages.deleteCancel}><X size={18} aria-hidden='true' /></button>
      </div>
      <small id={`${id}-help`}>{messages.renameDescription}</small>
      {busy ? <small role='status'>{messages.renaming}</small> : null}
      {error ? <small id={`${id}-error`} className='delete-video-error' role='alert'>{error}</small> : null}
    </form>
  );
}
