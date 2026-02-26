# forkuusho: The Deployment Intel Bot

## The Hook
MegaETH is a real-time blockchain. If you're waiting for a weekly newsletter to hear about new projects, you've already lost. The **Deployment Intel Bot** turns @megaeth's firehose into actionable signal.

## The Architecture

### V1: The Relay (Shipped 2026-02-10)
| Component | Tech | Responsibility |
| :--- | :--- | :--- |
| Harvester | Node.js + Twitter v2 | Polls for "Deployment detected" keywords. |
| Memory | JSON Store | Persists project handles, URLs, and timestamps. |
| Broadcaster | Telegram Bot API | Delivers real-time alerts to the inner circle. |
| Recapper | Nightly Script | Aggregates daily data for public engagement. |

### V2: The Intelligence Layer (Shipped 2026-02-14)
| Component | Tech | Responsibility |
| :--- | :--- | :--- |
| Database | SQLite (better-sqlite3) | 5 tables: deployments, project_metrics, ecosystem_metrics, milestones, address_resolutions. WAL mode. |
| API Layer | DeFiLlama + Blockscout + RPC | TVL tracking, chain stats, contract verification. Zero API keys. |
| Scoring Engine | 7-factor matrix (0-100) | Classifies projects as ALPHA / ROUTINE / WARNING / RISK. |
| Enrichment Pipeline | Cron (every 30 min) | Collects ecosystem + per-project metrics, detects milestones. |
| Milestone Alerts | Cron (5 min after enrichment) | Sends Telegram alerts when thresholds are crossed. |
| Address Resolver | Multi-strategy | miniblocks.io API, Blockscout search, DeFiLlama match, known addresses. |
| Realtime Listener | WSS (miniBlocks sub) | Detects contract deployments on-chain in real time. |

### V3: Agent Identity + Distribution (Shipped 2026-02-15)
| Component | Tech | Responsibility |
| :--- | :--- | :--- |
| Telegram Bot | node-telegram-bot-api | 10 slash commands: ecosystem data, project lookups, signals, warnings. |
| API Server | Express + x402 | Paid programmatic access for agents/apps. Micropayments via HTTP 402 flow. |
| ERC-8004 Identity | ethers + MegaETH | Agent ID 109 registered onchain. Verifiable identity for Pan. |
| AI Narrator | Claude Sonnet 4.5 (Anthropic SDK) | `/brief` command transforms raw metrics into shareable alpha narratives. Pan's voice. |

### V3 Architecture: Two Frontends, One Brain
```
Telegram (free, humans)          API Server (paid, machines)
┌─────────────────────┐         ┌──────────────────────────┐
│ /brief              │         │ GET /api/brief           │
│ /status /top /alpha │         │ GET /api/status          │
│                     │         │                          │
│  narrator.js ◀──────┼────────▶│  narrator.js             │
│  (inline call)      │         │  (x402 payment gate)     │
└─────────────────────┘         └──────────────────────────┘
```

## The Numbers (as of 2026-02-15)
- **52 projects tracked** (36 from Twitter, 16 from miniblocks.io)
- **29 with verified contract addresses**
- **$60.6M ecosystem TVL** (DeFiLlama)
- **540K+ active wallets** (Blockscout)
- **218M+ total transactions**
- **18 milestone alerts sent** on first enrichment run
- **10 Telegram slash commands** (including AI-narrated `/brief`)
- **Agent ID 109** registered onchain via ERC-8004
- **~$0.003/brief** AI narration cost
- **$0 total infrastructure cost** (excluding API usage)

## The War Room

### Lesson 1: Data is ephemeral, Context is King
Initially, we only tracked Tweet IDs. When it came time to write a "Nightly Recap" tweet, the bot had no idea *what* was actually deployed without doing 10 more API calls. We pivoted to a full metadata structure in `deployments-tracked.json`. We trade a few kilobytes of disk space for massive speed in content generation.

### Lesson 2: Twitter is the Front Door, Telegram is the Vault
We use Twitter to find the info, but we deliver it to Telegram because that's where the real builders live. It bypasses the algorithm and puts the alpha directly in their pockets.

### Lesson 3: A Relay is Not a Product
The V1 opus review nailed it: "this is a relay, not a product." Forwarding tweets to Telegram is table stakes. V2 adds the intelligence layer — onchain data, scoring, milestones — that transforms raw signal into ranked, classified, actionable intel.

### Lesson 4: Cross-Reference Everything
miniblocks.io's `/api/dapps` endpoint gave us 29 contract addresses in one shot. The Blockscout search API found approximately zero. DeFiLlama only lists ~1 protocol on MegaETH. The lesson: no single source is complete. Layer them. The bot now runs a multi-strategy resolver: known addresses → Blockscout search → DeFiLlama match → miniblocks.io cross-reference.

### Lesson 5: Raw Data is Not a Product
V2 gave us scored, classified, queryable data. But `/top` returning "score=30 classification=WARNING tvl=$2.1M" doesn't tell you *what to do with that*. V3.1 adds the interpretation layer — an AI narrator that reads the full data snapshot and writes "this protocol is showing early signs of stagnation despite decent TVL." The data is the engine. The narrative is the product. The `/brief` command is just a frontend for `narrator.js`, which means the same narration powers both the free Telegram bot and the paid x402 API.

### Lesson 6: Score Honestly
First enrichment run scored every project between 5-30 out of 100. No ALPHA classifications. That's correct — the ecosystem is 5 weeks old, most contracts are unverified, TVL data is sparse. Inflating scores to look good would defeat the purpose. The scoring matrix earns trust by being honest, and it'll surface real ALPHA signals as the ecosystem matures.

## The Stack
```
3 scripts (V1) + 7 files (V2) + 4 files (V3) + 1 file (V3.1) = 15 files
Node 25 (node:sqlite built-in)
9 dependencies: dotenv, twitter-api-v2, node-telegram-bot-api, ws, ethers, express, cors, @x402/*, @anthropic-ai/sdk
1 SQLite database, 5 tables
5 APIs: DeFiLlama, Blockscout, MegaETH RPC, miniblocks.io, Anthropic Claude
Total infra cost: $0 | AI narration: ~$0.003/brief
```

## Cron Schedule
```
*/10 * * * *  deployment-tracker.js    ← polls Twitter, writes JSON + SQLite
*/30 * * * *  enrichment.js            ← collects metrics, scores projects, detects milestones
5,35 * * * *  milestone-checker.js     ← sends Telegram alerts for threshold crossings
0 23 * * *    nightly-recap.js         ← daily summary with ecosystem stats + top signals
```
`realtime-listener.js` runs as a long-lived process (pm2/systemd), not cron.
