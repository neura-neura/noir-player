import { en } from './en';
import { es } from './es';
import type { AppLocale, AppMessages } from './types';
import { zh } from './zh';

export const DEFAULT_LOCALE: AppLocale = 'en';
export const LOCALE_OPTIONS: AppLocale[] = ['en', 'es', 'zh'];

export const MESSAGES: Record<AppLocale, AppMessages> = {
  en,
  es,
  zh,
};

export function isAppLocale(value: string): value is AppLocale {
  return value === 'en' || value === 'es' || value === 'zh';
}

export type { AppLocale, AppMessages } from './types';
