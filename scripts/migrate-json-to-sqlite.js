#!/usr/bin/env node
/**
 * One-time migration: JSON deployments → SQLite
 * Usage: npm run migrate
 */

const path = require('path');
const fs = require('fs');
const db = require('../lib/db');

const JSON_FILE = path.join(__dirname, '..', 'memory', 'deployments-tracked.json');

// Category assignment via keyword analysis on tweet text
const CATEGORY_KEYWORDS = {
  defi: ['defi', 'swap', 'liquidity', 'yield', 'lending', 'borrow', 'amm', 'pool', 'vault', 'stablecoin', 'perps', 'perpetual', 'clob', 'exchange', 'dex', 'clmm'],
  oracle: ['oracle', 'data feeds', 'data streams', 'price feed'],
  bridge: ['bridge', 'cross-chain', 'bridging', 'swap across'],
  infra: ['infrastructure', 'hosting', 'data availability', 'wallet tracker', 'rpc', 'indexer', 'analytics'],
  trading: ['trading bot', 'trading terminal', 'degen trading', 'sniper', 'bot'],
  launchpad: ['launchpad', 'launch', 'tge', 'token deploy', 'memecoin'],
  gaming: ['game', 'gaming', 'arena', 'pvp', 'fantasy football', 'play', 'tournament', 'monster'],
  prediction: ['prediction market', 'bet on', 'betting'],
  social: ['social', 'community'],
};

// Manual overrides for known projects
const CATEGORY_OVERRIDES = {
  aave: 'defi',
  LidoFinance: 'defi',
  chainlink: 'oracle',
  redstone_defi: 'oracle',
  GainsNetwork_io: 'defi',
  capmoney_: 'defi',
  avon_xyz: 'defi',
  warpexchange: 'defi',
  wcm_inc: 'defi',
  SectorOneDEX: 'defi',
  realtime_defi: 'defi',
  SupernovaLabs_: 'defi',
  PrismFi_: 'defi',
  kumbaya_xyz: 'defi',
  mrdn_finance: 'defi',
  premarket_xyz: 'defi',
  BungeeExchange: 'bridge',
  aori_io: 'bridge',
  telisxyz: 'bridge',
  AvailProject: 'infra',
  birdeye_so: 'infra',
  mtrkr_xyz: 'infra',
  thewarren_app: 'infra',
  infinex: 'infra',
  PriorityTrade_: 'trading',
  BasedTradingBot: 'trading',
  bananagun: 'trading',
  fasterdotfun: 'launchpad',
  AveForge: 'gaming',
  TopStrikeIO: 'gaming',
  stompdotgg: 'gaming',
  clutchpredict: 'prediction',
  hitdotone: 'defi',
  smasherdotfun: 'gaming',
  AiCrypts: 'gaming',
  OffshoreOnMega: 'defi',
};

// DeFiLlama slug mapping for known protocols
const DEFILLAMA_SLUGS = {
  aave: 'aave-v3',
  LidoFinance: 'lido',
  GainsNetwork_io: 'gains-network',
  capmoney_: 'cap',
};

function categorizeByText(text) {
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return category;
    }
  }
  return 'other';
}

function migrate() {
  if (!fs.existsSync(JSON_FILE)) {
    console.error('JSON file not found:', JSON_FILE);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  const deployments = raw.deployments || [];

  console.log(`Found ${deployments.length} deployments in JSON file`);

  const database = db.getDb();
  const insertMany = database.transaction((items) => {
    for (const d of items) {
      if (typeof d === 'string') {
        // Old format: just an ID string, skip
        console.log(`  Skipping string-only entry: ${d}`);
        continue;
      }

      const project = d.project || 'unknown';
      const category = CATEGORY_OVERRIDES[project] || categorizeByText(d.text || '');
      const slug = DEFILLAMA_SLUGS[project] || null;

      db.insertDeployment({
        id: d.id,
        project,
        url: d.url || null,
        tweet_text: d.text || null,
        created_at: d.createdAt || null,
        contract_address: null,
        category,
        defillama_slug: slug,
      });

      console.log(`  Migrated: @${project} [${category}]${slug ? ` (DeFiLlama: ${slug})` : ''}`);
    }
  });

  insertMany(deployments);

  const count = db.getDeploymentCount();
  console.log(`\nMigration complete: ${count} deployments in SQLite`);

  // Show category breakdown
  const cats = database.prepare('SELECT category, COUNT(*) as count FROM deployments GROUP BY category ORDER BY count DESC').all();
  console.log('\nCategory breakdown:');
  for (const c of cats) {
    console.log(`  ${c.category}: ${c.count}`);
  }

  db.close();
}

migrate();
