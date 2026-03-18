# CandidateVoice — Single Source of Truth (claude.md)

> **This file is authoritative.** Read before starting any task. Update after completing any task.
> Last Updated: Phase 2 Next — Supabase Database Setup
> Maintained by: AI Lead Architect (Claude)

---

## 1. Project Overview

**CandidateVoice** is a crowdsourced, open-source platform where job seekers anonymously log rejection experiences. The goal is to equalize hiring power dynamics through radical transparency.

- **Core Values:** Anonymity, Transparency, Community Ownership
- **License:** MIT (code) / CC0 (data schema)
- **Status:** 🟡 Phase 2 Next — Supabase Database Setup

---

## 2. Tech Stack

| Layer         | Technology                              |
|---------------|-----------------------------------------|
| Frontend      | Next.js 14 (App Router), TypeScript     |
| Styling       | Tailwind CSS                            |
| Auth & DB     | Supabase (PostgreSQL + Auth + RLS)      |
| Hosting       | Vercel                                  |
| Content Safety| Hive Moderation API (placeholder ready) |
| Linting       | ESLint + Prettier                       |

---

## 3. Directory Structure

```
candidatevoice/
├── src/
│   ├── app/                    # Next.js 14 App Router pages
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/             # Reusable React components
│   ├── lib/
│   │   └── supabase/
│   │       ├── client.ts       # Browser-side Supabase client
│   │       └── server.ts       # Server-side Supabase client (SSR)
│   ├── types/
│   │   └── index.ts            # Global TypeScript interfaces
│   └── utils/                  # Shared utility functions
├── docs/                       # API & schema documentation
├── .env.example                # Safe env template (no real keys)
├── .gitignore
├── claude.md                   # THIS FILE — do not delete
├── CONTRIBUTING.md
├── LICENSE                     # MIT
└── README.md
```

---

## 4. Database Schema (Planned — Phase 2)

### `submissions` table
| Column           | Type        | Notes                                      |
|------------------|-------------|--------------------------------------------|
| id               | uuid        | Primary key                                |
| company_id       | uuid        | FK → companies.id (no free-text co. names)|
| role_title       | text        | Normalized (Senior Engineer, etc.)         |
| rejection_stage  | enum        | applied / screened / interviewed / offered |
| rejection_reason | text        | User-provided, moderated                   |
| experience_text  | text        | Narrative. Max 2000 chars. Moderated.      |
| sentiment_score  | float       | Computed via Hive Moderation               |
| is_approved      | boolean     | Default false — requires moderation        |
| created_at       | timestamptz | Auto                                       |

### `companies` table
| Column      | Type   | Notes                                   |
|-------------|--------|-----------------------------------------|
| id          | uuid   | Primary key                             |
| name        | text   | Canonical name (seeded, not user-input) |
| domain      | text   | e.g. "google.com"                       |
| industry    | text   | Normalized category                     |
| logo_url    | text   | Optional                                |

### `moderations` table
| Column        | Type        | Notes                          |
|---------------|-------------|--------------------------------|
| id            | uuid        | PK                             |
| submission_id | uuid        | FK → submissions.id            |
| flagged_by    | text        | "hive" or "admin"              |
| reason        | text        | Flag reason                    |
| resolved_at   | timestamptz | Nullable until resolved        |

> ⚠️ **No user identity stored beyond Supabase Auth UUID.** Submission is anonymous post-auth.

---

## 5. Security Rules

1. **No API keys in code.** All secrets via environment variables only.
2. **RLS enabled on ALL tables.** No exceptions.
3. **Submissions default to `is_approved = false`.** Nothing public without moderation.
4. **No recruiter names.** UI must prevent this. Legally critical.
5. **No proprietary information fields.** Flag as out-of-scope in moderation.
6. **Input validation:** All text fields sanitized for XSS before storage.
7. **Rate limiting on submission endpoint** — prevent spam/abuse (Phase 3).

---

## 6. Legal Safety Checklist

- [ ] Terms of Service page (Phase 4)
- [ ] Privacy Policy (Phase 4)
- [x] Content disclaimer in codebase root (Phase 1)
- [ ] Disclaimer banner on public pages (Phase 3)
- [x] No recruiter name fields in schema (Phase 2 — enforced by design)
- [x] Company names seeded/controlled — no free-text defamation surface
- [ ] DMCA contact email in footer (Phase 4)

---

## 7. Open Source Standards

- **Code License:** MIT — see `LICENSE`
- **Data License:** CC0 1.0 — schema and anonymized exports
- **Contributing:** See `CONTRIBUTING.md`
- **API Docs:** `docs/` directory — schema and public endpoints documented
- **Data Portability:** All submission data exportable as JSON/CSV (Phase 5)

---

## 8. Environment Variables

See `.env.example` for all required variables. Never commit `.env`.

| Variable                         | Purpose                        |
|----------------------------------|--------------------------------|
| NEXT_PUBLIC_SUPABASE_URL         | Supabase project URL           |
| NEXT_PUBLIC_SUPABASE_ANON_KEY    | Public anon key (safe to ship) |
| SUPABASE_SERVICE_ROLE_KEY        | Server-only. NEVER expose.     |
| HIVE_API_KEY                     | Content moderation             |
| NEXT_PUBLIC_APP_URL              | Canonical app URL              |

---

## 9. Phase Tracker

| Phase | Name                          | Status      |
|-------|-------------------------------|-------------|
| 1     | Initialization & OSS Setup    | ✅ Complete  |
| 1.5   | Windows / Dependency Fixes    | ✅ Complete  |
| 2     | Database Schema & RLS         | 🔜 Next     |
| 3     | Submission Form & Moderation  | ⏳ Pending  |
| 4     | Public Browse & Search        | ⏳ Pending  |
| 5     | Admin Dashboard               | ⏳ Pending  |
| 6     | Analytics & Data Export       | ⏳ Pending  |

---

## 10. Known Risks & Decisions Log

| Date       | Decision                                              | Rationale                                              |
|------------|-------------------------------------------------------|--------------------------------------------------------|
| Phase 1    | Company names seeded, not free-text                   | Prevents defamation surface area                       |
| Phase 1    | Submissions default `is_approved = false`             | Nothing goes public without human/AI moderation        |
| Phase 1    | Supabase SSR client pattern used                      | Required for Next.js 14 App Router cookie-based auth   |
| Phase 1    | MIT + CC0 dual license                                | MIT for code portability; CC0 for open data ecosystem  |
| Phase 1.5  | Next.js pinned to 14.2.29                             | Patched secure version; stable with ESLint 8.x         |
