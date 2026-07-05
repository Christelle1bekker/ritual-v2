# Ritual — Compliance Audit Findings (Phase 1)

**Date:** 5 July 2026
**Scope:** `ritual-v2` (app), `ritual-website` (ritualhabits.com.au), live legal pages, all user-facing surfaces.
**Reference standard:** Beka privacy policy and terms (beka-app.com, effective 31 May 2026), adapted to Ritual's verified facts.
**Status:** Awaiting founder review. No files modified in either repo (this report excepted). Phase 2 does not begin until the numbered plan and decision points below are approved.

---

## 0. Executive summary

The current Ritual legal pages are single-jurisdiction (AU-only), name the pre-incorporation entity ("Christelle and Willem Bekker, ABN 20 917 156 101"), and contain **four claims that are contradicted by the codebase** (§7). Both pages are also literally truncated HTML files. The gap to the Beka standard is large but mostly mechanical adaptation; the genuinely new drafting clusters on **children's data**, where Ritual's facts are *better than the brief assumed* — no date of birth is collected anywhere, no photos, no child device data beyond a push token that lands on kid profiles as a side-effect (fixable in code).

The most consequential findings, in order:

1. **The live policy's data-isolation claim is false.** It states RLS policies "ensure each family's data is isolated and accessible only to authenticated members of that family." The actual policies are `allow all — using (true)` on every table ([schema.sql:100-104](schema.sql#L100)); isolation is app-level only. Fix the claim, the code, or both.
2. **No DOB is collected — the brief's "name + DOB" posture overstates collection.** Child data is: first name, adult/kid flag, a UI colour, a single-letter avatar derived from the name, points/streak counters, and habit-completion history attributable to the named child. The policy should claim exactly this and no more.
3. **No in-app account deletion exists.** Only individual member/habit/reward removal. No path deletes the family row or the Supabase auth user (and `on delete restrict` at [schema.sql:314](schema.sql#L314) actively blocks auth-user deletion). The policy's email-request deletion clause is accurate; Apple's guideline 5.1.1(v) (in-app account deletion for apps with account creation) is the exposure.
4. **Family surnames currently transit Anthropic, Resend, and Telegram** via the Maurice ops reports ([lib/maurice-core.js:499](lib/maurice-core.js#L499), 534-537). One small redaction keeps all three providers out of the privacy policy.
5. **Google Fonts loads on the website** (index, start) — visitor IP flows to Google, undisclosed. Self-hosting removes the disclosure obligation.
6. **The COPPA question is real but manageable.** Honest residual-risk assessment in §5 — the parent-device/parent-account/minimal-data model is a defensible mixed-audience position, materially strengthened by three cheap code changes (D5, D3, and dropping the aggregated-data-sale clause).

---

## 1. Provider inventory & classification

Verified against code by the lead engineer; every classification traced to the cited lines.

### 1.1 Processes user personal data → must appear in the privacy policy

| Provider | What it does | Data it sees | Region | Evidence |
|---|---|---|---|---|
| **Supabase** | Database + email/password auth | All app data: family names, plaintext family PINs, member names (incl. children's first names), kid flags, push tokens, completion history, account-holder emails; waitlist emails (website) | **Unconfirmed — dashboard check required** (not in repo config; not externally probeable — Cloudflare-fronted). Do NOT assume Beka's Singapore region; it is per-project. | [schema.sql:10-65](schema.sql#L10), [src/supabase.js:5-6](src/supabase.js#L5), website `api/waitlist.mjs:61-67` |
| **Vercel** | Hosts API routes, crons, website, waitlist endpoint | Request traffic incl. push tokens, member names read by API functions; waitlist emails in transit | **Unconfirmed** — neither repo's `vercel.json` sets `regions`; default compute region (likely iad1) must be confirmed in dashboard | [vercel.json:22-45](vercel.json#L22), website `vercel.json` (no regions key) |
| **Apple (APNs + App Store)** | Push delivery (direct, token-based JWT — no intermediary vendor); app distribution | APNs device tokens; notification title/body (habit names, member first names in reminder text) | Apple global infrastructure | [api/nudge.js:38-55](api/nudge.js#L38), [api/cron/reminders.js:214-271](api/cron/reminders.js#L214) |
| **Capgo** | OTA bundle delivery | **No user records.** `autoUpdate: false`; no `getLatest`/`download`/`setChannel` calls in app code. Plugin-default telemetry (anonymous per-install device UUID + app version) is likely active since no `statsUrl` override is set — **verify and confirm processing location before naming a country in the policy** | Unconfirmed (manual checklist) | [capacitor.config.ts:19-21](capacitor.config.ts#L19), [src/index.js:10](src/index.js#L10), ops-side read is public bundle metadata only ([lib/maurice-core.js:41](lib/maurice-core.js#L41)) |
| **Google Fonts** *(website only)* | Serves DM Serif Display / DM Sans on index + start pages | Visitor IP + user-agent on every page view | Google global | website `index.html:10-12`, `start.html:10-12`. **Not loaded on the legal pages.** Recommended: self-host (D4) and keep Google out of the policy |

### 1.2 Internal ops only — excluded from the policy (with one caveat)

| Provider | What it does | User data? | Evidence |
|---|---|---|---|
| **Anthropic API** (Claude Haiku) | Formats Maurice/Debbie ops reports; classifies Telegram commands | **Caveat: family names currently transit it.** Maurice selects `families(id, name, created_at)` and builds `familyActivity[].name` into the report payload compiled by Haiku ([lib/maurice-core.js:499](lib/maurice-core.js#L499), 534-537). Everything else is counts/aggregates. Fix via D3, else Anthropic must be disclosed as a processor | [lib/maurice-core.js:28,596-600](lib/maurice-core.js#L596), [lib/debbie-core.js:81-85](lib/debbie-core.js#L81) |
| **Resend** | Emails the daily ops report to the founders only | Same caveat — report body contains family names until D3 | [lib/maurice-core.js:741-763](lib/maurice-core.js#L741) |
| **Telegram Bot API** | Delivers ops reports to an allow-listed private founder chat | Same caveat | [api/telegram-webhook.js:1047](api/telegram-webhook.js#L1047) |
| **Apify** | Debbie scrapes public Instagram hashtags for market research | None — fixed hashtag list, no Ritual user data; `debbie-core.js` has no Supabase import | [lib/debbie-core.js:161-244](lib/debbie-core.js#L161) |
| **cron-job.org** | External scheduler pinging report endpoints with a bearer secret | None | [api/daily-report.js:367](api/daily-report.js#L367) |

**Verified negative:** Maurice reads the `waitlist` table as **counts only** — `sbCount('waitlist')`, never a select of email addresses ([lib/maurice-core.js:518-519](lib/maurice-core.js#L518), with an in-code comment documenting exactly this). Debbie touches no user table at all. The founders' personal experiments (Debbie's Instagram research) share infrastructure but not user data.

**Verified negative:** No analytics, crash-reporting, tracking, or fingerprinting SDK exists in either repo. The many "analytics" references in App.js are locally computed habit statistics. The website has zero third-party scripts other than Google Fonts.

---

## 2. Entity string sweep

Old ABN searched in all spacing variants (`20 917 156 101`, `20917156101`, `20-917-156-101`).

### ritual-website — 3 legal hits + 2 footer gaps

| File:line | Current text | Phase 2 action |
|---|---|---|
| `public/privacy.html:83` | "Ritual … is operated by Christelle and Willem Bekker (ABN 20 917 156 101)" | Replace with Bekker Labs Pty Ltd (ACN 699 280 012, ABN 79 699 280 012) — full rewrite of page |
| `public/privacy.html:165` | Contact block: "Operated by Christelle and Willem Bekker / ABN: 20 917 156 101 / Melbourne, Victoria, Australia" | Same |
| `public/terms.html:91` | "operated by Christelle and Willem Bekker (ABN 20 917 156 101)" | Same |
| `public/index.html:1487` | Footer: `© 2026 Ritual. Melbourne, Australia.` — no legal entity | Update to `© 2026 Bekker Labs Pty Ltd` (product name may stay in the line) |
| `public/start.html:611` | Same footer | Same |

**Not entity strings (leave alone):** the founders-story copy on `index.html:1432,1438` ("We're Willem and Christelle — a Melbourne couple…") is marketing voice, not legal entity framing.

### ritual-v2 — zero shipped entity strings

No ABN/ACN/"Pty"/"sole trader"/copyright string exists anywhere in the app repo. All "Bekker/Christelle/Willem" hits are code comments, test fixtures, spike docs, agent prompt text, and internal handoff docs — none in UI copy. **Consequence: the entity swap requires no App.js change and therefore no Capgo OTA push.** The in-app legal surface is three Settings rows + two consent-line links, all pointing at `ritualhabits.com.au/privacy|terms` ([src/App.js:4321-4330](src/App.js#L4321)) — they will pick up the rewritten pages automatically.

---

## 3. Legal page gap analysis (vs Beka standard)

Both current pages: effective "April 2026", single-jurisdiction, old entity — and **both files are truncated HTML** (privacy ends without `</body></html>`; terms ends mid-attribute at `<p style="margin-bottom` — website repo `public/terms.html:189`). They render, but the terms contact block is cut off.

| Beka section | Ritual today | Verdict | Phase 2 treatment |
|---|---|---|---|
| Territory statement (AU/NZ/US/SA; "not offered in the EU or UK") | Absent | **Add** | Adapt verbatim; territory list per D2 |
| §1 Who we are (Pty Ltd + ACN/ABN + contact) | Old entity inline | **Replace** | Bekker Labs Pty Ltd (ACN 699 280 012, ABN 79 699 280 012); hello@ritualhabits.com.au as sole public contact; registered office only where legally required |
| §2 "The short version" plain-language TL;DR | Absent | Add | Adapt to Ritual facts (no AI features, no email forwarding) |
| §3 Information we collect + negative list | Present but inaccurate | **Rewrite** | Must match §7 verified facts exactly — incl. removing the unbacked "device identifiers, OS version, app version, device type" claim; add Beka-style negative list (no location, no ad ID, no biometrics, no photos, **no DOB**) |
| §5 Children's information | Present, thin, partly inaccurate | **Redraft (Ritual-specific)** | See §5 below. Beka's "children never use the app" premise cannot be copied |
| §6 Named-processor table (provider / role / region / key terms) | Prose list, no regions, no DPA framing | **Rebuild as table** | Providers per §1.1; regions only after dashboard confirmation |
| §7 International transfers | Absent | Add | Depends on confirmed regions |
| §8 Retention (itemised) | Split across two sections; references subscription cancellation that doesn't exist | Rewrite | Itemised; subscription references removed (settled position 6) |
| §9 Security | Present but **overclaims RLS isolation** | **Correct** | See D7 — claim must match code or code must match claim |
| §11.1 AU small-business/APP + OAIC; NZ Privacy Act 2020/IPP 3A + Commissioner | Absent | Add | AU: Beka §11.1 verbatim pattern (settled position 4). NZ: IPP 3A indirect-collection rationale **must be re-reasoned** — Beka's "children do not use Beka" is false for Ritual; the Ritual rationale is: information about children is provided by the parent, notice is given through the parent as the child's guardian, and separate notice to young children is not practicable |
| §11.2 US: COPPA + California rights + notice at collection | Absent | Add — **COPPA block is fresh drafting** (§5); CA rights block adapts cleanly, but only if D1 resolves to "no sale" |
| §11.3 South Africa POPIA (responsible party, s35(1)(a), s18, s72, ss23-25, Information Regulator) | Absent | Add | s72 wording is directly reusable with Ritual's operators; s35(1)(a) parent-consent pattern fits Ritual's model well; s57(1)(d) risk addressed in §5.3 |
| Canada | Absent — **and absent from Beka too** (no PIPEDA section, not even in Beka's territory list) | **Decision D2** | No gold-standard precedent exists; if Canada stays a Ritual territory it needs a short fresh PIPEDA subsection |
| Terms: eligibility 18+ with supervised child use | **Present and correct for Ritual — keep** | Keep | Ritual's existing §1 framing is right; do not copy Beka's parent-only clause |
| Terms: subscriptions | Full billing/renewal/trial clauses for payments that don't exist | **Remove** | Settled position 6: replace with Beka's "currently free of charge; before any charge applies we will update these terms" pattern. Clauses to re-add at subscription launch are listed in §8 (change 9) |
| Terms: parent-authority warranty (Beka §4) | Absent | Add (adapted) | Parent confirms authority to enter a child's information |
| Terms: deletion clause | Email-only (accurate) | Keep accurate; see D6 | Terms must state the real mechanism; add in-app path only if/when built |
| Terms: NFC tiles section | Present — Ritual-specific, good | Keep | No Beka equivalent; retain as-is |
| Terms: ACL notice + AUD $50 liability cap | Present, strong, hardware-aware | Keep | Better than Beka's short form |
| Terms: governing law | "Exclusive jurisdiction" Victoria | Amend | Add Beka's local-mandatory-rights carve-out for multi-jurisdiction sales |
| Dual dating ("Effective from" + "Last updated") + cross-links between the two docs | Single month-level date; privacy doesn't link to terms | Add | Page furniture |

**Aggregated-data-sale clause (decision D1):** the current privacy §5 reserves the right to "share or sell aggregated, anonymised, and de-identified data … including demographic insights … for commercial purposes", echoed by the terms §6 licence. This directly conflicts with the Beka posture ("we don't sell your information") and — because the aggregates derive partly from children's completion data — it is the single worst clause to be holding while defending a mixed-audience COPPA position. Recommendation: **drop it** and adopt Beka's no-sale language. If the founders want to preserve the commercial option, it must survive CCPA "sale" analysis and be re-drafted narrowly; flagged, not settled.

---

## 4. Data-handling verification

| Question | Verified answer | Evidence |
|---|---|---|
| Deletion mechanism | In-app: remove individual members (cascades their completions/redemptions via FK), delete habits/rewards. **No family/account/auth-user deletion path exists**; `families.account_holder_id … on delete restrict` blocks auth-user deletion while a family exists. Email request is the only full-deletion route | [src/App.js:6009-6027](src/App.js#L6009), [schema.sql:59](schema.sql#L59), [schema.sql:314](schema.sql#L314) |
| Push notifications | APNs token per member row (`members.push_token`), written to whichever profile is active at registration — including kid profiles. Nothing else stored (no device model/OS/platform columns). Delivery is direct APNs, no third-party push vendor | [src/App.js:4838](src/App.js#L4838), [src/App.js:4871](src/App.js#L4871), [schema.sql:26-27](schema.sql#L26), [api/nudge.js:40](api/nudge.js#L40) |
| Analytics/tracking | None. No SDKs in either repo; website has no tracking scripts | package.json (both repos), full HTML sweep |
| Website forms | One form: waitlist email capture → POST `/api/waitlist` → Supabase `waitlist` table (`email`, `source`, timestamp). CORS-restricted, dedup on lower(email). No CRM, no mail service | website `index.html:1459-1462`, `api/waitlist.mjs:61-67`, `migrations/001_waitlist.sql` |
| Family PIN model | Legacy: family name + PIN via RPCs; **PIN stored plaintext** in `families.pin`, also cached in localStorage. Newer: Supabase email/password auth (email + password only, no name at signup), one account holder per family. Both models live simultaneously | [schema.sql:13](schema.sql#L13), [schema.sql:222-269](schema.sql#L222), [src/App.js:655](src/App.js#L655), [src/App.js:674-678](src/App.js#L674) |
| RLS | Enabled on all tables but every policy is `allow all using (true)`; account-holder-scoped policies exist **commented out** at schema.sql:344-392. Isolation is app-level only | [schema.sql:100-104](schema.sql#L100) |
| In-app legal surfaces | Settings → Privacy Policy / Terms of Use / Contact rows + consent-line links, all → ritualhabits.com.au (correct target for rewritten pages). Second support address `support@ritualhabits.com.au` appears in tiles FAQ copy | [src/App.js:4321-4330](src/App.js#L4321), [src/App.js:3692](src/App.js#L3692) |

---

## 5. Children / COPPA / POPIA analysis

### 5.1 What is actually collected about a child (code-verified)

The add/edit member form collects exactly three inputs: **name, colour, adult/kid toggle** ([src/App.js:1869-1912](src/App.js#L1869)). Derived/accumulated: single-letter avatar computed from the name ([src/App.js:1871](src/App.js#L1871)), points and streak counters, and **completion history attributable to the named child** (`completions` rows keyed by `member_id` — [schema.sql:56-65](schema.sql#L56)). Incidental: the APNs push token can be written to a kid profile if that profile is active at token registration ([src/App.js:4838](src/App.js#L4838)).

**There is no DOB, no age, no photo, no emoji avatar, no camera plugin, no child email, no child communications, no child-generated free text.** The brief's assumed "name + DOB" overstates collection; the policy should claim the smaller true set. Completion history tied to a named child **is** personal information about a child and must be disclosed as such — the current policy already does this ("their habit completion data"), which is to its credit.

### 5.2 COPPA (US)

**The question:** is Ritual "directed to children," a general-audience service, or a mixed-audience service under the FTC's factors?

**Honest read:** Ritual sits closer to the line than Beka did, and the founders should not pretend otherwise. Factors pulling toward child-directed: points, streaks, rewards, and colourful gamified UI are child-oriented *activities and incentives*, and children physically interact with the product (the tap is the core loop). Factors pulling away: the account is adult-only (18+ terms), setup/management is entirely parental, the app runs on the **parent's device** (no child accounts, no child logins, no child devices contemplated), marketing addresses parents ("a Melbourne couple with two kids… household"), there are no ads of any kind, no social features, no child communications, and collection is minimal and parent-entered.

**Defensible position (recommended):** Ritual is a **household tool for parents** — a mixed-audience-adjacent general-audience service. All personal information about children is provided by, and controlled by, the parent within the parent's own account on the parent's own device; Ritual does not knowingly collect personal information *from* children online in the COPPA sense. Where a child's supervised tap generates a completion row, that is activity data within the parent's account, attributed by the parent's configuration; the parent's deliberate account and profile setup is the consent mechanism. Persistent identifiers (the APNs token) exist solely to deliver notifications the parent requested — squarely the "support for internal operations" exception — and are not used for profiling, advertising, or cross-service tracking.

**Residual risk, stated plainly:** if the FTC viewed the tap-and-reward loop as making Ritual child-directed (even in part), the formal COPPA machinery (direct notice + enumerated verifiable-parental-consent methods) is not strictly satisfied by account setup alone. Practical exposure is low — no ads, no data sale to third parties in identifiable form, no behavioural profiling, minimal data, genuine parental control, and enforcement history targets much worse actors — but the risk is not zero and the founders should hold this position knowingly. Three changes materially strengthen it:

1. **Stop writing push tokens to kid profiles** (D5) — removes the only persistent identifier attached to a child profile; the token belongs on the adult/account-holder profile since it's the parent's device either way.
2. **Drop the aggregated-data-sale clause** (D1) — "selling demographic insights" derived partly from children's usage is the clause a regulator would quote.
3. **State the model explicitly in a dedicated children's section** — parent-managed household tool, parent's device, no child accounts, exact data list, parent review/delete path.

### 5.3 POPIA (South Africa)

POPIA s34 prohibits processing a child's personal information subject to s35 exceptions. Ritual's basis is **s35(1)(a)**: prior consent of a competent person — the parent/guardian, who is the account holder and enters the child's name themselves. This fits Ritual *better* than it fit Beka (the parent literally types the child's profile in). The Beka §11.3 scaffold (responsible party, s18 notice, ss23-25 rights, Information Regulator complaint path incl. POPIAComplaints@inforegulator.org.za) adapts directly with Ritual's operators and Bekker Labs as responsible party.

**s57(1)(d) residual note (the brief said s57; the operative provision for Ritual is s57(1)(d) read with s72):** transferring children's personal information to a foreign third party that does *not* provide an adequate level of protection requires prior authorisation from the Information Regulator. The mitigation — same as Beka's — is the s72(1)(a) basis: each foreign operator is bound by contractual terms providing substantially similar protection including onward-transfer restrictions, so the transfers are to parties providing adequate protection and the s57 prior-authorisation trigger is not engaged. This is the settled Beka position applied to Ritual's operator list; the residual risk is that the Regulator reads adequacy more narrowly for children's data. Low likelihood, non-zero, inherited knowingly.

### 5.4 Australia / New Zealand

**AU:** small-business exemption position per settled position 4 — operate to APP-equivalent standards voluntarily, don't claim statutory compliance, OAIC complaint path. Children's data adds no separate statutory trigger under the Privacy Act as it stands; the dedicated children's section plus parental control satisfies best practice. (If the Privacy Act reforms removing the small-business exemption pass, this section gets revisited — note for the annual review, not now.)

**NZ:** Privacy Act 2020 applies. IPP 3A (indirect collection notice) — Beka's rationale ("children do not use Beka, we have no way to contact them") cannot be copied. Ritual's re-reasoned rationale: children's information is collected from the parent, who is the child's guardian and the person who controls the account; notice is given through the parent; separate notice to young children is neither practicable nor meaningful given their age and the supervised nature of use. Privacy Commissioner complaint path (privacy.org.nz).

---

## 6. EU/UK feasibility note

**Recommendation: keep EU/UK excluded.** Both Beka-decisive facts apply, and one is worse for Ritual:

- **EU DSA trader requirement** (identical to Beka): listing in any EU territory forces the Bekker Labs registered office — a residential address — onto the App Store product page. Decisive for Beka; nothing about Ritual changes it.
- **UK AADC (Children's Code) — harder for Ritual than Beka:** the Code triggers for services "likely to be accessed by children." Beka could argue children never touch it; Ritual's model *invites* child interaction, so the Code would apply with real force — age-appropriate design obligations, DPIA, best-interests assessment, data-minimisation standards written for child-facing services. This is a genuine compliance programme, not a policy paragraph.
- Additionally, GDPR Art 27 would require appointing an EU representative (no EU establishment exists), and GDPR Art 8 child-consent rules would need analysis per member state.

Nothing about Ritual makes EU/UK "easy." State the exclusion in both documents using Beka's wording pattern ("not offered in the European Union or the United Kingdom, and this policy does not provide EU/UK data-protection rights").

---

## 7. Verified facts register

Facts every policy claim must be checked against (rule 7). Items marked ⚠ contradict the **current live policy**.

| # | Fact | Evidence |
|---|---|---|
| F1 | Child data = first name, kid flag, colour, letter avatar, points/streak, completion history. **No DOB, no photos.** | [schema.sql:17-29](schema.sql#L17), [src/App.js:1869-1912](src/App.js#L1869), [src/App.js:5991](src/App.js#L5991) |
| F2 ⚠ | RLS policies are `allow all using (true)` — the live policy's "row-level security … accessible only to authenticated members of that family" claim is not code-backed | [schema.sql:100-104](schema.sql#L100) |
| F3 ⚠ | No device identifiers, OS version, app version, or device type are collected/stored by the app (no `@capacitor/device`, no such columns) — the live policy claims they may be. Only caveat: Capgo plugin default telemetry (verify) | package.json, [schema.sql:17-29](schema.sql#L17) |
| F4 ⚠ | Payments/subscriptions do not exist in the build — live policy §1/§8 and terms §3 describe Apple billing, cancellation, trials | No StoreKit/payment code anywhere in repo |
| F5 ⚠ | Deletion is email-request only; live policy §6 "withdraw … by deleting your account" implies an in-app path that doesn't exist (policy §7's "by contacting us" is the accurate sentence) | [src/App.js:6009-6027](src/App.js#L6009) (member-only), §4 above |
| F6 | Family PIN stored plaintext in `families.pin` + localStorage | [schema.sql:13](schema.sql#L13), [src/App.js:585](src/App.js#L585) |
| F7 | Push = direct APNs; token on member rows (incl. kids); nothing else device-related stored | §4 above |
| F8 | No analytics/tracking SDKs anywhere | §1.2 above |
| F9 | Family names transit Anthropic/Resend/Telegram in ops reports; waitlist read as counts only | [lib/maurice-core.js:499](lib/maurice-core.js#L499), 518-519, 534-537 |
| F10 | Supabase project `nupifxbhwfaqyjevmmde`; region **not determinable** from repo or externally | [HANDOFF.md:18](HANDOFF.md#L18), Cloudflare-fronted probe |
| F11 | Vercel compute region not pinned in either repo's vercel.json | both vercel.json files |
| F12 | Website collects exactly one field (waitlist email) → Supabase | website `api/waitlist.mjs` |
| F13 | Google Fonts on index/start (visitor IP → Google); zero other third-party scripts | website `index.html:10-12` |
| F14 | Both live legal pages are truncated HTML | website `public/privacy.html` (ends L164), `public/terms.html` (ends L189 mid-attribute) |
| F15 | NFC tiles carry only a URL/UID; no personal data on tile — live policy claim is code-accurate | [schema.sql:47](schema.sql#L47) (`tile_uid`), tile parse at [src/App.js:4810-4816](src/App.js#L4810) |
| F16 | In-app legal links point at ritualhabits.com.au/privacy and /terms — will resolve to rewritten pages with no app change | [src/App.js:4321-4330](src/App.js#L4321) |
| F17 | Old ABN appears in exactly 3 places, all in ritual-website; zero entity strings ship in the app | §2 above |
| F18 | Beka precedent covers AU/NZ/US/SA only — no Canada/PIPEDA section exists in either Beka doc | Live Beka docs, fetched 5 Jul 2026 |

---

## 8. Phase 2 change plan (numbered, ordered)

All work on branch `legal/bekker-labs-entity-swap` in each repo; commit per logical unit; explicit file paths only; full diff presented for review; **no merge, no deploy, no Capgo push without sign-off**. Changes 1–6 are website-repo; 7–8 are app-repo; 9 is documentation.

1. **Rewrite `public/privacy.html`** — Beka architecture, Ritual verified facts: Bekker Labs entity block; territory statement (per D2); short-version TL;DR; accurate collection list + negative list (F1, F3); Ritual-specific children's section (§5); processor table with confirmed regions (blocked on manual checklist items M1–M3); international-transfers section; itemised retention (subscription references removed); corrected security section (per D7); jurisdiction sections AU/NZ/US/SA (+CA per D2); dual dating; cross-link to terms; fix truncation; preserve page style + logo back-link.
2. **Rewrite `public/terms.html`** — entity swap; territory statement; keep existing eligibility §1 (correct as-is), NFC §5, ACL notice, liability cap; add parent-authority warranty; **replace subscription §3 with the "currently free" pattern**; governing-law carve-out; accurate deletion clause; dual dating; fix truncation.
3. **Footer entity lines** — `public/index.html:1487`, `public/start.html:611` → `© 2026 Bekker Labs Pty Ltd`.
4. **Self-host the two Google font families** (subject to D4) — removes Google from the visitor data flow; also add a one-line waitlist disclosure to the privacy policy (F12).
5. **Add a short waitlist/website section to the privacy policy** covering the email capture (this is currently undisclosed — the live policy covers only the app).
6. **Verify rewritten pages render completely** (no truncation), links resolve, old strings absent — local check pre-deploy; live check post-approved-deploy.
7. **ritual-v2: redact family names from Maurice ops payloads** (subject to D3) — send family IDs/counts instead of names in `familyActivity`; keeps Anthropic/Resend/Telegram out of the policy. Server-side only (Vercel deploy, no Capgo push).
8. **ritual-v2: stop writing push tokens to kid profiles** (subject to D5) — register the token against the account-holder/adult profile only. This *is* app-bundle code (would ship via Capgo) — held for sign-off like everything else.
9. **Document the subscription-launch clause set** (do not draft into live terms): billing/renewal/cancellation via Apple, price-change notice, trial conversion, data-on-cancellation retention — reinstate-from-git plus Beka's pre-charge-notice commitment when payments ship.

### Decision points — founder input required before Phase 2

| # | Decision | Recommendation |
|---|---|---|
| D1 | Aggregated-data-sale clause: keep (needs CCPA sale analysis + weakens children posture) or drop | **Drop** — adopt Beka no-sale posture |
| D2 | Canada: confirmed territory needing a fresh PIPEDA subsection, or align to Beka's four? Brief says five territories; Beka's live docs say four, no Canada precedent exists (F18) | Match actual App Store territory settings (M2); if Canada stays, I draft a short PIPEDA subsection (fresh drafting, flagged as such) |
| D3 | Family names in ops reports → Anthropic/Resend/Telegram: redact (code change 7) or disclose all three as processors | **Redact** |
| D4 | Google Fonts: self-host (change 4) or disclose Google as a website processor | **Self-host** |
| D5 | Push token on kid profiles: fix in code (change 8) or disclose as-is | **Fix** — strongest single COPPA improvement |
| D6 | In-app account deletion: build now (product work — new RPC + UI + auth-user deletion; `on delete restrict` needs handling) or ship policy with accurate email-only clause and schedule the feature | Ship accurate clause now; **schedule the feature** — it's an App Store 5.1.1(v) exposure, not a policy problem |
| D7 | RLS overclaim (F2): (a) soften the policy claim to app-level isolation, or (b) enable the staged account-holder RLS policies (schema.sql:344-392) then keep the strong claim. (b) is a production migration — per working convention, that pauses for you regardless | Honest minimum is (a) now; (b) is the right end-state but is a migration decision, not a wording one |
| D8 | Plaintext family PIN (F6): out of policy scope (policy makes no hashing claim) but flagged — hash-on-write migration recommended as separate security work | Schedule separately; do not claim any specific PIN protection in the policy meanwhile |

---

## 9. Manual checklist — Christelle & Willem

Things I can't touch (credentials/dashboards/native):

- **M1 — Supabase dashboard:** confirm project `nupifxbhwfaqyjevmmde` region (Settings → General → Region). Needed verbatim for the processor table and POPIA s72 wording. Do not assume Beka's Singapore.
- **M2 — App Store Connect, territories:** confirm current sale territories match the intended set (AU/NZ/US/SA ± CA per D2); EU/UK territories deselected.
- **M3 — Vercel dashboards (both projects):** confirm serverless function region (likely iad1 default — verify) for the transfers section.
- **M4 — App Store Connect, app metadata:** privacy policy URL field → https://ritualhabits.com.au/privacy; copyright field → Bekker Labs Pty Ltd; **seller name** — verify it already reads Bekker Labs Pty Ltd.
- **M5 — App Store Connect, privacy nutrition labels:** re-declare after the policy ships: Contact Info → Name (children's first names, linked to user); Identifiers → Device ID (push token); Usage Data → Product Interaction (completion history, linked); Contact Info → Email (account holders). No tracking. Match the final approved policy exactly.
- **M6 — Capgo account:** confirm (a) whether device-level telemetry reaches Capgo under `autoUpdate: false` with default `statsUrl`, (b) Capgo's processing location/entity for the processor table, (c) whether a DPA is available.
- **M7 — Post-deploy live verification** (I can run the checks; the deploy trigger is yours): both pages 200 and complete; new entity + ACN present; all three old-ABN strings gone; footers updated; in-app Settings links open the new pages.
- **M8 — No Xcode/native work surfaced by this audit.** Change 8 (push-token fix) is JS-bundle only.

---

*Report prepared by Claude (Fable). Every code claim personally verified against source; subagent findings were cross-checked before inclusion. Beka reference documents fetched live 5 July 2026.*
