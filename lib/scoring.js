/**
 * Signal classification and scoring matrix
 * Scores projects 0-100, classifies as ALPHA/ROUTINE/WARNING/RISK
 *
 * Weight table (sums to exactly 100):
 *   tvl_relative     25  — highest signal: share of ecosystem TVL via DeFiLlama
 *                          NOTE: vault-mechanic projects (e.g. AVON) may not appear
 *                          on DeFiLlama; their locked value is captured instead via
 *                          usdm_balance and realtime_burst signals below.
 *   tx_activity      20  — delta vs 7d avg (sustained usage baseline)
 *   usdm_balance     20  — USDM held in contract (MegaETH KPI / TVL proxy for
 *                          non-DeFiLlama-listed vaults)
 *   realtime_burst   20  — txs/min in last snapshot window (throughput stress)
 *   contract_verified 5  — on-chain transparency
 *   defillama_listed  4  — external recognition bonus (not a gate)
 *   fee_proxy         3  — delta-based fee revenue proxy:
 *                          USDM balance delta (preferred) or ETH balance delta
 *                          between snapshots. Works for all project types.
 *   megamafia         3  — MegaETH-incubated project bonus
 *   [age_sustained removed — weak signal]
 *   [category_strength removed — category bias]
 */

// --- Scoring Weights ---

const WEIGHTS = {
  tvl_relative: 25,
  tx_activity: 20,
  usdm_balance: 20,
  realtime_burst: 20,
  contract_verified: 5,
  defillama_listed: 4,
  fee_proxy: 3,
  megamafia: 3,
};

// --- MegaMafia Projects ---
// Twitter handles of MegaETH-incubated / MegaMafia projects.
// Add new handles here as the programme grows.
const MEGAMAFIA_PROJECTS = new Set([
  'fasterdotfun',
  'smasherdotfun',
  'AveForge',
  'TopStrikeIO',
  'stompdotgg',
  'clutchpredict',
  'AiCrypts',
  'kumbaya_xyz',
  'OffshoreOnMega',
  'premarket_xyz',
  'PrismFi_',
  'SupernovaLabs_',
  'realtime_defi',
  'mrdn_finance',
  'avon_xyz',
  'wcm_inc',
  'SectorOneDEX',
  'warpexchange',
  'mtrkr_xyz',
  'thewarren_app',
  'hitdotone',
]);

// --- Classification Thresholds ---

function classify(score) {
  if (score >= 75) return 'ALPHA';
  if (score >= 40) return 'ROUTINE';
  if (score >= 20) return 'WARNING';
  return 'RISK';
}

// --- Score Computation ---

/**
 * @param {Object} params
 * @param {number|null} params.tvl_usd - Project TVL in USD
 * @param {number|null} params.ecosystem_tvl - Total ecosystem TVL in USD
 * @param {boolean} params.is_verified - Contract verified on Blockscout
 * @param {number|null} params.tx_count_delta - Tx count delta since last snapshot
 * @param {number|null} params.tx_count_7d_avg - 7-day average daily tx count
 * @param {number|null} params.balance_eth - Contract ETH balance (used for burst calc context)
 * @param {number|null} params.balance_eth_delta - ETH balance change since last snapshot (fee proxy)
 * @param {number|null} params.tx_count - Total tx count (for activity check)
 * @param {boolean} params.defillama_listed - Whether project is on DeFiLlama
 * @param {number|null} params.usdm_balance - USDM held in contract (token units)
 * @param {number|null} params.usdm_balance_delta - USDM balance change since last snapshot (fee proxy)
 * @param {boolean|number} params.megamafia - Whether project is MegaMafia-incubated
 * @param {string|null} [params.project] - Project handle (for MEGAMAFIA_PROJECTS lookup)
 * @param {number} [params.snapshot_interval_minutes=30] - Minutes between snapshots (for burst calc)
 * @returns {{ score: number, classification: string, breakdown: Object }}
 */
function scoreProject(params) {
  const breakdown = {};
  let total = 0;

  const intervalMins = params.snapshot_interval_minutes ?? 30;

  // 1. TVL relative to ecosystem (25 pts — highest signal)
  // Vault-mechanic projects not tracked by DeFiLlama (e.g. AVON) score 0 here
  // but are compensated through usdm_balance and realtime_burst.
  if (params.tvl_usd != null && params.ecosystem_tvl && params.ecosystem_tvl > 0) {
    const ratio = params.tvl_usd / params.ecosystem_tvl;
    let pts;
    if (ratio > 0.10) pts = 25;
    else if (ratio > 0.05) pts = 20;
    else if (ratio > 0.01) pts = 14;
    else if (ratio > 0.001) pts = 8;
    else pts = 4;
    breakdown.tvl_relative = pts;
    total += pts;
  } else {
    breakdown.tvl_relative = 0;
  }

  // 2. Contract verified (5 pts)
  if (params.is_verified) {
    breakdown.contract_verified = 5;
    total += 5;
  } else {
    breakdown.contract_verified = 0;
  }

  // 3. Tx activity — 24h delta vs 7d avg (20 pts)
  if (params.tx_count_delta != null && params.tx_count_7d_avg != null && params.tx_count_7d_avg > 0) {
    const ratio = params.tx_count_delta / params.tx_count_7d_avg;
    let pts;
    if (ratio > 2.0) pts = 20;
    else if (ratio > 1.5) pts = 16;
    else if (ratio > 1.0) pts = 12;
    else if (ratio > 0.5) pts = 8;
    else pts = 4;
    breakdown.tx_activity = pts;
    total += pts;
  } else if (params.tx_count != null && params.tx_count > 0) {
    breakdown.tx_activity = 4; // Has some activity
    total += 4;
  } else {
    breakdown.tx_activity = 0;
  }

  // 4. Fee proxy — delta-based revenue signal (3 pts)
  // Prefers USDM balance delta (higher-value signal for MegaETH ecosystem).
  // Falls back to ETH balance delta for protocols earning in ETH.
  // A growing balance between snapshots ≈ fee accumulation.
  {
    const usdmDelta = params.usdm_balance_delta;
    const ethDelta = params.balance_eth_delta;
    let pts = 0;
    if (usdmDelta != null && usdmDelta > 0) {
      // USDM delta branch — $100+ growth = full marks
      if (usdmDelta >= 100) pts = 3;
      else if (usdmDelta >= 10) pts = 2;
      else pts = 1;
    } else if (ethDelta != null && ethDelta > 0) {
      // ETH delta branch — 0.01+ ETH growth = full marks
      if (ethDelta >= 0.01) pts = 3;
      else if (ethDelta >= 0.001) pts = 2;
      else pts = 1;
    }
    breakdown.fee_proxy = pts;
    total += pts;
  }

  // 5. DeFiLlama listed (4 pts — bonus only)
  if (params.defillama_listed) {
    breakdown.defillama_listed = 4;
    total += 4;
  } else {
    breakdown.defillama_listed = 0;
  }

  // 6. USDM balance held in contract (20 pts) — MegaETH KPI alignment
  if (params.usdm_balance != null && params.usdm_balance > 0) {
    let pts;
    if (params.usdm_balance >= 100000) pts = 20;
    else if (params.usdm_balance >= 10000) pts = 15;
    else if (params.usdm_balance >= 1000) pts = 10;
    else if (params.usdm_balance >= 100) pts = 5;
    else pts = 2;
    breakdown.usdm_balance = pts;
    total += pts;
  } else {
    breakdown.usdm_balance = 0;
  }

  // 7. Real-time activity burst (20 pts) — txs/min in last snapshot window
  // Rewards high-frequency contracts that stress-test MegaETH throughput
  if (params.tx_count_delta != null && params.tx_count_delta > 0 && intervalMins > 0) {
    const txPerMin = params.tx_count_delta / intervalMins;
    let pts;
    if (txPerMin >= 100) pts = 20;
    else if (txPerMin >= 10) pts = 14;
    else if (txPerMin >= 1) pts = 8;
    else pts = 3;
    breakdown.realtime_burst = pts;
    total += pts;
  } else {
    breakdown.realtime_burst = 0;
  }

  // 8. MegaMafia / MegaETH-incubated (3 pts)
  // Accepts boolean param OR falls back to checking the project handle
  const isMegaMafia = params.megamafia
    || (params.project && MEGAMAFIA_PROJECTS.has(params.project));
  if (isMegaMafia) {
    breakdown.megamafia = 3;
    total += 3;
  } else {
    breakdown.megamafia = 0;
  }

  const score = Math.min(total, 100);
  return {
    score,
    classification: classify(score),
    breakdown,
  };
}

// --- Milestone Thresholds ---

const ECOSYSTEM_TVL_THRESHOLDS = [1e6, 5e6, 10e6, 25e6, 50e6, 100e6, 250e6, 500e6, 1e9];
const PROJECT_TVL_THRESHOLDS = [10e3, 50e3, 100e3, 500e3, 1e6, 5e6, 10e6];
const ECOSYSTEM_TXS_THRESHOLDS = [100e3, 500e3, 1e6, 5e6, 10e6, 50e6, 100e6, 500e6];
const ACTIVE_WALLETS_THRESHOLDS = [1e3, 5e3, 10e3, 50e3, 100e3, 500e3, 1e6];
const DEPLOYMENT_COUNT_INTERVAL = 10; // Every 10 deployments

/**
 * Check if a value crosses any thresholds in a list
 * @param {number} value - Current value
 * @param {number[]} thresholds - Sorted ascending thresholds
 * @returns {number[]} - Crossed thresholds
 */
function getCrossedThresholds(value, thresholds) {
  return thresholds.filter(t => value >= t);
}

/**
 * Check deployment count milestones (every 10: 40, 50, 60...)
 * @param {number} count - Current deployment count
 * @returns {number[]} - Milestone numbers crossed
 */
function getDeploymentMilestones(count) {
  const milestones = [];
  for (let i = DEPLOYMENT_COUNT_INTERVAL; i <= count; i += DEPLOYMENT_COUNT_INTERVAL) {
    if (i >= 40) milestones.push(i); // Start counting from 40 since we already have 36
  }
  return milestones;
}

function formatNumber(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
}

module.exports = {
  WEIGHTS,
  MEGAMAFIA_PROJECTS,
  classify,
  scoreProject,
  ECOSYSTEM_TVL_THRESHOLDS,
  PROJECT_TVL_THRESHOLDS,
  ECOSYSTEM_TXS_THRESHOLDS,
  ACTIVE_WALLETS_THRESHOLDS,
  DEPLOYMENT_COUNT_INTERVAL,
  getCrossedThresholds,
  getDeploymentMilestones,
  formatNumber,
};
