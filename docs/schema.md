# CandidateVoice — Public Schema Documentation

> **License:** CC0 1.0 Universal — this schema is dedicated to the public domain.
> Developers are encouraged to build on, fork, or extend this data structure.

---

## Overview

CandidateVoice uses a PostgreSQL database hosted on Supabase. The schema is intentionally minimal and anonymized — **no personally identifiable information is stored**.

---

## Tables

### `companies`

Seed list of verified companies. Users **cannot** add companies via the submission form — this prevents defamation through invented company names.

```sql
CREATE TABLE companies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  domain     TEXT,                        -- e.g. "google.com"
  industry   TEXT,                        -- e.g. "Technology"
  logo_url   TEXT,                        -- Optional CDN URL
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**RLS Policy:** Public read. No public insert/update.

---

### `submissions`

The core table. Each row is one anonymized rejection experience.

```sql
CREATE TYPE rejection_stage AS ENUM (
  'applied',
  'screened',
  'interviewed',
  'offered'
);

CREATE TABLE submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES companies(id),
  role_title       TEXT NOT NULL CHECK (char_length(role_title) <= 120),
  rejection_stage  rejection_stage NOT NULL,
  rejection_reason TEXT CHECK (char_length(rejection_reason) <= 500),
  experience_text  TEXT NOT NULL CHECK (char_length(experience_text) <= 2000),
  sentiment_score  FLOAT,                 -- Set by Hive Moderation, not user
  is_approved      BOOLEAN DEFAULT false, -- Must be true to appear publicly
  created_at       TIMESTAMPTZ DEFAULT now()
);
```

**RLS Policies:**
- Public SELECT: only rows where `is_approved = true`
- INSERT: authenticated users only
- UPDATE/DELETE: admin role only

**Note:** No `user_id` is stored. Submissions are anonymous post-auth.

---

### `moderations`

Audit trail for content moderation decisions.

```sql
CREATE TABLE moderations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  flagged_by    TEXT NOT NULL CHECK (flagged_by IN ('hive', 'admin')),
  reason        TEXT NOT NULL,
  resolved_at   TIMESTAMPTZ,              -- NULL = unresolved
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

**RLS Policy:** Admin role only. Not publicly accessible.

---

## Row Level Security Summary

| Table        | Public SELECT        | Auth INSERT | Admin Only          |
|--------------|----------------------|-------------|---------------------|
| companies    | ✅ All rows          | ❌          | UPDATE, DELETE      |
| submissions  | ✅ `is_approved=true`| ✅          | UPDATE, DELETE      |
| moderations  | ❌                   | ❌          | ALL operations      |

---

## Enum Values

### `rejection_stage`

| Value        | Meaning                                           |
|--------------|---------------------------------------------------|
| `applied`    | Rejected at application / resume screening stage |
| `screened`   | Rejected after recruiter phone/email screen       |
| `interviewed`| Rejected after one or more interviews             |
| `offered`    | Offer extended but rescinded                      |

---

## Data Export Format

Approved submissions will be exported periodically as CC0 public data.

**JSON format:**
```json
{
  "export_date": "2024-01-01",
  "license": "CC0 1.0",
  "submissions": [
    {
      "id": "uuid",
      "company_name": "Acme Corp",
      "industry": "Technology",
      "role_title": "Senior Engineer",
      "rejection_stage": "interviewed",
      "rejection_reason": "Not enough experience",
      "experience_text": "...",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Using This Schema

You are free to use, fork, or extend this schema under CC0. If you build something with it, we'd love to know — open a GitHub Discussion.
