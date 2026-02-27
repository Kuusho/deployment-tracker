#!/usr/bin/env node
/**
 * One-time seed: imports deployments from memory/deployments-tracked.json
 * into the Postgres tracker_deployments table.
 *
 * Contract addresses are not in the JSON — run `npm run enrich` afterwards
 * to resolve them via the address-resolution pipeline.
 *
 * Usage: node scripts/seed-deployments.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fs = require('fs');
const db = require('../lib/db');
const scoring = require('../lib/scoring');
const { getProject } = require('../lib/projects');

const JSON_FILE = path.join(__dirname, '../memory/deployments-tracked.json');

const CATEGORY_KEYWORDS = {
  defi:       ['defi', 'swap', 'liquidity', 'yield', 'lending', 'borrow', 'amm', 'pool', 'vault', 'stablecoin', 'perps', 'perpetual', 'clob', 'exchange', 'dex', 'clmm'],
  oracle:     ['oracle', 'data feeds', 'data streams', 'price feed'],
  bridge:     ['bridge', 'cross-chain', 'bridging', 'swap across'],
  infra:      ['infrastructure', 'hosting', 'data availability', 'wallet tracker', 'rpc', 'indexer', 'analytics'],
  trading:    ['trading bot', 'trading terminal', 'degen trading', 'sniper', 'bot'],
  launchpad:  ['launchpad', 'launch', 'tge', 'token deploy', 'memecoin'],
  gaming:     ['game', 'gaming', 'arena', 'pvp', 'fantasy football', 'play', 'tournament', 'monster'],
  prediction: ['prediction market', 'bet on', 'betting'],
  social:     ['social', 'community'],
};

const CATEGORY_OVERRIDES = {
  aave:            'defi',
  LidoFinance:     'defi',
  chainlink:       'oracle',
  redstone_defi:   'oracle',
  GainsNetwork_io: 'defi',
  capmoney_:       'defi',
  avon_xyz:        'defi',
  warpexchange:    'defi',
  wcm_inc:         'defi',
  SectorOneDEX:    'defi',
  realtime_defi:   'defi',
  SupernovaLabs_:  'defi',
  PrismFi_:        'defi',
  kumbaya_xyz:     'defi',
  mrdn_finance:    'defi',
  premarket_xyz:   'defi',
  BungeeExchange:  'bridge',
  aori_io:         'bridge',
  telisxyz:        'bridge',
  AvailProject:    'infra',
  birdeye_so:      'infra',
  mtrkr_xyz:       'infra',
  thewarren_app:   'infra',
  infinex:         'infra',
  PriorityTrade_:  'trading',
  BasedTradingBot: 'trading',
  bananagun:       'trading',
  fasterdotfun:    'launchpad',
  AveForge:        'gaming',
  TopStrikeIO:     'gaming',
  stompdotgg:      'gaming',
  clutchpredict:   'prediction',
  hitdotone:       'defi',
  smasherdotfun:   'gaming',
  AiCrypts:        'gaming',
  OffshoreOnMega:  'defi',
};

const DEFILLAMA_SLUGS = {
  aave:            'aave-v3',
  LidoFinance:     'lido',
  GainsNetwork_io: 'gains-network',
  capmoney_:       'cap',
};

function categorizeByText(text) {
  const lower = (text || '').toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return category;
    }
  }
  return 'other';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) console.log('[DRY RUN] No data will be written.');

  if (!fs.existsSync(JSON_FILE)) {
    console.error('JSON file not found:', JSON_FILE);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  const entries = (raw.deployments || []).filter(d => typeof d === 'object' && d.id);
  console.log(`Found ${entries.length} deployments in JSON file`);

  let inserted = 0;
  let skipped = 0;

  for (const d of entries) {
    const project = d.project || 'unknown';
    const category = CATEGORY_OVERRIDES[project] || categorizeByText(d.text || '');
    const defillama_slug = DEFILLAMA_SLUGS[project] || null;
    const megamafia = scoring.MEGAMAFIA_PROJECTS.has(project) ? 1 : 0;
    const { name, description, website } = getProject(project);

    const record = {
      id:               d.id,
      project,
      url:              d.url || null,
      tweet_text:       d.text || null,
      created_at:       d.createdAt || null,
      contract_address: null,
      category,
      defillama_slug,
      megamafia,
      name,
      description,
      website,
    };

    const tag = megamafia ? ' [MAFIA]' : '';
    const nameStr = name ? ` "${name}"` : '';
    console.log(`  @${project}${nameStr} [${category}]${defillama_slug ? ` (${defillama_slug})` : ''}${tag}`);

    if (!dryRun) {
      await db.insertDeployment(record);
      inserted++;
    } else {
      skipped++;
    }
  }

  if (!dryRun) {
    const total = await db.getDeploymentCount();
    console.log(`\nSeed complete: ${inserted} records inserted. Total in DB: ${total}`);
  } else {
    console.log(`\nDry run complete: ${entries.length} records would be inserted.`);
  }

  await db.close();
}

main().catch(async err => {
  console.error('Fatal:', err.message);
  await db.close();
  process.exit(1);
});
