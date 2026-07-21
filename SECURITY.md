# Security Policy

CandidateVoice is an open-source, solo-maintained project in private beta (see `claude.md` §1). There is no bug bounty program, but real vulnerability reports are taken seriously and will be fixed promptly.

## Reporting a Vulnerability

**Do not open a public GitHub issue for a security vulnerability.** Public issues on a live repo are visible to anyone before a fix ships.

Instead, email **imsomanshu@gmail.com** with:

- A description of the vulnerability and its impact
- Steps to reproduce (a minimal repro is ideal)
- Any suggested mitigation, if you have one

You should receive an acknowledgment within **5 business days**. This is a solo-maintained project, so response and fix times will vary with severity and maintainer availability — critical issues (data exposure, auth bypass, RCE) are prioritized over lower-severity ones.

## Scope

In scope:
- The application code in this repository (`src/`)
- The documented Supabase schema and RLS design (`docs/schema.md`)
- Configuration in this repo (`next.config.js`, `supabase/migrations/`)

Out of scope:
- Vulnerabilities in third-party dependencies — please report those upstream (e.g. via `npm audit` / the relevant project's own security policy) as well as letting us know so the dependency can be updated here
- Social engineering, physical attacks, or denial-of-service testing against the live deployment
- Findings that require access to `ADMIN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, or `COOKIE_SECRET` as a starting assumption (report how those could leak, not what's possible once they have)

## Disclosure

Please give us a reasonable window to fix the issue before any public disclosure. We'll credit reporters (with permission) once a fix ships, if desired.
