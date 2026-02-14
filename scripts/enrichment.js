#!/usr/bin/env node
/**
 * Enrichment pipeline — runs every 30 minutes via cron
 * Collects ecosystem + per-project metrics, detects milestones
 *
 * Usage: npm run enrich
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../lib/db');
const ds = require('../lib/data-sources');
const scoring = require('../lib/scoring');

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}

// --- Ecosystem Enrichment ---

async function enrichEcosystem() {
  log('Enriching ecosystem metrics...');

  let totalTvl = null;
  let stats = null;

  // DeFiLlama ecosystem TVL
  try {
    const tvlData = await ds.defillamaGetEcosystemTvl();
    if (tvlData) totalTvl = tvlData.tvl;
    log(`  DeFiLlama TVL: $${totalTvl ? scoring.formatNumber(totalTvl) : 'N/A'}`);
  } catch (err) {
    log(`  DeFiLlama TVL fetch failed: ${err.message}`, 'WARN');
  }

  // Blockscout chain stats
  try {
    stats = await ds.blockscoutGetStats();
    log(`  Blockscout: ${stats.total_addresses} addresses, ${stats.total_transactions} txs`);
  } catch (err) {
    log(`  Blockscout stats fetch failed: ${err.message}`, 'WARN');
  }

  const deploymentCount = db.getDeploymentCount();

  db.insertEcosystemMetrics({
    total_tvl: totalTvl,
    total_addresses: stats ? parseInt(stats.total_addresses) || null : null,
    total_txs: stats ? parseInt(stats.total_transactions) || null : null,
    txs_24h: stats ? parseInt(stats.transactions_today) || null : null,
    avg_gas_price: stats?.gas_prices?.average?.toString() || null,
    avg_block_time: stats ? parseFloat(stats.average_block_time) || null : null,
    deployment_count: deploymentCount,
  });

  log(`  Ecosystem snapshot saved (${deploymentCount} deployments)`);

  // Check ecosystem milestones
  checkEcosystemMilestones(totalTvl, stats, deploymentCount);
}

function checkEcosystemMilestones(tvl, stats, deploymentCount) {
  // TVL milestones
  if (tvl) {
    const crossed = scoring.getCrossedThresholds(tvl, scoring.ECOSYSTEM_TVL_THRESHOLDS);
    for (const threshold of crossed) {
      db.insertMilestone({
        type: 'ecosystem', subject: null, metric: 'tvl',
        threshold, actual_value: tvl,
      });
    }
  }

  // Transaction milestones
  if (stats?.total_transactions) {
    const txs = parseInt(stats.total_transactions);
    const crossed = scoring.getCrossedThresholds(txs, scoring.ECOSYSTEM_TXS_THRESHOLDS);
    for (const threshold of crossed) {
      db.insertMilestone({
        type: 'ecosystem', subject: null, metric: 'total_txs',
        threshold, actual_value: txs,
      });
    }
  }

  // Active wallets milestones
  if (stats?.total_addresses) {
    const addrs = parseInt(stats.total_addresses);
    const crossed = scoring.getCrossedThresholds(addrs, scoring.ACTIVE_WALLETS_THRESHOLDS);
    for (const threshold of crossed) {
      db.insertMilestone({
        type: 'ecosystem', subject: null, metric: 'active_wallets',
        threshold, actual_value: addrs,
      });
    }
  }

  // Deployment count milestones (every 10, starting at 40)
  const depMilestones = scoring.getDeploymentMilestones(deploymentCount);
  for (const threshold of depMilestones) {
    db.insertMilestone({
      type: 'ecosystem', subject: null, metric: 'deployment_count',
      threshold, actual_value: deploymentCount,
    });
  }
}

// --- Per-Project Enrichment ---

async function enrichProjects() {
  const projects = db.getDeploymentsWithAddress();
  log(`Enriching ${projects.length} projects with contract addresses...`);

  // Get ecosystem TVL for scoring
  const latestEco = db.getLatestEcosystemMetrics();
  const ecosystemTvl = latestEco?.total_tvl || null;

  // Cache DeFiLlama protocols
  let protocols = [];
  try {
    protocols = await ds.getCachedProtocols();
  } catch (err) {
    log(`  DeFiLlama protocols fetch failed: ${err.message}`, 'WARN');
  }

  for (const project of projects) {
    try {
      await enrichSingleProject(project, ecosystemTvl, protocols);
    } catch (err) {
      log(`  Failed to enrich @${project.project}: ${err.message}`, 'WARN');
    }
    await ds.sleep(200); // Rate limit protection
  }
}

async function enrichSingleProject(project, ecosystemTvl, protocols) {
  const addr = project.contract_address;
  let txCount = null;
  let balanceEth = null;
  let balanceWei = null;
  let isVerified = null;
  let tvlUsd = null;

  // Blockscout address info
  try {
    const addrInfo = await ds.blockscoutGetAddress(addr);
    txCount = parseInt(addrInfo.transactions_count) || null;
    if (addrInfo.coin_balance) {
      balanceWei = addrInfo.coin_balance;
      balanceEth = parseFloat(addrInfo.coin_balance) / 1e18;
    }
  } catch (err) {
    log(`    Blockscout address failed for @${project.project}: ${err.message}`, 'WARN');
  }

  // DeFiLlama TVL
  tvlUsd = ds.getProtocolTvlForProject(protocols, project.project, project.defillama_slug);

  // Contract verification
  try {
    const contract = await ds.blockscoutGetContract(addr);
    isVerified = contract && contract.is_verified ? 1 : 0;
    if (isVerified !== project.contract_verified) {
      db.updateDeployment(project.id, { contract_verified: isVerified });
    }
  } catch (err) {
    // 404 = not verified, not an error
    isVerified = 0;
  }

  // Compute delta from previous snapshot
  const prev = db.getLatestProjectMetrics(project.id);
  const txCountDelta = (txCount != null && prev?.tx_count != null) ? txCount - prev.tx_count : null;

  // Compute 7-day average for scoring
  const history = db.getProjectMetricsHistory(project.id, 14); // ~7 days at 2x/day
  let txCount7dAvg = null;
  if (history.length >= 2) {
    const deltas = history.filter(h => h.tx_count_delta != null).map(h => h.tx_count_delta);
    if (deltas.length > 0) {
      txCount7dAvg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    }
  }

  // Score the project
  const { score, classification, breakdown } = scoring.scoreProject({
    tvl_usd: tvlUsd,
    ecosystem_tvl: ecosystemTvl,
    is_verified: isVerified === 1,
    tx_count_delta: txCountDelta,
    tx_count_7d_avg: txCount7dAvg,
    balance_eth: balanceEth,
    created_at: project.created_at,
    tx_count: txCount,
    category: project.category,
    defillama_listed: tvlUsd != null,
  });

  db.insertProjectMetrics({
    deployment_id: project.id,
    tvl_usd: tvlUsd,
    tx_count: txCount,
    tx_count_delta: txCountDelta,
    balance_wei: balanceWei,
    balance_eth: balanceEth,
    is_verified: isVerified,
    score,
    classification,
  });

  log(`  @${project.project}: score=${score} [${classification}] tvl=${tvlUsd ? '$' + scoring.formatNumber(tvlUsd) : 'N/A'} txs=${txCount || 'N/A'}`);

  // Check project milestones
  checkProjectMilestones(project, tvlUsd, txCount);
}

function checkProjectMilestones(project, tvlUsd, txCount) {
  if (tvlUsd) {
    const crossed = scoring.getCrossedThresholds(tvlUsd, scoring.PROJECT_TVL_THRESHOLDS);
    for (const threshold of crossed) {
      db.insertMilestone({
        type: 'project', subject: project.project, metric: 'tvl',
        threshold, actual_value: tvlUsd,
      });
    }
  }
}

// --- Address Resolution for Unresolved Projects ---

async function resolveNewAddresses() {
  const unresolved = db.getDeploymentsWithoutAddress();
  log(`Attempting address resolution for ${unresolved.length} projects...`);

  let resolved = 0;
  for (const project of unresolved) {
    try {
      const result = await ds.resolveContractAddress(project);
      if (result && result.address) {
        db.updateDeployment(project.id, { contract_address: result.address });
        log(`  Resolved @${project.project} → ${result.address} (${result.method}, confidence: ${result.confidence})`);
        resolved++;
      }
    } catch (err) {
      log(`  Resolution failed for @${project.project}: ${err.message}`, 'WARN');
    }
    await ds.sleep(300); // Be gentle with APIs
  }

  log(`  Resolved ${resolved}/${unresolved.length} addresses`);
}

// --- Main ---

async function main() {
  log('=== Enrichment pipeline starting ===');
  const start = Date.now();

  // Each section wrapped independently so failures don't cascade
  try {
    await enrichEcosystem();
  } catch (err) {
    log(`Ecosystem enrichment failed: ${err.message}`, 'ERROR');
  }

  try {
    await enrichProjects();
  } catch (err) {
    log(`Project enrichment failed: ${err.message}`, 'ERROR');
  }

  try {
    await resolveNewAddresses();
  } catch (err) {
    log(`Address resolution failed: ${err.message}`, 'ERROR');
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`=== Enrichment complete in ${elapsed}s ===`);
  db.close();
}

main().catch(err => {
  log(`Fatal enrichment error: ${err.message}`, 'FATAL');
  db.close();
  process.exit(1);
});
