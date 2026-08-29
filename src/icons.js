import React from 'react';

/**
 * Ritual icon system — Sage & Berry UX refresh.
 *
 * One consistent line-icon set: 24x24 viewBox, stroke 1.8, round caps/joins,
 * currentColor, no fills anywhere. Accent dots are drawn as zero-length
 * stroked subpaths (e.g. `M12 18.5h.01`) which render as round dots.
 *
 * These same glyphs get laser-etched onto the physical NFC tiles, so every
 * shape is buildable from strokes alone and stays legible at 16px.
 */

// Registry: icon name -> one JSX fragment of <path/circle/rect/line> elements.
// Geometry attributes only — the <Icon> wrapper supplies stroke/fill props.
const ICON_PATHS = {
  // ---------------------------------------------------------------- core UI
  flame: (
    <>
      <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3 1-6 1-9z" />
    </>
  ),
  star: (
    <>
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3q1 7 9 9-8 2-9 9-1-7-9-9 8-2 9-9z" />
    </>
  ),
  check: (
    <>
      <path d="M5 12l5 5L20 7" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  undo: (
    <>
      <path d="M3 2v6h6" />
      <path d="M3.51 9a9 9 0 1 0 2.13-3.36L3 8" />
    </>
  ),
  refresh: (
    <>
      <path d="M3.5 12a8.5 8.5 0 0 1 15.2-5.2" />
      <path d="M18.7 2.5v4.3h-4.3" />
      <path d="M20.5 12a8.5 8.5 0 0 1-15.2 5.2" />
      <path d="M5.3 21.5v-4.3h4.3" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4.5L21 19.5H3z" />
      <path d="M12 10.5v4" />
      <path d="M12 17.3h.01" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
      <path d="M12 8v13" />
      <path d="M12 8C11 5 10 4 8.5 4a2 2 0 0 0 0 4z" />
      <path d="M12 8c1-3 2-4 3.5-4a2 2 0 0 1 0 4z" />
    </>
  ),
  users: (
    <>
      <circle cx="8.5" cy="7.5" r="3.5" />
      <path d="M15 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <path d="M16 4.4a4 4 0 0 1 0 7.2" />
      <path d="M22 20v-1.5a4 4 0 0 0-3-3.9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
    </>
  ),
  crown: (
    <>
      <path d="M3 7.5l4 3.5 5-6.5 5 6.5 4-3.5-2 11H5z" />
    </>
  ),
  wave: (
    <>
      <path d="M8.5 12V6a1.5 1.5 0 0 1 3 0v5.5" />
      <path d="M11.5 11.5V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14.5 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-12 0v-3.5a1.5 1.5 0 0 1 3 0" />
    </>
  ),
  hourglass: (
    <>
      <path d="M6 2.5h12" />
      <path d="M6 21.5h12" />
      <path d="M7.5 2.5v3.8c0 1.6 4.5 3.6 4.5 5.7s-4.5 4.1-4.5 5.7v3.8" />
      <path d="M16.5 2.5v3.8c0 1.6-4.5 3.6-4.5 5.7s4.5 4.1 4.5 5.7v3.8" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 6.5l9 6.5 9-6.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9z" />
      <path d="M10.3 19a2 2 0 0 0 3.4 0" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10.5" width="16" height="10.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  key: (
    <>
      <circle cx="15.5" cy="8.5" r="4.5" />
      <path d="M12.3 11.7L3 21" />
      <path d="M6 18l2.5 2.5" />
      <path d="M9 15l2 2" />
    </>
  ),
  sound: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4.5H6.5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2H15" />
      <rect x="9" y="2.5" width="6" height="4" rx="1" />
      <path d="M8.5 11h7" />
      <path d="M8.5 14.5h7" />
      <path d="M8.5 18h4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </>
  ),
  trendup: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  trenddown: (
    <>
      <path d="M3 7l6 6 4-4 8 8" />
      <path d="M15 17h6v-6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </>
  ),
  bulb: (
    <>
      <path d="M12 2.5a6.5 6.5 0 0 0-4 11.6c.6.5 1 1.2 1 2V18h6v-1.9c0-.8.4-1.5 1-2A6.5 6.5 0 0 0 12 2.5z" />
      <path d="M9 18h6" />
      <path d="M10 21h4" />
    </>
  ),
  trophy: (
    <>
      <path d="M4 20h16M6 20V9a6 6 0 0 1 12 0v11M9 12h6" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="6" />
      <circle cx="12" cy="15" r="2.5" />
      <path d="M8.2 10.3L5 2.5h5.2L12 6.5" />
      <path d="M15.8 10.3L19 2.5h-5.2L12 6.5" />
    </>
  ),
  science: (
    <>
      <path d="M9 2.5v6.2L3.8 18a2 2 0 0 0 1.7 3h13a2 2 0 0 0 1.7-3L15 8.7V2.5" />
      <path d="M8 2.5h8" />
      <path d="M7.2 14h9.6" />
    </>
  ),
  wrench: (
    <>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </>
  ),
  broom: (
    <>
      <path d="M12 2.5v9" />
      <path d="M7 11.5h10l1.5 5.5a2 2 0 0 1-1.9 2.5H7.4a2 2 0 0 1-1.9-2.5z" />
      <path d="M9.5 12v7.5" />
      <path d="M12 12v7.5" />
      <path d="M14.5 12v7.5" />
    </>
  ),
  tile: (
    <>
      <path d="M12 2L20.66 7v10L12 22 3.34 17V7z" />
    </>
  ),

  // -------------------------------------------------------------- tab bar
  diamond: (
    <>
      <path d="M12 3l9 9-9 9-9-9z" />
    </>
  ),
  circle: (
    <>
      <circle cx="12" cy="12" r="7" />
    </>
  ),
  rings: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  ),

  // ------------------------------------------------------ habits & rewards
  home: (
    <>
      <path d="M4 10l8-6 8 6v10H4zM10 20v-6h4v6" />
    </>
  ),
  bed: (
    <>
      <path d="M3 20v-9" />
      <path d="M3 14h13a5 5 0 0 1 5 5v1" />
      <path d="M3 17.5h18" />
      <circle cx="7.5" cy="11" r="2" />
    </>
  ),
  dinner: (
    <>
      <path d="M6 3v5a2.5 2.5 0 0 0 5 0V3" />
      <path d="M8.5 10.5V21" />
      <path d="M17 3v18" />
      <path d="M17 3c2.2 2 2.7 5.6 0 7.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16" />
      <path d="M9 6.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2.5" />
      <path d="M6.5 6.5V20a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  paw: (
    <>
      <circle cx="7" cy="9" r="1.8" />
      <circle cx="10.2" cy="6.4" r="1.8" />
      <circle cx="13.8" cy="6.4" r="1.8" />
      <circle cx="17" cy="9" r="1.8" />
      <path d="M12 12.2c3 0 5.2 2.3 5.2 4.8 0 1.9-1.5 3.3-3.4 3.3-.7 0-1.2-.3-1.8-.3s-1.1.3-1.8.3c-1.9 0-3.4-1.4-3.4-3.3 0-2.5 2.2-4.8 5.2-4.8z" />
    </>
  ),
  box: (
    <>
      <path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5L12 12l9-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  backpack: (
    <>
      <rect x="5" y="7" width="14" height="14" rx="4" />
      <path d="M9 7V5.5a3 3 0 0 1 6 0V7" />
      <path d="M9 21v-5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V21" />
      <path d="M10.5 17.5h3" />
    </>
  ),
  pill: (
    <>
      <rect x="4" y="9" width="16" height="6" rx="3" transform="rotate(-30 12 12)" />
      <path d="M9.5 8.5l5 3" />
    </>
  ),
  moon: (
    <>
      <path d="M20.5 14.8A9 9 0 1 1 9.2 3.5a7 7 0 0 0 11.3 11.3z" />
    </>
  ),
  droplet: (
    <>
      <path d="M12 3.2c3.2 3.8 6 6.6 6 9.8a6 6 0 0 1-12 0c0-3.2 2.8-6 6-9.8z" />
    </>
  ),
  herb: (
    <>
      <path d="M12 21V10" />
      <path d="M12 13c0-3 2-5.5 5-6 .3 3.2-1.8 6-5 6z" />
      <path d="M12 17c0-2.6-1.7-4.8-4.3-5.3-.3 2.8 1.6 5.3 4.3 5.3z" />
    </>
  ),
  leaf: (
    <>
      <path d="M20.5 3.5C10 4 4 9.5 4 17a4.5 4.5 0 0 0 4.5 4.5c7.5 0 12-6 12-18z" />
      <path d="M4.5 21C8 16.5 12 13.5 17 11.5" />
    </>
  ),
  lotus: (
    <>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 9c-2.2 0-3.8 1.7-4.6 3.6L6 16" />
      <path d="M12 9c2.2 0 3.8 1.7 4.6 3.6L18 16" />
      <path d="M5 19.5c0-2.2 3.1-4 7-4s7 1.8 7 4z" />
    </>
  ),
  suncream: (
    <>
      <rect x="6.5" y="8.5" width="11" height="13" rx="2.5" />
      <rect x="9.5" y="4" width="5" height="4.5" rx="1" />
      <path d="M6.5 13h11" />
    </>
  ),
  coffee: (
    <>
      <path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M17 9.5h1.5a3 3 0 0 1 0 6H17" />
      <path d="M8 2.5v2.5" />
      <path d="M12 2.5v2.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
    </>
  ),
  apple: (
    <>
      <path d="M12 8.5c-1.2-1.6-3.2-2.4-5-1.4C4.6 8.4 4.2 11.4 5.2 14.6c.9 3 2.6 5.4 4.3 5.4.8 0 1.4-.5 2.5-.5s1.7.5 2.5.5c1.7 0 3.4-2.4 4.3-5.4 1-3.2.6-6.2-1.8-7.5-1.8-1-3.8-.2-5 1.4z" />
      <path d="M12 8.5V5.5" />
      <path d="M12.2 5.6c-.2-1.8 1-3.3 2.8-3.5.2 1.8-1 3.3-2.8 3.5z" />
    </>
  ),
  phoneoff: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
      <path d="M10.5 5.5h3" />
      <path d="M4 20L20 4" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10.5 5 8.3 4.2 5.5 4.2c-.8 0-1.5.6-1.5 1.4v11.2c0 .8.7 1.4 1.5 1.4 2.8 0 5 .8 6.5 2.3" />
      <path d="M12 6.5c1.5-1.5 3.7-2.3 6.5-2.3.8 0 1.5.6 1.5 1.4v11.2c0 .8-.7 1.4-1.5 1.4-2.8 0-5 .8-6.5 2.3" />
      <path d="M12 6.5v14" />
    </>
  ),
  alarm: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 1.8" />
      <path d="M5 3L2 6" />
      <path d="M19 3l3 3" />
    </>
  ),
  tooth: (
    <>
      <path d="M12 6.5c-1.4-2.2-3.4-3.3-5.3-2.6C4.4 4.7 3.6 7.4 4.4 11c.5 2.2.8 3.6.9 5.4.1 1.8.6 4.1 2 4.1 1.7 0 1.9-2.6 2.4-4.6.3-1.3.7-2.2 2.3-2.2s2 .9 2.3 2.2c.5 2 .7 4.6 2.4 4.6 1.4 0 1.9-2.3 2-4.1.1-1.8.4-3.2.9-5.4.8-3.6 0-6.3-2.3-7.1-1.9-.7-3.9.4-5.3 2.6z" />
    </>
  ),
  run: (
    <>
      <circle cx="15.5" cy="4.5" r="2" />
      <path d="M15 8.5L11.5 13l3 3 .5 5" />
      <path d="M11.5 13L7 14.5 5 19" />
      <path d="M13.5 10l4 2 1 3.5" />
      <path d="M13 9.5L9.5 8" />
    </>
  ),
  walk: (
    <>
      <circle cx="12.5" cy="4.5" r="2" />
      <path d="M12.5 8.5L11.5 13.5l-1.7 3.7L9 21" />
      <path d="M11.5 13.5l2.5 3 .6 4.5" />
      <path d="M12.2 10L9.3 12.5" />
      <path d="M12.2 10l3 2.8" />
    </>
  ),
  stretch: (
    <>
      <circle cx="12" cy="4" r="2" />
      <path d="M12 8v6" />
      <path d="M12 14l-4 7" />
      <path d="M12 14l4 7" />
      <path d="M12 9L7.5 6" />
      <path d="M12 9l4.5-3" />
    </>
  ),
  stand: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 8.5v7" />
      <path d="M12 15.5L10 21" />
      <path d="M12 15.5L14 21" />
      <path d="M8.5 11h7" />
    </>
  ),
  bath: (
    <>
      <path d="M2.5 12h19v3.5a4.5 4.5 0 0 1-4.5 4.5H7a4.5 4.5 0 0 1-4.5-4.5z" />
      <path d="M6 12V6.5A2.5 2.5 0 0 1 8.5 4h1" />
      <path d="M6.5 20L5 22" />
      <path d="M17.5 20l1.5 2" />
    </>
  ),
  salad: (
    <>
      <path d="M3 12.5h18a9 9 0 0 1-18 0z" />
      <path d="M7.5 12.5c-1-2 0-4.2 2.2-5" />
      <path d="M12 12.5c-.8-2.4.5-4.8 3-5.4" />
      <path d="M16.5 12.5c.3-1.9 1.9-3.2 3.9-3.1" />
    </>
  ),
  music: (
    <>
      <circle cx="7" cy="18" r="2.5" />
      <circle cx="18" cy="16" r="2.5" />
      <path d="M9.5 18V6l11-2v12" />
    </>
  ),
  cook: (
    <>
      <path d="M2.5 11.5h13v1.5a6.5 6.5 0 0 1-13 0z" />
      <path d="M15.5 12L21.5 8" />
      <circle cx="9" cy="14.5" r="2" />
    </>
  ),
  heart: (
    <>
      <path d="M12 20.8L3.9 12.9a5.1 5.1 0 0 1 7.2-7.2l.9.9.9-.9a5.1 5.1 0 0 1 7.2 7.2z" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.9l2.5 1.8-1 3H10.5l-1-3z" />
      <path d="M12 8.9V3" />
      <path d="M14.5 10.7l5.6-1.8" />
      <path d="M13.5 13.7l3.3 6.2" />
      <path d="M10.5 13.7l-3.3 6.2" />
      <path d="M9.5 10.7L3.9 8.9" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14.5a4.5 4.5 0 0 0 8 0" />
      <path d="M9 9.5h.01" />
      <path d="M15 9.5h.01" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12h.01" />
    </>
  ),
  pizza: (
    <>
      <path d="M12 2.5l9.5 17.5a1.5 1.5 0 0 1-1.6 2.1c-5.2-1-10.6-1-15.8 0a1.5 1.5 0 0 1-1.6-2.1z" />
      <path d="M4.5 17.5c5-1 10-1 15 0" />
      <path d="M11 10h.01" />
      <path d="M14 14.5h.01" />
      <path d="M9 15h.01" />
    </>
  ),
  seedling: (
    <>
      <path d="M12 21v-7.5" />
      <path d="M12 15.5c-3.3 0-6-2.7-6-6 3.3 0 6 2.7 6 6z" />
      <path d="M12 13.5c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6z" />
      <path d="M6.5 21h11" />
    </>
  ),
  tree: (
    <>
      <path d="M8 16a4.5 4.5 0 0 1-1.9-8.6A5 5 0 0 1 12 3a5 5 0 0 1 5.9 4.4A4.5 4.5 0 0 1 16 16z" />
      <path d="M12 22v-6" />
      <path d="M12 19l-2.5-2.5" />
      <path d="M12 20.5l2.5-2.5" />
    </>
  ),
  muscle: (
    <>
      <path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3z" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="2.5" y="14" width="4.5" height="6.5" rx="2.2" />
      <rect x="17" y="14" width="4.5" height="6.5" rx="2.2" />
    </>
  ),
  cards: (
    <>
      <path d="M7 6H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
      <rect x="7" y="2.5" width="14" height="14" rx="2" />
      <path d="M10.5 7h7" />
      <path d="M10.5 11h4" />
    </>
  ),
  wind: (
    <>
      <path d="M2.5 8.5h11A3.2 3.2 0 1 0 10.3 5.3" />
      <path d="M2.5 12.5h6" />
      <path d="M2.5 16.5h8.5a3.2 3.2 0 1 1-3.2 3.2" />
    </>
  ),
  pray: (
    <>
      <path d="M12 3.5C10.7 5.5 8.7 8.5 7.8 10.3c-.9 1.7-1.4 3-1.4 4.4 0 1.5.6 2.8 1.6 3.8" />
      <path d="M12 3.5c1.3 2 3.3 5 4.2 6.8.9 1.7 1.4 3 1.4 4.4 0 1.5-.6 2.8-1.6 3.8" />
      <path d="M12 4.5v14" />
      <path d="M8 18.5h8" />
      <path d="M9.2 21.5h5.6" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2.5" y="7" width="19" height="13" rx="2" />
      <path d="M8.5 7V5.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2V7" />
      <path d="M2.5 12.5h19" />
    </>
  ),
  palette: (
    <>
      <path d="M12 2.5c5.2 0 9.5 3.9 9.5 8.7 0 2.6-2.1 4.3-4.7 4.3h-1.7c-1.2 0-2.1 1-2.1 2.1 0 .5.2 1 .5 1.4.3.4.5.9.5 1.4 0 1.2-1 2.1-2.1 2.1C6.9 22.5 2.5 18 2.5 12.5S6.8 2.5 12 2.5z" />
      <path d="M7.5 12.5h.01" />
      <path d="M9.5 8.5h.01" />
      <path d="M14 7.5h.01" />
      <path d="M17.5 10.5h.01" />
    </>
  ),
  gamepad: (
    <>
      <rect x="2" y="7.5" width="20" height="10" rx="4.5" />
      <path d="M7 11v3" />
      <path d="M5.5 12.5h3" />
      <path d="M16 11.5h.01" />
      <path d="M18.5 13.5h.01" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M10.5 5.5h3" />
      <path d="M12 18.5h.01" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="4.5" width="16" height="11" rx="1.5" />
      <path d="M2.5 18.5h19" />
    </>
  ),
  shower: (
    <>
      <path d="M12 2.5v4" />
      <path d="M5.5 10.5a6.5 6.5 0 0 1 13 0z" />
      <path d="M8 13.5v2" />
      <path d="M12 13.5v2" />
      <path d="M16 13.5v2" />
      <path d="M9.5 18v2" />
      <path d="M14.5 18v2" />
    </>
  ),
  party: (
    <>
      <path d="M2.5 21.5L8 9l7 7z" />
      <path d="M5.2 15.3l4.5 4.5" />
      <path d="M12.5 4.5h.01" />
      <path d="M17 3h.01" />
      <path d="M20 7.5h.01" />
      <path d="M15.5 9h.01" />
      <path d="M20.5 13h.01" />
    </>
  ),
  rainbow: (
    <>
      <path d="M3 18a9 9 0 0 1 18 0" />
      <path d="M6.5 18a5.5 5.5 0 0 1 11 0" />
      <path d="M10 18a2 2 0 0 1 4 0" />
    </>
  ),
  butterfly: (
    <>
      <path d="M12 6.5v12" />
      <path d="M12 9.5C10.6 7.1 8.3 5.8 6.6 6.5 4.6 7.3 4.2 10 5.4 12c-1.2 1.2-1.4 3.5.1 4.8 1.6 1.4 4.4.9 6.5-1.9" />
      <path d="M12 9.5c1.4-2.4 3.7-3.7 5.4-3 2 .8 2.4 3.5 1.2 5.5 1.2 1.2 1.4 3.5-.1 4.8-1.6 1.4-4.4.9-6.5-1.9" />
      <path d="M12 6.5L10 3.8" />
      <path d="M12 6.5l2-2.7" />
    </>
  ),
  flower: (
    <>
      <circle cx="12" cy="6.5" r="3" />
      <circle cx="17.2" cy="10.3" r="3" />
      <circle cx="15.2" cy="16.4" r="3" />
      <circle cx="8.8" cy="16.4" r="3" />
      <circle cx="6.8" cy="10.3" r="3" />
      <circle cx="12" cy="12" r="1.6" />
    </>
  ),
  gem: (
    <>
      <path d="M6 3h12l3.5 6L12 21.5 2.5 9z" />
      <path d="M2.5 9h19" />
      <path d="M9 3L7 9l5 12.5" />
      <path d="M15 3l2 6-5 12.5" />
    </>
  ),
  movie: (
    <>
      <rect x="2.5" y="3.5" width="19" height="17" rx="2" />
      <path d="M2.5 9h19" />
      <path d="M6.5 3.5L4 9" />
      <path d="M12 3.5L9.5 9" />
      <path d="M17.5 3.5L15 9" />
    </>
  ),
  money: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5" />
      <path d="M18 9.5v5" />
    </>
  ),
  ferris: (
    <>
      <circle cx="12" cy="10" r="7.5" />
      <path d="M12 2.5v15" />
      <path d="M4.5 10h15" />
      <path d="M6.7 4.7l10.6 10.6" />
      <path d="M17.3 4.7L6.7 15.3" />
      <path d="M12 17.5L8.5 22" />
      <path d="M12 17.5l3.5 4.5" />
      <path d="M8 22h8" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5v1a6.5 6.5 0 0 0 13 0v-1" />
      <path d="M12 19v2.5" />
      <path d="M8.5 21.5h7" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 2.5c3.5 2.5 5.5 6.5 5.5 11L15 17H9l-2.5-3.5c0-4.5 2-8.5 5.5-11z" />
      <circle cx="12" cy="10" r="2" />
      <path d="M9 17c-1.5 1.3-2 3-1.8 4.5 1.5-.3 2.8-1.2 3.5-2.5" />
      <path d="M15 17c1.5 1.3 2 3 1.8 4.5-1.5-.3-2.8-1.2-3.5-2.5" />
    </>
  ),
  unicorn: (
    <>
      <path d="M12 2l3.5 18.5h-7z" />
      <path d="M10.2 12.5l3.8-.8" />
      <path d="M9.6 16l5.3-1" />
      <path d="M11 9l2.2-.5" />
    </>
  ),
  icecream: (
    <>
      <path d="M7.5 11.5L12 21.5l4.5-10z" />
      <path d="M7 11.5a5 5 0 0 1 10 0z" />
      <path d="M9.5 16h5" />
    </>
  ),
  beach: (
    <>
      <path d="M3 11.5a9 9 0 0 1 18 0" />
      <path d="M3 11.5c1.5-2.2 3-2.2 4.5 0s3 2.2 4.5 0 3-2.2 4.5 0 3 2.2 4.5 0" />
      <path d="M12 11.5V21" />
      <path d="M8.5 21h7" />
    </>
  ),
  cake: (
    <>
      <path d="M4 21h16" />
      <path d="M4.5 21v-6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v6" />
      <path d="M4.5 16.5c1.2 0 1.2 1.5 2.4 1.5s1.2-1.5 2.4-1.5 1.2 1.5 2.4 1.5 1.2-1.5 2.4-1.5 1.2 1.5 2.4 1.5 1.2-1.5 2.4-1.5" />
      <path d="M12 13V9" />
      <path d="M12 9c1-1 1-2.2 0-3.2-1 1-1 2.2 0 3.2z" />
    </>
  ),
  guitar: (
    <>
      <path d="M12 8c1.6 0 2.7 1.2 2.7 2.6 0 .9-.4 1.5-.4 2.2 0 .9.7 1.4 1.3 2.1.7.9 1.2 1.8 1.2 2.8 0 2.2-2 3.8-4.8 3.8s-4.8-1.6-4.8-3.8c0-1 .5-1.9 1.2-2.8.6-.7 1.3-1.2 1.3-2.1 0-.7-.4-1.3-.4-2.2C9.3 9.2 10.4 8 12 8z" />
      <path d="M12 8V2.8" />
      <rect x="10.4" y="1" width="3.2" height="2" rx="0.6" />
      <circle cx="12" cy="16" r="1.7" />
    </>
  ),
  journal: (
    <>
      <rect x="4" y="2.5" width="15" height="19" rx="2" />
      <path d="M7.5 2.5v19" />
      <path d="M10.5 8h5.5" />
      <path d="M10.5 12h5.5" />
      <path d="M10.5 16h3.5" />
    </>
  ),
};

export function Icon({ name, size = 24, strokeWidth = 1.8, style = {}, color }) {
  const glyph = ICON_PATHS[name] || ICON_PATHS.tile;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}>
      {glyph}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(ICON_PATHS);

// NOTE: the emoji literals below are LEGACY DATABASE VALUES (stored habit /
// reward `icon` columns and template data), not UI content. They exist purely
// so old rows resolve to a line icon. They are therefore exempt from the
// "no emoji anywhere in the UI" rule — never render these keys, only map them.
export const EMOJI_TO_ICON = {
  // core UI
  '\u{1F525}': 'flame',
  '⭐': 'star',
  '\u{1F31F}': 'star',
  '✦': 'spark',
  '✨': 'spark',
  '✓': 'check',
  '✔': 'check',
  '✔️': 'check',
  '✅': 'check',
  '✕': 'close',
  '❌': 'close',
  '↩': 'undo',
  '↩️': 'undo',
  '\u{1F504}': 'undo',
  '↻': 'refresh',
  '✎': 'edit',
  '✏': 'edit',
  '✏️': 'edit',
  '⚠': 'warning',
  '⚠️': 'warning',
  '\u{1F381}': 'gift',
  '\u{1F465}': 'users',
  '\u{1F468}‍\u{1F469}‍\u{1F467}': 'users',
  '\u{1F91D}': 'users',
  '\u{1F464}': 'user',
  '\u{1F451}': 'crown',
  '\u{1F44B}': 'wave',
  '⏳': 'hourglass',
  '✉': 'mail',
  '✉️': 'mail',
  '\u{1F514}': 'bell',
  '\u{1F512}': 'lock',
  '\u{1F511}': 'key',
  '\u{1F50A}': 'sound',
  '➕': 'plus',
  '\u{1F4C4}': 'document',
  '\u{1F4CB}': 'clipboard',
  '\u{1F4CA}': 'chart',
  '\u{1F4C8}': 'trendup',
  '\u{1F4C9}': 'trenddown',
  '\u{1F4C5}': 'calendar',
  '\u{1F4A1}': 'bulb',
  '\u{1F3C6}': 'trophy',
  '\u{1F947}': 'medal',
  '\u{1F948}': 'medal',
  '\u{1F949}': 'medal',
  '\u{1F52C}': 'science',
  '\u{1F527}': 'wrench',
  '\u{1F9F9}': 'broom',
  '⚙': 'gear',
  '⚙️': 'gear',

  // habits, templates, rewards
  '\u{1F3E0}': 'home',
  '\u{1F6CF}': 'bed',
  '\u{1F6CF}️': 'bed',
  '\u{1F37D}': 'dinner',
  '\u{1F37D}️': 'dinner',
  '\u{1F374}': 'dinner',
  '\u{1F5D1}': 'trash',
  '\u{1F5D1}️': 'trash',
  '\u{1F43E}': 'paw',
  '\u{1F4E6}': 'box',
  '\u{1F392}': 'backpack',
  '\u{1F48A}': 'pill',
  '\u{1F319}': 'moon',
  '\u{1F4A7}': 'droplet',
  '\u{1F33F}': 'herb',
  '\u{1F343}': 'leaf',
  '\u{1F9D8}': 'lotus',
  '\u{1F9F4}': 'suncream',
  '☕': 'coffee',
  '☀': 'sun',
  '☀️': 'sun',
  '\u{1F34E}': 'apple',
  '\u{1F4F5}': 'phoneoff',
  '\u{1F4D6}': 'book',
  '\u{1F4DA}': 'book',
  '⏰': 'alarm',
  '\u{1F9B7}': 'tooth',
  '\u{1F3C3}': 'run',
  '\u{1F4D3}': 'journal',
  '\u{1F3B8}': 'guitar',
  '\u{1F30D}': 'globe',
  '\u{1F3A7}': 'headphones',
  '\u{1F0CF}': 'cards',
  '\u{1F32C}': 'wind',
  '\u{1F32C}️': 'wind',
  '\u{1F64F}': 'pray',
  '\u{1F333}': 'tree',
  '\u{1F4AA}': 'muscle',
  '\u{1F3CB}': 'muscle',
  '\u{1F3CB}️': 'muscle',
  '\u{1F6B6}': 'walk',
  '\u{1F938}': 'stretch',
  '\u{1F6C1}': 'bath',
  '\u{1F957}': 'salad',
  '\u{1F9CD}': 'stand',
  '\u{1F3B5}': 'music',
  '\u{1F373}': 'cook',
  '\u{1F49B}': 'heart',
  '⚽': 'ball',
  '\u{1F60A}': 'smile',
  '\u{1F3AF}': 'target',
  '\u{1F355}': 'pizza',
  '\u{1F331}': 'seedling',
  '\u{1F4BC}': 'briefcase',
  '\u{1F3A8}': 'palette',
  '\u{1F3AE}': 'gamepad',
  '\u{1F4F1}': 'phone',
  '\u{1F4BB}': 'laptop',
  '\u{1F6BF}': 'shower',
  '\u{1F389}': 'party',
  '\u{1F38A}': 'party',
  '\u{1F308}': 'rainbow',
  '\u{1F98B}': 'butterfly',
  '\u{1F338}': 'flower',
  '\u{1F48E}': 'gem',
  '\u{1F3AC}': 'movie',
  '\u{1F3AD}': 'movie',
  '\u{1F3AA}': 'movie',
  '\u{1F4B5}': 'money',
  '\u{1F4B0}': 'money',
  '\u{1F3A1}': 'ferris',
  '\u{1F3A2}': 'ferris',
  '\u{1F3A0}': 'ferris',
  '\u{1F3A4}': 'mic',
  '\u{1F680}': 'rocket',
  '\u{1F984}': 'unicorn',
  '\u{1F366}': 'icecream',
  '\u{1F3D6}': 'beach',
  '\u{1F3D6}️': 'beach',
  '\u{1F382}': 'cake',
};

// Resolve a stored habit/reward icon value (emoji string OR icon name)
// to an icon name in ICON_PATHS.
export function iconNameFor(value) {
  if (!value) return 'tile';
  if (ICON_PATHS[value]) return value;
  return EMOJI_TO_ICON[value] || 'tile';
}

// Custom-ritual picker — 1:1 with the legacy custom-emoji grid, deduped.
export const CUSTOM_ICON_CHOICES = [
  'smile', 'home', 'muscle', 'book', 'target', 'star', 'spark', 'flame',
  'droplet', 'apple', 'salad', 'run', 'lotus', 'music', 'coffee', 'pizza',
  'seedling', 'briefcase', 'palette', 'gamepad', 'phone', 'laptop', 'bed',
  'dinner', 'broom', 'shower', 'party', 'rainbow', 'butterfly', 'flower',
  'guitar', 'trophy', 'gem', 'globe', 'headphones', 'journal', 'moon', 'sun',
];

// Reward picker — 1:1 with the legacy reward-emoji grid, deduped.
export const REWARD_ICON_CHOICES = [
  'gift', 'gamepad', 'movie', 'pizza', 'icecream', 'beach', 'ferris', 'target',
  'star', 'trophy', 'mic', 'palette', 'book', 'rocket', 'unicorn', 'cake',
];
