/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SubtitleStyleLibrary } from '@/app/SubtitleStyleLibrary';
import { BUILTIN_SUBTITLE_STYLES, DEFAULT_STYLE, normalizeSubtitleStyle, readSavedSubtitleStyles, STYLE_LIBRARY_KEY } from '@/lib/subtitle-styles';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe('subtitle style library', () => {
  it('keeps the original first and the reference style second', () => {
    expect(BUILTIN_SUBTITLE_STYLES.map((entry) => entry.id)).toEqual(['noir-default', 'anime-classic']);
    expect(BUILTIN_SUBTITLE_STYLES[0].style).toEqual(DEFAULT_STYLE);
    expect(BUILTIN_SUBTITLE_STYLES[1].style).toMatchObject({ backgroundOpacity: 0, fontWeight: 700, outlineColor: '#000000', textColor: '#ffffff' });
  });

  it('loads older snapshots with new defaults and rejects broken storage entries', () => {
    expect(normalizeSubtitleStyle({ fontSize: 999, outlineWidth: -1, backgroundOpacity: 'bad', textColor: 'url(x)' }))
      .toMatchObject({ fontSize: 160, outlineWidth: 0, backgroundOpacity: DEFAULT_STYLE.backgroundOpacity, textColor: '#ffffff' });
    localStorage.setItem(STYLE_LIBRARY_KEY, JSON.stringify([
      null, { id: 'noir-default', name: 'Override', style: {}, fontStylesheetUrl: '' },
      { id: 'old', name: 'Older', style: { fontSize: 42 }, fontStylesheetUrl: '' },
      { id: 'old', name: 'Duplicate', style: {}, fontStylesheetUrl: '' },
    ]));
    expect(readSavedSubtitleStyles(localStorage)).toEqual([{ id: 'old', name: 'Older', style: { ...DEFAULT_STYLE, fontSize: 42 }, fontStylesheetUrl: '' }]);
    localStorage.setItem(STYLE_LIBRARY_KEY, '{broken');
    expect(readSavedSubtitleStyles(localStorage)).toEqual([]);
  });

  it('saves an independent complete snapshot, preserving its CSS font source across remounts', () => {
    const current = { style: { ...DEFAULT_STYLE, fontSize: 55, outlineWidth: 3 }, fontStylesheetUrl: 'https://cdn.jsdelivr.net/example/fonts.css' };
    const onApply = vi.fn().mockResolvedValue(undefined);
    const view = render(<SubtitleStyleLibrary current={current} locale='en' onApply={onApply} />);
    fireEvent.change(screen.getByLabelText('Style name'), { target: { value: 'Cinema' } });
    fireEvent.click(screen.getByText('Save as new'));
    current.style.fontSize = 24;
    view.unmount();
    render(<SubtitleStyleLibrary current={current} locale='en' onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /Cinema/ }));
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ style: { ...DEFAULT_STYLE, fontSize: 55, outlineWidth: 3 }, fontStylesheetUrl: current.fontStylesheetUrl }));
  });

  it('reports a storage failure without pretending the style was saved', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    render(<SubtitleStyleLibrary current={BUILTIN_SUBTITLE_STYLES[0]} locale='en' onApply={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Style name'), { target: { value: 'Cinema' } });
    fireEvent.click(screen.getByText('Save as new'));
    expect(screen.getByRole('status')).toHaveTextContent('Could not save styles');
    expect(screen.queryByRole('button', { name: /Cinema/ })).not.toBeInTheDocument();
  });
});
