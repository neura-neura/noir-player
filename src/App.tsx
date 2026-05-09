import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import DOMPurify from 'dompurify';
import Hls from 'hls.js';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import {
  findActiveCueIndex,
  formatMillisecondsAsSeconds,
  loadSubtitleTrack,
  parseSubtitleText,
  SubtitleLoadError,
  type SubtitleTrack,
} from '@/lib/subtitles';
import {
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALE_OPTIONS,
  MESSAGES,
  type AppLocale,
  type AppMessages,
} from '@/i18n';

type VideoSource = {
  src: string;
  fileName: string;
  kind: 'object' | 'path' | 'hls';
  path?: string;
};

type PanelTab = 'load' | 'style';

type SubtitleStyle = {
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  bottomOffset: number;
  fontWeight: number;
  fontFamily: string;
  useCustomMaxWidth: boolean;
  maxWidth: number;
  paddingX: number;
  paddingY: number;
  borderRadius: number;
  lineHeight: number;
  letterSpacing: number;
  textShadow: boolean;
};

type OpenFilePayload = {
  path: string;
};

type TsStreamSource = {
  playlistUrl: string;
  durationSeconds: number;
};

type ToastState = {
  id: number;
  message: string;
};

type NativeSubtitleTrackOption = {
  id: string;
  index: number;
  label: string;
  detail: string;
  source: 'html-track' | 'media-stream';
};

type NativeAudioTrackOption = {
  id: string;
  index: number;
  order: number;
  label: string;
  detail: string;
  codec: string;
};

type BrowserAudioTrack = {
  enabled: boolean;
  id?: string;
  label?: string;
  language?: string;
};

type WebAudioRefs = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

const VIDEO_ACCEPT =
  'video/*,.mkv,.avi,.mov,.m4v,.webm,.ts,.m2ts,.wmv,.flv,.mp4';
const SUBTITLE_ACCEPT = '.srt,.vtt,.zip';
const VIDEO_EXTENSIONS = [
  'mp4',
  'mkv',
  'avi',
  'mov',
  'm4v',
  'webm',
  'ts',
  'm2ts',
  'wmv',
  'flv',
];
const SUBTITLE_EXTENSIONS = ['srt', 'vtt', 'zip'];
const APP_NAME = 'Noir Player';
const STYLE_STORAGE_KEY = 'noir-web-player:subtitle-style';
const STYLE_PRESET_VERSION_STORAGE_KEY =
  'noir-web-player:subtitle-style-preset-version';
const SYNC_STORAGE_KEY = 'noir-web-player:subtitle-sync';
const REMEMBER_SYNC_STORAGE_KEY = 'noir-web-player:remember-sync';
const PROMPT_SUBTITLES_STORAGE_KEY = 'noir-web-player:prompt-subtitles';
const AUTOPLAY_ON_OPEN_STORAGE_KEY = 'noir-web-player:autoplay-on-open';
const OPEN_PANEL_ON_OPEN_STORAGE_KEY = 'noir-web-player:open-panel-on-open';
const FULLSCREEN_ON_OPEN_STORAGE_KEY = 'noir-web-player:fullscreen-on-open';
const LANGUAGE_STORAGE_KEY = 'noir-web-player:language';
const FONT_STYLESHEET_STORAGE_KEY = 'noir-web-player:font-stylesheet-url';
const FONT_STYLESHEET_INPUT_STORAGE_KEY = 'noir-web-player:font-stylesheet-input';
const APP_ICON_URL = '/icon.png';
const MAX_SYNC_OFFSET_MS = 120_000;
const FONTS_PER_PAGE = 10;
const LEGACY_DEFAULT_FONT_STYLESHEET_URL =
  'https://cdn.jsdelivr.net/npm/gotham-pro-font@1.0.0/fonts.min.css';
const DEFAULT_FONT_STYLESHEET_URL = '/vendor/gotham-pro-font/fonts.min.css';
const FONT_STYLESHEET_LINK_ID = 'subtitle-font-stylesheet';
const TOAST_DURATION_MS = 3_600;
const INJECTED_SUBTITLE_TRACK_PREFIX = '__noir-player-track__';
const REJECTED_STYLUS_PRESET_VERSION = 'gotham-stylus-v1';
const CURRENT_STYLE_PRESET_VERSION = 'gotham-classic-v1';

const LEGACY_INTER_DEFAULT_FONT_FAMILY =
  "'Inter Variable', 'Inter', 'Segoe UI Variable Text', 'Segoe UI', sans-serif";
const DEFAULT_SUBTITLE_FONT_FAMILY = 'GothamPro, sans-serif';

const DEFAULT_STYLE: SubtitleStyle = {
  fontSize: 38,
  textColor: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0.23,
  bottomOffset: 4,
  fontWeight: 500,
  fontFamily: DEFAULT_SUBTITLE_FONT_FAMILY,
  useCustomMaxWidth: false,
  maxWidth: 78,
  paddingX: 12,
  paddingY: 8,
  borderRadius: 8,
  lineHeight: 1.18,
  letterSpacing: 0.2,
  textShadow: true,
};

function getBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isTransportStreamFileName(fileName: string): boolean {
  return ['ts', 'm2ts'].includes(getFileExtension(fileName));
}

function isCodecLikelyUnsupported(codec: string): boolean {
  const normalizedCodec = codec.trim().toLowerCase();
  return [
    'eac3',
    'ac3',
    'truehd',
    'mlp',
    'dts',
    'dca',
    'dtshd',
    'pcm_bluray',
  ].includes(normalizedCodec);
}

function hexToRgbTuple(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map((segment) => segment + segment)
          .join('')
      : hex;

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `${red} ${green} ${blue}`;
}

function restoreClassicDefaultStyle(
  style: SubtitleStyle,
  parsed: Partial<SubtitleStyle>,
): SubtitleStyle {
  const storedPresetVersion = window.localStorage.getItem(
    STYLE_PRESET_VERSION_STORAGE_KEY,
  );
  if (storedPresetVersion !== REJECTED_STYLUS_PRESET_VERSION) {
    return style;
  }

  const hasRejectedDefaultLayout =
    parsed.backgroundOpacity === 0 &&
    parsed.paddingX === 0 &&
    parsed.paddingY === 0 &&
    parsed.borderRadius === 0 &&
    parsed.lineHeight === 1.5 &&
    parsed.letterSpacing === 0;

  if (!hasRejectedDefaultLayout) {
    return style;
  }

  return {
    ...style,
    backgroundOpacity: DEFAULT_STYLE.backgroundOpacity,
    paddingX: DEFAULT_STYLE.paddingX,
    paddingY: DEFAULT_STYLE.paddingY,
    borderRadius: DEFAULT_STYLE.borderRadius,
    lineHeight: DEFAULT_STYLE.lineHeight,
    letterSpacing: DEFAULT_STYLE.letterSpacing,
  };
}

function readStoredStyle(): SubtitleStyle {
  try {
    const rawValue = window.localStorage.getItem(STYLE_STORAGE_KEY);
    if (!rawValue) {
      return DEFAULT_STYLE;
    }

    const parsed = JSON.parse(rawValue) as Partial<SubtitleStyle>;
    const nextStyle = {
      ...DEFAULT_STYLE,
      ...parsed,
    };
    if (nextStyle.fontFamily === LEGACY_INTER_DEFAULT_FONT_FAMILY) {
      nextStyle.fontFamily = DEFAULT_STYLE.fontFamily;
    }

    return restoreClassicDefaultStyle(nextStyle, parsed);
  } catch {
    return DEFAULT_STYLE;
  }
}

function readStoredSyncOffset(): number {
  try {
    if (!readStoredBoolean(REMEMBER_SYNC_STORAGE_KEY, false)) {
      return 0;
    }

    const rawValue = window.localStorage.getItem(SYNC_STORAGE_KEY);
    if (!rawValue) {
      return 0;
    }

    const parsedValue = Number(rawValue);
    return Number.isFinite(parsedValue) ? parsedValue : 0;
  } catch {
    return 0;
  }
}

function readStoredLocale(): AppLocale {
  try {
    const rawValue = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return rawValue && isAppLocale(rawValue) ? rawValue : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

function readStoredFontStylesheetUrl(): string {
  try {
    const storedValue = window.localStorage.getItem(FONT_STYLESHEET_STORAGE_KEY);
    if (storedValue === null) {
      return DEFAULT_FONT_STYLESHEET_URL;
    }

    return storedValue === LEGACY_DEFAULT_FONT_STYLESHEET_URL
      ? DEFAULT_FONT_STYLESHEET_URL
      : storedValue;
  } catch {
    return DEFAULT_FONT_STYLESHEET_URL;
  }
}

function readStoredFontStylesheetInput(): string {
  try {
    const storedValue = window.localStorage.getItem(
      FONT_STYLESHEET_INPUT_STORAGE_KEY,
    );
    if (storedValue === null) {
      return readStoredFontStylesheetUrl();
    }

    return storedValue === LEGACY_DEFAULT_FONT_STYLESHEET_URL
      ? DEFAULT_FONT_STYLESHEET_URL
      : storedValue;
  } catch {
    return readStoredFontStylesheetUrl();
  }
}

function readStoredBoolean(storageKey: string, fallbackValue: boolean): boolean {
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue === null) {
      return fallbackValue;
    }

    return storedValue === 'true';
  } catch {
    return fallbackValue;
  }
}

function transferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }

  if (dataTransfer.files.length > 0) {
    return true;
  }

  return Array.from(dataTransfer.items || []).some(
    (item) => item.kind === 'file',
  );
}

function getFirstTransferFile(dataTransfer: DataTransfer | null): File | null {
  if (!dataTransfer) {
    return null;
  }

  const directFile = dataTransfer.files.item(0);
  if (directFile) {
    return directFile;
  }

  for (const item of Array.from(dataTransfer.items || [])) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        return file;
      }
    }
  }

  return null;
}

function isVideoFileName(fileName: string): boolean {
  return /\.(mp4|mkv|avi|mov|m4v|webm|ts|m2ts|wmv|flv)$/i.test(fileName);
}

function isSubtitleFileName(fileName: string): boolean {
  return /\.(srt|vtt|zip)$/i.test(fileName);
}

function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function formatFontStack(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return DEFAULT_STYLE.fontFamily;
  }

  if (trimmed.includes(',')) {
    return trimmed;
  }

  const familyName = /[\s"]/u.test(trimmed)
    ? `"${trimmed.replace(/"/g, '\\"')}"`
    : trimmed;

  return `${familyName}, sans-serif`;
}

function getFontLabel(fontStack: string): string {
  const firstFamily = fontStack.split(',')[0]?.trim() || fontStack.trim();
  return firstFamily.replace(/^['"]|['"]$/g, '');
}

function sanitizeCueHtml(rawValue: string): string {
  return DOMPurify.sanitize(rawValue, {
    ALLOWED_TAGS: ['b', 'i', 'u', 'font', 'br'],
    ALLOWED_ATTR: ['color'],
  }).replace(/&gt;/g, '>');
}

function nativeCueToHtml(cue: TextTrackCue): string {
  const htmlCue = cue as TextTrackCue & {
    text?: string;
    getCueAsHTML?: () => DocumentFragment;
  };

  if (typeof htmlCue.getCueAsHTML === 'function') {
    const wrapper = document.createElement('div');
    wrapper.append(htmlCue.getCueAsHTML());
    return sanitizeCueHtml(wrapper.innerHTML);
  }

  const text = typeof htmlCue.text === 'string' ? htmlCue.text : '';
  return sanitizeCueHtml(text.replace(/\n/g, '<br />'));
}

function getEmbeddedTrackLabel(
  track: TextTrack,
  index: number,
  embeddedTitle: string,
): string {
  const baseLabel = track.label?.trim() || track.language?.trim();
  return baseLabel || `${embeddedTitle} ${index + 1}`;
}

function getEmbeddedTrackDetail(track: TextTrack): string {
  const details: string[] = [];

  if (track.language) {
    details.push(track.language.toUpperCase());
  }

  if (track.kind === 'captions') {
    details.push('CC');
  } else if (track.kind === 'subtitles') {
    details.push('SUB');
  }

  return details.join(' â€¢ ');
}

function extractFontFamilies(cssText: string): string[] {
  const families = new Set<string>();
  const matches = cssText.matchAll(/font-family\s*:\s*['"]?([^;'"}]+)['"]?/gi);

  for (const match of matches) {
    const family = match[1]?.trim();
    if (family) {
      families.add(family);
    }
  }

  return Array.from(families);
}

function normalizeNativeDropCoordinate(value: number): number {
  return value / (window.devicePixelRatio || 1);
}

function getPrecisionFromStep(step: number): number {
  const decimalPart = `${step}`.split('.')[1];
  return decimalPart ? decimalPart.length : 0;
}

function formatNumberForInput(value: number, step: number): string {
  const precision = getPrecisionFromStep(step);
  return precision > 0 ? value.toFixed(precision) : String(Math.round(value));
}

function formatSrtTimestamp(milliseconds: number): string {
  const safeValue = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(safeValue / 3_600_000);
  const minutes = Math.floor((safeValue % 3_600_000) / 60_000);
  const seconds = Math.floor((safeValue % 60_000) / 1000);
  const ms = safeValue % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatVttTimestamp(milliseconds: number): string {
  return formatSrtTimestamp(milliseconds).replace(',', '.');
}

function decodeHtmlEntities(rawValue: string): string {
  const parser = document.createElement('textarea');
  parser.innerHTML = rawValue;
  return parser.value;
}

function subtitleHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?font[^>]*>/gi, '')
      .replace(/&nbsp;/gi, ' '),
  ).trim();
}

function buildShiftedSubtitleText(track: SubtitleTrack, shiftMs: number): {
  fileName: string;
  mimeType: string;
  content: string;
} {
  const extension = track.fileName.split('.').pop()?.toLowerCase() || 'srt';
  const isVtt = extension === 'vtt';
  const nextFileName = track.fileName.replace(/\.(srt|vtt)$/i, isVtt ? '.vtt' : '.srt');

  const blocks = track.cues.map((cue, index) => {
    const startMs = Math.max(0, cue.startMs + shiftMs);
    const endMs = Math.max(startMs + 1, cue.endMs + shiftMs);
    const timestampFormatter = isVtt ? formatVttTimestamp : formatSrtTimestamp;
    const lines = [
      `${timestampFormatter(startMs)} --> ${timestampFormatter(endMs)}`,
      subtitleHtmlToText(cue.html),
    ];

    if (isVtt) {
      return lines.join('\n');
    }

    return `${index + 1}\n${lines.join('\n')}`;
  });

  return {
    fileName: nextFileName,
    mimeType: isVtt ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8',
    content: isVtt ? `WEBVTT\n\n${blocks.join('\n\n')}\n` : `${blocks.join('\n\n')}\n`,
  };
}

function getDropOverlayMessage(
  messages: AppMessages,
  fileName?: string,
): string {
  if (!fileName) {
    return messages.overlays.generic;
  }

  if (isSubtitleFileName(fileName)) {
    return messages.overlays.subtitle;
  }

  if (isVideoFileName(fileName)) {
    return messages.overlays.video;
  }

  return messages.overlays.generic;
}

function getSubtitleErrorMessage(
  error: unknown,
  messages: AppMessages,
): string {
  if (error instanceof SubtitleLoadError) {
    switch (error.code) {
      case 'invalid_timestamp':
        return messages.errors.invalidTimestamp(error.detail || '');
      case 'zip_missing':
        return messages.errors.zipMissing;
      case 'no_valid_cues':
        return messages.errors.noValidCues;
      default:
        return messages.notices.subtitleLoadFailed;
    }
  }

  return error instanceof Error ? error.message : messages.notices.subtitleLoadFailed;
}

type NumberFieldProps = {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onCommit: (nextValue: number) => void;
};

function NumberField({
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onCommit,
}: NumberFieldProps) {
  const [draftValue, setDraftValue] = useState(formatNumberForInput(value, step));

  useEffect(() => {
    setDraftValue(formatNumberForInput(value, step));
  }, [step, value]);

  function commitDraftValue() {
    const normalized = Number(draftValue.replace(',', '.'));
    if (!Number.isFinite(normalized)) {
      setDraftValue(formatNumberForInput(value, step));
      return;
    }

    const clampedValue = clamp(normalized, min, max);
    onCommit(clampedValue);
  }

  return (
    <label className='number-input-shell'>
      <input
        type='number'
        value={draftValue}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={commitDraftValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitDraftValue();
            (event.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      {unit ? <span>{unit}</span> : null}
    </label>
  );
}

function findPreviousCueIndex(track: SubtitleTrack | null, playbackMs: number): number {
  if (!track) {
    return -1;
  }

  let result = -1;
  for (let index = 0; index < track.cues.length; index += 1) {
    if (track.cues[index].startMs < playbackMs) {
      result = index;
      continue;
    }

    break;
  }

  return result;
}

function findNextCueIndex(track: SubtitleTrack | null, playbackMs: number): number {
  if (!track) {
    return -1;
  }

  for (let index = 0; index < track.cues.length; index += 1) {
    if (track.cues[index].startMs > playbackMs) {
      return index;
    }
  }

  return -1;
}

export default function App() {
  const [language, setLanguage] = useState<AppLocale>(readStoredLocale);
  const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
  const [subtitleTrack, setSubtitleTrack] = useState<SubtitleTrack | null>(
    null,
  );
  const [activeCueIndex, setActiveCueIndex] = useState(-1);
  const [videoAspectRatio, setVideoAspectRatio] = useState<number | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('load');
  const [pageDropActive, setPageDropActive] = useState(false);
  const [dropOverlayMessage, setDropOverlayMessage] = useState(
    getDropOverlayMessage(MESSAGES[readStoredLocale()], 'video.mp4'),
  );
  const [subtitleDropActive, setSubtitleDropActive] = useState(false);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [advancedControlsOpen, setAdvancedControlsOpen] = useState(false);
  const [rememberSyncOffset, setRememberSyncOffset] = useState(() =>
    readStoredBoolean(REMEMBER_SYNC_STORAGE_KEY, false),
  );
  const [promptForSubtitles, setPromptForSubtitles] = useState(() =>
    readStoredBoolean(PROMPT_SUBTITLES_STORAGE_KEY, true),
  );
  const [autoplayOnOpen, setAutoplayOnOpen] = useState(() =>
    readStoredBoolean(AUTOPLAY_ON_OPEN_STORAGE_KEY, false),
  );
  const [openPanelOnOpen, setOpenPanelOnOpen] = useState(() =>
    readStoredBoolean(OPEN_PANEL_ON_OPEN_STORAGE_KEY, true),
  );
  const [fullscreenOnOpen, setFullscreenOnOpen] = useState(() =>
    readStoredBoolean(FULLSCREEN_ON_OPEN_STORAGE_KEY, false),
  );
  const [dockHovering, setDockHovering] = useState(false);
  const [systemFontsLoading, setSystemFontsLoading] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontSearchQuery, setFontSearchQuery] = useState('');
  const [fontPage, setFontPage] = useState(0);
  const [remoteFontFamilies, setRemoteFontFamilies] = useState<string[]>([]);
  const [nativeSubtitleTracks, setNativeSubtitleTracks] = useState<
    NativeSubtitleTrackOption[]
  >([]);
  const [nativeAudioTracks, setNativeAudioTracks] = useState<
    NativeAudioTrackOption[]
  >([]);
  const [activeEmbeddedTrackId, setActiveEmbeddedTrackId] = useState<
    string | null
  >(null);
  const [activeAudioTrackId, setActiveAudioTrackId] = useState<string | null>(
    null,
  );
  const [externalAudioSource, setExternalAudioSource] = useState<string | null>(
    null,
  );
  const [fontStylesheetUrl, setFontStylesheetUrl] = useState(
    readStoredFontStylesheetUrl,
  );
  const [fontStylesheetInput, setFontStylesheetInput] = useState(
    readStoredFontStylesheetInput,
  );
  const [notice, setNotice] = useState(
    MESSAGES[readStoredLocale()].notices.welcome,
  );
  const [toast, setToast] = useState<ToastState | null>(null);
  const [subtitleStyle, setSubtitleStyle] =
    useState<SubtitleStyle>(readStoredStyle);
  const [syncOffsetMs, setSyncOffsetMs] = useState(readStoredSyncOffset);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const externalAudioRef = useRef<HTMLAudioElement | null>(null);
  const injectedSubtitleTrackRef = useRef<HTMLTrackElement | null>(null);
  const injectedSubtitleObjectUrlRef = useRef<string | null>(null);
  const autoPreparedAudioKeyRef = useRef<string | null>(null);
  const preparedAudioSourcesRef = useRef<Record<string, string>>({});
  const preparingAudioPromisesRef = useRef<Record<string, Promise<string | null>>>(
    {},
  );
  const subtitleDropZoneRef = useRef<HTMLDivElement | null>(null);
  const advancedSectionRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<Plyr | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const webAudioRef = useRef<WebAudioRefs | null>(null);
  const pageDragDepthRef = useRef(0);
  const heroDropDepthRef = useRef(0);
  const subtitleDropDepthRef = useRef(0);
  const messages = MESSAGES[language];
  const dockVisible = dockHovering || panelVisible;
  const shouldOpenPanelOnVideoReady = openPanelOnOpen || promptForSubtitles;

  const activeCue =
    subtitleTrack && activeCueIndex >= 0
      ? subtitleTrack.cues[activeCueIndex]
      : null;

  const remoteFontOptions = remoteFontFamilies.map((fontName) => ({
    label: `${fontName} (CSS)`,
    value: formatFontStack(fontName),
  }));

  const systemFontOptions = systemFonts.map((fontName) => ({
    label: fontName,
    value: formatFontStack(fontName),
  }));
  const filteredSystemFontOptions = systemFontOptions.filter((fontOption) =>
    fontOption.label.toLowerCase().includes(fontSearchQuery.trim().toLowerCase()),
  );
  const totalFontPages = Math.max(
    1,
    Math.ceil(filteredSystemFontOptions.length / FONTS_PER_PAGE),
  );
  const visibleSystemFontOptions = filteredSystemFontOptions.slice(
    fontPage * FONTS_PER_PAGE,
    (fontPage + 1) * FONTS_PER_PAGE,
  );

  const subtitleVariables = {
    '--subtitle-text-color': subtitleStyle.textColor,
    '--subtitle-bg-color': hexToRgbTuple(subtitleStyle.backgroundColor),
    '--subtitle-bg-opacity': String(subtitleStyle.backgroundOpacity),
    '--subtitle-font-size': `${subtitleStyle.fontSize}px`,
    '--subtitle-bottom': `${subtitleStyle.bottomOffset}%`,
    '--subtitle-font-weight': String(subtitleStyle.fontWeight),
    '--subtitle-font-family': subtitleStyle.fontFamily,
    '--subtitle-text-max-width': `${subtitleStyle.maxWidth}vw`,
    '--subtitle-padding-x': `${subtitleStyle.paddingX}px`,
    '--subtitle-padding-y': `${subtitleStyle.paddingY}px`,
    '--subtitle-radius': `${subtitleStyle.borderRadius}px`,
    '--subtitle-line-height': String(subtitleStyle.lineHeight),
    '--subtitle-letter-spacing': `${subtitleStyle.letterSpacing}px`,
    '--subtitle-shadow': subtitleStyle.textShadow
      ? 'rgb(0 0 0) 0 0 7px, rgb(0 0 0 / 0.8) 0 0 18px'
      : 'none',
  } as CSSProperties;
  const playerFrameStyle = videoAspectRatio
    ? ({ '--player-aspect-ratio': String(videoAspectRatio) } as CSSProperties)
    : undefined;

  function resetForNewVideo(nextVideo: VideoSource, nextNotice: string) {
    setVideoSource(nextVideo);
    setSubtitleTrack(null);
    setNativeSubtitleTracks([]);
    setNativeAudioTracks([]);
    setActiveEmbeddedTrackId(null);
    setActiveAudioTrackId(null);
    setExternalAudioSource(null);
    autoPreparedAudioKeyRef.current = null;
    preparedAudioSourcesRef.current = {};
    preparingAudioPromisesRef.current = {};
    setActiveCueIndex(-1);
    setVideoAspectRatio(null);
    setPanelTab('load');
    setPanelVisible(shouldOpenPanelOnVideoReady);
    setSubtitleDropActive(false);
    if (!rememberSyncOffset) {
      setSyncOffsetMs(0);
    }
    setNotice(nextNotice);
  }

  async function openVideoFromPath(path: string) {
    const fileName = getBaseName(path);

    try {
      let playbackPath = path;
      if (isTransportStreamFileName(fileName)) {
        setNotice(messages.notices.videoPreparing(fileName));
        const streamSource = await invoke<TsStreamSource>('prepare_ts_hls_stream', {
          path,
        });
        resetForNewVideo(
          {
            src: streamSource.playlistUrl,
            fileName,
            kind: 'hls',
            path,
          },
          messages.notices.videoDetected(fileName),
        );
        return;
      }

      resetForNewVideo(
        {
          src: convertFileSrc(playbackPath),
          fileName,
          kind: 'path',
          path,
        },
        messages.notices.videoDetected(fileName),
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : messages.notices.diskReadFailed(fileName),
      );
    }
  }

  function openVideoFromFile(file: File) {
    const nativePath = (file as File & { path?: string }).path;
    if (nativePath && isTransportStreamFileName(file.name)) {
      void openVideoFromPath(nativePath);
      return;
    }

    if (isTransportStreamFileName(file.name)) {
      setNotice(messages.notices.transportStreamNeedsPath(file.name));
      return;
    }

    resetForNewVideo(
      {
        src: URL.createObjectURL(file),
        fileName: file.name,
        kind: 'object',
      },
      messages.notices.videoLoaded(file.name),
    );
  }

  async function fileFromPath(path: string): Promise<File> {
    const response = await fetch(convertFileSrc(path));
    if (!response.ok) {
      throw new Error(messages.notices.diskReadFailed(getBaseName(path)));
    }

    const blob = await response.blob();
    return new File([blob], getBaseName(path), {
      type: blob.type || 'application/octet-stream',
    });
  }

  function isNativeDropInsideSubtitleZone(
    position: { x: number; y: number } | null | undefined,
  ): boolean {
    if (!position || !subtitleDropZoneRef.current) {
      return false;
    }

    const rect = subtitleDropZoneRef.current.getBoundingClientRect();
    const x = normalizeNativeDropCoordinate(position.x);
    const y = normalizeNativeDropCoordinate(position.y);

    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  async function openInspector() {
    try {
      await invoke('open_devtools');
      setNotice(
        messages.notices.inspectorOpened('.caption-text'),
      );
    } catch {
      setNotice(messages.notices.inspectorUnavailable);
    }
  }

  async function loadRemoteFontStylesheet(
    rawUrl: string,
    options?: {
      quiet?: boolean;
      selectFirstFamily?: boolean;
    },
  ) {
    const trimmedUrl = rawUrl.trim();
    const normalizedUrl =
      trimmedUrl === LEGACY_DEFAULT_FONT_STYLESHEET_URL
        ? DEFAULT_FONT_STYLESHEET_URL
        : trimmedUrl;
    const quiet = options?.quiet ?? false;
    const selectFirstFamily = options?.selectFirstFamily ?? true;

    if (!normalizedUrl) {
      const existingLink = document.getElementById(
        FONT_STYLESHEET_LINK_ID,
      ) as HTMLLinkElement | null;
      existingLink?.remove();
      setRemoteFontFamilies([]);
      setFontStylesheetUrl('');
      if (!quiet) {
        setNotice(messages.notices.cssFontRemoved);
      }
      return;
    }

    let cssText = '';
    try {
      const response = await fetch(normalizedUrl);
      if (!response.ok) {
        throw new Error();
      }
      cssText = await response.text();
    } catch {
      throw new Error(messages.notices.remoteFontLoadFailed);
    }

    const families = extractFontFamilies(cssText);
    let fontLink = document.getElementById(
      FONT_STYLESHEET_LINK_ID,
    ) as HTMLLinkElement | null;

    if (!fontLink) {
      fontLink = document.createElement('link');
      fontLink.id = FONT_STYLESHEET_LINK_ID;
      fontLink.rel = 'stylesheet';
      document.head.append(fontLink);
    }

    await new Promise<void>((resolve, reject) => {
      const nextLink = fontLink as HTMLLinkElement;
      const cleanup = () => {
        nextLink.removeEventListener('load', handleLoad);
        nextLink.removeEventListener('error', handleError);
      };
      const handleLoad = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error(messages.notices.remoteFontLoadFailed));
      };

      if (
        nextLink.dataset.loadedUrl === normalizedUrl &&
        nextLink.sheet
      ) {
        resolve();
        return;
      }

      nextLink.addEventListener('load', handleLoad);
      nextLink.addEventListener('error', handleError);
      nextLink.dataset.loadedUrl = normalizedUrl;
      nextLink.href = normalizedUrl;
    });

    setRemoteFontFamilies(families);
    setFontStylesheetUrl(normalizedUrl);
    setFontStylesheetInput(normalizedUrl);

    if (selectFirstFamily && families.length > 0) {
      setSubtitleStyle((currentStyle) => ({
        ...currentStyle,
        fontFamily: formatFontStack(families[0]),
      }));
    }

    if (!quiet) {
      setNotice(
        families.length > 0
          ? messages.notices.cssFontReady(families[0])
          : messages.notices.cssFontLoaded,
      );
    }
  }

  function disableActiveFontStylesheet(options?: { quiet?: boolean }) {
    const existingLink = document.getElementById(
      FONT_STYLESHEET_LINK_ID,
    ) as HTMLLinkElement | null;
    existingLink?.remove();
    setRemoteFontFamilies([]);
    setFontStylesheetUrl('');

    if (!options?.quiet) {
      setNotice(messages.notices.cssFontDisabled);
    }
  }

  function selectInstalledFont(fontStack: string) {
    disableActiveFontStylesheet({ quiet: true });
    setSubtitleStyle((currentStyle) => ({
      ...currentStyle,
      fontFamily: fontStack,
    }));
    setNotice(messages.notices.installedFontApplied(getFontLabel(fontStack)));
  }

  function selectCssFont(fontStack: string) {
    setSubtitleStyle((currentStyle) => ({
      ...currentStyle,
      fontFamily: fontStack,
    }));
    setNotice(messages.notices.cssFontApplied(getFontLabel(fontStack)));
  }

  function pushToast(message: string) {
    setToast({
      id: Date.now(),
      message,
    });
  }

  function disableEmbeddedTextTracks() {
    const videoElement = videoElementRef.current;
    if (!videoElement) {
      return;
    }

    for (let index = 0; index < videoElement.textTracks.length; index += 1) {
      const track = videoElement.textTracks[index];
      if (!track) {
        continue;
      }

      try {
        track.mode = 'disabled';
      } catch {
        continue;
      }
    }

    if (injectedSubtitleTrackRef.current) {
      injectedSubtitleTrackRef.current.remove();
      injectedSubtitleTrackRef.current = null;
    }

    if (injectedSubtitleObjectUrlRef.current) {
      URL.revokeObjectURL(injectedSubtitleObjectUrlRef.current);
      injectedSubtitleObjectUrlRef.current = null;
    }
  }

  function setVideoInternalAudioMuted(shouldMute: boolean) {
    const videoElement = videoElementRef.current;
    if (!videoElement) {
      return;
    }

    if (!webAudioRef.current) {
      if (!shouldMute) {
        return;
      }

      try {
        const AudioContextCtor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;

        if (!AudioContextCtor) {
          return;
        }

        const context = new AudioContextCtor();
        const source = context.createMediaElementSource(videoElement);
        const gain = context.createGain();
        source.connect(gain);
        gain.connect(context.destination);
        webAudioRef.current = {
          context,
          source,
          gain,
        };
      } catch {
        return;
      }
    }

    webAudioRef.current.gain.gain.value = shouldMute ? 0 : 1;
    if (webAudioRef.current.context.state === 'suspended') {
      void webAudioRef.current.context.resume().catch(() => {
        // Ignore resume failures caused by autoplay restrictions.
      });
    }
  }

  function refreshEmbeddedSubtitleTracks() {
    const videoElement = videoElementRef.current;
    if (!videoElement) {
      setNativeSubtitleTracks([]);
      return;
    }

    const nextTracks: NativeSubtitleTrackOption[] = [];
    for (let index = 0; index < videoElement.textTracks.length; index += 1) {
      const track = videoElement.textTracks[index];
      if (
        !track ||
        !['subtitles', 'captions'].includes(track.kind) ||
        track.label.startsWith(INJECTED_SUBTITLE_TRACK_PREFIX)
      ) {
        continue;
      }

      const label = getEmbeddedTrackLabel(track, index, messages.panel.embeddedTitle);
      nextTracks.push({
        id: `embedded-${index}-${track.language || 'und'}-${track.label || 'track'}`,
        index,
        label,
        detail: getEmbeddedTrackDetail(track),
        source: 'html-track',
      });
    }

    setNativeSubtitleTracks((currentTracks) => {
      const mediaTracks = currentTracks.filter(
        (trackOption) => trackOption.source === 'media-stream',
      );
      const mergedTracks = [...nextTracks];

      for (const trackOption of mediaTracks) {
        const alreadyPresent = mergedTracks.some(
          (existingTrack) =>
            existingTrack.source === 'media-stream' &&
            existingTrack.index === trackOption.index,
        );

        if (!alreadyPresent) {
          mergedTracks.push(trackOption);
        }
      }

      return mergedTracks;
    });
  }

  function getBrowserAudioTracks(): BrowserAudioTrack[] {
    const videoElement = videoElementRef.current as HTMLVideoElement & {
      audioTracks?: ArrayLike<BrowserAudioTrack>;
    };

    return videoElement?.audioTracks
      ? Array.from(videoElement.audioTracks)
      : [];
  }

  async function refreshAudioTracks(videoPath: string) {
    try {
      const detectedAudioTracks = await invoke<
        Array<{
          index: number;
          order: number;
          label: string;
          detail: string;
          codec: string;
        }>
      >('list_embedded_audio_streams', {
        path: videoPath,
      });
      const browserAudioTracks = getBrowserAudioTracks();
      const mappedTracks =
        detectedAudioTracks.length > 0
          ? detectedAudioTracks.map((trackOption, index) => {
              const browserTrack = browserAudioTracks[index];

              return {
                ...trackOption,
                order: index,
                id: `audio-stream-${trackOption.index}`,
                label: browserTrack?.label?.trim() || trackOption.label,
                detail:
                  [browserTrack?.language?.trim().toUpperCase(), trackOption.detail]
                    .filter(Boolean)
                    .join(' | ') || '',
              };
            })
          : browserAudioTracks.map((browserTrack, index) => ({
              id: `audio-stream-${index}`,
              index,
              order: index,
              label: browserTrack.label?.trim() || `Audio ${index + 1}`,
              detail: browserTrack.language?.trim().toUpperCase() || '',
              codec: '',
            }));

      setNativeAudioTracks(mappedTracks);
      setActiveAudioTrackId((currentTrackId) =>
        mappedTracks.some((trackOption) => trackOption.id === currentTrackId)
          ? currentTrackId
          : mappedTracks[0]?.id || null,
      );
    } catch {
      setNativeAudioTracks([]);
      setActiveAudioTrackId(null);
    }
  }

  async function refreshMediaSubtitleTracks(videoPath: string) {
    try {
      const mediaStreams = await invoke<
        Array<{ index: number; label: string; detail: string }>
      >('list_embedded_subtitle_streams', {
        path: videoPath,
      });

      setNativeSubtitleTracks((currentTracks) => {
        const htmlTracks = currentTracks.filter(
          (trackOption) => trackOption.source === 'html-track',
        );
        const ffmpegTracks = mediaStreams.map((trackOption) => ({
          ...trackOption,
          id: `media-stream-${trackOption.index}`,
          source: 'media-stream' as const,
        }));

        const mergedTracks = [...htmlTracks];
        for (const trackOption of ffmpegTracks) {
          const alreadyPresent = mergedTracks.some(
            (existingTrack) =>
              existingTrack.source === 'media-stream' &&
              existingTrack.index === trackOption.index,
          );

          if (!alreadyPresent) {
            mergedTracks.push(trackOption);
          }
        }

        return mergedTracks;
      });
    } catch {
      // If ffprobe is unavailable or the format is unsupported, keep any tracks we already found.
    }
  }

  async function waitForEmbeddedTrackCues(
    track: TextTrack,
  ): Promise<TextTrackCue[]> {
    const readCues = () => Array.from(track.cues || []);
    const initialCues = readCues();
    if (initialCues.length > 0) {
      return initialCues;
    }

    return new Promise((resolve) => {
      const intervalId = window.setInterval(() => {
        const cues = readCues();
        if (cues.length > 0) {
          window.clearInterval(intervalId);
          window.clearTimeout(timeoutId);
          resolve(cues);
        }
      }, 120);

      const timeoutId = window.setTimeout(() => {
        window.clearInterval(intervalId);
        resolve(readCues());
      }, 1800);
    });
  }

  async function mountInjectedSubtitleTrack(
    trackText: string,
    trackLabel: string,
  ): Promise<TextTrack | null> {
    const videoElement = videoElementRef.current;
    if (!videoElement) {
      return null;
    }

    disableEmbeddedTextTracks();

    const trackElement = document.createElement('track');
    trackElement.kind = 'subtitles';
    trackElement.label = `${INJECTED_SUBTITLE_TRACK_PREFIX}${trackLabel}`;
    trackElement.srclang = 'und';
    const trackBlobUrl = URL.createObjectURL(
      new Blob([trackText], { type: 'text/vtt;charset=utf-8' }),
    );
    injectedSubtitleObjectUrlRef.current = trackBlobUrl;
    trackElement.src = trackBlobUrl;

    return new Promise((resolve) => {
      let settled = false;
      let intervalId = 0;
      let timeoutId = 0;

      const finalize = (track: TextTrack | null) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        resolve(track);
      };

      const cleanup = () => {
        window.clearInterval(intervalId);
        window.clearTimeout(timeoutId);
        trackElement.removeEventListener('load', handleLoad);
        trackElement.removeEventListener('error', handleError);
      };

      const tryEnableTrack = () => {
        try {
          trackElement.track.mode = 'hidden';
          return true;
        } catch {
          return false;
        }
      };

      const inspectTrack = () => {
        const textTrack = trackElement.track;
        if (!textTrack) {
          return;
        }

        tryEnableTrack();

        if (trackElement.readyState === 2 || (textTrack.cues?.length || 0) > 0) {
          finalize(textTrack);
          return;
        }

        if (trackElement.readyState === 3) {
          finalize(null);
        }
      };

      const handleLoad = () => {
        inspectTrack();
      };

      const handleError = () => {
        finalize(null);
      };

      trackElement.addEventListener('load', handleLoad, { once: true });
      trackElement.addEventListener('error', handleError, { once: true });
      trackElement.default = true;
      videoElement.appendChild(trackElement);
      injectedSubtitleTrackRef.current = trackElement;

      intervalId = window.setInterval(inspectTrack, 120);
      timeoutId = window.setTimeout(() => {
        const textTrack = trackElement.track;
        finalize((textTrack?.cues?.length || 0) > 0 ? textTrack : null);
      }, 4_000);

      window.requestAnimationFrame(inspectTrack);
    });
  }

  async function selectEmbeddedSubtitleTrack(
    trackOption: NativeSubtitleTrackOption,
  ) {
    if (trackOption.source === 'media-stream') {
      if (!videoSource?.path) {
        setNotice(messages.notices.embeddedSubtitleMissing);
        return;
      }

      setNotice(messages.notices.embeddedSubtitleLoading(trackOption.label));

      try {
        const subtitleTrackText = await invoke<string>('extract_embedded_subtitle_stream', {
          path: videoSource.path,
          streamIndex: trackOption.index,
        });
        const cues = parseSubtitleText(subtitleTrackText);
        if (!cues.length) {
          setNotice(messages.notices.embeddedSubtitleMissing);
          return;
        }

        disableEmbeddedTextTracks();
        setSubtitleTrack({
          fileName: `${videoSource.fileName} - ${trackOption.label}.vtt`,
          cues,
          rawText: subtitleTrackText,
        });
        setActiveEmbeddedTrackId(trackOption.id);
        setActiveCueIndex(-1);
        setPanelTab('style');
        setPanelVisible(true);
        setNotice(messages.notices.embeddedSubtitleSelected(trackOption.label));
      } catch {
        setNotice(messages.notices.embeddedSubtitleMissing);
      }

      return;
    }

    const videoElement = videoElementRef.current;
    if (!videoElement) {
      return;
    }

    const embeddedTrack = videoElement.textTracks[trackOption.index];
    if (!embeddedTrack) {
      setNotice(messages.notices.embeddedSubtitleMissing);
      return;
    }

    disableEmbeddedTextTracks();
    setNotice(messages.notices.embeddedSubtitleLoading(trackOption.label));

    try {
      embeddedTrack.mode = 'hidden';
    } catch {
      setNotice(messages.notices.embeddedSubtitleMissing);
      return;
    }

    const cues = await waitForEmbeddedTrackCues(embeddedTrack);
    const mappedCues = cues
      .map((cue) => ({
        startMs: Math.round(cue.startTime * 1000),
        endMs: Math.round(cue.endTime * 1000),
        html: nativeCueToHtml(cue),
      }))
      .filter((cue) => cue.html && cue.endMs > cue.startMs);

    if (!mappedCues.length) {
      setNotice(messages.notices.embeddedSubtitleMissing);
      return;
    }

    setSubtitleTrack({
      fileName: `${videoSource?.fileName || 'video'} - ${trackOption.label}.vtt`,
      cues: mappedCues,
      rawText: '',
    });
    setActiveEmbeddedTrackId(trackOption.id);
    setActiveCueIndex(-1);
    setPanelTab('style');
    setPanelVisible(true);
    setNotice(messages.notices.embeddedSubtitleSelected(trackOption.label));
  }

  async function handleSubtitleSelection(fileList: FileList | File[]) {
    const [file] = Array.from(fileList);
    if (!file) {
      return;
    }

    setSubtitleLoading(true);
    setNotice(messages.notices.subtitleProcessing(file.name));

    try {
      const nextTrack = await loadSubtitleTrack(file);
      disableEmbeddedTextTracks();
      setSubtitleTrack(nextTrack);
      setActiveEmbeddedTrackId(null);
      setPanelTab('style');
      setPanelVisible(true);
      setNotice(messages.notices.subtitleLoaded(nextTrack.fileName));
    } catch (error) {
      setNotice(getSubtitleErrorMessage(error, messages));
    } finally {
      setSubtitleLoading(false);
    }
  }

  async function handleDroppedFile(file: File) {
    if (isVideoFileName(file.name)) {
      openVideoFromFile(file);
      return;
    }

    if (isSubtitleFileName(file.name)) {
      if (!videoSource) {
        setNotice(messages.notices.openVideoFirst);
        return;
      }

      await handleSubtitleSelection([file]);
      return;
    }

    setNotice(messages.notices.unsupportedFile);
  }

  async function handleDroppedPath(path: string) {
    try {
      if (isVideoFileName(path)) {
        await openVideoFromPath(path);
        return;
      }

      if (isSubtitleFileName(path)) {
        if (!videoSource) {
          setNotice(messages.notices.openVideoFirst);
          return;
        }

        const subtitleFile = await fileFromPath(path);
        await handleSubtitleSelection([subtitleFile]);
        return;
      }

      setNotice(messages.notices.unsupportedFile);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : messages.notices.diskReadFailed(getBaseName(path)),
      );
    }
  }

  function clearSubtitleTrack() {
    disableEmbeddedTextTracks();
    setSubtitleTrack(null);
    setActiveEmbeddedTrackId(null);
    setActiveCueIndex(-1);
    setPanelVisible(true);
    setPanelTab('load');
    setNotice(messages.notices.subtitleCleared);
  }

  async function prepareAudioTrack(
    trackOption: NativeAudioTrackOption,
    sourcePathOverride?: string,
  ): Promise<string | null> {
    const sourcePath = sourcePathOverride || videoSource?.path;
    if (!sourcePath) {
      return null;
    }

    const cachedSource = preparedAudioSourcesRef.current[trackOption.id];
    if (cachedSource) {
      return cachedSource;
    }

    const pendingSource = preparingAudioPromisesRef.current[trackOption.id];
    if (pendingSource) {
      return pendingSource;
    }

    const preparation = invoke<string>('extract_embedded_audio_stream', {
      path: sourcePath,
      streamIndex: trackOption.index,
    })
      .then((extractedAudioPath) => {
        const preparedSource = convertFileSrc(extractedAudioPath);
        preparedAudioSourcesRef.current[trackOption.id] = preparedSource;
        return preparedSource;
      })
      .catch(() => null)
      .finally(() => {
        delete preparingAudioPromisesRef.current[trackOption.id];
      });

    preparingAudioPromisesRef.current[trackOption.id] = preparation;
    return preparation;
  }

  async function selectAudioTrack(
    trackOption: NativeAudioTrackOption,
    sourcePathOverride?: string,
  ) {
    const browserAudioTracks = getBrowserAudioTracks();
    const sourcePath = sourcePathOverride || videoSource?.path;

    if (browserAudioTracks.length > 0) {
      for (let index = 0; index < browserAudioTracks.length; index += 1) {
        browserAudioTracks[index].enabled = index === trackOption.order;
      }
    }

    if (!sourcePath) {
      setActiveAudioTrackId(trackOption.id);
      return;
    }

    try {
      const preparedSource = await prepareAudioTrack(trackOption, sourcePath);
      if (!preparedSource) {
        throw new Error('Audio track could not be prepared.');
      }

      const videoElement = videoElementRef.current;
      const externalAudioElement = externalAudioRef.current;
      if (videoElement && externalAudioElement) {
        setVideoInternalAudioMuted(true);
        externalAudioElement.pause();
        externalAudioElement.src = preparedSource;
        externalAudioElement.preload = 'auto';
        externalAudioElement.currentTime = videoElement.currentTime;
        externalAudioElement.playbackRate = videoElement.playbackRate;
        externalAudioElement.volume = videoElement.volume;
        externalAudioElement.muted = videoElement.muted;
        externalAudioElement.autoplay = !videoElement.paused;
        externalAudioElement.load();
        if (!videoElement.paused) {
          void externalAudioElement.play().catch(() => {
            // The synchronization effect will retry after metadata is ready.
          });
        }
      }

      setExternalAudioSource(preparedSource);
      setActiveAudioTrackId(trackOption.id);
    } catch {
      setExternalAudioSource(null);
      setActiveAudioTrackId(trackOption.id);
    }
  }

  async function triggerVideoPicker() {
    try {
      const selectedPath = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Video',
            extensions: VIDEO_EXTENSIONS,
          },
        ],
      });

      if (typeof selectedPath === 'string') {
        await openVideoFromPath(selectedPath);
        return;
      }
    } catch {
      // Fall back to the browser file input below.
    }

    if (!videoInputRef.current) {
      return;
    }

    videoInputRef.current.value = '';
    videoInputRef.current.click();
  }

  async function triggerSubtitlePicker() {
    try {
      const selectedPath = await openDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Subtitle',
            extensions: SUBTITLE_EXTENSIONS,
          },
        ],
      });

      if (typeof selectedPath === 'string') {
        await handleDroppedPath(selectedPath);
        return;
      }
    } catch {
      // Fall back to the browser file input below.
    }

    if (!subtitleInputRef.current) {
      return;
    }

    subtitleInputRef.current.value = '';
    subtitleInputRef.current.click();
  }

  function updateSubtitleCue() {
    const video = videoElementRef.current;
    if (!video || !subtitleTrack) {
      setActiveCueIndex(-1);
      return;
    }

    const playbackMs = video.currentTime * 1000 - syncOffsetMs;
    const nextCueIndex = findActiveCueIndex(subtitleTrack.cues, playbackMs);
    setActiveCueIndex((currentCueIndex) =>
      currentCueIndex === nextCueIndex ? currentCueIndex : nextCueIndex,
    );
  }

  function updateSyncOffset(nextValue: number) {
    setSyncOffsetMs(clamp(nextValue, -MAX_SYNC_OFFSET_MS, MAX_SYNC_OFFSET_MS));
  }

  function shiftSyncOffset(deltaMs: number) {
    updateSyncOffset(syncOffsetMs + deltaMs);
  }

  function syncRelativeCueToCurrentTime(direction: 'prev' | 'next') {
    const video = videoElementRef.current;
    if (!video || !subtitleTrack) {
      return;
    }

    const currentPlaybackMs = video.currentTime * 1000;
    const referencePlaybackMs = currentPlaybackMs - syncOffsetMs;
    const currentCueIndex = findActiveCueIndex(
      subtitleTrack.cues,
      referencePlaybackMs,
    );
    let targetCueIndex =
      direction === 'prev'
        ? findPreviousCueIndex(subtitleTrack, referencePlaybackMs)
        : findNextCueIndex(subtitleTrack, referencePlaybackMs);

    if (direction === 'prev' && currentCueIndex > 0) {
      targetCueIndex = currentCueIndex - 1;
    }

    if (
      direction === 'next' &&
      currentCueIndex >= 0 &&
      currentCueIndex < subtitleTrack.cues.length - 1
    ) {
      targetCueIndex = currentCueIndex + 1;
    }

    if (targetCueIndex < 0) {
      setNotice(
        direction === 'prev'
          ? messages.notices.noPreviousCue
          : messages.notices.noNextCue,
      );
      return;
    }

    const targetCue = subtitleTrack.cues[targetCueIndex];
    updateSyncOffset(currentPlaybackMs - targetCue.startMs);
    setNotice(
      direction === 'prev'
        ? messages.notices.previousCueAligned
        : messages.notices.nextCueAligned,
    );
  }

  async function downloadCurrentSubtitle() {
    if (!subtitleTrack) {
      return;
    }

    const shiftedTrack = buildShiftedSubtitleText(subtitleTrack, syncOffsetMs);
    try {
      const savedPath = await invoke<string>('save_subtitle_to_downloads', {
        fileName: shiftedTrack.fileName,
        content: shiftedTrack.content,
      });
      setNotice(
        messages.notices.exportSaved(
          formatMillisecondsAsSeconds(syncOffsetMs),
          savedPath,
        ),
      );
      pushToast(messages.toasts.subtitleSaved(savedPath));
    } catch {
      const blob = new Blob([shiftedTrack.content], {
        type: shiftedTrack.mimeType,
      });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = shiftedTrack.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setNotice(
        messages.notices.exportReady(
          formatMillisecondsAsSeconds(syncOffsetMs),
        ),
      );
      pushToast(messages.toasts.subtitleSavedFallback);
    }
  }

  function openAdvancedControls() {
    setPanelVisible(true);
    setPanelTab('style');
    setAdvancedControlsOpen(true);
    window.requestAnimationFrame(() => {
      advancedSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function handlePageDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    pageDragDepthRef.current = 0;
    heroDropDepthRef.current = 0;
    setPageDropActive(false);
    setDropOverlayMessage(getDropOverlayMessage(messages, 'video.mp4'));

    const file = getFirstTransferFile(event.dataTransfer);
    if (file) {
      if (isDesktopApp() && isVideoFileName(file.name)) {
        return;
      }

      void handleDroppedFile(file);
    }
  }

  function handleSubtitleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    subtitleDropDepthRef.current = 0;
    setSubtitleDropActive(false);
    setDropOverlayMessage(getDropOverlayMessage(messages, 'video.mp4'));
    const file = getFirstTransferFile(event.dataTransfer);
    if (file) {
      void handleDroppedFile(file);
    }
  }

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      playerRef.current?.destroy();
      playerRef.current = null;
      if (webAudioRef.current) {
        webAudioRef.current.gain.gain.value = 1;
        void webAudioRef.current.context.close().catch(() => {
          // Ignore shutdown errors.
        });
        webAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (videoSource?.kind === 'object') {
        URL.revokeObjectURL(videoSource.src);
      }
    };
  }, [videoSource]);

  useEffect(() => {
    const videoElement = videoElementRef.current;
    const externalAudioElement = externalAudioRef.current;

    if (!videoElement || !externalAudioElement) {
      return;
    }

    if (!externalAudioSource) {
      externalAudioElement.pause();
      externalAudioElement.removeAttribute('src');
      externalAudioElement.load();
      setVideoInternalAudioMuted(false);
      return;
    }

    setVideoInternalAudioMuted(true);
    externalAudioElement.pause();
    externalAudioElement.src = externalAudioSource;
    externalAudioElement.preload = 'auto';
    externalAudioElement.load();

    const syncTime = () => {
      if (externalAudioElement.readyState < HTMLMediaElement.HAVE_METADATA) {
        return;
      }

      if (Math.abs(externalAudioElement.currentTime - videoElement.currentTime) > 0.25) {
        externalAudioElement.currentTime = videoElement.currentTime;
      }
    };

    const syncPlaybackState = () => {
      externalAudioElement.playbackRate = videoElement.playbackRate;
      externalAudioElement.volume = videoElement.volume;
      externalAudioElement.muted = videoElement.muted;
    };

    const handlePlay = () => {
      syncTime();
      syncPlaybackState();
      void externalAudioElement.play().catch(() => {
        // Autoplay rules may block audio until a direct interaction.
      });
    };

    const handlePause = () => {
      externalAudioElement.pause();
    };

    const handleSeek = () => {
      syncTime();
      if (!videoElement.paused) {
        void externalAudioElement.play().catch(() => {
          // Ignore autoplay related failures.
        });
      }
    };

    const handleRateChange = () => {
      syncPlaybackState();
    };

    const handleVolumeChange = () => {
      syncPlaybackState();
    };

    const handleLoadedMetadata = () => {
      syncTime();
      syncPlaybackState();
      if (!videoElement.paused) {
        void externalAudioElement.play().catch(() => {
          // Ignore autoplay related failures.
        });
      }
    };

    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('seeking', handleSeek);
    videoElement.addEventListener('seeked', handleSeek);
    videoElement.addEventListener('timeupdate', syncTime);
    videoElement.addEventListener('ratechange', handleRateChange);
    videoElement.addEventListener('volumechange', handleVolumeChange);
    externalAudioElement.addEventListener('loadedmetadata', handleLoadedMetadata);

    if (externalAudioElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
      handleLoadedMetadata();
    }

    return () => {
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('seeking', handleSeek);
      videoElement.removeEventListener('seeked', handleSeek);
      videoElement.removeEventListener('timeupdate', syncTime);
      videoElement.removeEventListener('ratechange', handleRateChange);
      videoElement.removeEventListener('volumechange', handleVolumeChange);
      externalAudioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [externalAudioSource, videoSource?.src]);

  useEffect(() => {
    window.localStorage.setItem(
      STYLE_STORAGE_KEY,
      JSON.stringify(subtitleStyle),
    );
    window.localStorage.setItem(
      STYLE_PRESET_VERSION_STORAGE_KEY,
      CURRENT_STYLE_PRESET_VERSION,
    );
  }, [subtitleStyle]);

  useEffect(() => {
    if (!rememberSyncOffset) {
      window.localStorage.removeItem(SYNC_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(SYNC_STORAGE_KEY, String(syncOffsetMs));
  }, [rememberSyncOffset, syncOffsetMs]);

  useEffect(() => {
    window.localStorage.setItem(
      REMEMBER_SYNC_STORAGE_KEY,
      String(rememberSyncOffset),
    );
  }, [rememberSyncOffset]);

  useEffect(() => {
    window.localStorage.setItem(
      PROMPT_SUBTITLES_STORAGE_KEY,
      String(promptForSubtitles),
    );
  }, [promptForSubtitles]);

  useEffect(() => {
    window.localStorage.setItem(
      AUTOPLAY_ON_OPEN_STORAGE_KEY,
      String(autoplayOnOpen),
    );
  }, [autoplayOnOpen]);

  useEffect(() => {
    window.localStorage.setItem(
      OPEN_PANEL_ON_OPEN_STORAGE_KEY,
      String(openPanelOnOpen),
    );
  }, [openPanelOnOpen]);

  useEffect(() => {
    window.localStorage.setItem(
      FULLSCREEN_ON_OPEN_STORAGE_KEY,
      String(fullscreenOnOpen),
    );
  }, [fullscreenOnOpen]);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.title = APP_NAME;
    if (!pageDropActive && !subtitleDropActive) {
      setDropOverlayMessage(getDropOverlayMessage(messages, 'video.mp4'));
    }
  }, [language, messages, pageDropActive, subtitleDropActive]);

  useEffect(() => {
    window.localStorage.setItem(FONT_STYLESHEET_STORAGE_KEY, fontStylesheetUrl);
  }, [fontStylesheetUrl]);

  useEffect(() => {
    window.localStorage.setItem(
      FONT_STYLESHEET_INPUT_STORAGE_KEY,
      fontStylesheetInput,
    );
  }, [fontStylesheetInput]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((currentToast) =>
        currentToast?.id === toast.id ? null : currentToast,
      );
    }, TOAST_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast]);

  useEffect(() => {
    if (panelTab !== 'style' || systemFonts.length > 0) {
      return;
    }

    let active = true;
    setSystemFontsLoading(true);

    async function loadSystemFonts() {
      try {
        const fonts = await invoke<string[]>('list_system_fonts');
        if (active) {
          setSystemFonts(fonts);
        }
      } catch {
        // Browser preview is fine without native font discovery.
      } finally {
        if (active) {
          setSystemFontsLoading(false);
        }
      }
    }

    void loadSystemFonts();

    return () => {
      active = false;
    };
  }, [panelTab, systemFonts.length]);

  useEffect(() => {
    setFontPage(0);
  }, [fontSearchQuery]);

  useEffect(() => {
    if (fontPage < totalFontPages) {
      return;
    }

    setFontPage(Math.max(0, totalFontPages - 1));
  }, [fontPage, totalFontPages]);

  useEffect(() => {
    if (!videoSource) {
      return;
    }

    refreshEmbeddedSubtitleTracks();
    if (videoSource.path) {
      void refreshMediaSubtitleTracks(videoSource.path);
      if (videoSource.kind !== 'hls') {
        void refreshAudioTracks(videoSource.path);
      }
    }
  }, [language, videoSource]);

  useEffect(() => {
    if (
      !videoSource?.path ||
      videoSource.kind === 'hls' ||
      nativeAudioTracks.length === 0 ||
      externalAudioSource
    ) {
      return;
    }

    const browserAudioTracks = getBrowserAudioTracks();
    const firstTrack = nativeAudioTracks[0];
    const shouldPrepareFallback =
      browserAudioTracks.length === 0 || isCodecLikelyUnsupported(firstTrack.codec);

    if (!shouldPrepareFallback) {
      return;
    }

    const fallbackKey = `${videoSource.path}:${firstTrack.id}`;
    if (autoPreparedAudioKeyRef.current === fallbackKey) {
      return;
    }

    autoPreparedAudioKeyRef.current = fallbackKey;
    void selectAudioTrack(firstTrack, videoSource.path);
  }, [externalAudioSource, nativeAudioTracks, videoSource]);

  useEffect(() => {
    if (
      !videoSource?.path ||
      videoSource.kind === 'hls' ||
      nativeAudioTracks.length === 0
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (const trackOption of nativeAudioTracks) {
        if (cancelled) {
          return;
        }

        await prepareAudioTrack(trackOption, videoSource.path);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nativeAudioTracks, videoSource]);

  useEffect(() => {
    if (!fontStylesheetUrl) {
      return;
    }

    void loadRemoteFontStylesheet(fontStylesheetUrl, {
      quiet: true,
      selectFirstFamily: false,
    }).catch(() => {
      // Ignore startup font load failures and keep local fallbacks.
    });
  }, []);

  useEffect(() => {
    let unlistenPromise: Promise<UnlistenFn> | undefined;
    let active = true;

    async function wireTauriFileOpening() {
      try {
        const initialPath = await invoke<string | null>('get_launch_video');
        if (active && initialPath) {
          void openVideoFromPath(initialPath);
        }
      } catch {
        // Browser preview is fine without the desktop bridge.
      }

      try {
        unlistenPromise = listen<OpenFilePayload>('open-file', (event) => {
          void openVideoFromPath(event.payload.path);
        });
      } catch {
        // Ignore when running in a plain browser.
      }
    }

    void wireTauriFileOpening();

    return () => {
      active = false;
      void unlistenPromise?.then((unlisten) => unlisten());
    };
  }, [messages, rememberSyncOffset, shouldOpenPanelOnVideoReady]);

  useEffect(() => {
    let unlistenNativeDrop: UnlistenFn | undefined;

    async function wireNativeDrop() {
      try {
        unlistenNativeDrop = await getCurrentWebview().onDragDropEvent(
          (event) => {
            const { payload } = event;

            if (payload.type === 'enter' || payload.type === 'over') {
              if ('paths' in payload && payload.paths[0]) {
                setDropOverlayMessage(
                  getDropOverlayMessage(messages, payload.paths[0]),
                );
              }
              setPageDropActive(true);
              setSubtitleDropActive(
                'position' in payload &&
                  isNativeDropInsideSubtitleZone(payload.position),
              );
              return;
            }

            if (payload.type === 'leave') {
              setPageDropActive(false);
              setSubtitleDropActive(false);
              setDropOverlayMessage(getDropOverlayMessage(messages, 'video.mp4'));
              return;
            }

            setPageDropActive(false);
            setSubtitleDropActive(false);
            setDropOverlayMessage(getDropOverlayMessage(messages, 'video.mp4'));
            const [path] = payload.paths;
            if (path) {
              void handleDroppedPath(path);
            }
          },
        );
      } catch {
        // Plain browser previews do not have a native Tauri webview.
      }
    }

    void wireNativeDrop();

    return () => {
      void unlistenNativeDrop?.();
    };
  }, [messages, videoSource, subtitleTrack, syncOffsetMs]);

  useEffect(() => {
    function handleInspectorShortcut(event: KeyboardEvent) {
      const isInspectorShortcut =
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'i';

      if (!isInspectorShortcut) {
        return;
      }

      event.preventDefault();
      void openInspector();
    }

    window.addEventListener('keydown', handleInspectorShortcut);
    return () => {
      window.removeEventListener('keydown', handleInspectorShortcut);
    };
  }, [messages]);

  useEffect(() => {
    const videoElement = videoElementRef.current;
    if (!videoElement || !videoSource) {
      return;
    }

    playerRef.current?.destroy();
    playerRef.current = new Plyr(videoElement, {
      controls: [
        'play-large',
        'play',
        'progress',
        'current-time',
        'duration',
        'mute',
        'volume',
        'fullscreen',
      ],
      settings: [],
      keyboard: {
        focused: true,
        global: true,
      },
      fullscreen: {
        enabled: true,
        fallback: true,
        iosNative: false,
        container: '.player-frame',
      },
    });

    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoSource?.src]);

  useEffect(() => {
    const videoElement = videoElementRef.current;
    if (!videoElement || !videoSource) {
      return;
    }

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (videoSource.kind !== 'hls') {
      return;
    }

    videoElement.removeAttribute('src');
    videoElement.load();

    if (Hls.isSupported()) {
      const hls = new Hls({
        backBufferLength: 20,
        maxBufferLength: 40,
        maxMaxBufferLength: 70,
        startFragPrefetch: true,
      });
      hlsRef.current = hls;
      hls.attachMedia(videoElement);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(videoSource.src);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }

        setNotice(messages.notices.hlsPlaybackFailed);
      });

      return () => {
        hls.destroy();
        if (hlsRef.current === hls) {
          hlsRef.current = null;
        }
      };
    }

    if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = videoSource.src;
      videoElement.load();
      return;
    }

    setNotice(messages.notices.hlsPlaybackFailed);
  }, [messages, videoSource]);

  useEffect(() => {
    const videoElement = videoElementRef.current;
    if (!videoElement) {
      return;
    }

    let animationFrame = 0;
    const retryTimers: number[] = [];

    const tick = () => {
      updateSubtitleCue();
      if (!videoElement.paused && !videoElement.ended) {
        animationFrame = window.requestAnimationFrame(tick);
      }
    };

    const startLoop = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      window.cancelAnimationFrame(animationFrame);
      updateSubtitleCue();
    };

    const handleLoadedMetadata = () => {
      if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        setVideoAspectRatio(videoElement.videoWidth / videoElement.videoHeight);
      }

      setPanelVisible(shouldOpenPanelOnVideoReady);
      setPanelTab('load');
      refreshEmbeddedSubtitleTracks();
      if (videoSource?.path) {
        void refreshMediaSubtitleTracks(videoSource.path);
        if (videoSource.kind !== 'hls') {
          void refreshAudioTracks(videoSource.path);
        }
      }
      retryTimers.push(
        window.setTimeout(refreshEmbeddedSubtitleTracks, 180),
        window.setTimeout(refreshEmbeddedSubtitleTracks, 750),
      );
      setNotice((currentNotice) => {
        if (!videoSource) {
          return currentNotice;
        }

        return promptForSubtitles
          ? messages.notices.videoReadyPrompt(videoSource.fileName)
          : autoplayOnOpen
            ? messages.notices.videoReadyPlaying(videoSource.fileName)
            : messages.notices.videoReadyPaused(videoSource.fileName);
      });

      if (autoplayOnOpen) {
        void videoElement.play().catch(() => {
          // Some devices may still require an explicit play interaction.
        });
      } else {
        videoElement.pause();
      }

      if (fullscreenOnOpen) {
        window.setTimeout(() => {
          try {
            playerRef.current?.fullscreen.enter();
          } catch {
            // Fullscreen may still require user interaction in some environments.
          }
        }, 60);
      }

      updateSubtitleCue();
    };

    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoElement.addEventListener('play', startLoop);
    videoElement.addEventListener('pause', stopLoop);
    videoElement.addEventListener('seeked', updateSubtitleCue);
    videoElement.addEventListener('timeupdate', updateSubtitleCue);

    updateSubtitleCue();
    if (!videoElement.paused) {
      startLoop();
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      retryTimers.forEach((timerId) => window.clearTimeout(timerId));
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.removeEventListener('play', startLoop);
      videoElement.removeEventListener('pause', stopLoop);
      videoElement.removeEventListener('seeked', updateSubtitleCue);
      videoElement.removeEventListener('timeupdate', updateSubtitleCue);
    };
  }, [
    autoplayOnOpen,
    fullscreenOnOpen,
    messages,
    promptForSubtitles,
    shouldOpenPanelOnVideoReady,
    subtitleTrack,
    syncOffsetMs,
    videoSource,
  ]);

  return (
    <div
      className={`app-shell ${pageDropActive ? 'page-drop-active' : ''}`}
      data-drop-message={dropOverlayMessage}
      onDragEnter={(event) => {
        if (!transferHasFiles(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        setDropOverlayMessage(
          getDropOverlayMessage(
            messages,
            getFirstTransferFile(event.dataTransfer)?.name,
          ),
        );
        pageDragDepthRef.current += 1;
        setPageDropActive(true);
      }}
      onDragLeave={(event) => {
        if (!transferHasFiles(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        pageDragDepthRef.current = Math.max(0, pageDragDepthRef.current - 1);
        if (pageDragDepthRef.current === 0 && heroDropDepthRef.current === 0) {
          setPageDropActive(false);
          setDropOverlayMessage(getDropOverlayMessage(messages, 'video.mp4'));
        }
      }}
      onDragOver={(event) => {
        if (!transferHasFiles(event.dataTransfer)) {
          return;
        }

        event.preventDefault();
        setDropOverlayMessage(
          getDropOverlayMessage(
            messages,
            getFirstTransferFile(event.dataTransfer)?.name,
          ),
        );
        if (!pageDropActive) {
          setPageDropActive(true);
        }
      }}
      onDrop={handlePageDrop}
    >
      <input
        ref={videoInputRef}
        className='hidden-input'
        type='file'
        accept={VIDEO_ACCEPT}
        onChange={(event) => {
          const [file] = Array.from(event.target.files || []);
          if (file) {
            openVideoFromFile(file);
          }
        }}
      />
      <input
        ref={subtitleInputRef}
        className='hidden-input'
        type='file'
        accept={SUBTITLE_ACCEPT}
        onChange={(event) => {
          if (event.target.files?.length) {
            void handleSubtitleSelection(event.target.files);
          }
        }}
      />

      <header className='app-header'>
        <div className='brand-lockup'>
          <div className='brand-mark'>
            <img src={APP_ICON_URL} alt={APP_NAME} />
          </div>
          <div>
            <p className='eyebrow'>{messages.header.eyebrow}</p>
            <h1>{APP_NAME}</h1>
          </div>
        </div>
        <div className='header-actions'>
          <label className='language-picker'>
            <span>{messages.header.language}</span>
            <select
              value={language}
              onChange={(event) => {
                const nextLanguage = event.target.value;
                if (!isAppLocale(nextLanguage)) {
                  return;
                }

                setLanguage(nextLanguage);
                setNotice(
                  MESSAGES[nextLanguage].notices.languageChanged(
                    MESSAGES[nextLanguage].languages[nextLanguage],
                  ),
                );
              }}
            >
              {LOCALE_OPTIONS.map((locale) => (
                <option key={locale} value={locale}>
                  {messages.languages[locale]}
                </option>
              ))}
            </select>
          </label>
          <button
            type='button'
            className='ghost-button'
            onClick={() => void triggerVideoPicker()}
          >
            {messages.header.openVideo}
          </button>
          <button type='button' className='ghost-button' onClick={() => void openInspector()}>
            {messages.header.inspect}
          </button>
        </div>
      </header>

      <main className='app-main'>
        {!videoSource ? (
          <section className='hero-card'>
            <p className='eyebrow'>{messages.hero.eyebrow}</p>
            <h2>{messages.hero.title}</h2>
            <p className='hero-copy'>{messages.hero.copy}</p>

            <div className='hero-actions'>
              <button
                type='button'
                className='primary-button'
                onClick={() => void triggerVideoPicker()}
              >
                {messages.hero.selectVideo}
              </button>
              <button type='button' className='ghost-button' onClick={() => void openInspector()}>
                {messages.hero.openDevtools}
              </button>
            </div>

            <div
              className={`drop-card ${pageDropActive ? 'drop-card-active' : ''}`}
              onDragEnter={(event) => {
                if (!transferHasFiles(event.dataTransfer)) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                setDropOverlayMessage(
                  getDropOverlayMessage(
                    messages,
                    getFirstTransferFile(event.dataTransfer)?.name,
                  ),
                );
                heroDropDepthRef.current += 1;
                setPageDropActive(true);
              }}
              onDragLeave={(event) => {
                if (!transferHasFiles(event.dataTransfer)) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                heroDropDepthRef.current = Math.max(0, heroDropDepthRef.current - 1);
                if (heroDropDepthRef.current === 0 && pageDragDepthRef.current === 0) {
                  setPageDropActive(false);
                  setDropOverlayMessage(getDropOverlayMessage(messages, 'video.mp4'));
                }
              }}
              onDragOver={(event) => {
                if (!transferHasFiles(event.dataTransfer)) {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                setDropOverlayMessage(
                  getDropOverlayMessage(
                    messages,
                    getFirstTransferFile(event.dataTransfer)?.name,
                  ),
                );
                setPageDropActive(true);
              }}
              onDrop={(event) => {
                event.stopPropagation();
                handlePageDrop(event);
              }}
              onClick={() => void triggerVideoPicker()}
            >
              <strong>{messages.hero.dropTitle}</strong>
              <span>{messages.hero.dropHint}</span>
            </div>
          </section>
        ) : (
          <section className='player-layout'>
            <div className='stage-header'>
              <div className='chip-row'>
                <span className='info-chip'>
                  {messages.stage.video}: {videoSource.fileName}
                </span>
                <span className='info-chip'>
                  {messages.stage.subtitles}:{' '}
                  {subtitleTrack ? subtitleTrack.fileName : messages.stage.noneLoaded}
                </span>
                <span className='info-chip'>
                  {messages.stage.offset}: {formatMillisecondsAsSeconds(syncOffsetMs)}
                </span>
              </div>
              <div className='stage-actions'>
                <button
                  type='button'
                  className='ghost-button'
                  onClick={() => void triggerVideoPicker()}
                >
                  {messages.stage.changeVideo}
                </button>
                <button
                  type='button'
                  className='ghost-button'
                  onClick={() => {
                    setPanelVisible(true);
                    setPanelTab('load');
                  }}
                >
                  {messages.stage.loadSubtitles}
                </button>
              </div>
            </div>

            <div className='player-card'>
              <div className='player-frame' style={playerFrameStyle}>
                <video
                  key={videoSource.src}
                  ref={videoElementRef}
                  className='player-video'
                  src={videoSource.kind === 'hls' ? undefined : videoSource.src}
                  preload='auto'
                  playsInline
                />
                <audio ref={externalAudioRef} className='hidden-audio' preload='auto' />

                <div
                  className={`caption-layer caption-layer-centered ${
                    subtitleStyle.useCustomMaxWidth
                      ? 'caption-layer-custom-width'
                      : 'caption-layer-auto-width'
                  }`}
                  style={subtitleVariables}
                >
                  {activeCue ? (
                    <span
                      className='caption-text'
                      dangerouslySetInnerHTML={{ __html: activeCue.html }}
                    />
                  ) : null}
                </div>

                <div
                  className={`dock-shell ${dockVisible ? 'dock-shell-visible' : ''}`}
                  onMouseEnter={() => setDockHovering(true)}
                  onMouseLeave={() => setDockHovering(false)}
                >
                  <div className='dock-hover-zone' aria-hidden='true' />
                  <div className='floating-dock'>
                    <button
                      type='button'
                      className='dock-button'
                      onClick={() => {
                        setPanelVisible((currentValue) => !currentValue);
                        setPanelTab('load');
                      }}
                    >
                      {messages.dock.subtitles}
                    </button>
                    <button
                      type='button'
                      className='dock-button'
                      onClick={() => {
                        setPanelVisible(true);
                        setPanelTab('style');
                      }}
                    >
                      {messages.dock.settings}
                    </button>
                    <button
                      type='button'
                      className='dock-button'
                      onClick={() => void openInspector()}
                    >
                      {messages.dock.devTools}
                    </button>
                  </div>
                </div>

                <aside
                  className={`control-panel ${panelVisible ? 'control-panel-open' : ''}`}
                >
                  <div className='panel-tabs'>
                    <button
                      type='button'
                      className={panelTab === 'load' ? 'panel-tab active' : 'panel-tab'}
                      onClick={() => setPanelTab('load')}
                    >
                      {messages.panel.loadTab}
                    </button>
                    <button
                      type='button'
                      className={panelTab === 'style' ? 'panel-tab active' : 'panel-tab'}
                      onClick={() => setPanelTab('style')}
                    >
                      {messages.panel.styleTab}
                    </button>
                    <button
                      type='button'
                      className='panel-close'
                      onClick={() => setPanelVisible(false)}
                    >
                      {messages.panel.close}
                    </button>
                  </div>

                  {panelTab === 'load' ? (
                    <div className='panel-body load-zone'>
                      <p className='eyebrow'>{messages.panel.autoEyebrow}</p>
                      <h3>{messages.panel.loadTitle}</h3>
                      <div
                        ref={subtitleDropZoneRef}
                        className={`subtitle-drop-zone ${
                          subtitleDropActive ? 'subtitle-drop-zone-active' : ''
                        }`}
                        onClick={() => void triggerSubtitlePicker()}
                        onDragEnter={(event) => {
                          if (!transferHasFiles(event.dataTransfer)) {
                            return;
                          }

                          event.preventDefault();
                          setDropOverlayMessage(
                            getDropOverlayMessage(
                              messages,
                              getFirstTransferFile(event.dataTransfer)?.name,
                            ),
                          );
                          subtitleDropDepthRef.current += 1;
                          setSubtitleDropActive(true);
                        }}
                        onDragLeave={(event) => {
                          if (!transferHasFiles(event.dataTransfer)) {
                            return;
                          }

                          event.preventDefault();
                          subtitleDropDepthRef.current = Math.max(
                            0,
                            subtitleDropDepthRef.current - 1,
                          );
                          if (subtitleDropDepthRef.current === 0) {
                            setSubtitleDropActive(false);
                            setDropOverlayMessage(
                              getDropOverlayMessage(messages, 'video.mp4'),
                            );
                          }
                        }}
                        onDragOver={(event) => {
                          if (!transferHasFiles(event.dataTransfer)) {
                            return;
                          }

                          event.preventDefault();
                          setDropOverlayMessage(
                            getDropOverlayMessage(
                              messages,
                              getFirstTransferFile(event.dataTransfer)?.name,
                            ),
                          );
                        }}
                        onDrop={handleSubtitleDrop}
                      >
                        <strong>
                          {subtitleTrack
                            ? messages.panel.loadedFile(subtitleTrack.fileName)
                            : messages.panel.emptyDrop}
                        </strong>
                        <span>
                          {subtitleTrack
                            ? messages.panel.cuesReady(subtitleTrack.cues.length)
                            : messages.panel.dropHint}
                        </span>
                      </div>

                      <section className='embedded-track-section'>
                        <div className='section-heading'>
                          <h3>{messages.panel.embeddedTitle}</h3>
                        </div>

                        {nativeSubtitleTracks.length > 0 ? (
                          <div className='embedded-track-list'>
                            {nativeSubtitleTracks.map((trackOption) => (
                              <button
                                key={trackOption.id}
                                type='button'
                                className={`embedded-track-card ${
                                  activeEmbeddedTrackId === trackOption.id
                                    ? 'embedded-track-card-active'
                                    : ''
                                }`}
                                onClick={() => void selectEmbeddedSubtitleTrack(trackOption)}
                              >
                                <strong>{trackOption.label}</strong>
                                <span>
                                  {trackOption.detail || messages.panel.useEmbedded}
                                </span>
                                {activeEmbeddedTrackId === trackOption.id ? (
                                  <small>{messages.panel.currentEmbedded}</small>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className='helper-text'>{messages.panel.embeddedEmpty}</p>
                        )}
                      </section>

                      <section className='embedded-track-section'>
                        <div className='section-heading'>
                          <h3>{messages.panel.audioTitle}</h3>
                        </div>

                        {nativeAudioTracks.length > 0 ? (
                          <div className='embedded-track-list'>
                            {nativeAudioTracks.map((trackOption) => (
                              <button
                                key={trackOption.id}
                                type='button'
                                className={`embedded-track-card ${
                                  activeAudioTrackId === trackOption.id
                                    ? 'embedded-track-card-active'
                                    : ''
                                }`}
                                onClick={() => selectAudioTrack(trackOption)}
                              >
                                <strong>{trackOption.label}</strong>
                                <span>{trackOption.detail || messages.panel.currentAudio}</span>
                                {activeAudioTrackId === trackOption.id ? (
                                  <small>{messages.panel.currentAudio}</small>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className='helper-text'>{messages.panel.audioEmpty}</p>
                        )}
                      </section>

                      <div className='stack-actions'>
                        <button
                          type='button'
                          className='primary-button'
                          onClick={() => void triggerSubtitlePicker()}
                          disabled={subtitleLoading}
                        >
                          {subtitleLoading
                            ? messages.panel.processing
                            : messages.panel.selectSubtitle}
                        </button>
                        {subtitleTrack ? (
                          <button
                            type='button'
                            className='ghost-button'
                            onClick={clearSubtitleTrack}
                          >
                            {messages.panel.removeSubtitle}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className='panel-body settings-container'>
                      <section className='settings-section'>
                        <div className='section-heading'>
                          <h3>{messages.behavior.title}</h3>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.behavior.language}</span>
                          <div className='settings-item-content'>
                            <label className='language-picker panel-language-picker'>
                              <select
                                value={language}
                                onChange={(event) => {
                                  const nextLanguage = event.target.value;
                                  if (!isAppLocale(nextLanguage)) {
                                    return;
                                  }

                                  setLanguage(nextLanguage);
                                  setNotice(
                                    MESSAGES[nextLanguage].notices.languageChanged(
                                      MESSAGES[nextLanguage].languages[nextLanguage],
                                    ),
                                  );
                                }}
                              >
                                {LOCALE_OPTIONS.map((locale) => (
                                  <option key={locale} value={locale}>
                                    {messages.languages[locale]}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.behavior.promptForSubtitles}</span>
                          <div className='settings-item-content toggle-editor'>
                            <label className='switch'>
                              <input
                                type='checkbox'
                                checked={promptForSubtitles}
                                onChange={(event) =>
                                  setPromptForSubtitles(event.target.checked)
                                }
                              />
                              <span />
                            </label>
                          </div>
                        </div>

                        <p className='helper-text'>
                          {messages.behavior.promptForSubtitlesHelp}
                        </p>

                        <div className='settings-item'>
                          <span>{messages.behavior.openPanel}</span>
                          <div className='settings-item-content toggle-editor'>
                            <label className='switch'>
                              <input
                                type='checkbox'
                                checked={openPanelOnOpen}
                                onChange={(event) =>
                                  setOpenPanelOnOpen(event.target.checked)
                                }
                              />
                              <span />
                            </label>
                          </div>
                        </div>

                        <p className='helper-text'>
                          {messages.behavior.openPanelHelp}
                        </p>

                        <div className='settings-item'>
                          <span>{messages.behavior.autoplay}</span>
                          <div className='settings-item-content toggle-editor'>
                            <label className='switch'>
                              <input
                                type='checkbox'
                                checked={autoplayOnOpen}
                                onChange={(event) =>
                                  setAutoplayOnOpen(event.target.checked)
                                }
                              />
                              <span />
                            </label>
                          </div>
                        </div>

                        <p className='helper-text'>
                          {messages.behavior.autoplayHelp}
                        </p>

                        <div className='settings-item'>
                          <span>{messages.behavior.openFullscreen}</span>
                          <div className='settings-item-content toggle-editor'>
                            <label className='switch'>
                              <input
                                type='checkbox'
                                checked={fullscreenOnOpen}
                                onChange={(event) =>
                                  setFullscreenOnOpen(event.target.checked)
                                }
                              />
                              <span />
                            </label>
                          </div>
                        </div>

                        <p className='helper-text'>
                          {messages.behavior.openFullscreenHelp}
                        </p>
                      </section>

                      <section className='settings-section'>
                        <div className='section-heading'>
                          <h3>{messages.sync.title}</h3>
                          <strong>{formatMillisecondsAsSeconds(syncOffsetMs)}</strong>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.sync.offset}</span>
                          <div className='settings-item-content sync-editor'>
                            <input
                              type='range'
                              min={-120}
                              max={120}
                              step={0.05}
                              value={syncOffsetMs / 1000}
                              onChange={(event) =>
                                updateSyncOffset(Number(event.target.value) * 1000)
                              }
                            />
                            <NumberField
                              value={syncOffsetMs / 1000}
                              min={-120}
                              max={120}
                              step={0.05}
                              unit='s'
                              onCommit={(nextValue) =>
                                updateSyncOffset(nextValue * 1000)
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.sync.rememberOffset}</span>
                          <div className='settings-item-content toggle-editor'>
                            <label className='switch'>
                              <input
                                type='checkbox'
                                checked={rememberSyncOffset}
                                onChange={(event) => {
                                  setRememberSyncOffset(event.target.checked);
                                  if (!event.target.checked) {
                                    setSyncOffsetMs(0);
                                  }
                                }}
                              />
                              <span />
                            </label>
                          </div>
                        </div>

                        <p className='helper-text'>
                          {messages.sync.rememberOffsetHelp}
                        </p>

                        <div className='button-grid'>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={() => updateSyncOffset(0)}
                          >
                            {messages.sync.reset}
                          </button>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={() => shiftSyncOffset(-500)}
                          >
                            {messages.sync.shiftMinusHalf}
                          </button>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={() => shiftSyncOffset(-100)}
                          >
                            {messages.sync.shiftMinusTenth}
                          </button>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={() => shiftSyncOffset(100)}
                          >
                            {messages.sync.shiftPlusTenth}
                          </button>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={() => shiftSyncOffset(500)}
                          >
                            {messages.sync.shiftPlusHalf}
                          </button>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={() => syncRelativeCueToCurrentTime('prev')}
                            disabled={!subtitleTrack}
                          >
                            {messages.sync.previousHere}
                          </button>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={() => syncRelativeCueToCurrentTime('next')}
                            disabled={!subtitleTrack}
                          >
                            {messages.sync.nextHere}
                          </button>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={downloadCurrentSubtitle}
                            disabled={!subtitleTrack}
                          >
                            {messages.sync.download}
                          </button>
                          <button
                            type='button'
                            className='mini-button'
                            onClick={openAdvancedControls}
                          >
                            {messages.sync.advanced}
                          </button>
                        </div>
                      </section>

                      <section className='settings-section'>
                        <div className='section-heading'>
                          <h3>{messages.font.title}</h3>
                          <strong>{getFontLabel(subtitleStyle.fontFamily)}</strong>
                        </div>

                        <div className='settings-item settings-item-stack'>
                          <span>{messages.font.cssLoaded}</span>
                          <div className='settings-item-content font-editor'>
                            {remoteFontOptions.length > 0 ? (
                              <div className='font-preview-list'>
                                {remoteFontOptions.map((fontOption) => (
                                  <button
                                    key={fontOption.value}
                                    type='button'
                                    className={`font-preview-card ${
                                      subtitleStyle.fontFamily === fontOption.value
                                        ? 'font-preview-card-active'
                                        : ''
                                    }`}
                                    style={{ fontFamily: fontOption.value }}
                                    onClick={() => selectCssFont(fontOption.value)}
                                  >
                                    <strong>{getFontLabel(fontOption.value)}</strong>
                                    <span>{messages.font.sample}</span>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className='helper-text'>
                                {messages.font.noCss}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className='settings-item settings-item-stack'>
                          <span>{messages.font.cssUrl}</span>
                          <div className='settings-item-content font-editor'>
                            <input
                              type='url'
                              className='text-input'
                              value={fontStylesheetInput}
                              placeholder={messages.font.cssPlaceholder}
                              onChange={(event) =>
                                setFontStylesheetInput(event.target.value)
                              }
                            />
                            <div className='inline-actions'>
                              <button
                                type='button'
                                className='ghost-button slim-button'
                                onClick={() =>
                                  void loadRemoteFontStylesheet(
                                    fontStylesheetInput,
                                  ).catch((error: unknown) => {
                                    setNotice(
                                      error instanceof Error
                                        ? error.message
                                        : messages.notices.remoteFontLoadFailed,
                                    );
                                  })
                                }
                              >
                                {messages.font.loadCss}
                              </button>
                            </div>
                            <p className='helper-text'>{messages.font.cssHelper}</p>
                          </div>
                        </div>

                        <div className='settings-item settings-item-stack'>
                          <span>{messages.font.installed}</span>
                          <div className='settings-item-content font-editor'>
                            <input
                              type='search'
                              className='text-input'
                              value={fontSearchQuery}
                              placeholder={messages.font.searchPlaceholder}
                              onChange={(event) =>
                                setFontSearchQuery(event.target.value)
                              }
                            />
                            {systemFontsLoading ? (
                              <p className='helper-text'>{messages.panel.processing}</p>
                            ) : visibleSystemFontOptions.length > 0 ? (
                              <>
                                <div className='font-preview-list'>
                                  {visibleSystemFontOptions.map((fontOption) => (
                                    <button
                                      key={fontOption.value}
                                      type='button'
                                      className={`font-preview-card ${
                                        subtitleStyle.fontFamily === fontOption.value
                                          ? 'font-preview-card-active'
                                          : ''
                                      }`}
                                      style={{ fontFamily: fontOption.value }}
                                      onClick={() => selectInstalledFont(fontOption.value)}
                                    >
                                      <strong>{getFontLabel(fontOption.value)}</strong>
                                      <span>{messages.font.sample}</span>
                                    </button>
                                  ))}
                                </div>
                                <div className='font-pagination'>
                                  <button
                                    type='button'
                                    className='ghost-button slim-button'
                                    disabled={fontPage === 0}
                                    onClick={() =>
                                      setFontPage((currentPage) =>
                                        Math.max(0, currentPage - 1),
                                      )
                                    }
                                  >
                                    {messages.font.previousPage}
                                  </button>
                                  <span>
                                    {messages.font.pageSummary(
                                      Math.min(fontPage + 1, totalFontPages),
                                      totalFontPages,
                                    )}
                                  </span>
                                  <button
                                    type='button'
                                    className='ghost-button slim-button'
                                    disabled={fontPage >= totalFontPages - 1}
                                    onClick={() =>
                                      setFontPage((currentPage) =>
                                        Math.min(totalFontPages - 1, currentPage + 1),
                                      )
                                    }
                                  >
                                    {messages.font.nextPage}
                                  </button>
                                </div>
                                <p className='helper-text'>
                                  {messages.font.resultsSummary(
                                    visibleSystemFontOptions.length,
                                    filteredSystemFontOptions.length,
                                  )}
                                </p>
                              </>
                            ) : (
                              <p className='helper-text'>{messages.font.noResults}</p>
                            )}
                            <p className='helper-text'>{messages.font.installedHelper}</p>
                          </div>
                        </div>
                      </section>

                      <section className='settings-section'>
                        <div className='section-heading'>
                          <h3>{messages.style.title}</h3>
                          <strong>{messages.style.preset}</strong>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.size}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={22}
                              max={64}
                              step={1}
                              value={subtitleStyle.fontSize}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  fontSize: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.fontSize}
                              min={8}
                              max={200}
                              step={1}
                              unit='px'
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  fontSize: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.position}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={2}
                              max={30}
                              step={1}
                              value={subtitleStyle.bottomOffset}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  bottomOffset: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.bottomOffset}
                              min={0}
                              max={100}
                              step={1}
                              unit='%'
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  bottomOffset: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.color}</span>
                          <div className='settings-item-content color-editor'>
                            <input
                              type='color'
                              value={subtitleStyle.textColor}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  textColor: event.target.value,
                                }))
                              }
                            />
                            <code>{subtitleStyle.textColor}</code>
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.background}</span>
                          <div className='settings-item-content color-editor'>
                            <input
                              type='color'
                              value={subtitleStyle.backgroundColor}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  backgroundColor: event.target.value,
                                }))
                              }
                            />
                            <code>{subtitleStyle.backgroundColor}</code>
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.opacity}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={0}
                              max={100}
                              step={1}
                              value={Math.round(subtitleStyle.backgroundOpacity * 100)}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  backgroundOpacity:
                                    Number(event.target.value) / 100,
                                }))
                              }
                            />
                            <NumberField
                              value={Math.round(subtitleStyle.backgroundOpacity * 100)}
                              min={0}
                              max={100}
                              step={1}
                              unit='%'
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  backgroundOpacity: nextValue / 100,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.weight}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={100}
                              max={900}
                              step={10}
                              value={subtitleStyle.fontWeight}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  fontWeight: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.fontWeight}
                              min={100}
                              max={900}
                              step={10}
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  fontWeight: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.width}</span>
                          <div className='settings-item-content slider-editor'>
                            <div className='inline-switch-label'>
                              <span>{messages.style.customWidth}</span>
                              <label className='switch'>
                                <input
                                  type='checkbox'
                                  checked={subtitleStyle.useCustomMaxWidth}
                                  onChange={(event) =>
                                    setSubtitleStyle((currentStyle) => ({
                                      ...currentStyle,
                                      useCustomMaxWidth: event.target.checked,
                                    }))
                                  }
                                />
                                <span />
                              </label>
                            </div>
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.widthValue}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={20}
                              max={100}
                              step={1}
                              value={subtitleStyle.maxWidth}
                              disabled={!subtitleStyle.useCustomMaxWidth}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  maxWidth: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.maxWidth}
                              min={10}
                              max={100}
                              step={1}
                              unit='%'
                              disabled={!subtitleStyle.useCustomMaxWidth}
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  maxWidth: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.style.shadow}</span>
                          <div className='settings-item-content toggle-editor'>
                            <label className='switch'>
                              <input
                                type='checkbox'
                                checked={subtitleStyle.textShadow}
                                onChange={(event) =>
                                  setSubtitleStyle((currentStyle) => ({
                                    ...currentStyle,
                                    textShadow: event.target.checked,
                                  }))
                                }
                              />
                              <span />
                            </label>
                          </div>
                        </div>
                      </section>

                      <section
                        ref={advancedSectionRef}
                        className={`settings-section ${advancedControlsOpen ? '' : 'collapsed-section'}`}
                      >
                        <div className='section-heading'>
                          <h3>{messages.advanced.title}</h3>
                          <button
                            type='button'
                            className='ghost-button slim-button'
                            onClick={() =>
                              setAdvancedControlsOpen((currentValue) => !currentValue)
                            }
                          >
                            {advancedControlsOpen
                              ? messages.advanced.hide
                              : messages.advanced.show}
                          </button>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.advanced.lineHeight}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={1}
                              max={1.6}
                              step={0.01}
                              value={subtitleStyle.lineHeight}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  lineHeight: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.lineHeight}
                              min={0.5}
                              max={3}
                              step={0.01}
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  lineHeight: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.advanced.letterSpacing}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={-1}
                              max={3}
                              step={0.1}
                              value={subtitleStyle.letterSpacing}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  letterSpacing: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.letterSpacing}
                              min={-5}
                              max={10}
                              step={0.1}
                              unit='px'
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  letterSpacing: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.advanced.paddingX}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={0}
                              max={36}
                              step={1}
                              value={subtitleStyle.paddingX}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  paddingX: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.paddingX}
                              min={0}
                              max={80}
                              step={1}
                              unit='px'
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  paddingX: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.advanced.paddingY}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={0}
                              max={24}
                              step={1}
                              value={subtitleStyle.paddingY}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  paddingY: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.paddingY}
                              min={0}
                              max={80}
                              step={1}
                              unit='px'
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  paddingY: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>

                        <div className='settings-item'>
                          <span>{messages.advanced.radius}</span>
                          <div className='settings-item-content slider-editor'>
                            <input
                              type='range'
                              min={0}
                              max={24}
                              step={1}
                              value={subtitleStyle.borderRadius}
                              onChange={(event) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  borderRadius: Number(event.target.value),
                                }))
                              }
                            />
                            <NumberField
                              value={subtitleStyle.borderRadius}
                              min={0}
                              max={80}
                              step={1}
                              unit='px'
                              onCommit={(nextValue) =>
                                setSubtitleStyle((currentStyle) => ({
                                  ...currentStyle,
                                  borderRadius: nextValue,
                                }))
                              }
                            />
                          </div>
                        </div>
                      </section>

                      <div className='stack-actions compact'>
                        <button
                          type='button'
                          className='ghost-button'
                          onClick={() => {
                            setSubtitleStyle(DEFAULT_STYLE);
                            setAdvancedControlsOpen(false);
                            void loadRemoteFontStylesheet(
                              DEFAULT_FONT_STYLESHEET_URL,
                              { selectFirstFamily: false },
                            ).catch((error: unknown) => {
                              setNotice(
                                error instanceof Error
                                  ? error.message
                                  : messages.notices.restoreRemoteFontFailed,
                              );
                            });
                          }}
                        >
                          {messages.style.restoreDefault}
                        </button>
                      </div>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </section>
        )}
      </main>

      {toast ? (
        <div className='toast-notice' role='status' aria-live='polite'>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

