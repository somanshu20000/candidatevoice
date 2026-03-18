# CandidateVoice

> **Equalizing hiring power dynamics through radical transparency.**

CandidateVoice is an open-source, crowdsourced platform where job seekers anonymously log rejection experiences. By aggregating this data publicly, we give candidates the same visibility into hiring pipelines that employers have always had.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Data: CC0](https://img.shields.io/badge/Data-CC0%201.0-lightgrey.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

> ⚠️ **Legal Disclaimer:** This platform hosts anonymized, user-generated content. All submissions are moderated before publication. Company names are sourced from a verified seed list. No individual employee names are permitted. Content does not represent verified facts and should not be treated as such. See Terms of Service for full liability information.

---

## Mission

The hiring process is opaque. Employers collect data on candidates; candidates collect nothing. CandidateVoice flips this asymmetry by creating a **public, structured, anonymized record** of rejection experiences — what stage, what reason (if given), and what the experience felt like.

**We do not name individuals. We do not host proprietary information. We moderate everything.**

---

## Tech Stack

| Layer         | Technology                              |
|---------------|-----------------------------------------|
| Frontend      | Next.js 14 (App Router), TypeScript     |
| Styling       | Tailwind CSS                            |
| Auth & DB     | Supabase (PostgreSQL + Auth + RLS)      |
| Hosting       | Vercel                                  |
| Content Safety| Hive Moderation API                     |

---

## Data Schema Overview

The schema is CC0-licensed and documented for public use.

### Core Tables

**`companies`** — Seed list of verified companies (not user-input)
```
id | name | domain | industry | logo_url
```

**`submissions`** — Anonymized rejection experiences
```
id | company_id | role_title | rejection_stage | rejection_reason 
   | experience_text | sentiment_score | is_approved | created_at
```

**`moderations`** — Content moderation audit trail
```
id | submission_id | flagged_by | reason | resolved_at
```

**Rejection Stages (enum):**
`applied` → `screened` → `interviewed` → `offered`

Full schema with RLS policies is in `/docs/schema.md`.

---

## Getting Started (Local Development)

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Vercel](https://vercel.com) account (for deployment)

### 1. Clone the repo

```bash
git clone https://github.com/your-org/candidatevoice.git
cd candidatevoice
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.example .env.local
```

Fill in your values in `.env.local` — see `.env.example` for required variables.

> ⛔ Never commit `.env.local` or any file containing real API keys.

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Set up Supabase

Run the SQL migrations in `/docs/schema.sql` in your Supabase SQL Editor.
Enable Row Level Security on all tables (policies are included in the migration file).

---

## Project Structure

```
candidatevoice/
├── src/
│   ├── app/                    # Next.js 14 App Router
│   ├── components/             # Reusable UI components
│   ├── lib/supabase/           # Supabase client (server + browser)
│   ├── types/                  # TypeScript interfaces
│   └── utils/                  # Shared utilities
├── docs/                       # Schema docs & API reference
├── .env.example                # Environment variable template
├── claude.md                   # Project source of truth (AI context)
├── CONTRIBUTING.md             # Contributor guidelines
└── LICENSE                     # MIT (code) + CC0 (data)
```

---

## Open Data

The anonymized, aggregated dataset produced by this platform will be periodically exported and published under CC0. Our goal is to make rejection-stage statistics freely available to researchers, journalists, and other developers.

Export format: JSON / CSV
Planned frequency: Monthly snapshots
Location: `/data/exports/` (coming in Phase 6)

---

## Contributing

We welcome contributions of all kinds — code, design, data validation, legal review, and community moderation.

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

---

## Legal

- Code: [MIT License](./LICENSE)
- Data Schema: [CC0 1.0 Universal](./LICENSE)
- User-submitted content remains the property of the original author
- Platform is not liable for unverified user-generated content
- No individual employee names permitted on the platform
