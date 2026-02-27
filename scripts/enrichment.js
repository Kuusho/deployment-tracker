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

  const deploymentCount = await db.getDeploymentCount();

  await db.insertEcosystemMetrics({
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
  await checkEcosystemMilestones(totalTvl, stats, deploymentCount);
}

async function checkEcosystemMilestones(tvl, stats, deploymentCount) {
  // TVL milestones
  if (tvl) {
    const crossed = scoring.getCrossedThresholds(tvl, scoring.ECOSYSTEM_TVL_THRESHOLDS);
    for (const threshold of crossed) {
      await db.insertMilestone({
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
      await db.insertMilestone({
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
      await db.insertMilestone({
        type: 'ecosystem', subject: null, metric: 'active_wallets',
        threshold, actual_value: addrs,
      });
    }
  }

  // Deployment count milestones (every 10, starting at 40)
  const depMilestones = scoring.getDeploymentMilestones(deploymentCount);
  for (const threshold of depMilestones) {
    await db.insertMilestone({
      type: 'ecosystem', subject: null, metric: 'deployment_count',
      threshold, actual_value: deploymentCount,
    });
  }
}

// --- MegaMafia Flag Sync ---

async function syncMegaMafiaFlags() {
  const handles = [...scoring.MEGAMAFIA_PROJECTS];
  await db.bulkSetMegamafia(handles);
  const flagged = await db.getMegaMafiaCount();
  log(`  MegaMafia flags synced: ${flagged} projects`);
}

// --- Per-Project Enrichment ---

async function enrichProjects() {
  const projects = await db.getDeploymentsForEnrichment();
  const withAddr = projects.filter(p => p.contract_address).length;
  const slugOnly = projects.length - withAddr;
  log(`Enriching ${projects.length} projects (${withAddr} with address, ${slugOnly} DeFiLlama-slug-only)...`);

  // Get ecosystem TVL for scoring
  const latestEco = await db.getLatestEcosystemMetrics();
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
  const USDM_ADDRESS = '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7'; // $USDM token
  let txCount = null;
  let balanceEth = null;
  let balanceWei = null;
  let isVerified = null;
  let tvlUsd = null;
  let usdmBalance = null;

  // Blockscout address info — requires contract address
  if (addr) {
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
  }

  // DeFiLlama TVL — uses slug or fuzzy name match, no address needed
  tvlUsd = ds.getProtocolTvlForProject(protocols, project.project, project.defillama_slug);

  // USDM balance held in this contract — requires contract address
  if (addr) {
    try {
      usdmBalance = await ds.rpcERC20BalanceOf(USDM_ADDRESS, addr, 18);
      if (usdmBalance === 0) usdmBalance = null; // treat zero as absent for scoring
    } catch (err) {
      // silent — most contracts won't hold USDM
    }
  }

  // Contract verification — requires contract address
  if (addr) {
    try {
      const contract = await ds.blockscoutGetContract(addr);
      isVerified = contract && contract.is_verified ? 1 : 0;
      if (isVerified !== project.contract_verified) {
        await db.updateDeployment(project.id, { contract_verified: isVerified });
      }
    } catch (err) {
      // 404 = not verified, not an error
      isVerified = 0;
    }
  }

  // Compute deltas from previous snapshot
  const prev = await db.getLatestProjectMetrics(project.id);
  const txCountDelta = (txCount != null && prev?.tx_count != null) ? txCount - prev.tx_count : null;
  const balanceEthDelta = (balanceEth != null && prev?.balance_eth != null) ? balanceEth - prev.balance_eth : null;
  const usdmBalanceDelta = (usdmBalance != null && prev?.usdm_balance != null) ? usdmBalance - prev.usdm_balance : null;

  // Compute 7-day average for scoring
  const history = await db.getProjectMetricsHistory(project.id, 14); // ~7 days at 2x/day
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
    balance_eth_delta: balanceEthDelta,
    tx_count: txCount,
    defillama_listed: tvlUsd != null,
    usdm_balance: usdmBalance,
    usdm_balance_delta: usdmBalanceDelta,
    megamafia: project.megamafia === 1,
    project: project.project,        // allows MEGAMAFIA_PROJECTS set lookup as fallback
    snapshot_interval_minutes: 30,   // enrichment cron cadence
  });

  await db.insertProjectMetrics({
    deployment_id: project.id,
    tvl_usd: tvlUsd,
    tx_count: txCount,
    tx_count_delta: txCountDelta,
    balance_wei: balanceWei,
    balance_eth: balanceEth,
    is_verified: isVerified,
    score,
    classification,
    usdm_balance: usdmBalance,
    balance_eth_delta: balanceEthDelta,
    usdm_balance_delta: usdmBalanceDelta,
  });

  const usdmStr = usdmBalance != null ? ` usdm=${scoring.formatNumber(usdmBalance)}` : '';
  const feeEthStr = balanceEthDelta != null && balanceEthDelta > 0 ? ` fee_eth=+${balanceEthDelta.toFixed(4)}` : '';
  const feeUsdmStr = usdmBalanceDelta != null && usdmBalanceDelta > 0 ? ` fee_usdm=+${scoring.formatNumber(usdmBalanceDelta)}` : '';
  log(`  @${project.project}: score=${score} [${classification}] tvl=${tvlUsd ? '$' + scoring.formatNumber(tvlUsd) : 'N/A'} txs=${txCount || 'N/A'}${usdmStr}${feeEthStr}${feeUsdmStr}`);

  // Check project milestones
  await checkProjectMilestones(project, tvlUsd, txCount);
}

async function checkProjectMilestones(project, tvlUsd, txCount) {
  if (tvlUsd) {
    const crossed = scoring.getCrossedThresholds(tvlUsd, scoring.PROJECT_TVL_THRESHOLDS);
    for (const threshold of crossed) {
      await db.insertMilestone({
        type: 'project', subject: project.project, metric: 'tvl',
        threshold, actual_value: tvlUsd,
      });
    }
  }
}

// --- Stablecoin Enrichment ---

const STABLECOINS = [
  { symbol: 'USDM', address: '0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7', decimals: 18 },
  { symbol: 'CUSD', address: '0xcCcc62962d17b8914c62D74FfB843d73B2a3cccC', decimals: 18, stakedAddress: '0x88887bE419578051FF9F4eb6C858A951921D8888' },
  { symbol: 'stcUSD', address: '0x88887bE419578051FF9F4eb6C858A951921D8888', decimals: 18 },
];

async function enrichStablecoins() {
  log('Enriching stablecoin metrics...');

  for (const token of STABLECOINS) {
    try {
      let totalSupply = null;
      let stakedSupply = null;
      let circulatingSupply = null;
      let holderCount = null;
      let transferCount = null;

      // Total supply via RPC eth_call
      try {
        totalSupply = await ds.rpcERC20TotalSupply(token.address, token.decimals);
      } catch (err) {
        log(`  ${token.symbol} totalSupply RPC failed: ${err.message}`, 'WARN');
      }

      // For CUSD: get CUSD locked in staking contract via balanceOf(sCUSD_address)
      if (token.symbol === 'CUSD' && token.stakedAddress) {
        try {
          stakedSupply = await ds.rpcERC20BalanceOf(token.address, token.stakedAddress, token.decimals);
          circulatingSupply = totalSupply != null ? totalSupply - stakedSupply : null;
        } catch (err) {
          log(`  CUSD staked balance RPC failed: ${err.message}`, 'WARN');
          circulatingSupply = totalSupply;
        }
      } else {
        circulatingSupply = totalSupply;
      }

      // Holder count + transfer count from Blockscout token endpoint
      try {
        const tokenInfo = await ds.blockscoutGetTokenInfo(token.address);
        holderCount = parseInt(tokenInfo.holders ?? tokenInfo.holders_count) || null;
        transferCount = parseInt(tokenInfo.transfers_count ?? tokenInfo.transfer_count) || null;
        // Blockscout may return total_supply in raw units — prefer our RPC value
        if (totalSupply == null && tokenInfo.total_supply) {
          const rawSupply = BigInt(tokenInfo.total_supply);
          const divisor = BigInt(10) ** BigInt(token.decimals);
          totalSupply = Number(rawSupply / divisor) + Number(rawSupply % divisor) / Math.pow(10, token.decimals);
          circulatingSupply = totalSupply;
        }
      } catch (err) {
        log(`  ${token.symbol} Blockscout token info failed: ${err.message}`, 'WARN');
      }

      // For USDM: sum usdm_balance already written to project_metrics this run
      // (enrichProjects runs before enrichStablecoins — no duplicate RPC calls needed)
      let appsDepositedUsdm = null;
      if (token.symbol === 'USDM') {
        appsDepositedUsdm = await db.getLatestUsdmDepositedSum();
        if (appsDepositedUsdm != null) {
          log(`  USDM in tracked apps (from project_metrics): ${scoring.formatNumber(appsDepositedUsdm)}`);
        }
      }

      // Delta in transfers since last snapshot
      const prev = await db.getLatestStablecoinMetrics(token.symbol);
      const transferDelta = (transferCount != null && prev?.transfer_count != null)
        ? transferCount - prev.transfer_count
        : null;

      await db.insertStablecoinMetrics({
        token_symbol: token.symbol,
        token_address: token.address,
        total_supply: totalSupply,
        staked_supply: stakedSupply,
        circulating_supply: circulatingSupply,
        holder_count: holderCount,
        transfer_count: transferCount,
        transfer_count_delta: transferDelta,
        apps_deposited_usdm: appsDepositedUsdm,
      });

      const supplyStr = totalSupply != null ? scoring.formatNumber(totalSupply) : 'N/A';
      const circStr = (circulatingSupply != null && token.symbol === 'CUSD')
        ? ` circ=${scoring.formatNumber(circulatingSupply)}`
        : '';
      log(`  $${token.symbol}: supply=${supplyStr}${circStr} holders=${holderCount ?? 'N/A'} transfers=${transferCount ?? 'N/A'}`);

      await ds.sleep(200);
    } catch (err) {
      log(`  Stablecoin enrichment failed for ${token.symbol}: ${err.message}`, 'WARN');
    }
  }
}

// --- Address Resolution for Unresolved Projects ---

async function resolveNewAddresses() {
  const unresolved = await db.getDeploymentsWithoutAddress();
  log(`Attempting address resolution for ${unresolved.length} projects...`);

  let resolved = 0;
  for (const project of unresolved) {
    try {
      const result = await ds.resolveContractAddress(project);
      if (result && result.address) {
        await db.updateDeployment(project.id, { contract_address: result.address });
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

// --- Heatmap Revalidation ---

async function notifyHeatmap() {
  const url = process.env.HEATMAP_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;
  try {
    await fetch(`${url}/api/revalidate?secret=${secret}`, { method: 'POST' });
    log('Notified heatmap to revalidate');
  } catch (err) {
    log(`Heatmap revalidation failed (non-fatal): ${err.message}`, 'WARN');
  }
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
    await syncMegaMafiaFlags();
  } catch (err) {
    log(`MegaMafia sync failed: ${err.message}`, 'ERROR');
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

  try {
    await enrichStablecoins();
  } catch (err) {
    log(`Stablecoin enrichment failed: ${err.message}`, 'ERROR');
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log(`=== Enrichment complete in ${elapsed}s ===`);

  await notifyHeatmap();
  await db.close();
}

main().catch(async err => {
  log(`Fatal enrichment error: ${err.message}`, 'FATAL');
  await db.close();
  process.exit(1);
});
