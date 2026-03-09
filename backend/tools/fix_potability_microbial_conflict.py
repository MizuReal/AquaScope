#!/usr/bin/env python3
"""Fix conflicting labels in Supabase `water_potability` table.

Sets ``is_potable = false`` for every row where ``microbial_risk = 'high'``
and ``is_potable = true``.  This aligns the training data so that high
microbial risk and potability are mutually exclusive.

Only the ``water_potability`` table is modified. The ``field_samples``
table (user scans) is NOT touched.

Usage
-----
    cd backend
    python -m tools.fix_potability_microbial_conflict          # dry-run (default)
    python -m tools.fix_potability_microbial_conflict --apply   # actually update
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND_DIR / ".env")
except ImportError:
    pass

from supabase import create_client

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
logger = logging.getLogger(__name__)

TABLE = "water_potability"


def get_client():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        sys.exit(1)
    return create_client(url, key)


def count_conflicts(client) -> int:
    resp = (
        client.table(TABLE)
        .select("id", count="exact")
        .eq("is_potable", True)
        .eq("microbial_risk", "high")
        .execute()
    )
    return resp.count if resp.count is not None else len(resp.data or [])


def fix_conflicts(client) -> int:
    """Update conflicting rows in batches and return total updated count."""
    updated = 0
    while True:
        # Fetch a batch of conflicting row IDs
        resp = (
            client.table(TABLE)
            .select("id")
            .eq("is_potable", True)
            .eq("microbial_risk", "high")
            .limit(500)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            break
        ids = [r["id"] for r in rows]
        for row_id in ids:
            client.table(TABLE).update({"is_potable": False}).eq("id", row_id).execute()
        updated += len(ids)
        logger.info("  Updated %d rows so far...", updated)
    return updated


def main():
    parser = argparse.ArgumentParser(description="Fix Potable+HighRisk conflicts in water_potability")
    parser.add_argument("--apply", action="store_true", help="Actually perform the update (default is dry-run)")
    args = parser.parse_args()

    client = get_client()
    n = count_conflicts(client)
    logger.info("Found %d conflicting rows (is_potable=true AND microbial_risk='high')", n)

    if n == 0:
        logger.info("Nothing to fix.")
        return

    if not args.apply:
        logger.info("DRY RUN — no changes made. Re-run with --apply to update.")
        return

    updated = fix_conflicts(client)
    logger.info("Done. Updated %d rows: is_potable set to false.", updated)


if __name__ == "__main__":
    main()
