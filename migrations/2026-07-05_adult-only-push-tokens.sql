-- ─── ADULT-ONLY PUSH TOKENS — one-off cleanup (July 2026) ──────────────────
-- Privacy: APNs device tokens are stored on adult profiles only. The device
-- is the parent's; a token sitting on a kid profile is a persistent
-- identifier attached to a child's record, which the privacy policy (and the
-- app's children's-data posture) says we don't keep.
--
-- The app no longer writes tokens to kid profiles (src/App.js registration +
-- reconcile guards; handleEditMember clears the token on adult→kid switch),
-- and api/cron/reminders.js + api/nudge.js route kid-profile notifications
-- to the family's adult devices instead. This migration clears any tokens
-- already written to kid rows by earlier app versions. Adults re-register
-- automatically on next app launch, so nulling a token that was doing duty
-- for the household is self-healing.
--
-- No check constraint enforcing this at the DB level: app bundles in the
-- field may still write tokens to kid rows until the OTA update lands, and a
-- constraint would also break legitimate adult→kid profile edits from old
-- bundles. Revisit alongside the RLS migration.

update members set push_token = null where is_kid = true;
