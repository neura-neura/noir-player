/**
 * Text-entry controls keep Space for typing. Buttons and other chrome do not.
 */
const SPACE_SHORTCUT_TYPING_SELECTOR = [
  'textarea',
  'select',
  'option',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

const SPACE_SHORTCUT_TYPING_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'url',
  'email',
  'password',
  'number',
  'tel',
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

function isElement(value: EventTarget | null): value is Element {
  return typeof Element !== 'undefined' && value instanceof Element;
}

function isTypingTarget(target: Element): boolean {
  const htmlTarget = target as HTMLElement;
  if (
    htmlTarget.isContentEditable ||
    htmlTarget.contentEditable === 'true' ||
    htmlTarget.contentEditable === 'plaintext-only'
  ) {
    return true;
  }

  if (target.closest(SPACE_SHORTCUT_TYPING_SELECTOR)) {
    return true;
  }

  const input = target.closest('input');
  if (!input) {
    return false;
  }

  const inputType = (input.getAttribute('type') ?? '').toLowerCase();
  return SPACE_SHORTCUT_TYPING_INPUT_TYPES.has(inputType);
}

/**
 * Returns whether a key event is eligible for the app-level playback shortcut.
 *
 * Space toggles playback regardless of which chrome currently has focus, so
 * closing Settings and leaving focus on Cerrar still pauses or resumes. The
 * only exception is actual text entry.
 */
export function shouldHandlePlaybackSpace(event: KeyboardEvent): boolean {
  const isSpaceKey =
    event.key === ' ' ||
    event.key === 'Spacebar' ||
    (event.key === '' && event.code === 'Space');
  if (!isSpaceKey) {
    return false;
  }

  if (
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  // Respect another capture listener that already claimed the key.
  if (event.defaultPrevented) {
    return false;
  }

  const target = isElement(event.target)
    ? event.target
    : typeof document !== 'undefined' && isElement(document.activeElement)
      ? document.activeElement
      : null;

  if (!target) {
    return true;
  }

  return !isTypingTarget(target);
}
