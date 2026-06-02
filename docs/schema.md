# CandidateVoice — Schema

> **License:** CC0 1.0 Universal.
> **Status:** Experimental MVP / Private Beta — the schema may change without notice.

This document reflects the **current** Supabase schema as used by the application. It is not aspirational. If the running application disagrees with this file, the application is correct and this file is out of date.

---

## Overview

A single PostgreSQL table on Supabase. No foreign keys. No companies table — the company is stored as a normalized text slug on each row. No user identity is recorded.

---

## `hiring_submissions`

```sql
CREATE TABLE hiring_submissions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company                   TEXT NOT NULL,
  role                      TEXT NOT NULL,
  experience_bucket         TEXT NOT NULL,
  stage                     TEXT NOT NULL,
  outcome                   TEXT NOT NULL,
  response_time_bucket      TEXT NOT NULL,
  last_interaction_gap      TEXT NOT NULL,
  call_duration             TEXT NOT NULL,
  first_interaction_outcome TEXT NOT NULL,
  reason                    TEXT NOT NULL,
  payment_flag              BOOLEAN NOT NULL DEFAULT false,
  is_approved               BOOLEAN NOT NULL DEFAULT false,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Columns

| Column                      | Type        | Notes                                                    |
|-----------------------------|-------------|----------------------------------------------------------|
| `id`                        | UUID        | Primary key                                              |
| `company`                   | text        | Normalized slug (lowercased, spaces → hyphens). Free-text from the submitter; sanitized + length-capped at 100 chars server-side. |
| `role`                      | text        | Free-text role title. Sanitized + length-capped at 120 chars server-side. |
| `experience_bucket`         | text        | Enum-valued (see below)                                  |
| `stage`                     | text        | Enum-valued                                              |
| `outcome`                   | text        | Enum-valued                                              |
| `response_time_bucket`      | text        | Enum-valued                                              |
| `last_interaction_gap`      | text        | Enum-valued                                              |
| `call_duration`             | text        | Enum-valued                                              |
| `first_interaction_outcome` | text        | Enum-valued                                              |
| `reason`                    | text        | Enum-valued                                              |
| `payment_flag`              | boolean     | True if the candidate was asked to pay anything          |
| `is_approved`               | boolean     | Defaults to `false`. Only `true` rows are publicly visible. |
| `created_at`                | timestamptz | Insert timestamp                                         |

### RLS

| Operation | Public (anon)                  | Service role (server)        |
|-----------|--------------------------------|------------------------------|
| SELECT    | Only rows where `is_approved = true` | All rows                |
| INSERT    | Denied                          | All inserts                  |
| UPDATE    | Denied                          | Admin moderation actions     |
| DELETE    | Denied                          | Admin reject (currently hard delete) |

All write paths go through the server using the `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS. Public reads use the anon key and respect RLS.

---

## Enum value sets

These are enforced **server-side** in `src/app/api/submit/route.ts` (TypeScript allowlists). They are not enforced as PostgreSQL `ENUM` types at the database level.

### `stage`
`applied`, `screening`, `technical`, `hr`, `final`

### `outcome`
`rejected`, `no_response`, `offer`, `ongoing`

### `experience_bucket`
`0-1`, `1-3`, `3-5`, `5-8`, `8+`

### `response_time_bucket`
`0-3`, `4-7`, `8-14`, `15+`

### `last_interaction_gap`
`0-7`, `8-14`, `15-30`, `30+`

### `call_duration`
`<2`, `2-5`, `5-15`, `15+`, `na`

### `first_interaction_outcome`
`continued`, `rejected_immediately`, `na`

### `reason`
`experience_mismatch`, `skill_mismatch`, `culture_fit`, `no_reason`, `other`

---

## What is **not** in the schema

The following were described in earlier versions of this document but **do not exist** in the running application:

- ❌ No `companies` table
- ❌ No `moderations` audit-trail table
- ❌ No `sentiment_score`, `experience_text`, `role_title`, `rejection_stage`, or `rejection_reason` columns (the actual column names are `role`, `stage`, `reason`)
- ❌ No `rejection_stage` PostgreSQL ENUM type
- ❌ No `user_id` or any column linking a submission to a person

---

## Identity & privacy

- No `user_id`, no email, no IP address is stored on a row
- The platform sets one HMAC-signed first-party cookie (`COOKIE_SECRET`-signed) listing company slugs the visitor has "unlocked" by submitting. The cookie expires in 24 hours and is capped at 20 entries
- Vercel platform logs may include IP addresses at the infrastructure layer; these are not written to `hiring_submissions`
