import { parseTileUrl } from './parseTileUrl';

describe('parseTileUrl', () => {
  test('parses production path-style URL', () => {
    expect(parseTileUrl('https://ritual-v2-mu.vercel.app/t/04A32B')).toBe('04A32B');
  });

  test('parses legacy query-string URL', () => {
    expect(parseTileUrl('https://ritual-v2-mu.vercel.app/?tile=04A32B')).toBe('04A32B');
  });

  test('prepends https:// for protocol-less input (some tags omit it)', () => {
    expect(parseTileUrl('ritual-v2-mu.vercel.app/t/04a32b')).toBe('04A32B');
  });

  test('normalises colon-separated UIDs', () => {
    expect(parseTileUrl('https://x.app/t/04:A3:2B')).toBe('04A32B');
  });

  test('normalises dot-separated UIDs', () => {
    expect(parseTileUrl('https://x.app/?tile=04.a3.2b')).toBe('04A32B');
  });

  test('decodes percent-encoded path segments', () => {
    expect(parseTileUrl('https://x.app/t/04%3AA3%3A2B')).toBe('04A32B');
  });

  test('path takes precedence over query when both present', () => {
    expect(parseTileUrl('https://x.app/t/AAAA?tile=BBBB')).toBe('AAAA');
  });

  test('uppercases lowercase UIDs', () => {
    expect(parseTileUrl('https://x.app/t/deadbeef')).toBe('DEADBEEF');
  });

  test('returns null for null/undefined/empty input', () => {
    expect(parseTileUrl(null)).toBeNull();
    expect(parseTileUrl(undefined)).toBeNull();
    expect(parseTileUrl('')).toBeNull();
  });

  test('returns null for unparseable URL', () => {
    expect(parseTileUrl('https://')).toBeNull();
  });

  test('returns null for URL with no tile info', () => {
    expect(parseTileUrl('https://ritual-v2-mu.vercel.app/')).toBeNull();
    expect(parseTileUrl('https://ritual-v2-mu.vercel.app/settings')).toBeNull();
  });

  test('returns null for empty /t/ path', () => {
    expect(parseTileUrl('https://x.app/t/')).toBeNull();
  });

  test('returns null for malformed percent-encoding instead of throwing', () => {
    expect(parseTileUrl('https://x.app/t/%E0%A4%A')).toBeNull();
  });

  test('auth callback URLs carry no tile', () => {
    expect(parseTileUrl('https://app.ritualhabits.com.au/auth/callback?code=abc123')).toBeNull();
  });
});
