#!/usr/bin/env python3
"""
CandidateVoice — Reddit acquisition adapter (Phase-1 cold-start bootstrap only).

WHAT THIS IS
    An acquisition adapter. It reads public hiring discussions via Reddit's
    OFFICIAL API (PRAW, authenticated) and emits ONE canonical record per line
    of a JSONL file — the same contract every source produces (see
    src/lib/hiring-intel/types.ts, RawExternalReport).

WHAT THIS IS NOT
    It does not touch the database. Loading the JSONL into Supabase is a
    separate, deliberate step that runs the records through validation, dedup
    and a moderation gate, landing them as PENDING:

        npm run external:import -- Data/external/reddit.jsonl --source reddit

    Separating acquisition from ingestion is the point: this file can be
    swapped or removed without touching the application.

WHAT IT STORES — AND DELIBERATELY DOES NOT
    Only extracted STRUCTURED FIELDS plus a link back to the post. It reads the
    title/body to extract signals, but it NEVER writes the post text, the title,
    or the author to the output. A file this adapter produces cannot republish
    copyrighted user content or identify a Reddit user, because the contract has
    nowhere to put them.

ENV (.env.local): REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USER_AGENT
"""

import os
import re
import sys
import json
import logging
import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPO_ROOT / ".env.local")
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Bump when the extraction logic below changes, so rows can be traced to the
# exact extractor that produced them and re-extracted selectively.
EXTRACTION_VERSION = "reddit-v1"

DEFAULT_SUBREDDITS = [
    "cscareerquestions", "ExperiencedDevs", "indiajobs",
    "cscareerquestionsCAD", "cscareerquestionsEU", "recruitinghell", "jobs",
]
SEARCH_QUERIES = [
    "interview experience", "interview process", "onsite experience",
    "OA experience", "got rejected after", "offer after interview",
]
SIGNALS = [
    "interview", "onsite", "oa", "online assessment", "phone screen",
    "system design", "behavioral", "recruiter", "offer", "rejected",
    "coding round", "technical round",
]
KNOWN = [
    "Google", "Amazon", "Meta", "Facebook", "Apple", "Microsoft", "Netflix",
    "Stripe", "Airbnb", "Uber", "Lyft", "Snap", "Oracle", "IBM", "Salesforce",
    "Adobe", "Intel", "Nvidia", "Cisco", "Flipkart", "Swiggy", "Zomato",
    "Razorpay", "Paytm", "Zerodha", "CRED", "Infosys", "TCS", "Wipro",
    "Accenture", "Deloitte", "Capgemini", "Atlassian", "Databricks",
    "Snowflake", "Palantir", "Coinbase", "Robinhood",
]
ROLE_PATTERNS = {
    "Software Engineer": [r"\bswe\b", r"software engineer", r"\bdeveloper\b", r"\bsde\b", r"\bbackend\b", r"\bfrontend\b", r"full ?stack"],
    "Product Manager": [r"\bpm\b", r"product manager", r"product management"],
    "Data Scientist": [r"data scientist", r"data analyst", r"machine learning", r"ml engineer", r"data engineer"],
    "Designer": [r"\bux\b", r"ui designer", r"product designer"],
    "DevOps Engineer": [r"\bdevops\b", r"\bsre\b", r"site reliability", r"cloud engineer"],
}

# Interview rounds, ordered by how far through the process they sit. The furthest
# matched round determines `stage`, mapped to the contract's closed vocabulary.
ROUND_TO_STAGE = [
    ("screening", [r"\boa\b", r"online assessment", r"\bhackerrank\b", r"\bcodility\b", r"\bleetcode\b", r"phone screen", r"phone round", r"telephonic", r"recruiter (?:call|screen)"]),
    ("technical", [r"technical round", r"coding round", r"technical interview", r"\bdsa\b", r"system design", r"\bhld\b", r"\blld\b"]),
    ("hr", [r"behavioral", r"behavioural", r"\bhr round\b", r"\bhr interview\b", r"cultural fit", r"values round", r"hiring manager", r"manager round"]),
    ("final", [r"final round", r"onsite", r"on-site", r"super ?day"]),
]
STAGE_ORDER = ["applied", "screening", "technical", "hr", "final"]


def company(text: str) -> Optional[str]:
    low = text.lower()
    for c in KNOWN:
        if c.lower() in low:
            return c
    m = re.search(r"\b(?:at|from|interview(?:ed)? (?:at|with))\s+([A-Z][A-Za-z0-9&.\- ]{1,30})", text)
    if m:
        cand = m.group(1).strip().rstrip(".")
        if len(cand) > 2 and cand.lower() not in ("the", "their", "this", "them", "a", "an"):
            return cand
    return None


def role(text: str) -> Optional[str]:
    low = text.lower()
    for label, patterns in ROLE_PATTERNS.items():
        if any(re.search(p, low) for p in patterns):
            return label
    return None


def stage(text: str) -> Optional[str]:
    low = text.lower()
    furthest = -1
    for st, patterns in ROUND_TO_STAGE:
        if any(re.search(p, low) for p in patterns):
            furthest = max(furthest, STAGE_ORDER.index(st))
    return STAGE_ORDER[furthest] if furthest >= 0 else None


def outcome(text: str) -> Optional[str]:
    low = text.lower()
    if re.search(r"got (?:the )?offer|received (?:an )?offer|offer letter|got hired|accepted the offer", low):
        return "offer"
    if re.search(r"ghosted|ghosting|never heard back|no response|went silent|radio silence", low):
        return "no_response"
    if re.search(r"rejected|rejection|did not get|didn't get|turned down", low):
        return "rejected"
    return None


def response_time_bucket(text: str) -> Optional[str]:
    low = text.lower()
    days = None
    m = re.search(r"(\d+)\s*-\s*(\d+)\s*days", low)
    if m:
        days = (int(m.group(1)) + int(m.group(2))) // 2
    elif (m := re.search(r"(\d+)\s*days", low)):
        days = int(m.group(1))
    elif (m := re.search(r"(\d+)\s*weeks?", low)):
        days = int(m.group(1)) * 7
    elif (m := re.search(r"(\d+)\s*months?", low)):
        days = int(m.group(1)) * 30
    if days is None:
        return None
    if days <= 3:
        return "0-3"
    if days <= 7:
        return "4-7"
    if days <= 14:
        return "8-14"
    return "15+"


def payment_flag(text: str) -> Optional[bool]:
    low = text.lower()
    if re.search(r"asked (?:me )?to pay|training fee|pay for training|deposit before|registration fee", low):
        return True
    return None  # absence of evidence is not evidence of absence — leave unknown


class RedditAdapter:
    def __init__(self):
        try:
            import praw
        except ImportError:
            logger.error("praw not installed. Run: pip install -r scripts/requirements.txt")
            sys.exit(1)
        cid = os.getenv("REDDIT_CLIENT_ID")
        csec = os.getenv("REDDIT_CLIENT_SECRET")
        ua = os.getenv("REDDIT_USER_AGENT", "candidatevoice:v1.0 (by /u/yourusername)")
        if not cid or not csec:
            raise ValueError("REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET must be set in .env.local")
        self.reddit = praw.Reddit(client_id=cid, client_secret=csec, user_agent=ua)
        self.reddit.read_only = True

    def harvest(self, subreddits, limit=100):
        seen, records = set(), []
        joined = "+".join(subreddits)
        logger.info("Searching r/%s via the official API…", joined)
        for query in SEARCH_QUERIES:
            try:
                for post in self.reddit.subreddit(joined).search(query, sort="relevance", time_filter="year", limit=limit):
                    if post.id in seen:
                        continue
                    seen.add(post.id)
                    # Read title+body to EXTRACT signals; never store them.
                    text = f"{post.title}\n\n{post.selftext or ''}"
                    if sum(1 for sig in SIGNALS if sig in text.lower()) < 2:
                        continue
                    record = self._to_record(post, text)
                    if record:
                        records.append(record)
                logger.info("  query %r: %d kept so far", query, len(records))
            except Exception as e:  # noqa: BLE001 — one bad query must not abort the run
                logger.warning("  query %r failed: %s", query, e)
        return records

    def _to_record(self, post, text) -> Optional[dict]:
        c = company(text)
        if not c:
            return None
        st = stage(text)
        oc = outcome(text)
        rt = response_time_bucket(text)
        pf = payment_flag(text)
        # Require at least one usable signal — a bare company mention is noise.
        if not (st or oc or rt or pf is not None):
            return None
        month = datetime.fromtimestamp(post.created_utc, tz=timezone.utc).strftime("%Y-%m")
        rl = role(text)
        # Confidence: this extractor is regex/keyword based, so confidence scales
        # with how many independent signals it found. A single signal is a weak
        # guess; several agreeing signals are stronger. Deliberately conservative
        # — the core stores this so extraction quality can be tracked and the
        # weighted score can discount low-confidence rows.
        signals = sum(1 for v in (rl, st, oc, rt, (pf if pf is not None else None)) if v)
        confidence = round(min(0.3 + 0.15 * signals, 0.85), 2)
        # CANONICAL CONTRACT ONLY. No title, no body, no author.
        record = {
            "company": c,
            "source_url": f"https://www.reddit.com{post.permalink}",
            "external_ref": f"t3_{post.id}",
            "reported_month": month,
            "extraction_version": EXTRACTION_VERSION,
            "extraction_confidence": confidence,
        }
        if rl:
            record["role"] = rl
        if st:
            record["stage"] = st
        if oc:
            record["outcome"] = oc
        if rt:
            record["response_time_bucket"] = rt
        if pf is not None:
            record["payment_flag"] = pf
        return record


def write_jsonl(records, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    if not records:
        logger.warning("No records to write.")
        return
    with open(out, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    logger.info("Wrote %d records -> %s", len(records), out)
    logger.info("Next (does NOT auto-run): npm run external:import -- %s --source reddit", out)


def main():
    default_out = REPO_ROOT / "Data" / "external" / "reddit.jsonl"
    ap = argparse.ArgumentParser(description="Reddit acquisition adapter -> canonical JSONL (no DB writes)")
    ap.add_argument("--subreddit", action="append", default=None, help="repeatable; defaults to a curated list with --all-subreddits")
    ap.add_argument("--all-subreddits", action="store_true")
    ap.add_argument("--limit", type=int, default=100, help="results per search query")
    ap.add_argument("--output", type=Path, default=default_out)
    args = ap.parse_args()

    subs = args.subreddit or (DEFAULT_SUBREDDITS if args.all_subreddits else None)
    if not subs:
        ap.print_help()
        sys.exit(1)

    try:
        adapter = RedditAdapter()
    except Exception as e:  # noqa: BLE001
        logger.error("Init failed: %s", e)
        sys.exit(1)

    records = adapter.harvest(subs, limit=args.limit)
    write_jsonl(records, args.output)


if __name__ == "__main__":
    main()
