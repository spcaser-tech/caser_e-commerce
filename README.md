# The Gamers Oasis

A futuristic gaming gear storefront with a persistent SQLite catalog, account registration and login, a saved shopping cart, and database-backed orders and receipts.

## Run locally

Requires Python 3.10 or later; the application uses only Python's standard library.

```powershell
python server.py
```

Open [http://localhost:8000](http://localhost:8000). The server creates `gamers_oasis.sqlite3` in the project folder on first launch. Set `PORT` or `GAMERS_OASIS_DB` to customize the local server port or database path.

Create an account or log in before checking out. Cart contents are saved in your browser; customer accounts, sessions, inventory, and completed orders are stored in SQLite. The checkout creates a real order and generates an itemized receipt. Payment processing is not connected.
