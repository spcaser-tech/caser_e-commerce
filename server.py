#!/usr/bin/env python3
"""The Gamers Oasis storefront API and SQLite database."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("GAMERS_OASIS_DB", ROOT / "gamers_oasis.sqlite3"))
PORT = int(os.environ.get("PORT", "8000"))
SESSION_DAYS = 30
PRODUCT_CATALOG = json.loads((ROOT / "products.json").read_text(encoding="utf-8"))["products"]
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/products.json": ("products.json", "application/json; charset=utf-8"),
}


def connect() -> sqlite3.Connection:
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    database = sqlite3.connect(DATABASE, timeout=10)
    database.row_factory = sqlite3.Row
    database.execute("PRAGMA foreign_keys = ON")
    return database


def initialize_database() -> None:
    with connect() as database:
        database.executescript(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
                badge TEXT NOT NULL DEFAULT '',
                rating TEXT NOT NULL,
                review_count INTEGER NOT NULL,
                image TEXT NOT NULL,
                stock INTEGER NOT NULL DEFAULT 50 CHECK (stock >= 0)
            );
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
                status TEXT NOT NULL DEFAULT 'confirmed',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY,
                order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id),
                name TEXT NOT NULL,
                price_cents INTEGER NOT NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0)
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
            """
        )
        database.executemany(
            """INSERT OR IGNORE INTO products
               (id, name, category, description, price_cents, badge, rating, review_count, image)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    product["id"],
                    product["name"],
                    product["category"],
                    product["description"],
                    product["price_cents"],
                    product["badge"],
                    product["rating"],
                    product["review_count"],
                    product["image"],
                )
                for product in PRODUCT_CATALOG
            ],
        )


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def public_user(user: sqlite3.Row) -> dict[str, object]:
    return {"id": user["id"], "name": user["name"], "email": user["email"]}


class StoreHandler(SimpleHTTPRequestHandler):
    server_version = "GamersOasis/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format: str, *args) -> None:
        print(f"{self.address_string()} - {format % args}")

    def send_json(self, status: int, data: dict[str, object]) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def read_json(self) -> dict[str, object]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 16_384:
                raise ValueError
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError
            return payload
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Send a valid JSON object.") from None

    def authenticated_user(self) -> sqlite3.Row | None:
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None
        digest = hashlib.sha256(header[7:].encode("utf-8")).hexdigest()
        with connect() as database:
            return database.execute(
                """SELECT users.* FROM sessions
                   JOIN users ON users.id = sessions.user_id
                   WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
                (digest, now_utc().isoformat()),
            ).fetchone()

    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        expires = (now_utc() + timedelta(days=SESSION_DAYS)).isoformat()
        with connect() as database:
            database.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (digest, user_id, expires),
            )
        return token

    def do_GET(self) -> None:
        route = urlparse(self.path).path
        if route == "/api/products":
            with connect() as database:
                products = [dict(row) for row in database.execute(
                    """SELECT id, name, category, description, price_cents, badge,
                              rating, review_count, image, stock FROM products
                       WHERE stock > 0 ORDER BY id"""
                )]
            self.send_json(200, {"products": products})
        elif route == "/api/me":
            user = self.authenticated_user()
            if user is None:
                self.send_json(401, {"error": "Your session has expired. Please log in again."})
            else:
                self.send_json(200, {"user": public_user(user)})
        elif route.startswith("/api/"):
            self.send_json(404, {"error": "That API route does not exist."})
        else:
            asset = STATIC_FILES.get(route)
            if asset is None:
                self.send_error(404, "Not found")
                return
            filename, content_type = asset
            try:
                content = (ROOT / filename).read_bytes()
            except OSError:
                self.send_error(500, "Storefront asset unavailable")
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        try:
            if route == "/api/auth/register":
                self.register()
            elif route == "/api/auth/login":
                self.login()
            elif route == "/api/auth/logout":
                self.logout()
            elif route == "/api/orders":
                self.create_order()
            else:
                self.send_json(404, {"error": "That API route does not exist."})
        except ValueError as issue:
            self.send_json(400, {"error": str(issue)})
        except sqlite3.IntegrityError:
            self.send_json(409, {"error": "That email address is already registered. Try logging in instead."})
        except sqlite3.Error:
            self.send_json(500, {"error": "The database could not complete that request. Please try again."})

    def register(self) -> None:
        payload = self.read_json()
        name = payload.get("name")
        email = payload.get("email")
        password = payload.get("password")
        if not isinstance(name, str) or not 2 <= len(name.strip()) <= 80:
            raise ValueError("Add your name (2–80 characters).")
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ValueError("Enter a valid email address.")
        if not isinstance(password, str) or len(password) < 8 or len(password) > 256:
            raise ValueError("Your password must be between 8 and 256 characters.")
        salt = secrets.token_bytes(16)
        password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
        with connect() as database:
            cursor = database.execute(
                """INSERT INTO users (name, email, password_hash, salt, created_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (name.strip(), email.strip().lower(), password_hash.hex(), salt.hex(), now_utc().isoformat()),
            )
            user_id = cursor.lastrowid
            user = database.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        token = self.create_session(user_id)
        self.send_json(201, {"user": public_user(user), "token": token})

    def login(self) -> None:
        payload = self.read_json()
        email = payload.get("email")
        password = payload.get("password")
        if not isinstance(email, str) or not isinstance(password, str):
            raise ValueError("Enter your email and password.")
        with connect() as database:
            user = database.execute("SELECT * FROM users WHERE email = ?", (email.strip().lower(),)).fetchone()
        if user is None:
            self.send_json(401, {"error": "That email and password combination doesn't match."})
            return
        salt = bytes.fromhex(user["salt"])
        password_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
        if not hmac.compare_digest(password_hash.hex(), user["password_hash"]):
            self.send_json(401, {"error": "That email and password combination doesn't match."})
            return
        token = self.create_session(user["id"])
        self.send_json(200, {"user": public_user(user), "token": token})

    def logout(self) -> None:
        header = self.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            digest = hashlib.sha256(header[7:].encode("utf-8")).hexdigest()
            with connect() as database:
                database.execute("DELETE FROM sessions WHERE token_hash = ?", (digest,))
        self.send_json(200, {"ok": True})

    def create_order(self) -> None:
        user = self.authenticated_user()
        if user is None:
            self.send_json(401, {"error": "Log in to your account before placing an order."})
            return
        payload = self.read_json()
        items = payload.get("items")
        if not isinstance(items, list) or not items or len(items) > 50:
            raise ValueError("Your bag is empty. Add some gear before checking out.")
        quantities: dict[int, int] = {}
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("There is an invalid item in your bag.")
            product_id = item.get("product_id")
            quantity = item.get("quantity")
            if isinstance(product_id, bool) or not isinstance(product_id, int):
                raise ValueError("There is an invalid item in your bag.")
            if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 50:
                raise ValueError("Each item quantity must be between 1 and 50.")
            quantities[product_id] = quantities.get(product_id, 0) + quantity
        if any(quantity > 50 for quantity in quantities.values()):
            raise ValueError("You can order up to 50 of each item.")

        order_id = f"AH-{now_utc():%y%m%d}-{secrets.token_hex(3).upper()}"
        created_at = now_utc().isoformat()
        with connect() as database:
            database.execute("BEGIN IMMEDIATE")
            order_items = []
            total_cents = 0
            for product_id, quantity in quantities.items():
                product = database.execute(
                    "SELECT id, name, price_cents, stock FROM products WHERE id = ?",
                    (product_id,),
                ).fetchone()
                if product is None or product["stock"] < quantity:
                    self.send_json(409, {"error": "An item in your bag is no longer available in that quantity. Please update your bag."})
                    return
                total_cents += product["price_cents"] * quantity
                order_items.append({**dict(product), "quantity": quantity})
            database.execute(
                "INSERT INTO orders (id, user_id, total_cents, status, created_at) VALUES (?, ?, ?, 'confirmed', ?)",
                (order_id, user["id"], total_cents, created_at),
            )
            for item in order_items:
                database.execute(
                    "INSERT INTO order_items (order_id, product_id, name, price_cents, quantity) VALUES (?, ?, ?, ?, ?)",
                    (order_id, item["id"], item["name"], item["price_cents"], item["quantity"]),
                )
                database.execute(
                    "UPDATE products SET stock = stock - ? WHERE id = ?",
                    (item["quantity"], item["id"]),
                )
        self.send_json(201, {
            "id": order_id,
            "total_cents": total_cents,
            "status": "confirmed",
            "created_at": created_at,
            "items": [
                {"product_id": item["id"], "name": item["name"], "price_cents": item["price_cents"], "quantity": item["quantity"]}
                for item in order_items
            ],
        })

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()


if __name__ == "__main__":
    initialize_database()
    print(f"The Gamers Oasis is ready at http://localhost:{PORT}")
    print(f"SQLite database: {DATABASE}")
    ThreadingHTTPServer(("0.0.0.0", PORT), StoreHandler).serve_forever()
