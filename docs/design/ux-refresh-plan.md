# UX refresh plan — Sage & Berry (invariant-plan-gate)

**Goal**: Reskin the web UI to the Sage & Berry tokens, replace every UI emoji with one
SVG line-icon set, and replace the tree with the illustrated 5-stage `GrowingTree` —
layout, navigation, copy and flows unchanged.

**Invariants at risk**
- Capgo version lockstep: no version bumps, no tags, no Capgo release, no store tracks. UI-only diff.
- Android ownership: nothing under `android/`, `docs/android/`, assetlinks, or Android-specific
  Capacitor config changes. (`capacitor.config.ts` iOS/splash background is explicitly in scope per brief.)
- DB compatibility: `habits.icon` / `rewards.icon` stay emoji strings — emoji→icon mapping is
  render-time only; no migrations, no data writes. Old clients on main must keep rendering correctly.
- Auth/RLS: Login/PIN/auth screens are restyled only — zero changes to supabase calls or auth logic.
- Behaviour: completion/streak/boot-cache/NFC logic untouched. Only sanctioned behaviour change:
  tree stage mapping becomes 0 / <33% / <66% / <100% / 100% → stages 0–4 (per brief).
- Worktree discipline: all git commands in this worktree on `ux-refresh`; never merge to main.

**Unknowns**
- `ritual-palettes.html` missing from ~/Downloads → proceed (tokens are inline in the brief); flagged in report.
- Family mini-tree row fit on smallest width → decide at implementation; report which variant shipped.

**Order**: baseline tests → commit mockups+plan → dev gallery route (old UI "before" screenshots)
→ tokens module → icons + GrowingTree (parallel subagents) → App.js sweep (tokens, icons, tree,
dark card, Insights strip, family trees) → index.html/manifest/capacitor colours → "after"
screenshots → grep proofs → tests + build → push.

**Success criteria**: `npm test` passes; `npm run build` passes; grep shows zero old-palette hex
values and zero emoji in src/; before/after screenshots for every screen in
`docs/design/ux-refresh-screenshots/`; GrowingTree stages 0–4 + fruit + bird captured.
