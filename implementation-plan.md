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

 1. Telegram Bot — degen-facing, slash commands, freemium (top of funnel)
 2. Dashboard — analyst/VC/team-facing, deep analytics, paid (revenue engine)

 Key insight: $MEGA token emissions are tied to onchain milestones. Milestone-based alerts    
 have direct financial value to $MEGA holders.

 ---
 Architecture

                     DATA PIPELINE (ships first)
                     ┌─────────────────────┐
   Twitter API ─────→│                     │
   MegaETH RPC ────→│  Enrichment Engine  │──→ SQLite DB
   growthepie API ──→│  (periodic cron)    │
   DeFiLlama API ──→│                     │
   Blockscout API ──→│                     │
                     └────────┬────────────┘
                              │
                 ┌────────────┴────────────┐
                 │                         │
         ┌───────▼───────┐        ┌────────▼────────┐
         │ TELEGRAM BOT  │        │   DASHBOARD     │
         │ (slash cmds)  │        │  (web app)      │
         │ Free + Premium│        │  Paid tiers     │
         └───────────────┘        └─────────────────┘

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
   id TEXT PRIMARY KEY,        -- tweet ID
   project TEXT NOT NULL,      -- @handle
   tweet_url TEXT,
   tweet_text TEXT,
   deployed_at TEXT,           -- ISO timestamp
   contract_address TEXT,      -- enriched later
   category TEXT,              -- DeFi, Gaming, Infra, etc.
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
   type TEXT NOT NULL,          -- 'tvl', 'tx_count', 'wallets', 'deployment_count'
   target TEXT,                 -- project handle or 'ecosystem'
   threshold REAL,              -- the value that was crossed
   direction TEXT,              -- 'up' or 'down'
   actual_value REAL,
   triggered_at TEXT DEFAULT CURRENT_TIMESTAMP,
   alerted INTEGER DEFAULT 0   -- whether Telegram alert was sent
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
 /start              → Welcome message + command list
 /latest             → Last 5 deployments with dates
 /list               → All tracked projects (paginated)
 /project <name>     → Basic info: deployed date, tweet link, category
 /count              → Total deployments on MegaETH
 /search <keyword>   → Search projects by name or category
 /help               → Command reference

 Premium tier (paid):
 /tvl <project>      → Current TVL + 7d trend
 /activity <project> → Tx count, unique wallets, gas usage (last snapshot)
 /ecosystem          → Full ecosystem overview: TVL, tx volume, wallets, deployment velocity  
 /milestones         → Recent milestone events ($MEGA emission relevant)
 /compare <a> <b>    → Side-by-side project comparison
 /alerts setup       → Configure personal milestone alerts (DM-based)
 /hot                → Top projects by activity growth in last 7 days
 /report             → Weekly ecosystem summary

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
 │              File              │                         Purpose                         │ 
 ├────────────────────────────────┼─────────────────────────────────────────────────────────┤ 
 │ scripts/telegram-bot.js        │ New: Main bot process with command handlers             │ 
 ├────────────────────────────────┼─────────────────────────────────────────────────────────┤ 
 │ lib/bot-commands/free.js       │ New: Free tier command implementations                  │ 
 ├────────────────────────────────┼─────────────────────────────────────────────────────────┤ 
 │ lib/bot-commands/premium.js    │ New: Premium tier command implementations               │ 
 ├────────────────────────────────┼─────────────────────────────────────────────────────────┤
 │ lib/bot-commands/formatters.js │ New: Message formatting helpers (escape markdown, etc.) │ 
 ├────────────────────────────────┼─────────────────────────────────────────────────────────┤ 
 │ lib/subscription.js            │ New: User subscription state management                 │ 
 └────────────────────────────────┴─────────────────────────────────────────────────────────┘ 
 ---
 Product 3: Dashboard (ships after bot)

 Purpose: Web-based analytics dashboard for ecosystem teams, VCs, and power users.

 Pages/Views

 1. Home/Overview: Deployment timeline, ecosystem health metrics, recent milestones
 2. Project Directory: Searchable/filterable list of all deployed projects
 3. Project Detail: Per-project page with metrics, TVL chart, activity graph, tweet embed     
 4. Ecosystem Analytics: TVL over time, deployment velocity, category breakdown, L2
 comparison
 5. Milestones Feed: Timeline of milestone events with $MEGA emission context

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

 1. Data pipeline: Run enrichment script, verify SQLite contains metric snapshots, trigger a  
 test milestone alert
 2. Telegram bot: Test every slash command in DM, verify free/premium gating works
 3. Dashboard: Load all pages, verify data matches SQLite, test on mobile
 4. Milestone alerts: Manually insert a metric crossing a threshold, verify alert fires to    
 both Telegram channel and bot subscribers
 5. End-to-end: New deployment detected on Twitter → stored in SQLite → enrichment runs →     
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

| Step | Source | Data | Frequency |
|------|--------|------|-----------|
| 1 | Twitter API (existing) | New deployment detected: @SectorOneDEX | Every 10 min |
| 2 | DeFiLlama API | MegaETH ecosystem TVL: $47M → $52M (24h) | Every 1 hr |
| 3 | growthepie API | Active wallets: 12,400 (+18% vs yesterday) | Every 1 hr |
| 4 | Milestone checker | TVL crossed $50M threshold → emission milestone | After each snapshot |

**Insight delivered:** "🚨 MegaETH just crossed $50M TVL with 254 deployed projects and 12.4K active wallets. Deployment velocity: 7.3/day. This is an emission-relevant milestone."

**Where it surfaces:**
- Telegram: automatic alert to channel + `/milestones` command
- Dashboard: Milestones Feed page with emission context

**Why they pay:** $MEGA emissions are tied to ecosystem milestones. Knowing *when* a threshold is about to be crossed — before the market reacts — is worth $10-20/month to any holder with a meaningful position.

### Scenario 2: The VC — "Is this chain real or just noise?"

**Question:** "MegaETH claims 250+ deployments. Are they real projects with real users, or ghost contracts?"

**How the system answers:**

| Step | Source | Data | Frequency |
|------|--------|------|-----------|
| 1 | SQLite (deployment table) | 254 projects tracked over 35 days, 7.3/day avg | Pre-computed |
| 2 | Blockscout API | Contract verified: Yes. Has ABI. Source code public. | On new deployment |
| 3 | DeFiLlama API | @realtime_defi TVL: $2.1M. @SectorOneDEX TVL: $890K. | Every 1 hr |
| 4 | growthepie API | Ecosystem tx volume: 142K/day. Gas usage trending up. | Every 1 hr |
| 5 | MegaETH RPC | @realtime_defi contract: 4,200 txs in 24h, 0.8 ETH balance | Every 30 min |

**Insight delivered:** "MegaETH Ecosystem Report: 254 deployments (35 days). 68% have verified contracts. Top 10 protocols hold $38M combined TVL. Daily tx volume: 142K. Deployment velocity accelerating: 9.1/day this week vs 5.2/day in week 1."

**Where it surfaces:**
- Dashboard: Ecosystem Analytics page (deployment velocity chart, category breakdown, TVL over time)
- Dashboard: Project Directory with verification badges and activity indicators
- Telegram: `/ecosystem` command (premium), `/report` weekly summary

**Why they pay:** Due diligence on an emerging L2 ecosystem currently requires manually checking 10+ sources. We do it automatically, every hour. That's worth $500-2K/month to a fund evaluating MegaETH allocation.

### Scenario 3: The Deployed Project — "How do we compare?"

**Question:** "We deployed on MegaETH last week. Are we getting traction vs other projects in our category?"

**How the system answers:**

| Step | Source | Data | Frequency |
|------|--------|------|-----------|
| 1 | SQLite (deployment table) | @avon_xyz deployed Jan 28. Category: DeFi. | Pre-computed |
| 2 | DeFiLlama API | @avon_xyz TVL: $340K. Category median: $520K. | Every 1 hr |
| 3 | MegaETH RPC | @avon_xyz contract: 1,100 txs/24h. Category median: 2,300. | Every 30 min |
| 4 | growthepie API | MegaETH DeFi sector: 42% of ecosystem TVL | Every 1 hr |

**Insight delivered:** "📊 @avon_xyz vs DeFi category: TVL $340K (35th percentile), Daily txs 1,100 (28th percentile). You're below median in both metrics. Top DeFi protocol @realtime_defi has 6x your TVL. Ecosystem DeFi share: 42%."

**Where it surfaces:**
- Telegram: `/compare avon_xyz realtime_defi` (premium)
- Telegram: `/activity avon_xyz` (premium)
- Dashboard: Project Detail page with benchmark charts

**Why they pay:** Projects want to know if they're winning or losing. Benchmarking data that shows their position in the ecosystem is worth visibility and a paid tier. Some will also share the dashboard publicly — free distribution for us.

### Data Source Matrix: What We Get From Where

| Source | What it provides | Insights it feeds | Cost | Rate limits |
|--------|-----------------|-------------------|------|-------------|
| **Twitter API** (existing) | Deployment announcements, project handles, tweet text | Deployment velocity, project discovery, timeline | $0 (free tier) | 500K tweets/month |
| **MegaETH RPC** | `eth_getCode`, `eth_getTransactionCount`, `eth_getBalance`, `eth_blockNumber` | Contract existence verification, per-project tx activity, balance tracking | $0 (public RPC) | TBD — probe needed |
| **growthepie API** | Ecosystem TVL, daily txs, active addresses, gas fees, L2 comparisons | Ecosystem health, milestone detection, L2 benchmarking | $0 (public API) | TBD — probe needed |
| **DeFiLlama API** | Per-protocol TVL on MegaETH, TVL history, category breakdown | Project-level TVL, category analysis, TVL milestones | $0 (public API) | No auth, generous |
| **Blockscout API** | Contract verification status, source code, ABI, token info | Verification badges, contract identity, legitimacy scoring | $0 (public API) | TBD — probe needed |

### The Insight Catalog

Every insight maps to a product feature. If an insight doesn't surface in a command or dashboard view, it's wasted computation.

| Insight | Data Sources Combined | Bot Command | Dashboard View |
|---------|----------------------|-------------|----------------|
| Deployment velocity (daily/weekly trend) | Twitter API + SQLite timestamps | `/count`, `/latest` | Home: timeline chart |
| Ecosystem TVL + trend | growthepie + DeFiLlama | `/ecosystem` (premium) | Ecosystem Analytics |
| Per-project TVL | DeFiLlama | `/tvl <project>` (premium) | Project Detail |
| Per-project activity | MegaETH RPC (tx count, balance) | `/activity <project>` (premium) | Project Detail |
| Contract verification status | Blockscout | `/project <name>` | Project Directory (badge) |
| Milestone alerts ($MEGA relevant) | All sources → milestone-checker | `/milestones` (premium) | Milestones Feed |
| Category breakdown | DeFiLlama + SQLite categories | `/search <category>` | Ecosystem Analytics |
| Project comparison | DeFiLlama + RPC + growthepie | `/compare <a> <b>` (premium) | Project Detail |
| Hot projects (growth ranking) | RPC snapshots (7d delta) + DeFiLlama | `/hot` (premium) | Home: trending section |
| Weekly ecosystem summary | All sources aggregated | `/report` (premium) | Home: overview cards |

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