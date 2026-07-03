import { decodeUriRecord, extractUrlFromTag, NDEF_URI_PREFIXES } from './nfcNdef';

// Build a well-known URI record (TNF=1, type 'U') the way the Capgo plugin
// serialises it over the bridge: plain number arrays.
const uriRecord = (prefixCode, rest) => ({
  tnf: 1,
  type: [0x55],
  payload: [prefixCode, ...Array.from(new TextEncoder().encode(rest))],
});

describe('decodeUriRecord', () => {
  test('decodes https:// prefix (0x04) — production tile format', () => {
    expect(decodeUriRecord(uriRecord(0x04, 'ritual-v2-mu.vercel.app/t/04A32B')))
      .toBe('https://ritual-v2-mu.vercel.app/t/04A32B');
  });

  test('decodes http://www. prefix (0x01)', () => {
    expect(decodeUriRecord(uriRecord(0x01, 'example.com'))).toBe('http://www.example.com');
  });

  test('decodes no-prefix code (0x00) verbatim', () => {
    expect(decodeUriRecord(uriRecord(0x00, 'https://x.app/t/AB'))).toBe('https://x.app/t/AB');
  });

  test('treats reserved prefix codes (0x24–0xFF) as no-prefix', () => {
    expect(decodeUriRecord(uriRecord(0x50, 'rest'))).toBe('rest');
  });

  test('rejects non-well-known TNF', () => {
    expect(decodeUriRecord({ ...uriRecord(0x04, 'x.app'), tnf: 2 })).toBeNull();
  });

  test('rejects non-URI record types (e.g. text record, type T/0x54)', () => {
    expect(decodeUriRecord({ ...uriRecord(0x04, 'x.app'), type: [0x54] })).toBeNull();
  });

  test('rejects multi-byte record types', () => {
    expect(decodeUriRecord({ ...uriRecord(0x04, 'x.app'), type: [0x55, 0x55] })).toBeNull();
  });

  test('rejects empty or missing payload', () => {
    expect(decodeUriRecord({ tnf: 1, type: [0x55], payload: [] })).toBeNull();
    expect(decodeUriRecord({ tnf: 1, type: [0x55] })).toBeNull();
  });

  test('rejects null/undefined record', () => {
    expect(decodeUriRecord(null)).toBeNull();
    expect(decodeUriRecord(undefined)).toBeNull();
  });

  test('decodes multi-byte UTF-8 payloads', () => {
    expect(decodeUriRecord(uriRecord(0x04, 'x.app/t/café'))).toBe('https://x.app/t/café');
  });

  test('prefix table matches RTD-URI 1.0 length (0x00–0x23)', () => {
    expect(NDEF_URI_PREFIXES).toHaveLength(0x24);
  });
});

describe('extractUrlFromTag', () => {
  test('returns the first URI record URL', () => {
    const tag = { ndefMessage: [uriRecord(0x04, 'x.app/t/AAAA'), uriRecord(0x04, 'x.app/t/BBBB')] };
    expect(extractUrlFromTag(tag)).toBe('https://x.app/t/AAAA');
  });

  test('skips non-URI records to find a URI record (mixed-record tag)', () => {
    const tag = { ndefMessage: [{ tnf: 1, type: [0x54], payload: [0x02, 0x65, 0x6E] }, uriRecord(0x04, 'x.app/t/CCCC')] };
    expect(extractUrlFromTag(tag)).toBe('https://x.app/t/CCCC');
  });

  test('returns null when no URI record present', () => {
    expect(extractUrlFromTag({ ndefMessage: [{ tnf: 1, type: [0x54], payload: [0x02] }] })).toBeNull();
  });

  test('returns null for tag without ndefMessage (UID-only tag event)', () => {
    expect(extractUrlFromTag({ id: [4, 163, 43] })).toBeNull();
    expect(extractUrlFromTag({})).toBeNull();
    expect(extractUrlFromTag(null)).toBeNull();
    expect(extractUrlFromTag(undefined)).toBeNull();
  });
});
