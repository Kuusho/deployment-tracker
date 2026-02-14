# Implementation Log: Deployment Tracker

| Date | Decision | Rationale | Rejection |
| :--- | :--- | :--- | :--- |
| 2026-02-10 | Migration to Metadata | Simple IDs didn't provide enough context for nightly recaps without re-fetching. | Sticking with string IDs only. |
| 2026-02-10 | Telegram Integration | X algorithm suppresses external links; TG is the primary "alpha" delivery channel. | Discord (too much noise). |
| 2026-02-10 | Project Isolation | Moving to `ideation-labs/megashETH-labs` for clean 72-hour sprint management. | Keeping in clawd-pan root. |
| 2026-02-10 | dotenv for Credentials | Cleaner than shell sourcing; keeps creds in project scope. | Hardcoding or system-wide env vars. |
| 2026-02-10 | Autonomous Deployment | Bot runs independently via cron, not dependent on Pan session. | Pan-triggered monitoring (uptime dependency). |

## Backfill Results (2026-02-10 22:12 GMT+1)
- **Total deployments tracked:** 36 unique projects
- **Date range:** Jan 5 - Feb 9, 2026 (35 days)
- **Tweets scanned:** 300
- **Telegram alerts:** 22/36 delivered (61% success rate)
- **Failed alerts:** 14 (12 markdown parsing errors, 2 rate limit)
- **Data integrity:** 100% (all 36 saved to JSON)

## Technical Fixes Applied
| Issue | Fix | Date |
| :--- | :--- | :--- |
| Extraction regex missed "Deployment detected @handle" | Added fallback pattern to handle both "for/by" and direct mention | 2026-02-10 |
| @redstone_defi extracted as null | Manual correction + regex improvement | 2026-02-10 |
| Telegram rate limit (429) | Accepted limitation; data saved regardless | 2026-02-10 |
| Markdown parsing errors | Logged for future fix (escape special chars in tweet text) | 2026-02-10 |

## Files Created (Backfill Phase)
- `scripts/backfill-deployments.js` - Paginated historical scan (up to 300 tweets)
- `memory/deployments-tracked.json.backup` - Pre-backfill state

## Cost Tracker
- **Twitter API v2**: Free tier (limited to 1,500 posts/mo, enough for monitoring).
- **Telegram Bot API**: $0.
- **Compute**: Local machine.
- **Backfill cost:** ~3 API calls (300 tweets via pagination, 1s delays)

## Ecosystem Insights (From Database)
- **Blue chips:** 3 (@aave, @LidoFinance, @chainlink)
- **DeFi dominance:** 12 protocols (33%)
- **Trading/prediction:** 6 platforms (17%)
- **Deployment velocity:** ~1 project/day average

---

## V2: Intelligence Layer (2026-02-14)

### Decisions

| Date | Decision | Rationale | Rejection |
| :--- | :--- | :--- | :--- |
| 2026-02-14 | SQLite via better-sqlite3 | Synchronous API, WAL mode, zero-config, no async overhead. Relational structure needed for time-series metrics, scoring, and milestone tracking. | PostgreSQL (overkill), JSON files (no queries). |
| 2026-02-14 | Scoring matrix (0-100) | Quantitative signal classification (ALPHA/ROUTINE/WARNING/RISK) replaces gut feel. 7 weighted factors: TVL, verification, tx activity, balance, age, category, DeFiLlama listing. | Simple pass/fail, manual triage. |
| 2026-02-14 | miniblocks.io as address source | Their `/api/dapps` endpoint returns contract addresses for every listed project. Resolved 29/52 addresses in one shot vs Blockscout search which found ~0. | Manual address hunting, etherscan scraping. |
| 2026-02-14 | DeFiLlama + Blockscout + RPC | Three free APIs covering TVL (DeFiLlama), chain stats (Blockscout), and contract verification (RPC). No API keys needed. | Dune (requires API key), The Graph (too complex). |
| 2026-02-14 | Cron-based enrichment | 30-min enrichment cycle is sufficient for ecosystem monitoring. Realtime WSS listener added for contract deployment detection but not critical path. | Continuous polling (wasteful), webhook-based (no webhooks available). |
| 2026-02-14 | Global fetch (Node 18+) | Zero new HTTP dependencies. `fetchWithRetry` with exponential backoff handles 429/5xx. | axios (unnecessary dep), got (unnecessary dep). |

### V2 Build Results (2026-02-14)

**New files created:**
- `lib/db.js` — SQLite singleton, 5 tables, CRUD functions, WAL mode
- `lib/data-sources.js` — DeFiLlama, Blockscout, MegaETH RPC wrappers + contract resolver
- `lib/scoring.js` — 7-factor scoring matrix, milestone thresholds, classification engine
- `scripts/migrate-json-to-sqlite.js` — One-time JSON → SQLite migration
- `scripts/enrichment.js` — Cron: ecosystem + project metrics collection
- `scripts/milestone-checker.js` — Cron: Telegram alerts for threshold crossings
- `scripts/realtime-listener.js` — WSS miniBlocks subscription for contract deployments

**Modified files:**
- `scripts/deployment-tracker.js` — Now writes to SQLite alongside JSON, attempts contract resolution
- `scripts/nightly-recap.js` — Reads from SQLite, includes ecosystem stats + milestones + top signals
- `package.json` — Added `better-sqlite3`, `ws`. Version bumped to 2.0.0. New npm scripts.
- `.gitignore` — Added `data/`, `*.db`, `*.db-wal`, `*.db-shm`

**New dependencies:** `better-sqlite3` (SQLite), `ws` (WebSocket)

### Database State (Post-Migration + miniblocks.io Cross-Reference)
- **Total deployments:** 52 (36 from Twitter backfill + 16 from miniblocks.io)
- **With contract address:** 29
- **Without contract address:** 23
- **DeFiLlama slugs mapped:** 4 (aave-v3, lido, gains-network, cap)

### Category Breakdown (52 projects)
| Category | Count |
| :--- | :--- |
| DeFi | 23 |
| Infra | 9 |
| Gaming | 7 |
| Trading | 3 |
| NFT | 3 |
| Bridge | 3 |
| Oracle | 2 |
| Prediction | 1 |
| Launchpad | 1 |

### Enrichment Results (First Run)
- **Ecosystem TVL:** $60.6M (DeFiLlama)
- **Total addresses:** 540,831 (Blockscout)
- **Total transactions:** 218,253,367 (Blockscout)
- **Milestones detected:** 18 (TVL, txs, wallets thresholds)
- **Milestone alerts sent:** 18/18 to @kuusho_shouten
- **Projects scored:** 29 (all with contract addresses)
- **Score range:** 5-30 (no ALPHA yet — ecosystem is early, most contracts unverified, sparse TVL data)

### miniblocks.io Cross-Reference (2026-02-14)
**Source:** `https://miniblocks.io/api/dapps` — 31 projects listed with contract addresses

**13 existing projects got contract addresses:**
avon_xyz, chainlink, fasterdotfun, kumbaya_xyz, mtrkr_xyz, PrismFi_, redstone_defi, SectorOneDEX, smasherdotfun, stompdotgg, TopStrikeIO, warpexchange, thewarren_app

**16 new projects added:**
beefyfinance, _canolic, currentxdex, GMX_IO, intraVerse_Game, LayerZero_Core, ManiaDotFun, Megaeth_Punks, Noxa_Fi, oddslaunchpad, rarible, Showdown_TCG, leveragesir, syscall_sdk, WheelX_fi, wormhole

### Cost Tracker (V2)
- **DeFiLlama API:** $0 (no key, no rate limit)
- **Blockscout API:** $0 (public)
- **MegaETH RPC:** $0 (public endpoint)
- **miniblocks.io API:** $0 (public)
- **better-sqlite3:** $0 (MIT)
- **ws:** $0 (MIT)
- **Total V2 cost:** $0

## Countdown
**33 days remaining** in the 40-day mission.
