// ─── GROWING TREE ────────────────────────────────────────────────
// One illustrated SVG asset, five stages, layers toggled by `stage` so the
// tree visibly grows rather than swapping pictures. Geometry is the approved
// artwork from docs/design/ritual-tree-detailed.html; every colour is re-bound
// to the Sage & Berry tokens (no hex literals live in this file).
//
//   0 seed   1 sprout   2 sapling   3 young tree   4 fruiting tree (+ bird)
//
// Ids are prefixed with React.useId() so several instances can share a page
// without <use href> resolving into another instance's <defs>.

import React from 'react';
import { TREE, T } from './styles/tokens';

const VB_W = 120;
const VB_H = 130;

const STAGE_LABELS = [
  'A seed in the soil',
  'A sprout with its first leaves',
  'A young sapling',
  'A growing tree',
  'A tree in fruit, with a bird',
];

// Map today's completion into a stage.
export function stageForProgress(done, total) {
  const t = Number(total) || 0;
  const d = Number(done) || 0;
  if (t <= 0 || d <= 0) return 0;
  const pct = d / t;
  if (pct >= 1) return 4;
  if (pct < 1 / 3) return 1;
  if (pct < 2 / 3) return 2;
  return 3;
}

// ─── artwork data ────────────────────────────────────────────────
// clumps: [x, y, width, height, tone]
const CLUMPS_2 = [
  [36, 62, 30, 24, 'g1'],
  [58, 58, 30, 24, 'g1'],
  [30, 46, 34, 27, 'g2'],
  [58, 42, 34, 27, 'g2'],
  [44, 30, 34, 27, 'g3'],
];

const CLUMPS_3 = [
  [18, 52, 38, 30, 'g1'],
  [66, 50, 38, 30, 'g1'],
  [42, 58, 36, 29, 'g1'],
  [12, 36, 42, 34, 'g2'],
  [66, 32, 42, 34, 'g2'],
  [38, 38, 44, 36, 'g2'],
  [26, 22, 40, 32, 'g3'],
  [58, 18, 38, 30, 'g3'],
  [44, 10, 32, 26, 'g4'],
];

const CLUMPS_4 = [
  [14, 50, 40, 32, 'g1'],
  [68, 48, 40, 32, 'g1'],
  [40, 56, 40, 32, 'g1'],
  [8, 34, 44, 36, 'g2'],
  [68, 30, 44, 36, 'g2'],
  [36, 36, 48, 38, 'g2'],
  [22, 18, 42, 34, 'g3'],
  [58, 14, 40, 32, 'g3'],
  [42, 6, 34, 28, 'g4'],
];

// leaves: [x, y, width, height, tone, transform]
const LEAVES_1 = [
  [43, 80, 12, 20, 'g2', 'rotate(-60 49 90)'],
  [64, 76, 12, 20, 'g3', 'rotate(50 70 86)'],
  [47, 66, 11, 18, 'g3', 'rotate(-35 52 75)'],
  [61, 62, 11, 18, 'g4', 'rotate(20 66 71)'],
];

const LEAVES_2 = [[26, 60, 8, 13, 'g2', 'rotate(-40 30 66)']];

const LEAVES_3 = [
  [8, 58, 8, 13, 'g2', 'rotate(-40 12 64)'],
  [104, 54, 8, 13, 'g2', 'rotate(35 108 60)'],
];

const LEAVES_4 = [
  [4, 56, 8, 13, 'g2', 'rotate(-40 8 62)'],
  [108, 52, 8, 13, 'g2', 'rotate(35 112 58)'],
];

// fruit: [x, y] — first five are the mockup's stage-4 positions, the sixth
// balances the low-right of the canopy (the hero drawing carries a sixth too).
const FRUIT_POS = [
  [22, 50],
  [54, 54],
  [84, 46],
  [40, 30],
  [72, 26],
  [76, 60],
];
const FRUIT_W = 11;
const FRUIT_H = 12;

// backplate: [translateY, scale] — grows and rises with the tree
const PLATE_TF = [
  'translate(0px, 10px) scale(0.92)',
  'translate(0px, 10px) scale(0.92)',
  'translate(0px, 6px) scale(0.92)',
  'none',
  'translate(0px, -4px) scale(1.04)',
];

const GROUND_TF = ['scale(0.95)', 'scale(0.95)', 'scale(0.95)', 'none', 'scale(1.05)'];

// ─── component ───────────────────────────────────────────────────
export default function GrowingTree({
  stage = 0,
  fruit = 0,
  size = 150,
  animate = true,
  style = {},
}) {
  const rawId = React.useId();
  const pid = 'gt' + String(rawId).replace(/[^a-zA-Z0-9_-]/g, '');

  const s = Math.max(0, Math.min(4, Math.round(Number(stage) || 0)));
  const nFruit = s === 4 ? Math.max(0, Math.min(FRUIT_POS.length, Math.floor(Number(fruit) || 0))) : 0;
  const w = Number(size) || 150;
  const h = (w * VB_H) / VB_W;

  const ease = 'cubic-bezier(.22,.61,.36,1)';
  const css = [
    `.${pid}-l,.${pid}-g{transform-box:view-box}`,
    `.${pid}-l{transform-origin:60px 108px}`,
    // visible: grow out of the trunk base and fade in
    `.${pid}-anim .${pid}-l{opacity:1;transform:scale(1);transition:opacity 400ms ${ease},transform 400ms ${ease}}`,
    // hidden: fade out first, only then reset the scale (no shrink-away)
    `.${pid}-anim .${pid}-l[data-on="0"]{opacity:0;transform:scale(.6);transition:opacity 180ms linear,transform 0s linear 180ms}`,
    `.${pid}-anim .${pid}-g{transition:transform 400ms ${ease}}`,
    // reduced motion / animate={false}: opacity only, never transform
    `.${pid}-still .${pid}-l{opacity:1;transform:none;transition:opacity 200ms linear}`,
    `.${pid}-still .${pid}-l[data-on="0"]{opacity:0;transform:none}`,
    `.${pid}-still .${pid}-g{transition:none}`,
    `@media (prefers-reduced-motion: reduce){`,
    `.${pid}-root .${pid}-l{transform:none !important;transition:opacity 200ms linear !important}`,
    `.${pid}-root .${pid}-l[data-on="0"]{opacity:0 !important}`,
    `.${pid}-root .${pid}-g{transition:none !important}`,
    `}`,
  ].join('\n');

  const on = (visible) => (visible ? '1' : '0');
  const tone = (key) => TREE[key];

  const clumps = (list) =>
    list.map((c, i) => (
      <use
        key={'c' + i}
        href={`#${pid}-clump`}
        x={c[0]}
        y={c[1]}
        width={c[2]}
        height={c[3]}
        fill={tone(c[4])}
      />
    ));

  const leaves = (list) =>
    list.map((l, i) => (
      <use
        key={'l' + i}
        href={`#${pid}-leaf`}
        x={l[0]}
        y={l[1]}
        width={l[2]}
        height={l[3]}
        fill={tone(l[4])}
        transform={l[5]}
      />
    ));

  return (
    <svg
      className={`${pid}-root ${animate ? `${pid}-anim` : `${pid}-still`}`}
      width={w}
      height={h}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      fill="none"
      stroke={T.ink}
      strokeWidth={1.4}
      strokeLinejoin="round"
      strokeLinecap="round"
      role="img"
      aria-label={STAGE_LABELS[s]}
      style={{ display: 'block', ...style }}
    >
      <style>{css}</style>

      <defs>
        {/* scalloped leaf clump, 40 x 32 */}
        <symbol id={`${pid}-clump`} viewBox="0 0 40 32">
          <path d="M4 20C1 14 5 8 10 9C10 3 18 1 22 6C26 1 34 3 34 9C39 9 41 16 37 20C40 26 34 31 28 28C24 33 14 33 12 28C6 31 1 26 4 20Z" />
        </symbol>
        {/* single leaf, 12 x 20 */}
        <symbol id={`${pid}-leaf`} viewBox="0 0 12 20">
          <path d="M6 1C11 6 12 13 6 19C0 13 1 6 6 1Z" />
          <path d="M6 4V17" fill="none" />
        </symbol>
        {/* fruit, 16 x 18 */}
        <symbol id={`${pid}-fruit`} viewBox="0 0 16 18">
          <path d="M8 4V1" fill="none" stroke={TREE.trunk2} strokeWidth={1.4} />
          <path d="M8 3c3-3 6-2 6 0-3 1-5 1-6 0z" fill={TREE.g1} />
          <circle cx="8" cy="10" r="6" fill={TREE.fruit} />
          <circle cx="6" cy="8" r="1.6" fill={T.ptsSoft} stroke="none" />
        </symbol>
      </defs>

      {/* backplate — every stage, grows with the tree */}
      <circle
        className={`${pid}-g`}
        cx="60"
        cy="60"
        r="50"
        fill={TREE.plate}
        stroke="none"
        style={{ transformOrigin: '60px 60px', transform: PLATE_TF[s] }}
      />

      {/* ground — every stage */}
      <g
        className={`${pid}-g`}
        style={{ transformOrigin: '60px 110px', transform: GROUND_TF[s] }}
      >
        <ellipse cx="60" cy="110" rx="42" ry="8" fill={TREE.ground} />
        <ellipse cx="60" cy="109" rx="20" ry="3.5" fill={TREE.soil} stroke="none" />
        <path
          d="M26 106c1-3 2-5 3-6M96 105c-1-3-2-5-3-6"
          stroke={TREE.g2}
          strokeWidth={1.4}
        />
        <ellipse cx="84" cy="112" rx="2.4" ry="1.4" fill={TREE.soil} stroke="none" />
        <ellipse cx="36" cy="111" rx="1.8" ry="1.1" fill={TREE.soil} stroke="none" />
      </g>

      {/* stage 0 — seed in the soil */}
      <g className={`${pid}-l`} data-on={on(s === 0)}>
        <g transform="rotate(-18 60 104)">
          <ellipse cx="60" cy="104" rx="7" ry="5" fill={TREE.trunk} />
        </g>
        <path d="M58 101l3 3" stroke={TREE.trunk2} strokeWidth={1.2} />
        <path d="M62 108c1 2 1 4 0 6" stroke={TREE.trunk} strokeWidth={1.4} />
      </g>

      {/* stage 1 — sprout */}
      <g className={`${pid}-l`} data-on={on(s === 1)}>
        <path d="M60 108c0-8 0-16 1-26" stroke={TREE.g1} strokeWidth={2.4} />
        {leaves(LEAVES_1)}
        <circle cx="66" cy="70" r="1.2" fill={TREE.highlight} stroke="none" />
      </g>

      {/* stage 2 — sapling */}
      <g className={`${pid}-l`} data-on={on(s === 2)}>
        <path d="M57 108c0-16 1-30 3-44h3c1 14 1 28 0 44z" fill={TREE.trunk} />
        <path d="M60 78c-4-4-8-7-13-9M61 74c4-4 8-6 12-7" strokeWidth={4.5} />
        <path
          d="M60 78c-4-4-8-7-13-9M61 74c4-4 8-6 12-7"
          stroke={TREE.trunk}
          strokeWidth={2.6}
        />
        {clumps(CLUMPS_2)}
        {leaves(LEAVES_2)}
        <path d="M52 36c2-1 5-1 7 0" stroke={TREE.highlight} strokeWidth={1.3} />
      </g>

      {/* stage 3 — young tree */}
      <g className={`${pid}-l`} data-on={on(s === 3)}>
        <path
          d="M54 108c-4-1-8 1-12 4h5c3-2 5-3 8-3zM66 108c4-1 8 1 12 4h-5c-3-2-5-3-8-3z"
          fill={TREE.trunk}
        />
        <path d="M55 108c-1-18 1-32 5-48h5c4 16 6 30 5 48z" fill={TREE.trunk} />
        <path d="M65 60c4 16 6 30 5 48h-4c0-18-1-32-4-48z" fill={TREE.trunk2} stroke="none" />
        <path
          d="M58.5 81c-.5 3-.5 6 0 10M60.5 70c-.5 2.5-1 5-.5 7"
          stroke={TREE.trunk2}
          strokeWidth={1.1}
        />
        <path
          d="M58 68c-6-6-13-12-22-16M64 66c6-6 13-12 23-15M61 62c0-6 1-12 2-18"
          strokeWidth={5.5}
        />
        <path
          d="M58 68c-6-6-13-12-22-16M64 66c6-6 13-12 23-15M61 62c0-6 1-12 2-18"
          stroke={TREE.trunk}
          strokeWidth={3.4}
        />
        {clumps(CLUMPS_3)}
        {leaves(LEAVES_3)}
        <path
          d="M52 16c2-1 5-1 7 0M34 30c2-1 4-2 6-2"
          stroke={TREE.highlight}
          strokeWidth={1.3}
        />
      </g>

      {/* stage 4 — fruiting tree */}
      <g className={`${pid}-l`} data-on={on(s === 4)}>
        <path
          d="M53 108c-4-1-9 1-13 4h5c3-2 6-3 9-3zM67 108c4-1 9 1 13 4h-5c-3-2-6-3-9-3z"
          fill={TREE.trunk}
        />
        <path d="M54 108c-1-18 1-32 6-50h6c5 18 7 32 6 50z" fill={TREE.trunk} />
        <path d="M66 58c5 18 7 32 6 50h-4c0-18-1-32-5-50z" fill={TREE.trunk2} stroke="none" />
        <path
          d="M58 80c-.5 3-.5 6 0 10M60 68c-.5 2.5-1 5-.5 7"
          stroke={TREE.trunk2}
          strokeWidth={1.1}
        />
        <path
          d="M58 66c-6-6-14-12-24-16M65 64c6-6 14-12 25-15M61 60c0-6 1-12 2-18"
          strokeWidth={5.5}
        />
        <path
          d="M58 66c-6-6-14-12-24-16M65 64c6-6 14-12 25-15M61 60c0-6 1-12 2-18"
          stroke={TREE.trunk}
          strokeWidth={3.4}
        />
        {clumps(CLUMPS_4)}
        {leaves(LEAVES_4)}
        <path
          d="M50 12c2-1 5-1 7 0M30 26c2-1 4-2 6-2"
          stroke={TREE.highlight}
          strokeWidth={1.3}
        />
      </g>

      {/* fruit — stage 4 only, one layer each so they pop in one at a time */}
      {FRUIT_POS.map((f, i) => (
        <g
          key={'f' + i}
          className={`${pid}-l`}
          data-on={on(i < nFruit)}
          style={{ transformOrigin: `${f[0] + FRUIT_W / 2}px ${f[1] + FRUIT_H / 2}px` }}
        >
          <use href={`#${pid}-fruit`} x={f[0]} y={f[1]} width={FRUIT_W} height={FRUIT_H} />
        </g>
      ))}

      {/* bird — stage 4 only */}
      <g
        className={`${pid}-l`}
        data-on={on(s === 4)}
        style={{ transformOrigin: '100px 44px' }}
      >
        <g transform="translate(94 40) scale(.55)">
          <path
            d="M0 8c0-5 4-8 9-8s9 3 9 8c0 3-2 5-5 6H4C1 13 0 11 0 8z"
            fill={TREE.highlight}
          />
          <circle cx="16" cy="3" r="4.2" fill={TREE.highlight} />
          <path d="M20 3l4 1-4 1z" fill={TREE.fruit} />
          <circle cx="17" cy="2.4" r="1.2" fill={T.ink} stroke="none" />
          <path d="M0 8l-6 3" strokeWidth={1.6} />
        </g>
      </g>
    </svg>
  );
}
