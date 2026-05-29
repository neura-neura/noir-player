import DOMPurify from 'dompurify';
import { detect } from 'jschardet';
import JSZip from 'jszip';

export type SubtitleCue = {
  startMs: number;
  endMs: number;
  html: string;
};

export type SubtitleTrack = {
  cues: SubtitleCue[];
  fileName: string;
  rawText: string;
};

export type SubtitleLoadErrorCode =
  | 'invalid_timestamp'
  | 'zip_missing'
  | 'no_valid_cues';

export class SubtitleLoadError extends Error {
  code: SubtitleLoadErrorCode;
  detail?: string;

  constructor(code: SubtitleLoadErrorCode, detail?: string) {
    super(code);
    this.name = 'SubtitleLoadError';
    this.code = code;
    this.detail = detail;
  }
}

const FALLBACK_ENCODINGS = ['utf-8', 'windows-1252', 'iso-8859-1'] as const;
const SUPPORTED_ARCHIVE_ENTRY = /\.(srt|vtt|ass|ssa)$/i;

function normalizeText(rawText: string): string {
  return rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .trim();
}

function normalizeEncoding(rawEncoding?: string): string {
  if (!rawEncoding) {
    return 'utf-8';
  }

  const normalized = rawEncoding.toLowerCase().replace(/_/g, '-');

  if (normalized === 'ascii' || normalized === 'utf8') {
    return 'utf-8';
  }

  if (normalized === 'windows-1252' || normalized === 'iso-8859-1') {
    return normalized;
  }

  return normalized;
}

function detectEncodingFromBom(buffer: Uint8Array): string | null {
  if (buffer.length >= 3) {
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return 'utf-8';
    }
  }

  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return 'utf-16le';
    }

    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      return 'utf-16be';
    }
  }

  return null;
}

function bytesToLatin1String(buffer: Uint8Array): string {
  const chunkSize = 0x4000;
  let result = '';

  for (let index = 0; index < buffer.length; index += chunkSize) {
    result += String.fromCharCode(...buffer.subarray(index, index + chunkSize));
  }

  return result;
}

function decodeSubtitleBuffer(buffer: Uint8Array): string {
  const fromBom = detectEncodingFromBom(buffer);
  const sample = bytesToLatin1String(buffer.subarray(0, 24_000));
  const detected = normalizeEncoding(fromBom || detect(sample).encoding);
  const encodings = [detected, ...FALLBACK_ENCODINGS].filter(
    (encoding, index, values) => values.indexOf(encoding) === index,
  );

  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      continue;
    }
  }

  return new TextDecoder('utf-8').decode(buffer);
}

function stripUnsupportedCueMarkup(rawText: string): string {
  return rawText
    .replace(/\\N/g, '<br />')
    .replace(/<c(\.[^>]+)?>/gi, '')
    .replace(/<\/c>/gi, '')
    .replace(/<v(\s+[^>]*)?>/gi, '')
    .replace(/<\/v>/gi, '')
    .replace(/<lang(\s+[^>]*)?>/gi, '')
    .replace(/<\/lang>/gi, '')
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/<\/?\d{2}:\d{2}:\d{2}\.\d{3}>/g, '');
}

function sanitizeCueHtml(rawText: string): string {
  return DOMPurify.sanitize(stripUnsupportedCueMarkup(rawText), {
    ALLOWED_TAGS: ['b', 'i', 'u', 'font', 'br'],
    ALLOWED_ATTR: ['color'],
  }).replace(/&gt;/g, '>');
}

function isAssSubtitleFile(fileName?: string): boolean {
  return /\.(ass|ssa)$/i.test(fileName || '');
}

function isAssSubtitleText(rawText: string): boolean {
  return (
    /^\s*\[(?:Script Info|Events|V4\+? Styles)\]/im.test(rawText) &&
    /^\s*Dialogue\s*:/im.test(rawText)
  );
}

function parseMilliseconds(rawValue: string): number {
  const [leftPart, rawMs = '0'] = rawValue.trim().replace(',', '.').split('.');
  const segments = leftPart.split(':').map((segment) => Number(segment));

  while (segments.length < 3) {
    segments.unshift(0);
  }

  const [hours, minutes, seconds] = segments;
  const milliseconds = Number(rawMs.padEnd(3, '0').slice(0, 3));

  if (
    [hours, minutes, seconds, milliseconds].some((part) =>
      Number.isNaN(part),
    )
  ) {
    throw new SubtitleLoadError('invalid_timestamp', rawValue);
  }

  return (
    ((hours * 60 * 60 + minutes * 60 + seconds) * 1000) + milliseconds
  );
}

function parseCueBlock(block: string): SubtitleCue | null {
  const lines = block
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return null;
  }

  let timeLineIndex = 0;
  if (!lines[0].includes('-->') && lines[1]?.includes('-->')) {
    timeLineIndex = 1;
  }

  const timeLine = lines[timeLineIndex];
  if (!timeLine?.includes('-->')) {
    return null;
  }

  const [rawStart, rawEndAndSettings] = timeLine.split(/\s+-->\s+/);
  const rawEnd = rawEndAndSettings.split(/\s+/)[0];

  const startMs = parseMilliseconds(rawStart);
  const endMs = parseMilliseconds(rawEnd);
  const html = sanitizeCueHtml(lines.slice(timeLineIndex + 1).join('<br />'));

  if (!html || endMs <= startMs) {
    return null;
  }

  return {
    startMs,
    endMs,
    html,
  };
}

function splitAssFields(rawValue: string, expectedFieldCount: number): string[] {
  if (expectedFieldCount <= 1) {
    return [rawValue];
  }

  const fields: string[] = [];
  let remainingValue = rawValue;

  for (let index = 1; index < expectedFieldCount; index += 1) {
    const separatorIndex = remainingValue.indexOf(',');
    if (separatorIndex < 0) {
      fields.push(remainingValue.trim());
      remainingValue = '';
      break;
    }

    fields.push(remainingValue.slice(0, separatorIndex).trim());
    remainingValue = remainingValue.slice(separatorIndex + 1);
  }

  fields.push(remainingValue.trim());

  while (fields.length < expectedFieldCount) {
    fields.push('');
  }

  return fields;
}

function stripAssCueMarkup(rawText: string): string {
  return rawText
    .replace(/\\[Nn]/g, '<br />')
    .replace(/\\h/g, ' ')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\([{}])/g, '$1');
}

function parseAssSubtitleText(rawText: string): SubtitleCue[] {
  const lines = rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const cues: SubtitleCue[] = [];
  let hasSeenSection = false;
  let isInsideEventsSection = false;
  let eventFormat: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      hasSeenSection = true;
      isInsideEventsSection = sectionMatch[1].trim().toLowerCase() === 'events';
      continue;
    }

    if (!isInsideEventsSection && hasSeenSection) {
      continue;
    }

    if (/^Format\s*:/i.test(line)) {
      eventFormat = line
        .replace(/^Format\s*:\s*/i, '')
        .split(',')
        .map((field) => field.trim().toLowerCase());
      continue;
    }

    if (!/^Dialogue\s*:/i.test(line)) {
      continue;
    }

    const dialogueText = line.replace(/^Dialogue\s*:\s*/i, '');
    const fields = splitAssFields(dialogueText, eventFormat?.length || 10);
    const startIndex = eventFormat?.indexOf('start') ?? 1;
    const endIndex = eventFormat?.indexOf('end') ?? 2;
    const textIndex = eventFormat?.indexOf('text') ?? 9;

    if (
      startIndex < 0 ||
      endIndex < 0 ||
      textIndex < 0 ||
      !fields[startIndex] ||
      !fields[endIndex]
    ) {
      continue;
    }

    const startMs = parseMilliseconds(fields[startIndex]);
    const endMs = parseMilliseconds(fields[endIndex]);
    const html = sanitizeCueHtml(stripAssCueMarkup(fields[textIndex] || ''));

    if (!html || endMs <= startMs) {
      continue;
    }

    cues.push({
      startMs,
      endMs,
      html,
    });
  }

  return cues.sort(
    (leftCue, rightCue) =>
      leftCue.startMs - rightCue.startMs || leftCue.endMs - rightCue.endMs,
  );
}

export function parseSubtitleText(
  rawText: string,
  fileName?: string,
): SubtitleCue[] {
  if (isAssSubtitleFile(fileName) || isAssSubtitleText(rawText)) {
    return parseAssSubtitleText(rawText);
  }

  const normalized = normalizeText(rawText);
  if (!normalized) {
    return [];
  }

  return normalized
    .replace(/\n{3,}/g, '\n\n')
    .split('\n\n')
    .map((block) => parseCueBlock(block))
    .filter((cue): cue is SubtitleCue => Boolean(cue));
}

async function readFileBuffer(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

async function readArchiveEntry(file: File): Promise<{
  fileName: string;
  buffer: Uint8Array;
}> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  const subtitleEntry = Object.values(archive.files).find(
    (entry) => !entry.dir && SUPPORTED_ARCHIVE_ENTRY.test(entry.name),
  );

  if (!subtitleEntry) {
    throw new SubtitleLoadError('zip_missing');
  }

  return {
    fileName: subtitleEntry.name.split('/').pop() || subtitleEntry.name,
    buffer: await subtitleEntry.async('uint8array'),
  };
}

export async function loadSubtitleTrack(file: File): Promise<SubtitleTrack> {
  const isArchive = file.name.toLowerCase().endsWith('.zip');
  const source = isArchive
    ? await readArchiveEntry(file)
    : { fileName: file.name, buffer: await readFileBuffer(file) };

  const rawText = decodeSubtitleBuffer(source.buffer);
  const cues = parseSubtitleText(rawText, source.fileName);

  if (!cues.length) {
    throw new SubtitleLoadError('no_valid_cues');
  }

  return {
    fileName: source.fileName,
    cues,
    rawText,
  };
}

export function findActiveCueIndex(
  cues: SubtitleCue[],
  playbackMs: number,
): number {
  let start = 0;
  let end = cues.length - 1;

  while (start <= end) {
    const middle = Math.floor((start + end) / 2);
    const cue = cues[middle];

    if (playbackMs < cue.startMs) {
      end = middle - 1;
      continue;
    }

    if (playbackMs > cue.endMs) {
      start = middle + 1;
      continue;
    }

    return middle;
  }

  return -1;
}

export function formatMillisecondsAsSeconds(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  return `${seconds >= 0 ? '+' : ''}${seconds.toFixed(2)} s`;
}
