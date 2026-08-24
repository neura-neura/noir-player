/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import { shouldHandlePlaybackSpace } from '@/player/core/playback-shortcuts';

function dispatchSpace(target: EventTarget, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('playback space shortcut target guard', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts a space key on the video surface', () => {
    const video = document.createElement('video');
    document.body.append(video);

    expect(shouldHandlePlaybackSpace(dispatchSpace(video))).toBe(true);
  });

  it('leaves editable and interactive controls to the browser', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(input, button, dialog);

    expect(shouldHandlePlaybackSpace(dispatchSpace(input))).toBe(false);
    expect(shouldHandlePlaybackSpace(dispatchSpace(button))).toBe(true);
    expect(shouldHandlePlaybackSpace(dispatchSpace(dialog))).toBe(true);
  });

  it('toggles playback even when a leftover Settings button still has focus', () => {
    const closeButton = document.createElement('button');
    closeButton.className = 'panel-close';
    closeButton.textContent = 'Cerrar';
    document.body.append(closeButton);
    closeButton.focus();

    expect(shouldHandlePlaybackSpace(dispatchSpace(closeButton))).toBe(true);
  });

  it('keeps Space for typing in search fields and contenteditable text', () => {
    const search = document.createElement('input');
    search.type = 'search';
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(search, editable);

    expect(shouldHandlePlaybackSpace(dispatchSpace(search))).toBe(false);
    expect(shouldHandlePlaybackSpace(dispatchSpace(editable))).toBe(false);
  });

  it('ignores modifiers and key repeats', () => {
    const video = document.createElement('video');
    document.body.append(video);

    expect(shouldHandlePlaybackSpace(dispatchSpace(video, { ctrlKey: true }))).toBe(false);
    expect(shouldHandlePlaybackSpace(dispatchSpace(video, { shiftKey: true }))).toBe(false);
    expect(shouldHandlePlaybackSpace(dispatchSpace(video, { repeat: true }))).toBe(false);
  });

  it('accepts legacy Spacebar key values', () => {
    const video = document.createElement('video');
    document.body.append(video);

    expect(
      shouldHandlePlaybackSpace(
        (() => {
          const event = new KeyboardEvent('keydown', {
            key: 'Spacebar',
            bubbles: true,
            cancelable: true,
          });
          video.dispatchEvent(event);
          return event;
        })(),
      ),
    ).toBe(true);
  });
});
