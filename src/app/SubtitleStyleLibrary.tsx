import { useState } from 'react';
import type { AppLocale } from '@/i18n';
import {
  BUILTIN_SUBTITLE_STYLES, matchesSubtitleStyle, readSavedSubtitleStyles,
  STYLE_LIBRARY_KEY, type SavedSubtitleStyle, type SubtitleStyleSnapshot,
} from '@/lib/subtitle-styles';

const COPY = {
  es: {
    title: 'Estilos guardados', help: 'Guarda todos los ajustes actuales, incluida la fuente. Pulsa un estilo para aplicarlo.',
    builtin: 'Incluido', active: 'Aplicado', name: 'Nombre del estilo', save: 'Guardar como nuevo',
    rename: 'Renombrar', update: 'Guardar ajustes actuales', remove: 'Eliminar', cancel: 'Cancelar',
    confirm: 'Guardar nombre', error: 'No se pudieron guardar los estilos. El almacenamiento puede estar lleno.',
    applying: 'Aplicando…', saved: 'Estilo guardado.', renamed: 'Nombre guardado.', updated: 'Ajustes actualizados.', removed: 'Estilo eliminado.',
    outline: 'Contorno', outlineColor: 'Color del contorno',
  },
  en: {
    title: 'Saved styles', help: 'Save every current setting, including the font. Click a style to apply it.',
    builtin: 'Included', active: 'Applied', name: 'Style name', save: 'Save as new',
    rename: 'Rename', update: 'Save current settings', remove: 'Delete', cancel: 'Cancel',
    confirm: 'Save name', error: 'Could not save styles. Storage may be full.',
    applying: 'Applying…', saved: 'Style saved.', renamed: 'Name saved.', updated: 'Settings updated.', removed: 'Style deleted.',
    outline: 'Outline', outlineColor: 'Outline color',
  },
  zh: {
    title: '已保存的样式', help: '保存所有当前设置（包括字体）。点击样式即可应用。',
    builtin: '内置', active: '已应用', name: '样式名称', save: '另存为新样式',
    rename: '重命名', update: '保存当前设置', remove: '删除', cancel: '取消',
    confirm: '保存名称', error: '无法保存样式，存储空间可能已满。',
    applying: '正在应用…', saved: '样式已保存。', renamed: '名称已保存。', updated: '设置已更新。', removed: '样式已删除。',
    outline: '描边', outlineColor: '描边颜色',
  },
};

export function subtitleStyleCopy(locale: AppLocale) { return COPY[locale]; }

export function SubtitleStyleLibrary({ current, locale, onApply }: {
  current: SubtitleStyleSnapshot;
  locale: AppLocale;
  onApply: (snapshot: SubtitleStyleSnapshot) => Promise<void>;
}) {
  const copy = COPY[locale];
  const [saved, setSaved] = useState(() => readSavedSubtitleStyles(window.localStorage));
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [applying, setApplying] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  function persist(next: SavedSubtitleStyle[], message: string): boolean {
    try {
      window.localStorage.setItem(STYLE_LIBRARY_KEY, JSON.stringify(next));
      setSaved(next);
      setStatus(message);
      return true;
    } catch { setStatus(copy.error); return false; }
  }

  async function apply(entry: SavedSubtitleStyle) {
    setApplying(entry.id);
    setStatus('');
    try { await onApply(entry); }
    catch (error) { setStatus(error instanceof Error ? error.message : copy.error); }
    finally { setApplying(null); }
  }

  return (
    <section className='settings-section style-library' aria-label={copy.title}>
      <div className='section-heading'><h3>{copy.title}</h3></div>
      <p className='helper-text'>{copy.help}</p>
      <div className='saved-style-list'>
        {[...BUILTIN_SUBTITLE_STYLES, ...saved].map((entry, index) => {
          const builtin = index < BUILTIN_SUBTITLE_STYLES.length;
          const active = matchesSubtitleStyle(current, entry);
          return (
            <div className={`saved-style-row${active ? ' saved-style-row-active' : ''}`} key={entry.id}>
              <button type='button' className='saved-style-apply' aria-pressed={active}
                disabled={applying !== null} onClick={() => void apply(entry)}>
                <span className='saved-style-swatch' aria-hidden='true' style={{
                  fontFamily: entry.style.fontFamily, fontWeight: entry.style.fontWeight,
                  color: entry.style.textColor, background: entry.style.backgroundColor,
                  WebkitTextStroke: `${Math.min(entry.style.outlineWidth, 1)}px ${entry.style.outlineColor}`,
                  paintOrder: 'stroke fill',
                }}>Aa</span>
                <span><strong>{entry.name}</strong><small>{applying === entry.id ? copy.applying : active ? copy.active : builtin ? copy.builtin : entry.style.fontFamily.split(',')[0]}</small></span>
              </button>
              {!builtin && (
                <div className='saved-style-actions'>
                  {editing === entry.id ? (
                    <form onSubmit={(event) => {
                      event.preventDefault();
                      if (rename.trim() && persist(saved.map((item) => item.id === entry.id ? { ...item, name: rename.trim() } : item), copy.renamed)) setEditing(null);
                    }}>
                      <input autoFocus className='text-input' aria-label={copy.name} maxLength={80} value={rename} onChange={(event) => setRename(event.target.value)} />
                      <button className='mini-button' disabled={!rename.trim()}>{copy.confirm}</button>
                      <button type='button' className='mini-button' onClick={() => setEditing(null)}>{copy.cancel}</button>
                    </form>
                  ) : (
                    <>
                      <button type='button' className='mini-button' onClick={() => { setEditing(entry.id); setRename(entry.name); }}>{copy.rename}</button>
                      <button type='button' className='mini-button' disabled={active || applying !== null} onClick={() => persist(saved.map((item) => item.id === entry.id ? { ...item, style: { ...current.style }, fontStylesheetUrl: current.fontStylesheetUrl } : item), copy.updated)}>{copy.update}</button>
                      <button type='button' className='mini-button' onClick={() => { if (persist(saved.filter((item) => item.id !== entry.id), copy.removed)) setEditing(null); }}>{copy.remove}</button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <form className='saved-style-create' onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() && persist([...saved, { id: crypto.randomUUID(), name: name.trim(), style: { ...current.style }, fontStylesheetUrl: current.fontStylesheetUrl }], copy.saved)) setName('');
      }}>
        <label>{copy.name}<input className='text-input' maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <button className='ghost-button slim-button' disabled={!name.trim() || applying !== null}>{copy.save}</button>
      </form>
      <p className='helper-text' role='status'>{status}</p>
    </section>
  );
}
