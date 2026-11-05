# The Gamers Oasis

A futuristic gaming gear storefront with a persistent SQLite catalog, account registration and login, editable delivery profiles, GCash, Maya, cash-on-delivery, and credit/debit-card payment choices, Philippine peso pricing, a saved shopping cart, and database-backed orders and receipts.

## Run locally

Requires Python 3.10 or later; the application uses only Python's standard library.

```powershell
python server.py
```

Open [http://localhost:8000](http://localhost:8000). The server creates `gamers_oasis.sqlite3` in the project folder on first launch. Set `PORT` or `GAMERS_OASIS_DB` to customize the local server port or database path.

## PostgreSQL

Install the driver, create a PostgreSQL database named `gamers_oasis` in pgAdmin, and set the connection string in PowerShell:

```powershell
python -m pip install -r requirements.txt
$env:DATABASE_URL = "postgresql://postgres:YOUR_PASSWORD@localhost:5432/gamers_oasis"
```

To copy the existing SQLite users, orders, products, inventory, payments, and coupons:

```powershell
python migrate_to_postgres.py
python server.py
```

Keep `DATABASE_URL` set whenever the server or `create_admin.py` is run. If it is not set, the app safely uses the local SQLite database.

Alternatively, after creating the database in pgAdmin, run `.\run_postgres.ps1`. It securely prompts for the PostgreSQL password, migrates the existing SQLite data, and starts the store without saving the password in the project.

### Deploying the API to Vercel

The repository includes [`api/index.py`](./api/index.py) and [`vercel.json`](./vercel.json) so Vercel routes `/api/*` to the Python API. In the Vercel project settings, add these environment variables for **Production** and **Preview**:

```text
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_HOST:5432/gamers_oasis
ADMIN_EMAIL=your-admin-email
ADMIN_PASSWORD=your-admin-password
ADMIN_NAME=System Administrator
```

Use a hosted PostgreSQL provider for a deployed Vercel site. `localhost` points to the Vercel server, not your personal computer, so a local PostgreSQL connection string will not work there.

Create an account or log in before checking out. Cart contents are saved in your browser; customer accounts, sessions, inventory, and completed orders are stored in SQLite. The checkout creates a real order and generates an itemized receipt. Payment processing is not connected; payment methods record the customer's selected settlement method. Order creation uses a SQLite transaction with an immediate lock so inventory, order, payment, and delivery snapshots commit atomically or roll back together.

To bootstrap the system administrator, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 12 characters) before starting the server:

```powershell
$env:ADMIN_EMAIL = "admin@example.com"
$env:ADMIN_PASSWORD = "use-a-strong-private-password"
python server.py
```

The administrator signs in through the normal login form. Their account opens the monitoring dashboard instead of the customer profile and can view customer/order counts, revenue, recent orders, payment methods, and low-stock products. Credentials are never stored in source code.

Alternatively, create or reset an administrator interactively without putting credentials in environment variables:

```powershell
python create_admin.py
```

Sign in through the normal **Log in** button. Administrator accounts open the monitoring dashboard, which includes customers, orders, item counts, delivery details, payment references/status, revenue, and low-stock inventory.

The shared product catalog is in `products.json`. Product prices are PHP retail listings with a source link and price-check date; retailer prices and availability can change, so confirm the linked listing before purchase. On startup, the API updates catalog details in existing databases while retaining stock for unchanged products and resetting stock when a product is replaced. The local SQLite database stores products, users, delivery profiles, orders, order items, sessions, and payment transaction records. Payment records retain only the method, status, timestamp, and a masked reference; raw card numbers, CVV, and wallet account numbers are never stored. The storefront also loads the catalog directly as a fallback when a static deployment such as Vercel does not provide the Python `/api/products` endpoint. On Vercel, the product catalog, filters, and cart are available from the static deployment; account registration and database-backed checkout need a separately hosted API and persistent database.

Select a product photo or name to view its specifications and add it to the bag. Customers can submit a 1–5 star rating and a short feedback message; recent submissions appear on the storefront, while the administrator dashboard's **Client feedback** tab shows the latest 100. Feedback is stored in the same database as the catalog. The home page also includes the Gamers Oasis story and its Instagram/TikTok (`@gamersoasis`) and Facebook (`Gamers Oasis`) account names. On Vercel, these database-backed feedback features require the Python API and a reachable PostgreSQL database.
