# Where Ritual lives — canonical filing

**Purpose:** one page that says where every Ritual repo belongs on every machine, so filing never drifts again. If a checkout exists anywhere not listed here, it's wrong — reconcile and remove it (see the migration procedure at the bottom).

## The two repos

| Repo | What it is | GitHub |
|---|---|---|
| `ritual-v2` | The app: React web app + Capacitor iOS shell + Vercel serverless `api/` | `Christelle1bekker/ritual-v2` |
| `ritual-website` | Marketing site | `Christelle1bekker/ritual-website` |

## The rules

1. **Every checkout lives at `~/Developer/<repo-name>`** on every machine. Folder name = GitHub repo name, exactly (`ritual-v2`, not `Ritual`, `ritual`, or `Ritual v2`).
2. **Never inside a cloud-synced folder.** No OneDrive, iCloud Drive, Dropbox, Google Drive — and remember that **Desktop and Documents count** when OneDrive/iCloud folder backup is on. `~/Developer` is safe on macOS (never synced by default). Why this is a hard rule and not a preference:
   - Sync clients fight `.git` (lock files, partial writes) → repo corruption.
   - Xcode/npm builds churn thousands of files → sync storms, slow builds.
   - Files-On-Demand can dematerialize files to cloud placeholders → git and Xcode read garbage.
3. **Git is the only sync mechanism between machines.** Push to GitHub, pull on the other machine. Never copy a repo folder via OneDrive/AirDrop/USB.
4. **One checkout per repo per machine.** No "backup copies" — GitHub is the backup.

## Canonical locations

| Machine | ritual-v2 | ritual-website |
|---|---|---|
| Christelle's Mac | `/Users/christellebekker/Developer/ritual-v2` ✅ | `/Users/christellebekker/Developer/ritual-website` ✅ |
| Mac Mini (Willem) | `/Users/willem/Developer/ritual-v2` — **create via the migration below**; the old copy under OneDrive → Desktop → Games → Ritual is being retired | as needed: `/Users/willem/Developer/ritual-website` |

## Vercel — deliberately NOT renamed

The Vercel project deploys `ritual-v2` automatically on every push to `main`, serving `https://ritual-v2-mu.vercel.app`. That domain looks like cosmetic debt, but **do not rename the project or touch the domain**:

- Physical NFC tags in the wild encode `…/t/{uid}` URLs on that host — unfixable after the fact.
- `t.ritualhabits.com.au` 301s to that host (see `vercel.json` redirects).
- The AASA deep-link config is served from it.

If a prettier app domain is ever wanted, **add** a custom domain alongside (aliases keep working) — never rename/remove. Nothing else in Vercel needs tidying: project ↔ repo ↔ auto-deploy is already the clean setup.

## Mac Mini migration (one-time, run in a terminal on the Mini)

Goal: fresh clone at `/Users/willem/Developer/ritual-v2`; old OneDrive copy retired **without losing any work trapped in it**.

**1. Find every copy** (OneDrive paths vary; check both classic and CloudStorage locations):
```sh
mdfind -onlyin ~ 'kMDItemFSName == "*itual*"cd' | grep -vi 'node_modules\|Library/Caches' | head -30
ls -d ~/OneDrive*/Desktop/Games/* ~/Library/CloudStorage/OneDrive*/Desktop/Games/* ~/Desktop/Games/* 2>/dev/null
```

**2. Reconcile each copy found — do NOT delete anything yet.** In each repo directory:
```sh
cd "<the-copy>"
git status --porcelain          # uncommitted changes?
git stash list                  # forgotten stashes?
git log --branches --not --remotes --oneline   # commits never pushed?
```
- All three empty → the copy holds nothing unique.
- Anything non-empty → push it: commit dirty files to a rescue branch (`git switch -c rescue/mini-onedrive && git add <explicit paths> && git commit && git push -u origin rescue/mini-onedrive`) and push any unpushed branches. If the copy predates git or is corrupted, zip the whole folder to `~/ritual-onedrive-archive.zip` instead.

**3. Fresh clone at the canonical path:**
```sh
mkdir -p /Users/willem/Developer
git clone git@github.com:Christelle1bekker/ritual-v2.git /Users/willem/Developer/ritual-v2
cd /Users/willem/Developer/ritual-v2
npm ci
```
(If the Mini lacks a GitHub SSH key: `ssh-keygen -t ed25519 -C "willem-mac-mini"`, add `~/.ssh/id_ed25519.pub` at github.com → Settings → SSH keys, then clone.)

**4. Retire the old copy — rename, don't delete:**
```sh
mv "<old-onedrive-copy>" "<same-parent>/Ritual-RETIRED-2026-07-05"
```
Delete `Ritual-RETIRED-*` only after the Capgo OTA restore build has shipped successfully from the new clone (see `CAPGO_OTA_RESTORE.md` step F) — until then it's the belt-and-suspenders backup.

**5. Sanity check the new clone:**
```sh
cd /Users/willem/Developer/ritual-v2
git log --oneline -3      # should start at or after a217427 (main, 2026-07-05)
grep -A 2 '"CapacitorUpdater"' ios/App/App/capacitor.config.json   # "autoUpdate": true
```
The Capgo runbook (`CAPGO_OTA_RESTORE.md` step B) already assumes this path — after this migration, ship day continues exactly as written.
