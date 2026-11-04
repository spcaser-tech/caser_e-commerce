#!/usr/bin/env python3
"""Copy the existing SQLite store into PostgreSQL."""

import os
import sqlite3
import sys
from pathlib import Path

import server


TABLES = {
    "products": ("id", "name", "category", "description", "price_cents", "badge", "rating", "review_count", "image", "stock"),
    "users": ("id", "name", "email", "password_hash", "salt", "created_at", "role", "phone", "address", "city", "postal_code"),
    "sessions": ("token_hash", "user_id", "expires_at"),
    "orders": ("id", "user_id", "total_cents", "status", "created_at", "payment_method", "delivery_name", "delivery_phone", "delivery_address", "delivery_city", "delivery_postal_code", "coupon_code", "discount_cents"),
    "order_items": ("id", "order_id", "product_id", "name", "price_cents", "quantity"),
    "payment_transactions": ("id", "order_id", "method", "status", "masked_reference", "created_at"),
    "coupon_redemptions": ("id", "user_id", "order_id", "coupon_code", "discount_cents", "redeemed_at"),
}


def main() -> None:
    if not server.DATABASE_URL:
        raise SystemExit("Set DATABASE_URL before running this script.")
    source_path = Path(os.environ.get("GAMERS_OASIS_DB", server.ROOT / "gamers_oasis.sqlite3"))
    if not source_path.exists():
        raise SystemExit(f"SQLite database not found: {source_path}")

    server.initialize_database()
    source = sqlite3.connect(source_path)
    source.row_factory = sqlite3.Row
    try:
        with server.connect() as target:
            for table, columns in TABLES.items():
                source_columns = {row["name"] for row in source.execute(f"PRAGMA table_info({table})")}
                if not set(columns).issubset(source_columns):
                    continue
                rows = source.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
                placeholders = ", ".join("?" for _ in columns)
                assignments = ", ".join(f"{column} = EXCLUDED.{column}" for column in columns if column != "id")
                conflict = "ON CONFLICT DO NOTHING" if table == "sessions" else f"ON CONFLICT (id) DO UPDATE SET {assignments}"
                target.executemany(
                    f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders}) {conflict}",
                    [tuple(row[column] for column in columns) for row in rows],
                )
            for table in ("users", "order_items", "payment_transactions", "coupon_redemptions"):
                target.execute(
                    f"""SELECT setval(pg_get_serial_sequence('{table}', 'id'),
                              COALESCE((SELECT MAX(id) FROM {table}), 1),
                              (SELECT COUNT(*) > 0 FROM {table}))"""
                ).fetchone()
    finally:
        source.close()
    print(f"Migrated {source_path} to PostgreSQL.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Migration failed: {error}", file=sys.stderr)
        raise
