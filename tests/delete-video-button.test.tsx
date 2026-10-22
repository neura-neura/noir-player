/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteVideoButton } from '@/app/DeleteVideoButton';
import { MESSAGES } from '@/i18n';

function pointer(button: HTMLElement, type: string, properties: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true });
  Object.entries({ button: 0, pointerId: 1, isPrimary: true, ...properties }).forEach(([key, value]) => {
    Object.defineProperty(event, key, { value });
  });
  fireEvent(button, event);
}

function setup(disabled = false) {
  const onRequest = vi.fn();
  const onHold = vi.fn();
  const props = { fileName: 'movie.mkv', messages: MESSAGES.en.playlist, disabled, onRequest, onHold };
  const view = render(<DeleteVideoButton {...props} />);
  return { ...view, props, button: screen.getByRole('button'), onRequest, onHold };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('playlist delete button', () => {
  it('requests confirmation for an ordinary click', () => {
    const { button, onRequest, onHold } = setup();
    pointer(button, 'pointerdown');
    act(() => vi.advanceTimersByTime(200));
    pointer(button, 'pointerup');
    fireEvent.click(button, { detail: 1 });
    act(() => vi.advanceTimersByTime(1000));
    expect(onRequest).toHaveBeenCalledOnce();
    expect(onHold).not.toHaveBeenCalled();
    expect(button).not.toHaveClass('playlist-delete-holding');
  });

  it('deletes only after a full second and suppresses the trailing mouse click', () => {
    const { button, onRequest, onHold } = setup();
    pointer(button, 'pointerdown');
    expect(button).toHaveClass('playlist-delete-holding');
    act(() => vi.advanceTimersByTime(999));
    expect(onHold).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onHold).toHaveBeenCalledOnce();
    pointer(button, 'pointerup');
    fireEvent.click(button, { detail: 1 });
    act(() => vi.advanceTimersByTime(2000));
    expect(onHold).toHaveBeenCalledOnce();
    expect(onRequest).not.toHaveBeenCalled();
    // A subsequent ordinary click still requires confirmation.
    pointer(button, 'pointerdown');
    pointer(button, 'pointerup');
    fireEvent.click(button, { detail: 1 });
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it.each(['pointerout', 'pointercancel', 'lostpointercapture'])('cancels an interrupted hold (%s)', (event) => {
    const { button, onRequest, onHold } = setup();
    pointer(button, 'pointerdown');
    act(() => vi.advanceTimersByTime(600));
    pointer(button, event);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(button, { detail: 1 });
    expect(onHold).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();
    expect(button).not.toHaveClass('playlist-delete-holding');
  });

  it('cancels on window blur and permits keyboard activation afterward', () => {
    const { button, onRequest, onHold } = setup();
    pointer(button, 'pointerdown');
    act(() => vi.advanceTimersByTime(500));
    fireEvent(window, new Event('blur'));
    act(() => vi.advanceTimersByTime(1000));
    expect(onHold).not.toHaveBeenCalled();
    fireEvent.click(button, { detail: 0 });
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it('cancels when disabled or unmounted', () => {
    const view = setup();
    pointer(view.button, 'pointerdown');
    act(() => vi.advanceTimersByTime(500));
    view.rerender(<DeleteVideoButton {...view.props} disabled />);
    act(() => vi.advanceTimersByTime(1000));
    expect(view.onHold).not.toHaveBeenCalled();
    view.rerender(<DeleteVideoButton {...view.props} />);
    pointer(view.button, 'pointerdown');
    view.unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(view.onHold).not.toHaveBeenCalled();
  });

  it('ignores right clicks and secondary pointers', () => {
    const { button, onHold } = setup();
    pointer(button, 'pointerdown', { button: 2 });
    act(() => vi.advanceTimersByTime(1000));
    pointer(button, 'pointerdown', { isPrimary: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(onHold).not.toHaveBeenCalled();
  });
});
