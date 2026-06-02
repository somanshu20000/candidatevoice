# CandidateVoice — claude.md

> Read before starting any task. Update after completing any task.

---

## 1. Status

Experimental MVP / Private Beta. Not production-ready.

---

## 2. What this is

Open-source platform where candidates anonymously submit structured signals about their hiring experiences. Approved submissions are aggregated into a per-company score with a confidence tier based on sample size.

- **Code License:** MIT
- **Data License:** CC0 1.0

---

## 3. Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Frontend | Next.js 14 (App Router), TypeScript |
| Styling  | Tailwind CSS                        |
| DB       | Supabase (PostgreSQL + RLS)         |
| Hosting  | Vercel                              |

No AI services. No third-party content moderation. No analytics.

---

## 4. Directory Structure

```
howdarethey/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                # Homepage
│   │   ├── browse/page.tsx
│   │   ├── company/[slug]/page.tsx
│   │   ├── submit/page.tsx
│   │   ├── admin/page.tsx
│   │   └── api/
│   │       ├── submit/route.ts
│   │       └── admin/
│   │           ├── approve/route.ts
│   │           ├── reject/route.ts
│   │           ├── list-pending/route.ts
│   │           └── _utils.ts
│   ├── components/                 # Navbar, Footer, SubmissionCard, etc.
│   ├── lib/
│   │   └── supabase/
│   │       ├── client.ts           # @supabase/ssr browser client (currently unused)
│   │       ├── browser.ts          # Plain @supabase/supabase-js client used by browse page
│   │       ├── server.ts           # SSR client + service-role admin client
│   │       └── unlock-cookie.ts    # HMAC-signed company unlock cookie
│   ├── types/                      # Database + UI types
│   └── utils/
│       ├── sanitize.ts             # Input sanitization (wired into submit route)
│       └── hqs.ts                  # Hiring Quality Score formula
├── docs/
│   └── schema.md
├── .env.example
├── claude.md
├── README.md
└── LICENSE
```

---

## 5. Database

Single table: `hiring_submissions` in Supabase.

See `docs/schema.md` for the exact column list and enums.

- RLS is enabled on `hiring_submissions`
- Public reads: only rows where `is_approved = true`
- Writes (insert/update): performed server-side using the service-role key (bypasses RLS)
- No `user_id`, no email, no IP persisted to the database

---

## 6. Trust & Moderation

- Submissions default to `is_approved = false`. Nothing is publicly visible until approved.
- All moderation is **human** — performed via the `/admin` page using a bearer token (`ADMIN_SECRET`).
- There is no automated content moderation, no AI scoring, no third-party content service.
- Server-side enum allowlists validate every dropdown field on submit.
- Free-text fields (`company`, `role`) are HTML-stripped and length-capped via `src/utils/sanitize.ts`.

---

## 7. Hiring Quality Score (HQS)

Computed in `src/utils/hqs.ts`. A weighted linear formula over five metrics:

- `ghostRate` (no response + 15+ day silence)
- `earlyRejectRate` (<5 min first call + immediate rejection)
- `transparencyRate` (reason given, any reason ≠ `no_reason`)
- `paymentRate` (candidate asked to pay)
- `responseScore` (mapped from `response_time_bucket`)

Confidence tiers based on `total` submissions:
- **low:** < 20
- **medium:** 20–49
- **high:** ≥ 50

The numeric score is suppressed on the company page when `total < 5`. The formula is **not Bayesian**.

---

## 8. Submission Stage Enum

| Value     | Meaning                                |
|-----------|----------------------------------------|
| applied   | Application submitted, no further contact |
| screening | Recruiter screen reached                |
| technical | Technical interview reached             |
| hr        | HR / behavioral interview reached       |
| final     | Final round / offer stage reached       |

---

## 9. Outcome Enum

| Value        | Meaning                       |
|--------------|-------------------------------|
| rejected     | Explicitly rejected           |
| no_response  | No reply (potential ghost)    |
| offer        | Offer extended                |
| ongoing      | Process still in progress     |

---

## 10. Environment Variables

See `.env.example`. Never commit `.env.local`.

| Variable                       | Purpose                                |
|--------------------------------|----------------------------------------|
| NEXT_PUBLIC_SUPABASE_URL       | Supabase project URL                   |
| NEXT_PUBLIC_SUPABASE_ANON_KEY  | Public anon key (safe to ship)         |
| SUPABASE_SERVICE_ROLE_KEY      | Server-only. Never expose to client.   |
| NEXT_PUBLIC_APP_URL            | Canonical app URL                      |
| ADMIN_SECRET                   | Bearer token for `/api/admin/*` routes |
| COOKIE_SECRET                  | HMAC secret for unlock cookie          |

---

## 11. Security Posture (current)

- Sanitization + enum allowlists on the submit route (server-side)
- Service-role key is server-side only
- RLS on `hiring_submissions`
- HMAC-signed unlock cookie (24h expiry, max 20 companies)
- Locked company pages do **not** render real metric values in the DOM
- Rate limiter is in-memory only and is non-functional on Vercel serverless — known limitation, acceptable at private-beta scale

---

## 12. Known Limitations

- In-memory rate limiter does not persist across serverless invocations
- Admin reject route currently hard-deletes (planned migration to soft-delete pending)
- No legal pages (Terms, Privacy, Grievance, Contact) — required before public launch
- No moderation audit trail beyond the row's `is_approved` boolean
- `src/lib/supabase/client.ts` is currently dead code; `browse/page.tsx` imports `src/lib/supabase/browser.ts` instead
