#!/usr/bin/env python3
"""Create or reset the local system administrator account."""

from getpass import getpass
import re
import secrets
import hashlib

import server


email = input("Administrator email: ").strip().lower()
name = input("Administrator name [System Administrator]: ").strip() or "System Administrator"
password = getpass("Administrator password (12+ characters): ")
if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
    raise SystemExit("Enter a valid email address.")
if len(password) < 12:
    raise SystemExit("Password must be at least 12 characters.")

server.initialize_database()
salt = secrets.token_bytes(16)
password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
with server.connect() as database:
    database.execute(
        """INSERT INTO users (name, email, password_hash, salt, created_at, role)
           VALUES (?, ?, ?, ?, ?, 'admin')
           ON CONFLICT(email) DO UPDATE SET
             name = excluded.name, password_hash = excluded.password_hash,
             salt = excluded.salt, role = 'admin'""",
        (name, email, password_hash.hex(), salt.hex(), server.now_utc().isoformat()),
    )
print(f"Administrator account ready: {email}")
