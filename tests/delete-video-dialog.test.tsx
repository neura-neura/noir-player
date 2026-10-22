/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DeleteVideoDialog } from '@/app/DeleteVideoDialog';
import { MESSAGES, LOCALE_OPTIONS } from '@/i18n';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('video recycling confirmation', () => {
  it.each(LOCALE_OPTIONS)('localizes confirmation and passes the opt-out only when confirming (%s)', (locale) => {
    const messages = MESSAGES[locale].playlist;
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteVideoDialog fileName='movie.mkv' messages={messages} busy={false} error={false} onCancel={onCancel} onConfirm={onConfirm} />);
    expect(screen.getByRole('dialog', { name: messages.deleteTitle })).toBeVisible();
    expect(screen.getByRole('button', { name: messages.deleteCancel })).toHaveFocus();
    fireEvent.click(screen.getByRole('checkbox', { name: messages.deleteSkipConfirmation }));
    fireEvent.click(screen.getByRole('button', { name: messages.deleteCancel }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: messages.deleteConfirm }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('shows indeterminate progress and prevents dismissal while recycling', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteVideoDialog fileName='movie.mkv' messages={MESSAGES.en.playlist} busy error={false} onCancel={onCancel} onConfirm={onConfirm} />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('allows Escape to cancel, restores focus and shows localized failures for retry', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onCancel = vi.fn();
    const view = render(<DeleteVideoDialog fileName='movie.mkv' messages={MESSAGES.es.playlist} busy={false} error onCancel={onCancel} onConfirm={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGES.es.playlist.deleteFailed);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
