// Parse a tile URL into a normalised tile UID, or null if the URL doesn't
// carry one. Handles both /t/{id} path-style and ?tile={id} query-string
// formats, with a https:// prepend for protocol-less inputs (NFC tags
// sometimes omit it). Genuinely no-throw — caller does not need try/catch.
//
// Extracted verbatim from src/App.js so it can be unit-tested; behaviour
// must stay byte-for-byte identical to the passive deep-link path.
export function parseTileUrl(urlStr) {
  if (!urlStr) return null;
  let normalized = urlStr;
  if (!normalized.includes('://')) normalized = 'https://' + normalized;
  let url;
  try { url = new URL(normalized); } catch { return null; }
  let raw = null;
  const pathMatch = url.pathname.match(/^\/t\/(.+)$/);
  if (pathMatch) {
    try { raw = decodeURIComponent(pathMatch[1]); } catch { return null; }
  }
  if (!raw) raw = url.searchParams.get('tile');
  if (!raw) return null;
  // Tile UIDs may arrive as 04:A3:2B or 04.A3.2B — strip separators, uppercase.
  return raw.replace(/[:.]/g, '').toUpperCase();
}
