export type SubtitleStyle = {
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
  outlineWidth: number;
  outlineColor: string;
};

export type SubtitleStyleSnapshot = {
  style: SubtitleStyle;
  fontStylesheetUrl: string;
};

export type SavedSubtitleStyle = SubtitleStyleSnapshot & { id: string; name: string };

export const STYLE_LIBRARY_KEY = 'noir-web-player:subtitle-styles:v1';
export const DEFAULT_FONT_STYLESHEET_URL = '/vendor/gotham-pro-font/fonts.min.css';
export const DEFAULT_STYLE: SubtitleStyle = {
  fontSize: 38, textColor: '#ffffff', backgroundColor: '#000000',
  backgroundOpacity: 0.23, bottomOffset: 4, fontWeight: 500,
  fontFamily: 'GothamPro, sans-serif', useCustomMaxWidth: false, maxWidth: 78,
  paddingX: 12, paddingY: 8, borderRadius: 8, lineHeight: 1.18,
  letterSpacing: 0.2, textShadow: true, outlineWidth: 0, outlineColor: '#000000',
};

export const BUILTIN_SUBTITLE_STYLES: SavedSubtitleStyle[] = [
  { id: 'noir-default', name: 'Noir Player', style: { ...DEFAULT_STYLE }, fontStylesheetUrl: DEFAULT_FONT_STYLESHEET_URL },
  {
    id: 'anime-classic', name: 'Anime Classic', fontStylesheetUrl: '',
    style: {
      ...DEFAULT_STYLE, fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 46,
      fontWeight: 700, backgroundOpacity: 0, bottomOffset: 10,
      paddingX: 0, paddingY: 0, borderRadius: 0, lineHeight: 1.23,
      letterSpacing: 0, textShadow: false, outlineWidth: 2.4,
    },
  },
];

// Accept only known, bounded properties from persistent storage. Older styles
// inherit new properties, so adding controls doesn't invalidate saved presets.
export function normalizeSubtitleStyle(value: unknown): SubtitleStyle {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...DEFAULT_STYLE };
  const ranges = {
    fontSize: [8, 160], backgroundOpacity: [0, 1], bottomOffset: [0, 100],
    fontWeight: [100, 900], maxWidth: [10, 100], paddingX: [0, 80], paddingY: [0, 80],
    borderRadius: [0, 80], lineHeight: [0.5, 3], letterSpacing: [-5, 10], outlineWidth: [0, 8],
  } as const;
  for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) {
    const candidate = input[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      result[key] = Math.min(ranges[key][1], Math.max(ranges[key][0], candidate));
    }
  }
  for (const key of ['textColor', 'backgroundColor', 'outlineColor'] as const) {
    if (typeof input[key] === 'string' && /^#[\da-f]{6}$/i.test(input[key])) result[key] = input[key];
  }
  for (const key of ['textShadow', 'useCustomMaxWidth'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key];
  }
  if (typeof input.fontFamily === 'string' && input.fontFamily.trim()) result.fontFamily = input.fontFamily;
  return result;
}

export function readSavedSubtitleStyles(storage: Pick<Storage, 'getItem'>): SavedSubtitleStyle[] {
  try {
    const entries: unknown = JSON.parse(storage.getItem(STYLE_LIBRARY_KEY) || '[]');
    if (!Array.isArray(entries)) return [];
    const ids = new Set(BUILTIN_SUBTITLE_STYLES.map((entry) => entry.id));
    return entries.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' ||
        ids.has(entry.id) || typeof entry.name !== 'string' || !entry.name.trim() ||
        !entry.style || typeof entry.style !== 'object' || typeof entry.fontStylesheetUrl !== 'string') return [];
      ids.add(entry.id);
      return [{ id: entry.id, name: entry.name.trim().slice(0, 80), style: normalizeSubtitleStyle(entry.style), fontStylesheetUrl: entry.fontStylesheetUrl }];
    });
  } catch {
    return [];
  }
}

export function matchesSubtitleStyle(left: SubtitleStyleSnapshot, right: SubtitleStyleSnapshot): boolean {
  return left.fontStylesheetUrl === right.fontStylesheetUrl &&
    (Object.keys(DEFAULT_STYLE) as Array<keyof SubtitleStyle>).every((key) => left.style[key] === right.style[key]);
}
