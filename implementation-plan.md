# Implementation Plan: MegaETH Deployment Tracker

## Phase 1: Foundation (COMPLETED)

- [x] Twitter API v2 integration for real-time monitoring of @megaeth.
- [x] Metadata engine upgrade: transitioning from simple ID tracking to full deployment objects (project handle, URL, timestamp).
- [x] Local persistence layer in `memory/deployments-tracked.json`.
- [x] Telegram Bot integration (scaffolded).

## Phase 2: Signal Amplification (NEXT)

- [ ] **Credential Handshake**: Securely inject `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID`.
- [ ] **Live Testing**: Run end-to-end flow from tweet detection to Telegram broadcast.
- [ ] **Nightly Recap**: Automate the `nightly-recap.js` script via cron to summarize the day's wins.
- [ ] **Error Handling**: Implement retry logic for Twitter rate limits.

## Phase 3: Intelligence Layer (LONG-TERM)

- [ ] **Onchain Verification**: Integrate with Blockscout API to find the actual contract addresses for each deployment.
- [ ] **Sentiment Mapping**: Track community reaction (replies/likes) to deployments to identify "hot" projects.
- [ ] **X402/ERC-8004 Support**: Special alerts for projects using the latest MegaETH standards.

Deployment Tracker V2 — Full Product Spec

Context

V1 is a working Node.js bot that polls @megaeth Twitter for deployment announcements and  
 sends Telegram alerts. 36 projects tracked, $0 cost, $0 revenue. The goal is to turn this  
 into a revenue-generating product ($40K/30 days) by building two products on a shared data  
 pipeline:

1.  Telegram Bot — degen-facing, slash commands, freemium (top of funnel)
2.  Dashboard — analyst/VC/team-facing, deep analytics, paid (revenue engine)

Key insight: $MEGA token emissions are tied to onchain milestones. Milestone-based alerts  
 have direct financial value to $MEGA holders.

---

Architecture

                     DATA PIPELINE (ships first)
                     ┌─────────────────────┐

Twitter API ─────→│ │
MegaETH RPC ────→│ Enrichment Engine │──→ SQLite DB
growthepie API ──→│ (periodic cron) │
DeFiLlama API ──→│ │
Blockscout API ──→│ │
└────────┬────────────┘
│
┌────────────┴────────────┐
│ │
┌───────▼───────┐ ┌────────▼────────┐
│ TELEGRAM BOT │ │ DASHBOARD │
│ (slash cmds) │ │ (web app) │
│ Free + Premium│ │ Paid tiers │
└───────────────┘ └─────────────────┘

---

Product 1: Data Pipeline

Purpose: Periodically collect and store enriched data about MegaETH deployments and
ecosystem health. This is the foundation both products sit on.

Data Sources & Collection
Source: Twitter API (existing)
What it provides: Deployment announcements, project handles
Frequency: Every 10 min
────────────────────────────────────────
Source: MegaETH RPC
What it provides: Contract existence, tx count, balance, block data
Frequency: Every 30 min
────────────────────────────────────────
Source: growthepie API
What it provides: Ecosystem TVL, tx volume, active addresses, gas
Frequency: Every 1 hour
────────────────────────────────────────
Source: DeFiLlama API
What it provides: Per-protocol TVL on MegaETH
Frequency: Every 1 hour
────────────────────────────────────────
Source: Blockscout/Explorer API
What it provides: Contract verification status, source code, ABI
Frequency: On new deployment
Storage: SQLite (via better-sqlite3)

Tables:

-- Core deployment records (migrated from JSON)
deployments (
id TEXT PRIMARY KEY, -- tweet ID
project TEXT NOT NULL, -- @handle
tweet_url TEXT,
tweet_text TEXT,
deployed_at TEXT, -- ISO timestamp
contract_address TEXT, -- enriched later
category TEXT, -- DeFi, Gaming, Infra, etc.
created_at TEXT DEFAULT CURRENT_TIMESTAMP
)

-- Periodic snapshots of project metrics
project_metrics (
id INTEGER PRIMARY KEY AUTOINCREMENT,
project TEXT NOT NULL,
tvl_usd REAL,
tx_count_24h INTEGER,
unique_wallets_24h INTEGER,
gas_used_24h REAL,
snapshot_at TEXT DEFAULT CURRENT_TIMESTAMP
)

-- Ecosystem-wide metrics
ecosystem_metrics (
id INTEGER PRIMARY KEY AUTOINCREMENT,
total_tvl_usd REAL,
total_tx_24h INTEGER,
total_wallets_24h INTEGER,
deployment_count INTEGER,
snapshot_at TEXT DEFAULT CURRENT_TIMESTAMP
)

-- Milestone events (for alerts)
milestones (
id INTEGER PRIMARY KEY AUTOINCREMENT,
type TEXT NOT NULL, -- 'tvl', 'tx_count', 'wallets', 'deployment_count'
target TEXT, -- project handle or 'ecosystem'
threshold REAL, -- the value that was crossed
direction TEXT, -- 'up' or 'down'
actual_value REAL,
triggered_at TEXT DEFAULT CURRENT_TIMESTAMP,
alerted INTEGER DEFAULT 0 -- whether Telegram alert was sent
)

Milestone Detection Logic

After each metric snapshot, compare against configurable thresholds:

- Ecosystem TVL: $1M, $5M, $10M, $25M, $50M, $100M, $250M, $500M, $1B
- Per-project TVL: $100K, $500K, $1M, $5M, $10M
- Ecosystem tx count: 100K, 500K, 1M, 5M, 10M cumulative
- Active wallets: 1K, 5K, 10K, 50K, 100K
- Deployment count: every 10 (40, 50, 60...)

When a threshold is crossed → insert into milestones table → trigger alert to Telegram  
 channel and bot subscribers.

Files to create/modify
File: scripts/deployment-tracker.js
Action: Modify: write to SQLite instead of JSON
────────────────────────────────────────
File: scripts/enrichment.js
Action: New: periodic onchain data collection
────────────────────────────────────────
File: scripts/milestone-checker.js
Action: New: compare snapshots against thresholds, trigger alerts
────────────────────────────────────────
File: scripts/migrate-json-to-sqlite.js
Action: New: one-time migration script
────────────────────────────────────────
File: lib/db.js
Action: New: SQLite connection + query helpers
────────────────────────────────────────
File: lib/data-sources.js
Action: New: API wrappers for RPC, growthepie, DeFiLlama, Blockscout
────────────────────────────────────────
File: memory/deployments-tracked.json
Action: Keep as backup, no longer primary store

---

Product 2: Telegram Bot

Purpose: Slash-command interface for degens and $MEGA holders to query deployment data and  
 receive milestone alerts.

Command Structure

Free tier:
/start → Welcome message + command list
/latest → Last 5 deployments with dates
/list → All tracked projects (paginated)
/project <name> → Basic info: deployed date, tweet link, category
/count → Total deployments on MegaETH
/search <keyword> → Search projects by name or category
/help → Command reference

Premium tier (paid):
/tvl <project> → Current TVL + 7d trend
/activity <project> → Tx count, unique wallets, gas usage (last snapshot)
/ecosystem → Full ecosystem overview: TVL, tx volume, wallets, deployment velocity  
 /milestones → Recent milestone events ($MEGA emission relevant)
/compare <a> <b> → Side-by-side project comparison
/alerts setup → Configure personal milestone alerts (DM-based)
/hot → Top projects by activity growth in last 7 days
/report → Weekly ecosystem summary

Monetization

- Free commands available to all users in the channel or via DM
- Premium commands require a subscription ($10-20/month)
- Payment via Stripe or crypto (USDC on MegaETH if possible)
- Could add token-gated access later if a token launch happens

Technical Implementation

- Reuse existing node-telegram-bot-api dependency
- Bot runs as a long-polling process (or webhook if deployed to server)
- Queries SQLite for all data (no direct API calls per user request — data is pre-fetched)
- Rate limit: 5 free queries/hour per user, unlimited for premium

Files to create
┌────────────────────────────────┬─────────────────────────────────────────────────────────┐
│ File │ Purpose │
├────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ scripts/telegram-bot.js │ New: Main bot process with command handlers │
├────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ lib/bot-commands/free.js │ New: Free tier command implementations │
├────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ lib/bot-commands/premium.js │ New: Premium tier command implementations │
├────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ lib/bot-commands/formatters.js │ New: Message formatting helpers (escape markdown, etc.) │
├────────────────────────────────┼─────────────────────────────────────────────────────────┤
│ lib/subscription.js │ New: User subscription state management │
└────────────────────────────────┴─────────────────────────────────────────────────────────┘

---

Product 3: Dashboard (ships after bot)

Purpose: Web-based analytics dashboard for ecosystem teams, VCs, and power users.

Pages/Views

1.  Home/Overview: Deployment timeline, ecosystem health metrics, recent milestones
2.  Project Directory: Searchable/filterable list of all deployed projects
3.  Project Detail: Per-project page with metrics, TVL chart, activity graph, tweet embed
4.  Ecosystem Analytics: TVL over time, deployment velocity, category breakdown, L2
    comparison
5.  Milestones Feed: Timeline of milestone events with $MEGA emission context

Tech Stack

- Framework: Next.js (SSR for SEO, API routes for backend)
- Styling: Tailwind CSS
- Charts: Recharts or lightweight alternative
- Data: API routes query SQLite directly
- Auth: Simple API key or NextAuth for paid tiers
- Hosting: Vercel (free tier to start)

Monetization

- Free: View project list + basic deployment timeline
- Paid ($500-2K/month): Full analytics, API access, custom alerts, export
- Premium ($2-4K/month): Ecosystem reports, embeddable widgets, white-label

Files to create

- dashboard/ directory with Next.js app
- API routes that query the shared SQLite database
- Reuses the same lib/db.js and data layer as the bot

---

Build Order (30-day sprint)

Week 1: Data Pipeline

- Set up SQLite schema + lib/db.js
- Migrate JSON → SQLite (scripts/migrate-json-to-sqlite.js)
- Modify deployment-tracker.js to write to SQLite
- Build lib/data-sources.js — probe each API, see what's actually available
- Build scripts/enrichment.js — periodic metric collection
- Build scripts/milestone-checker.js — threshold detection + alerts
- Set up cron jobs for enrichment (30min/1hr intervals)

Week 2: Telegram Bot

- Build scripts/telegram-bot.js with free tier commands
- Implement all free commands against SQLite
- Add premium command stubs
- Implement premium commands with enriched data
- Add subscription management (simple user table + payment check)
- Test in private channel, then deploy to @kuusho_shouten
- Launch announcement on Twitter

Week 3: Dashboard MVP

- Scaffold Next.js app in dashboard/
- Build API routes (reuse lib/db.js)
- Home page with deployment timeline + ecosystem health
- Project directory + detail pages
- Milestones feed
- Deploy to Vercel
- Auth gating for paid features

Week 4: Monetization + Distribution

- Stripe integration for bot subscriptions + dashboard access
- Outreach to MegaETH team (offer free premium dashboard access)
- Outreach to deployed projects (offer analytics visibility)
- Launch thread on Twitter with dashboard screenshots
- Iterate based on feedback

---

Verification Plan

1.  Data pipeline: Run enrichment script, verify SQLite contains metric snapshots, trigger a  
    test milestone alert
2.  Telegram bot: Test every slash command in DM, verify free/premium gating works
3.  Dashboard: Load all pages, verify data matches SQLite, test on mobile
4.  Milestone alerts: Manually insert a metric crossing a threshold, verify alert fires to  
    both Telegram channel and bot subscribers
5.  End-to-end: New deployment detected on Twitter → stored in SQLite → enrichment runs →  
    milestone triggered → alert sent → visible in bot /milestones command → visible on dashboard
    milestones page

---

First Task When Implementation Starts

Probe each data source (MegaETH RPC, growthepie, DeFiLlama, Blockscout) with actual API  
 calls to confirm:

- What endpoints exist and respond
- What data fields are available for MegaETH specifically
- Authentication requirements and rate limits
- Any MegaETH-specific quirks

This determines the shape of the enrichment pipeline and what commands/dashboard features are actually possible.

---

## Data Source Probe: Value-First Design

The pipeline doesn't start with "what APIs can we call?" — it starts with **"what's in it for me?"**

Every user in crypto asks that question. If our data gives a solid variety of answers across $MEGA holders, VCs, and projects, we win. Here's how each data source earns its place by producing sellable insights.

### The Value Chain

```
More deployments → More TVL → More activity → Milestone triggered
    → $MEGA emission event → Value for holders
    → Ecosystem growth signal → VC investment
    → Visibility for projects → They pay for analytics
```

Every data source we poll feeds this chain. If it doesn't contribute to a tangible insight someone will pay for (or come back for daily), it doesn't belong in the pipeline.

### Scenario 1: The $MEGA Holder — "Should I hold or sell?"

**Question:** "Is the MegaETH ecosystem actually growing, or is it stalling?"

**How the system answers:**

| Step | Source                 | Data                                            | Frequency           |
| ---- | ---------------------- | ----------------------------------------------- | ------------------- |
| 1    | Twitter API (existing) | New deployment detected: @SectorOneDEX          | Every 10 min        |
| 2    | DeFiLlama API          | MegaETH ecosystem TVL: $47M → $52M (24h)        | Every 1 hr          |
| 3    | growthepie API         | Active wallets: 12,400 (+18% vs yesterday)      | Every 1 hr          |
| 4    | Milestone checker      | TVL crossed $50M threshold → emission milestone | After each snapshot |

**Insight delivered:** "🚨 MegaETH just crossed $50M TVL with 254 deployed projects and 12.4K active wallets. Deployment velocity: 7.3/day. This is an emission-relevant milestone."

**Where it surfaces:**

- Telegram: automatic alert to channel + `/milestones` command
- Dashboard: Milestones Feed page with emission context

**Why they pay:** $MEGA emissions are tied to ecosystem milestones. Knowing _when_ a threshold is about to be crossed — before the market reacts — is worth $10-20/month to any holder with a meaningful position.

### Scenario 2: The VC — "Is this chain real or just noise?"

**Question:** "MegaETH claims 250+ deployments. Are they real projects with real users, or ghost contracts?"

**How the system answers:**

| Step | Source                    | Data                                                       | Frequency         |
| ---- | ------------------------- | ---------------------------------------------------------- | ----------------- |
| 1    | SQLite (deployment table) | 254 projects tracked over 35 days, 7.3/day avg             | Pre-computed      |
| 2    | Blockscout API            | Contract verified: Yes. Has ABI. Source code public.       | On new deployment |
| 3    | DeFiLlama API             | @realtime_defi TVL: $2.1M. @SectorOneDEX TVL: $890K.       | Every 1 hr        |
| 4    | growthepie API            | Ecosystem tx volume: 142K/day. Gas usage trending up.      | Every 1 hr        |
| 5    | MegaETH RPC               | @realtime_defi contract: 4,200 txs in 24h, 0.8 ETH balance | Every 30 min      |

**Insight delivered:** "MegaETH Ecosystem Report: 254 deployments (35 days). 68% have verified contracts. Top 10 protocols hold $38M combined TVL. Daily tx volume: 142K. Deployment velocity accelerating: 9.1/day this week vs 5.2/day in week 1."

**Where it surfaces:**

- Dashboard: Ecosystem Analytics page (deployment velocity chart, category breakdown, TVL over time)
- Dashboard: Project Directory with verification badges and activity indicators
- Telegram: `/ecosystem` command (premium), `/report` weekly summary

**Why they pay:** Due diligence on an emerging L2 ecosystem currently requires manually checking 10+ sources. We do it automatically, every hour. That's worth $500-2K/month to a fund evaluating MegaETH allocation.

### Scenario 3: The Deployed Project — "How do we compare?"

**Question:** "We deployed on MegaETH last week. Are we getting traction vs other projects in our category?"

**How the system answers:**

| Step | Source                    | Data                                                       | Frequency    |
| ---- | ------------------------- | ---------------------------------------------------------- | ------------ |
| 1    | SQLite (deployment table) | @avon_xyz deployed Jan 28. Category: DeFi.                 | Pre-computed |
| 2    | DeFiLlama API             | @avon_xyz TVL: $340K. Category median: $520K.              | Every 1 hr   |
| 3    | MegaETH RPC               | @avon_xyz contract: 1,100 txs/24h. Category median: 2,300. | Every 30 min |
| 4    | growthepie API            | MegaETH DeFi sector: 42% of ecosystem TVL                  | Every 1 hr   |

**Insight delivered:** "📊 @avon_xyz vs DeFi category: TVL $340K (35th percentile), Daily txs 1,100 (28th percentile). You're below median in both metrics. Top DeFi protocol @realtime_defi has 6x your TVL. Ecosystem DeFi share: 42%."

**Where it surfaces:**

- Telegram: `/compare avon_xyz realtime_defi` (premium)
- Telegram: `/activity avon_xyz` (premium)
- Dashboard: Project Detail page with benchmark charts

**Why they pay:** Projects want to know if they're winning or losing. Benchmarking data that shows their position in the ecosystem is worth visibility and a paid tier. Some will also share the dashboard publicly — free distribution for us.

### Data Source Matrix: What We Get From Where

| Source                     | What it provides                                                              | Insights it feeds                                                          | Cost            | Rate limits        |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------- | ------------------ |
| **Twitter API** (existing) | Deployment announcements, project handles, tweet text                         | Deployment velocity, project discovery, timeline                           | $0 (free tier)  | 500K tweets/month  |
| **MegaETH RPC**            | `eth_getCode`, `eth_getTransactionCount`, `eth_getBalance`, `eth_blockNumber` | Contract existence verification, per-project tx activity, balance tracking | $0 (public RPC) | TBD — probe needed |
| **growthepie API**         | Ecosystem TVL, daily txs, active addresses, gas fees, L2 comparisons          | Ecosystem health, milestone detection, L2 benchmarking                     | $0 (public API) | TBD — probe needed |
| **DeFiLlama API**          | Per-protocol TVL on MegaETH, TVL history, category breakdown                  | Project-level TVL, category analysis, TVL milestones                       | $0 (public API) | No auth, generous  |
| **Blockscout API**         | Contract verification status, source code, ABI, token info                    | Verification badges, contract identity, legitimacy scoring                 | $0 (public API) | TBD — probe needed |

### The Insight Catalog

Every insight maps to a product feature. If an insight doesn't surface in a command or dashboard view, it's wasted computation.

| Insight                                  | Data Sources Combined                | Bot Command                     | Dashboard View            |
| ---------------------------------------- | ------------------------------------ | ------------------------------- | ------------------------- |
| Deployment velocity (daily/weekly trend) | Twitter API + SQLite timestamps      | `/count`, `/latest`             | Home: timeline chart      |
| Ecosystem TVL + trend                    | growthepie + DeFiLlama               | `/ecosystem` (premium)          | Ecosystem Analytics       |
| Per-project TVL                          | DeFiLlama                            | `/tvl <project>` (premium)      | Project Detail            |
| Per-project activity                     | MegaETH RPC (tx count, balance)      | `/activity <project>` (premium) | Project Detail            |
| Contract verification status             | Blockscout                           | `/project <name>`               | Project Directory (badge) |
| Milestone alerts ($MEGA relevant)        | All sources → milestone-checker      | `/milestones` (premium)         | Milestones Feed           |
| Category breakdown                       | DeFiLlama + SQLite categories        | `/search <category>`            | Ecosystem Analytics       |
| Project comparison                       | DeFiLlama + RPC + growthepie         | `/compare <a> <b>` (premium)    | Project Detail            |
| Hot projects (growth ranking)            | RPC snapshots (7d delta) + DeFiLlama | `/hot` (premium)                | Home: trending section    |
| Weekly ecosystem summary                 | All sources aggregated               | `/report` (premium)             | Home: overview cards      |

### Staying at $0: Rate Limit Strategy

The enrichment cron runs against pre-fetched/cached data, not per-user-request. This is critical.

- **Twitter API:** Already polling every 10 min. 500K tweet reads/month on free tier = ~11.5K/day. We use ~144/day (20 tweets × ~7 polls/hour). Headroom: 98.7%.
- **DeFiLlama API:** No auth required. Hourly poll for ecosystem + per-protocol TVL. ~24 calls/day for ecosystem, ~24 × N for per-protocol (N = number of DeFiLlama-listed MegaETH protocols). Well within limits.
- **growthepie API:** Public API, hourly poll. 24 calls/day. Need to probe actual rate limits.
- **MegaETH RPC:** Public endpoint. Every 30 min, batch `eth_getTransactionCount` + `eth_getBalance` for tracked contracts. ~48 calls/day × N contracts. Need to probe rate limits — may need a dedicated RPC (QuickNode free tier) if public endpoint throttles.
- **Blockscout API:** On-demand only (triggered by new deployment). ~7-8 calls/day. Minimal load.

**Key principle:** All user-facing queries hit SQLite only. Zero external API calls per user request. The cron pre-fetches everything. This means even if we have 10K Telegram users, the API load stays the same.

### Probing Order (Day 1 task)

Before building the enrichment pipeline, we need to verify what each source actually returns for MegaETH:

1. **DeFiLlama** (highest confidence) — `GET /v2/chains` to confirm MegaETH is listed, `GET /protocols` filtered by chain. Likely works out of the box.
2. **growthepie** (high confidence) — `GET /v1/chains/megaeth/...` endpoints. Need to confirm MegaETH slug and available metrics.
3. **Blockscout** (high confidence) — `megaeth.blockscout.com/api/v2/smart-contracts/{address}`. Need to confirm API is live and what fields return.
4. **MegaETH RPC** (medium confidence) — Standard JSON-RPC calls. Need to confirm public endpoint URL, rate limits, and whether `eth_getTransactionCount` works as expected.
5. **Twitter API** (already working) — No probe needed. Already polling successfully.

The probe results determine which columns in `project_metrics` and `ecosystem_metrics` we can actually populate, and therefore which bot commands and dashboard views ship with real data vs "coming soon."

MegaETH Deployment Tracker V2: Intelligence Layer

Context

V1 is a working Node.js bot (3 scripts, 3 deps, $0 cost) that polls @megaeth Twitter and sends Telegram alerts. 36 projects tracked
in a JSON file with Twitter handles but no contract addresses, no onchain data, no scoring. The opus review correctly identified
it as "a relay, not a product."

V2 transforms this into an intelligence platform by adding: a SQLite database, API integrations (DeFiLlama, Blockscout, MegaETH
RPC), periodic enrichment, a scoring matrix, milestone detection, and realtime WSS monitoring.

API Probe Results (What Actually Works)
┌────────────┬──────────────┬─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Source │ Status │ Key Data │
├────────────┼──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ DeFiLlama │ Working │ MegaETH TVL: ~$60.59M, chain slug MegaETH, historical TVL since Sept 2024. Only Aave V3 found as a │
│ │ │ protocol (~$325K). │
├────────────┼──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Blockscout │ Working │ 540K addresses, 217M txs, 2.2M txs/day, contract listings, token data, verification status, decoded │
│ │ │ tx data │
├────────────┼──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ MegaETH │ Working │ Chain ID 4326, standard eth\_\* methods, eth_sendRawTransactionSync for instant receipts │
│ RPC │ │ │
├────────────┼──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ MegaETH │ Available │ miniBlocks subscription at wss://mainnet.megaeth.com/ws, 30s keepalive required │
│ WSS │ │ │
├────────────┼──────────────┼─────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ growthepie │ Blocked │ Skip for now, revisit if access is granted │
│ │ (403) │ │
└────────────┴──────────────┴─────────────────────────────────────────────────────────────────────────────────────────────────────┘
Build Order (10 Steps, Strict Dependencies)

Step 1: lib/db.js ← foundation, everything depends on this
Step 2: scripts/migrate-json-to-sqlite.js ← depends on Step 1
Step 3: lib/data-sources.js ← independent (API wrappers)
Step 4: lib/scoring.js ← independent (scoring matrix)
Step 5: scripts/enrichment.js ← depends on 1, 3, 4
Step 6: scripts/milestone-checker.js ← depends on 1, 4
Step 7: Modify deployment-tracker.js ← depends on 1, 3 (write to SQLite + JSON)
Step 8: Modify nightly-recap.js ← depends on 1 (read from SQLite)
Step 9: scripts/realtime-listener.js ← depends on 1, 3, 4 (WSS miniblocks)
Step 10: Cron setup + end-to-end test

Steps 3 and 4 can be built in parallel (no mutual dependency).

New Files

lib/db.js — SQLite via better-sqlite3

Singleton connection, WAL mode, synchronous API. Exports CRUD functions for 5 tables:

Tables:

- deployments — migrated from JSON + enriched (contract_address, category, defillama_slug, contract_verified)
- project_metrics — time-series snapshots per project (tvl_usd, tx_count, tx_count_delta, balance, verification status)
- ecosystem_metrics — chain-wide snapshots (total_tvl, addresses, txs, gas, deployment count)
- milestones — threshold crossing events with alerted flag
- address_resolutions — audit log for contract address discovery attempts

DB file at data/tracker.db. Twitter IDs stored as TEXT (exceed JS safe integer range).

lib/data-sources.js — API Wrappers

Uses global fetch (Node 18+), no new HTTP deps. Includes fetchWithRetry with exponential backoff for 429/5xx.

DeFiLlama:

- defillamaGetEcosystemTvl() — GET /v2/historicalChainTvl/MegaETH
- defillamaGetProtocols() — GET /protocols, filter by chains.includes('MegaETH'), cache 1hr
- defillamaGetProtocolTvl(slug) — GET /protocol/{slug}

Blockscout (megaeth.blockscout.com/api/v2):

- blockscoutGetStats() — chain stats (addresses, txs, gas, block time)
- blockscoutSearchContracts(query) — search for contract by name (for address resolution)
- blockscoutGetContract(address) — verification status, ABI, source
- blockscoutGetAddress(address) — balance, tx count, token transfers
- blockscoutGetTokens() — token listings with holders, market cap

MegaETH RPC (Alchemy primary, public fallback):

- rpcGetCode(address) — verify address is a contract
- rpcGetTransactionCount(address) — nonce count
- rpcGetBalance(address) — ETH balance (wei as string, eth as float)
- rpcGetBlockNumber() — current block

Contract Address Resolver:

- resolveContractAddress(project) — multi-strategy: Blockscout search → DeFiLlama protocol match → hardcoded known addresses (Aave,
  Chainlink, Lido)
- Returns { address, confidence, method }, logs attempt to address_resolutions table

lib/scoring.js — Signal Classification (Scoring Matrix)

Scoring weights (0-100 total):
┌───────────────────────────────────┬────────┬──────────────────────────────────────────────────────────────────┐
│ Factor │ Weight │ How it's scored │
├───────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────┤
│ TVL relative to ecosystem │ 25 │ >10% = 25, >5% = 20, >1% = 15, >0.1% = 10, listed but tiny = 5 │
├───────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────┤
│ Contract verified │ 15 │ Yes = 15, No = 0 │
├───────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────┤
│ Tx activity (24h delta vs 7d avg) │ 20 │ >2x avg = 20, >1.5x = 16, >1x = 12, >0.5x = 8, active = 4 │
├───────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────┤
│ Balance health │ 10 │ >10 ETH = 10, >1 ETH = 8, >0.1 ETH = 5, >0 = 2 │
├───────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────┤
│ Age + sustained activity │ 5 │ >7d active = 5, >3d active = 3, <3d = 1, ghost = 0 │
├───────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────┤
│ Category strength │ 10 │ DeFi/Oracle = 10, Bridge = 9, Infra = 8, Trading = 7, Gaming = 5 │
├───────────────────────────────────┼────────┼──────────────────────────────────────────────────────────────────┤
│ DeFiLlama listed │ 15 │ Listed = 15, Not listed = 0 │
└───────────────────────────────────┴────────┴──────────────────────────────────────────────────────────────────┘
Classifications:

- ALPHA (75-100): Strong TVL, verified, active, DeFiLlama-listed
- ROUTINE (40-74): Moderate metrics, some verification
- WARNING (20-39): Declining activity, unverified, thin liquidity
- RISK (0-19): No verification, no activity, potential rug indicators

Milestone thresholds (configurable):

- Ecosystem TVL: $1M, $5M, $10M, $25M, $50M, $100M, $250M, $500M, $1B
- Per-project TVL: $10K, $50K, $100K, $500K, $1M, $5M, $10M
- Ecosystem txs: 100K, 500K, 1M, 5M, 10M, 50M, 100M, 500M
- Active wallets: 1K, 5K, 10K, 50K, 100K, 500K, 1M
- Deployment count: every 10 (40, 50, 60...)

scripts/migrate-json-to-sqlite.js

One-time migration of 36 deployments from JSON to SQLite. Assigns initial categories via keyword analysis + manual overrides for
known projects. Maps DeFiLlama slugs for Aave, Lido, Gains Network, Cap.

scripts/enrichment.js (Cron: every 30 min)

enrichment.js
├── enrichEcosystem()
│ ├── blockscoutGetStats() → addresses, txs, gas
│ ├── defillamaGetEcosystemTvl() → total TVL
│ ├── getDeploymentCount() → from own DB
│ ├── INSERT ecosystem_metrics
│ └── checkEcosystemMilestones() → INSERT milestones if threshold crossed
│
├── enrichProjects() (for each deployment WITH contract_address)
│ ├── blockscoutGetAddress(addr) → tx_count, balance
│ ├── getCachedProtocols() → tvl_usd (if DeFiLlama listed)
│ ├── blockscoutGetContract(addr) → is_verified
│ ├── INSERT project_metrics (with tx_count_delta computed from previous snapshot)
│ └── checkProjectMilestones() → INSERT milestones
│
└── resolveNewAddresses() (for deployments WITHOUT contract_address)
├── blockscoutSearchContracts(project_name)
├── rpcGetCode(candidate) → verify it's a contract
└── UPDATE deployments SET contract_address

200ms delay between project API calls. Each section wrapped independently so failures don't cascade.

scripts/milestone-checker.js (Cron: 5 min after enrichment)

Reads unalerted milestones from DB, formats Telegram messages, sends alerts, marks as alerted. Separate from enrichment for
independent testing.

scripts/realtime-listener.js (Long-running process)

WSS connection to MegaETH miniBlocks subscription. Detects contract deployments (tx.to === null), cross-references against known
projects, sends alerts for high-signal events. Auto-reconnect on disconnect. Requires ws npm package.

Modifications to Existing Files

scripts/deployment-tracker.js — Add lib/db.js import, call insertDeployment() alongside JSON write, attempt contract resolution on
new deployments.

scripts/nightly-recap.js — Read from SQLite instead of JSON, include ecosystem metrics and recent milestones in recap.

package.json — Add better-sqlite3, ws. Add scripts: migrate, enrich, milestones, listen.

.gitignore — Add data/, _.db, _.db-wal, \*.db-shm, enrichment.log.

.env — Add MEGAETH_ALCHEMY_RPC and MEGAETH_WSS.

New Dependencies

- better-sqlite3 — synchronous SQLite (no async overhead, WAL mode for concurrent access)
- ws — WebSocket client for realtime listener

Cron Schedule

_/10 _ \* \* _ deployment-tracker.js (existing, modified to write SQLite)
_/30 \* \* \* _ enrichment.js (new)
5,35 _ \* \* _ milestone-checker.js (new, 5 min after enrichment)
0 23 _ \* \* nightly-recap.js (existing, modified to read SQLite)

realtime-listener.js runs as a long-running process (pm2 or systemd), not cron.

Verification Plan

1.  DB layer: Run node -e "require('./lib/db').getDb()" — verify data/tracker.db created with 5 tables
2.  Migration: Run npm run migrate — verify 36 rows in deployments with categories
3.  API wrappers: Test each function individually in Node REPL — verify DeFiLlama returns TVL, Blockscout returns stats, RPC returns
    block number
4.  Enrichment: Run npm run enrich once — verify ecosystem_metrics and project_metrics tables populated
5.  Milestones: Insert a test milestone, run npm run milestones — verify Telegram alert sent
6.  Scoring: Score a known project (Aave) — verify structured output with classification and evidence
7.  End-to-end: deployment detected → SQLite insert → enrichment runs → milestone triggered → alert sent → visible in nightly recap

Known Limitations

- Contract address resolution will be incomplete. Many of the 36 projects won't be automatically resolvable. The system works with
  NULL addresses — those projects just skip per-project metrics. Manual address mapping (a config file) can fill gaps over time.
- DeFiLlama only lists ~1 protocol (Aave) on MegaETH. Per-project TVL data will be sparse initially. As the ecosystem matures, more
  protocols will appear.
- growthepie is inaccessible (403). Ecosystem benchmarking against other L2s is deferred. Blockscout stats provide sufficient
  chain-level metrics.
- Realtime listener (Step 9) is the most complex and least critical. If it blocks progress, defer it and focus on the cron-based
  pipeline which delivers 95% of the value.
