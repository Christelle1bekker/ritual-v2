// Pure NDEF URI-record decoding, extracted from src/hooks/useNfcScanner.js
// so it can be unit-tested. No Capacitor imports — plain data in, string out.

// NFC Forum URI Record Type Definition (RTD-URI 1.0) prefix table.
// First byte of a URI record's payload is an index into this table; the
// remainder of the payload is the rest of the URI as UTF-8 bytes.
// Codes 0x24–0xFF are reserved by the spec — treated as no-prefix.
export const NDEF_URI_PREFIXES = [
  '',                              // 0x00
  'http://www.',                   // 0x01
  'https://www.',                  // 0x02
  'http://',                       // 0x03
  'https://',                      // 0x04
  'tel:',                          // 0x05
  'mailto:',                       // 0x06
  'ftp://anonymous:anonymous@',    // 0x07
  'ftp://ftp.',                    // 0x08
  'ftps://',                       // 0x09
  'sftp://',                       // 0x0A
  'smb://',                        // 0x0B
  'nfs://',                        // 0x0C
  'ftp://',                        // 0x0D
  'dav://',                        // 0x0E
  'news:',                         // 0x0F
  'telnet://',                     // 0x10
  'imap:',                         // 0x11
  'rtsp://',                       // 0x12
  'urn:',                          // 0x13
  'pop:',                          // 0x14
  'sip:',                          // 0x15
  'sips:',                         // 0x16
  'tftp:',                         // 0x17
  'btspp://',                      // 0x18
  'btl2cap://',                    // 0x19
  'btgoep://',                     // 0x1A
  'tcpobex://',                    // 0x1B
  'irdaobex://',                   // 0x1C
  'file://',                       // 0x1D
  'urn:epc:id:',                   // 0x1E
  'urn:epc:tag:',                  // 0x1F
  'urn:epc:pat:',                  // 0x20
  'urn:epc:raw:',                  // 0x21
  'urn:epc:',                      // 0x22
  'urn:nfc:',                      // 0x23
];

// Decode a single NDEF record into a URI string, or null if the record
// is not a NFC Forum well-known URI record (TNF=1, type='U' / 0x55).
export function decodeUriRecord(record) {
  if (!record || record.tnf !== 1) return null;
  if (!Array.isArray(record.type) || record.type.length !== 1 || record.type[0] !== 0x55) return null;
  if (!Array.isArray(record.payload) || record.payload.length < 1) return null;
  const prefix = NDEF_URI_PREFIXES[record.payload[0]] ?? '';
  try {
    const rest = new TextDecoder('utf-8').decode(new Uint8Array(record.payload.slice(1)));
    return prefix + rest;
  } catch {
    return null;
  }
}

// Walk a tag's NDEF message and return the first URI record's URL, or null
// if no URI record is present. Production tiles have a single URI record;
// this iteration is defensive against mixed-record tiles or non-Ritual tags.
export function extractUrlFromTag(tag) {
  const records = tag?.ndefMessage;
  if (!Array.isArray(records)) return null;
  for (const record of records) {
    const url = decodeUriRecord(record);
    if (url) return url;
  }
  return null;
}
