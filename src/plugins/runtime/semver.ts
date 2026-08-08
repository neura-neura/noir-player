import { valid, validRange, satisfies } from 'semver';

export function isValidVersion(value: unknown): value is string {
  return typeof value === 'string' && valid(value) !== null;
}

export function isValidRange(value: unknown): value is string {
  return typeof value === 'string' && validRange(value) !== null;
}

export function versionSatisfies(version: string, range: string): boolean {
  return valid(version) !== null && validRange(range) !== null && satisfies(version, range);
}

export function compareRangeOrFalse(version: string, range: string | undefined): boolean {
  return range === undefined || versionSatisfies(version, range);
}
