# Design: company-domain authentication for HR updates

**Status:** Design only. Not implemented. Nothing in this document changes
`hiring_events.actor_type` — that CHECK still admits only `'candidate'` and
`'system'` (migration `0023`, DECISIONS.md D-011) until this design, or a
revision of it, is actually built and someone deliberately widens it.

## Why this exists

Roadmap items 6 and 8 ("HR/company status", "weekly HR updates") are blocked,
not missing. `DECISIONS.md` D-011 explains why: **there is no organization-level
authentication anywhere in this app.** The only existing auth is
`ADMIN_SECRET` — one shared bearer token, no per-user identity
(`src/app/api/admin/_utils.ts`). Shipping an HR write path on top of that would
let anyone holding the secret speak *as any company*. We refused to build that.

This document is the answer to "how, then" — so the decision to unblock is
informed, not improvised the day someone wants item 6 shipped.

---

## 1. Company-domain email verification (the primary path)

**Mechanism:** the same signed, expiring-token pattern already used twice in
this codebase (`src/lib/unlock-cookie.ts`, `src/lib/candidate/cookie.ts` — HMAC
via `crypto.createHmac`, keyed by a server-only secret). No new cryptographic
primitive, no new dependency.

1. A person enters a work email at `someone@company.com`.
2. We extract the domain and check it against `company_links` (`link_type =
   'website'`, already 85% populated) for the organization they claim to
   represent. **A mismatch is rejected before any email is sent** — this is a
   cheap, useful filter even though it isn't proof (a company can own multiple
   domains, and a personal-domain HR person exists too; see §2).
3. We send a single-use, **short-lived** (recommend 15 minutes) signed link:
   `token = HMAC(email + organization_id + expiry, HR_AUTH_SECRET)`. Mirrors
   `unlock-cookie.ts`'s `sign()` exactly — no session state to store server-side
   until the link is actually clicked.
4. Clicking the link inside its window proves control of that inbox and
   creates the HR session — an HMAC-signed cookie scoped to
   `(organization_id, email)`, expiring on its own (recommend 30 days,
   re-verified by a fresh email on expiry). This is a **third** identity
   envelope, structurally separate from the anonymous candidate cookie and the
   opaque advisor-preference cookie (ADR-0003's disjointness guarantee) — an HR
   session must never be able to correlate with either.

**Reuses:** the HMAC pattern, `src/lib/rate-limit.ts` for throttling the send
endpoint (mirroring `checkAndRecordRateLimit` on `/api/submit`), and
`src/lib/client-ip.ts` for lockout tracking (mirroring `_utils.ts`'s
`isLockedOut`/`recordFailedAttempt`).

## 2. What this proves — and, explicitly, what it does not

**Proves:** the person clicking the link currently controls an inbox at that
domain.

**Does NOT prove:**
- **That they are authorized to speak for the company.** A domain has many
  inboxes. `someone@company.com` might be an intern, a contractor, or someone
  who left last month and still has mail forwarding. Domain control is a
  *filter*, not an *authorization* — it rules out "anyone on the internet," it
  does not rule in "this specific person may post HR updates."
- **That the company endorses using this platform at all.** One employee
  self-serving a verification link is not the company opting in.
- **Permanence.** A verified person who leaves the company keeps a working
  session until it expires (§4 addresses revocation).
- **Good faith.** A verified employee could still misrepresent a role's status
  (mark a cancelled role "still hiring" to keep a talent pipeline warm, or the
  reverse to discourage a specific applicant). Verification authenticates
  *identity*, not *honesty* — the same limit every authentication system has,
  named explicitly here because the roadmap phrasing ("HR status") can read as
  if a verified update is automatically ground truth. It is a first-party
  claim, exactly like a candidate report — evaluated by corroboration and the
  same suppression discipline (D-002), never taken as fact because it came
  from a verified sender.

This is why §3 exists: domain verification is necessary but explicitly
**not sufficient** for anything higher-stakes than routine status updates.

## 3. Admin / manual verification fallback

For cases the automatic path can't reach cleanly: a company with no website
domain on file yet, a person emailing from a personal address who can prove
authority some other way (a signed letter, a LinkedIn admin match — evaluated
by a human, not automated), or a dispute over who's authorized to post for a
given company.

**Mechanism:** extends the existing `ADMIN_SECRET`-gated admin surface
(`src/app/admin/*`, `src/app/api/admin/*`) rather than inventing a parallel
one. An admin reviews the claim and manually grants an HR session for
`(organization_id, email)` — same signed-cookie output as §1, different
issuance path. Every manual grant is itself an audit-trail event (§5) recording
*who at CandidateVoice* approved it and why, so "an admin just clicked yes" is
never invisible.

**Deliberately NOT built into this design:** any fully-automated fallback
(SMS, government ID, a paid verification API). Manual review is slower but
adds a human judgment call exactly where the automated signal is weakest —
consistent with this codebase's existing bias (D-011 refused to invent auth
rather than ship something weaker than it looks).

## 4. Permission model for HR updates

**Scope, not role.** An HR session is scoped to exactly one
`organization_id` — it can post updates only for hiring opportunities under
that organization, never any other. There is no "global HR" or "super-HR"
role; a person representing two companies (an agency recruiter) holds two
separate sessions.

**What an HR session can do:**
- Post a status update on an existing `hiring_opportunity` under its
  `organization_id` (the four values from the roadmap: still hiring / paused /
  hired / cancelled / other).
- Nothing else. Not editing candidate reports, not seeing candidate identity
  (there isn't one to see — hiring_submissions carries none), not moderating,
  not touching another organization's data.

**Revocation:** a session expires on its own (§1). Immediate revocation (an
admin pulls access before natural expiry — e.g. a dispute, or someone leaving
the company) is a manual-admin action (§3), logged the same way a grant is.
No user-facing "log out everyone at this company" self-service exists in this
design — that is itself a judgment call, deliberately routed through a human.

**Rate limits:** an HR update is throttled per-organization (not just
per-session), mirroring the existing per-scope pattern in `rate-limit.ts`
(`company_enrich_slug` is the closest precedent — a per-target lock, not just
per-IP) — this prevents a compromised or malicious session from flooding one
company's timeline with contradictory events.

## 5. Audit trail

**The audit trail already exists as a mechanism — it just isn't legal to use
yet.** `hiring_events` is append-only and genuinely immutable at the database
level (D-010: `UPDATE`/`DELETE` both raise `P0001`, verified live). The moment
`actor_type`'s CHECK widens to admit `'hr'`, every HR action is automatically
an audit-trail row with no additional schema work:

```sql
alter table hiring_events drop constraint hiring_events_actor_type_check;
alter table hiring_events add constraint hiring_events_actor_type_check
  check (actor_type in ('candidate', 'system', 'hr'));
```

Two additions this design calls for, layered on top of that migration (not
built here):
- **A new event type**, `hr_status_update`, payload `{ status: 'still_hiring'
  | 'paused' | 'hired' | 'cancelled' | 'other', note?: string }` — `note`
  capped and sanitized the same way `reason`/`requester_note` already are
  elsewhere in this codebase, never rendered as unescaped HTML.
- **A separate, admin-only `hr_sessions` audit table** (verification method,
  granted-by, granted-at, revoked-at) — distinct from `hiring_events` because
  session grants are *about* who may write, not evidence *of* anything a
  candidate or the system observed. Mixing the two would blur exactly the
  "first-party claim vs. platform bookkeeping" line D-011 exists to keep clean.

**What stays true regardless of implementation:** an HR update is rendered
with the same neutral, non-authoritative framing as every other event kind in
`HiringTimeline.tsx` — never as an adjudicated "this is what happened," always
as "the company reported X." Perception, system inference, and HR claim are
three different epistemic categories, and the UI must keep saying so.

---

## Summary — what's needed before items 6/8 unblock

1. `HR_AUTH_SECRET` env var + the domain-verification email flow (§1).
2. The `hr_sessions` audit table + admin grant/revoke UI extending `/admin`
   (§3, §5).
3. The `actor_type` CHECK widening + `hr_status_update` event type (§5).
4. Per-organization rate limiting for HR writes (§4).
5. Timeline rendering updated to show HR events with their own neutral,
   clearly-labelled visual treatment (extends `HiringTimeline.tsx`'s existing
   candidate/system distinction to a third kind).

None of this is started. This document exists so that decision is made
consciously, not by drifting into it one convenient shortcut at a time.
