# Trackoor

A self-hosted Solana wallet tracker. Pings a Telegram bot the moment one of your tracked wallets buys, sells, mints, or transfers — and gives you a web dashboard to manage everything with proper search, filters, and per-wallet settings.

It's basically a free version of [Cielo Finance](https://cielo.finance), built so I could track as many wallets as I want, with whatever filters I want, without paying a monthly fee or hitting any caps.

> **Status:** I'm running this on a private VPS for my own use — there's no public demo. The repo is here so you can read the code, clone it, plug in your own Helius / Telegram / Postgres / Redis credentials, and run your own copy. Setup steps are below.

---

## What it does

You feed it a list of Solana wallet addresses. Behind the scenes:

1. Helius watches those addresses on-chain via an enhanced webhook.
2. When one of them does something interesting (swap, token mint, transfer), Helius POSTs the parsed transaction to the backend.
3. The backend filters it against your per-wallet settings, stores it in Postgres, and fires a Telegram message if it passes.
4. The dashboard shows you everything — wallets, filters, recent transactions, 24h stats — and lets you add/edit/pause wallets without leaving the browser.

Telegram for **alerts**, dashboard for **management**. The two share the same backend, so changes in one show up immediately in the other.

## Why I built it

I'd been using paid trackers like Cielo for a while. They're good, but I kept hitting the same problems:

- Wallet caps on the free tier, monthly fee for more.
- Filters were too coarse — I wanted to mute small dust transactions per-wallet, not globally.
- Editing a wallet's settings on mobile through a Telegram bot is painful: scroll, tap, scroll, tap.
- Searching through 80+ wallets in a chat thread is genuinely awful.

So I built my own. Unlimited wallets, granular filters, full control over what triggers a notification, and a real UI for managing the list. Telegram still does what Telegram does best (push notifications), but now the boring management bits live somewhere they belong — a dashboard.

## How it works

```
        Solana on-chain
              │
              ▼
       Helius webhook  ──┐
              │          │  enhanced txs (SWAP / TOKEN_MINT / TRANSFER)
              ▼          │
         Backend (Express) ────┐
         │     │      │        │
   Postgres  Redis   Bot       │
   (positions,  (price   (Telegram
    history)    cache,    notifications +
                state)    inline buttons)
              │
              ▼
       Web dashboard (React)
```

A few things worth calling out:

- **Helius webhook auto-syncs.** Whenever you add, remove, or pause a wallet, the backend pushes the new address list to Helius (`syncWebhookAddresses` in `services/helius.js`). You never have to touch the webhook config manually.
- **Postgres for durable stuff** (wallets, filters, transactions, positions). **Redis for ephemeral stuff** (60s SOL price cache, Telegram conversation state). Redis has an in-memory fallback so a brief Redis outage doesn't kill the bot.
- **Dual price feed.** CoinGecko's free tier rate-limits hard. Jupiter is the fallback. The cached price is used for both threshold checks and PNL calculations.
- **The bot and the dashboard share `services/wallet.js`.** Adding a wallet via `/add` in Telegram and adding it via the `+ Add Wallet` button in the dashboard hit the same code path.

### Filters

Each wallet has its own filter row in `wallet_filters`:

| Field | What it does |
|---|---|
| `notify_buys` / `notify_sells` | Toggle SWAP notifications by direction |
| `notify_token_creates` | Notify when this wallet mints a new token |
| `notify_transfers` | Notify on plain SOL/token transfers |
| `threshold_value` + `threshold_currency` | Mute anything under this size (USD or SOL) |
| `skip_threshold_for_creates` | Token mints bypass the threshold (catches launches early) |

There's also a global dust filter (anything under 0.01 SOL is dropped before filtering even runs) — a sniper bot rebroadcasting tiny amounts will spam you otherwise.

## The Telegram bot

| Command | Description |
|---|---|
| `/wallets` | List every tracked wallet, each with inline buttons for filters / label / pause / delete |
| `/add` | Multi-step: send address → send label → done |
| `/pause_all` | Pause notifications for everything (useful when you're sleeping) |
| `/resume_all` | Un-pause everything |
| `/help` | Command list |

Every notification message also has its own buttons:

- **🔗 Chart** → opens GMGN for that token
- **📝 Tx** → opens Solscan for that signature
- **⚙️ Filters** → jump straight to the filter menu for that wallet
- **⏸ Pause** → mute that wallet without opening any menus

The bot is single-user — only the chat ID in `TELEGRAM_CHAT_ID` can talk to it. Everyone else gets `Unauthorized.`. The dashboard is the multi-user-ish surface (well, multi-tab anyway — it's password-protected, JWT, single shared password).

## Pain points I hit

A list of things that tripped me up. If you're building something similar, hopefully this saves you a couple of hours.

### 1. `transactionSubscribe` (enhanced webhooks) vs `accountSubscribe`

This was my biggest one. My first version used a raw Solana RPC `accountSubscribe` to watch wallet balances. That fires on **every** account state change — every byte of data that changes, not just transactions. It worked, sort of, but burned through Helius credits at an insane rate, sent duplicate signals, and gave me raw account data I then had to parse into "did this wallet buy or sell something?".

Switching to the **enhanced webhook** (which is `transactionSubscribe` semantics — Helius fires once per transaction, already parsed into a clean shape with `tokenTransfers`, `feePayer`, `accountData.nativeBalanceChange`, etc.) fixed everything. Way fewer requests, no duplicate spam, and Helius does most of the parsing for me. Honestly I don't fully understand why one is so much heavier than the other under the hood, but the practical difference is huge.

### 2. Telegram's 64-byte `callback_data` limit

A Solana address is up to 44 base58 characters. Once you stick a prefix on (`tf:` for "toggle filter") plus a field name, you blow straight past Telegram's 64-byte limit on `callback_data` and the buttons just silently stop working. Took me a while to figure out why some buttons just did nothing.

The fix is to send only the first 8 chars of the address in the callback, then look up the full address from the DB on the receiving end (`shortAddr` and `resolveAddress` in `bot/index.js`). 8 chars is enough to be unique even at hundreds of wallets.

### 3. Helius rejects an empty webhook address list

If you delete your last wallet, the next webhook sync sends `accountAddresses: []` and Helius returns 400. The webhook gets stuck in a broken state until you add another wallet.

The workaround: if there are no active wallets, push the system program (`11111111111111111111111111111111`) instead. The webhook stays alive, doesn't fire on anything you care about, and is ready to go when you add a real wallet.

### 4. Webhook batches arrive out of order

Helius batches multiple transactions per webhook POST. Within the batch, they're not always sorted by timestamp. If a sell arrives before its corresponding buy, my PNL calculation goes negative because there's no cost basis yet.

Fix is one line: `transactions.sort((a, b) => a.timestamp - b.timestamp)` before processing the batch. (See `routes/webhook.js`.)

### 5. SOL price API got rate-limited

CoinGecko's free tier is generous-ish until you hit it more than once per second across the same IP, then you get hard 429'd for a minute. The 60s cache helps, but if Redis blips at the wrong moment (cache miss → fetch → 429) you're temporarily stuck with no price.

Two-layer fix: (a) Jupiter as a fallback price source, and (b) an in-memory cache layer in `services/price.js` that backs up Redis. So even if Redis is down AND CoinGecko 429s, the bot uses the last-known-good price.

### 6. Telegraf's `bot.launch()` doesn't always resolve

I expected `await bot.launch()` to resolve once polling was up so I could mark the bot as "running" for the `/health` endpoint. In Telegraf 4.16+ that promise sometimes never resolves even though polling has started fine.

Workaround in `index.js`: kick off `bot.launch()` without awaiting, then `setTimeout(5000, () => bot.telegram.getMe())` — if `getMe()` returns the bot info, polling is up and we flip `botRunning = true`.

### 7. TRANSFER transactions need to know which wallet is "ours"

A SWAP has a clear `feePayer` — the wallet that initiated the trade. A TRANSFER doesn't. If I'm watching wallet A and wallet B sends SOL to wallet A, the parser doesn't know whether A is the sender or receiver — and therefore can't say "Received 5 SOL" vs "Sent 5 SOL".

The split: the parser in `helius.js` extracts whatever it can without knowing the tracked wallet. The webhook handler in `routes/webhook.js` fills in `sol_amount` and `direction` afterwards, by finding the tracked wallet in `accountData` and looking at its `nativeBalanceChange`.

### 8. Helius double-sends webhooks occasionally

Sometimes the same signature arrives twice. I added a `UNIQUE` constraint on `transactions.signature` and a quick `SELECT` check before doing any work, so duplicates skip cleanly without sending two notifications.

## How it's built

```
backend/
├── src/
│   ├── index.js              Express entry, wires up routes + bot
│   ├── bot/index.js          Telegram bot (Telegraf)
│   ├── db/
│   │   ├── index.js          PG pool
│   │   └── schema.sql        wallets, wallet_filters, transactions, wallet_positions
│   ├── routes/
│   │   ├── webhook.js        Helius webhook → DB → notify
│   │   ├── wallets.js        REST API for the dashboard
│   │   └── auth.js           Login (single password) → JWT
│   ├── services/
│   │   ├── helius.js         Webhook sync + tx parser
│   │   ├── wallet.js         Wallet CRUD + filter logic
│   │   ├── pnl.js            Running positions, realised PNL
│   │   ├── price.js          SOL price cache + Telegram conversation state
│   │   └── formatter.js      Telegram message formatting
│   └── middleware/auth.js    JWT middleware
└── .env.example

frontend/
├── src/
│   ├── App.jsx               Auth gate
│   ├── pages/
│   │   ├── Login.jsx
│   │   └── Dashboard.jsx     All dashboard components in one file
│   ├── lib/api.js            Tiny fetch wrapper
│   └── index.css             All styling
└── vite.config.js

docker-compose.yml            postgres + redis + backend + frontend
```

Stack:

- **Node.js + Express** — backend
- **Telegraf** — Telegram bot framework
- **Postgres** — durable storage (wallets, filters, transactions, positions)
- **Redis** — price cache + conversation state, with in-memory fallback
- **Helius** — Solana enhanced webhooks + DAS API for token metadata
- **CoinGecko + Jupiter** — SOL/USD price feeds
- **React + Vite** — dashboard
- **Docker Compose** — local dev + simple VPS deploy

## Run it locally

### 1. Set up env vars

```bash
cp backend/.env.example backend/.env
# fill in the values
```

You'll need:
- A Helius API key (free tier from [helius.dev](https://helius.dev))
- A Telegram bot token (talk to [@BotFather](https://t.me/BotFather))
- Your Telegram chat ID (message [@userinfobot](https://t.me/userinfobot))
- A Postgres URL (Supabase free tier works)
- A Redis URL (Upstash free tier works)

### 2. Start everything

```bash
docker-compose up -d
```

That brings up Postgres, Redis, the backend, and the frontend. The schema in `backend/src/db/schema.sql` runs automatically on first boot.

Or manually, without Docker:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

### 3. Create the Helius webhook

For Helius to POST to your backend, the backend needs a publicly reachable URL. In dev, [ngrok](https://ngrok.com) is fine:

```bash
ngrok http 3001
# put the https URL into HELIUS_WEBHOOK_URL in your .env
```

Then run this once to register the webhook with Helius:

```bash
cd backend
node -e "
import('./src/services/helius.js').then(h =>
  h.createWebhook([]).then(r => {
    console.log('Webhook ID:', r.webhookID);
    console.log('Add this to .env as HELIUS_WEBHOOK_ID');
  })
);
"
```

Stick the returned ID into `HELIUS_WEBHOOK_ID` in `.env` and restart the backend. From there, every wallet you add via the dashboard or the bot will auto-sync to the webhook.

### 4. Open the dashboard

Open `http://localhost:3000`, enter the password from `DASHBOARD_PASSWORD`, add a wallet, and watch the alerts come in.

## Free tier estimate

For ~3,000 notifications/day across 100 tracked wallets:

- Helius free: 1M credits/month — actual usage is roughly 90k-180k. ✅
- Upstash Redis: 10k commands/day free — fits comfortably. ✅
- Supabase Postgres: 500MB free — months of transaction history. ✅
- Backend hosting: a $5 VPS runs the whole thing fine.

## What I'd add next

- **Multi-user mode.** Right now the dashboard is single-password and the bot is single-chat. Proper user accounts + per-user wallet lists would make this useful for more than one person.
- **A hosted demo.** I'd run a read-only public version with a curated set of "smart money" wallets so people can see it work without deploying their own.
- **Better PNL.** Right now realised PNL uses a simple weighted average cost basis. FIFO would be more accurate, especially for partial sells.
- **Webhook signature replay protection.** The Helius `authHeader` is a shared secret; an HMAC-of-payload would be better.
- **Tests.** None right now. The filter logic and PNL math are the bits I'd write tests for first.
- **Migration to Helius LaserStream** for sub-second latency once it's out of beta.

## Disclaimer

This is a personal-use tracker. It's not financial advice and the data isn't guaranteed to be accurate or complete — Helius can drop webhooks, price feeds can be stale, and my parser doesn't handle every Solana program in existence. Don't make actual trading decisions based purely on what this tells you.
