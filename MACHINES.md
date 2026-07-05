# Where Ritual lives — canonical filing

**Purpose:** one page that says where everything Ritual belongs, so filing never drifts again. If Ritual content exists anywhere not listed here, it's a stray — reconcile it into the right repo and remove it.

**The machine:** there is one — the Mac Mini, running on Christelle's account (`/Users/christellebekker`). Xcode work (Willem) happens on this same machine and checkout. If another machine ever joins, it follows the same rules with the same paths under its own home directory.

## The three repos

| Repo | What it is | Canonical path | GitHub |
|---|---|---|---|
| `ritual-v2` | The app: React web + Capacitor iOS shell + Vercel serverless `api/` | `~/Developer/ritual-v2` | `Christelle1bekker/ritual-v2` |
| `ritual-website` | Marketing site | `~/Developer/ritual-website` | `Christelle1bekker/ritual-website` |
| `ritual-assets` | Brand, visual identity, beta-invite decks, onboarding video project, data exports — everything that isn't code | `~/Developer/ritual-assets` | `Christelle1bekker/ritual-assets` (**private** — contains beta-family names) |

One exception inside `ritual-assets`: `video/Instructional_Ritual.mp4` (178 MB) exceeds GitHub's file limit and lives only on disk + in `~/Developer/_archive/` (see that repo's README).

## The rules

1. **Every checkout lives at `~/Developer/<repo-name>`.** Folder name = GitHub repo name, exactly (`ritual-v2`, not `Ritual`).
2. **Never inside a cloud-synced folder.** No OneDrive, iCloud Drive, Dropbox — and **Desktop/Documents count** when folder backup is on. `~/Developer` is safe. Why this is a hard rule: sync clients fight `.git` (corruption), builds cause sync storms, and Files-On-Demand dematerializes files into unreadable placeholders (observed live on this machine 2026-07-05: the entire Games folder was cloud-only and unreadable until the OneDrive client was relaunched).
3. **Git/GitHub is the only backup and sync mechanism.** New Ritual artifacts (brand files, decks, exports) go into `ritual-assets` and get pushed — not onto the Desktop, not into OneDrive.
4. **One checkout per repo.** No "backup copies" — GitHub is the backup.
5. **OneDrive's Games folder is for games** (Trivia, sophias-jungle-game) and non-Ritual projects (`saam`). No Ritual content returns there.

## Vercel — deliberately NOT renamed

The Vercel project auto-deploys `ritual-v2` on every push to `main`, serving `https://ritual-v2-mu.vercel.app`. The domain looks like cosmetic debt, but **do not rename the project or touch the domain**:

- Physical NFC tags in the wild encode `…/t/{uid}` URLs on that host — unfixable after the fact.
- `t.ritualhabits.com.au` 301s to that host (`vercel.json` redirects).
- The AASA deep-link config is served from it.

If a prettier app domain is ever wanted, **add** a custom domain alongside — never rename/remove. Also remember: pushing to `main` deploys the web app immediately.

## What happened on 2026-07-05 (the tidy-up record)

- OneDrive → Desktop → Games held non-git snapshots of `ritual-v2` and `ritual-website`, plus brand assets, the visual-identity generator, beta-invite slides, an onboarding-video project (`ritual-video-v`, never in git), and a habits export.
- Everything Ritual was rescued: assets → new `ritual-assets` repo (pushed); the snapshot remainders → `~/Developer/_archive/onedrive-games-2026-07-05/` (local only, ~190 MB).
- The Ritual items were then deleted from OneDrive (recoverable from OneDrive's online recycle bin for ~30 days).
- `~/Developer/_archive/` can be deleted whenever confidence is high that nothing unique remains; nothing references it.
- Stale Claude worktrees were pruned from both `ritual-v2` and `ritual-website`.
