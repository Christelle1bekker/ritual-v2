// ─── SAGE & BERRY DESIGN TOKENS ──────────────────────────────────
// Single source of truth for every colour in the app. The app styles
// everything with inline JS styles, so this JS module is the repo's
// equivalent of a tokens.css. If a colour isn't in here, it doesn't ship.
//
// Colour rules:
// - Berry (act) only on things you can tap: Tap-tile pill, FAB, active tab,
//   avatar ring, primary buttons. Never as a bar fill, never as decoration.
// - Points / progress / streak are always sun orange (pts).
// - Done states are always green (done).
// - The dark card is forest ink (darkCard), not charcoal.
// - Nothing terracotta, nothing cream.

export const T = {
  // surfaces
  bg: '#F1F4EC',
  card: '#FFFFFF',
  card2: '#F8FAF5',
  line: '#DDE4D8',
  iconBg: '#E7EDE1',

  // text
  ink: '#1C3A2E',
  ink2: '#54685B',
  mute: '#8B9C90',

  // semantic
  act: '#D9467A',        // berry: everything tappable
  actSoft: '#FBE3EB',
  done: '#3F9A5C',       // completed state, positive copy, strength bars
  doneSoft: '#DCE7DA',   // Beka app-icon sage
  pts: '#F5A623',        // points, progress fill, streak flame
  ptsSoft: '#FDEBCF',
  ptsDeep: '#7E4A00',    // text on ptsSoft

  // dark card (family view / no-tree progress)
  darkCard: '#1C3A2E',
  darkMuted: '#9FB8AB',
  darkQuote: '#D7E3DC',

  // utility (not in the palette spec but needed by existing UI)
  white: '#FFFFFF',
  error: '#C0504D',
};

// tree
export const TREE = {
  g1: '#4F9A5C',        // shadow clumps
  g2: '#86C784',        // mid
  g3: '#B4DBA9',        // light
  g4: '#D3EBC9',        // lightest, top
  trunk: '#9A7B5A',
  trunk2: '#7A5F42',
  ground: '#DCE7DA',
  soil: '#CCD9C4',
  plate: '#E6F0E2',
  highlight: '#FFFFFF',
  fruit: '#F5A623',
};

// type: unchanged — keep the current serif display + sans body pairing
export const FONTS = {
  heading: "'DM Serif Display', serif",
  body: "'DM Sans', sans-serif",
};

// Member identity colours (avatar/habit accents chosen at setup). Harmonised
// with the palette; berry stays first so the "tappable" accent leads.
export const MEMBER_COLORS = ['#D9467A', '#3F9A5C', '#7E4A00', '#F5A623', '#5B8DB8', '#54685B', '#9B7EC8', '#8B9C90'];
export const SETUP_MEMBER_COLORS = ['#D9467A', '#F5A623', '#4F9A5C', '#8B9EC4', '#B07DB8', '#8B9C90'];

// ─── LEGACY COLOUR MAPPING ───────────────────────────────────────
// Member / habit / reward colours are stored as hex in the DB, so existing
// rows still carry the old cream/terracotta palette. Map them to the nearest
// Sage & Berry colour at normalise time — render-time only, no DB writes.
const LEGACY_COLOR_MAP = {
  // old C.* palette
  '#C17B4E': '#D9467A', '#D4956A': '#F5A623', // accent, accentLight
  '#5C7A5E': '#3F9A5C', '#7A9E7C': '#3F9A5C', // green, greenLight
  '#8B7355': '#7E4A00', '#A08C6E': '#7E4A00', // warm, warmLight
  '#E8854A': '#F5A623', '#F0A070': '#F5A623', // kids, kidsLight
  '#5B8DB8': '#5B8DB8', '#9B7EC8': '#9B7EC8', // kidsBlue, kidsPurple (kept)
  '#5A6B72': '#54685B', '#3D4A4F': '#1C3A2E', '#2A3438': '#1C3A2E', // slates
  '#E8E0D5': '#DDE4D8', '#F2EDE7': '#F1F4EC', '#C9BFB3': '#8B9C90', // sands
  '#FAF8F5': '#FFFFFF', '#F5F0EB': '#F8FAF5', // whites
  // old SETUP_MEMBER_COLORS
  '#C47B4A': '#D9467A', '#7A9E87': '#4F9A5C', '#C4AA70': '#F5A623',
};

export function mapLegacyColor(hex) {
  if (!hex || typeof hex !== 'string') return hex;
  return LEGACY_COLOR_MAP[hex.toUpperCase()] || LEGACY_COLOR_MAP[hex] || hex;
}
