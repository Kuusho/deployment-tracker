/**
 * Signal classification and scoring matrix
 * Scores projects 0-100, classifies as ALPHA/ROUTINE/WARNING/RISK
 */

// --- Scoring Weights ---

const WEIGHTS = {
  tvl_relative: 25,
  contract_verified: 15,
  tx_activity: 20,
  balance_health: 10,
  age_sustained: 5,
  category_strength: 10,
  defillama_listed: 15,
};

// --- Category Strength ---

const CATEGORY_SCORES = {
  defi: 10,
  oracle: 10,
  bridge: 9,
  infra: 8,
  trading: 7,
  launchpad: 6,
  gaming: 5,
  social: 4,
  nft: 4,
  other: 3,
};

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
 * @param {number|null} params.tx_count_delta - 24h tx count delta
 * @param {number|null} params.tx_count_7d_avg - 7-day average daily tx count
 * @param {number|null} params.balance_eth - Contract ETH balance
 * @param {string|null} params.created_at - Deployment creation timestamp
 * @param {number|null} params.tx_count - Total tx count (for activity check)
 * @param {string|null} params.category - Project category
 * @param {boolean} params.defillama_listed - Whether project is on DeFiLlama
 * @returns {{ score: number, classification: string, breakdown: Object }}
 */
function scoreProject(params) {
  const breakdown = {};
  let total = 0;

  // 1. TVL relative to ecosystem (25 pts)
  if (params.tvl_usd != null && params.ecosystem_tvl && params.ecosystem_tvl > 0) {
    const ratio = params.tvl_usd / params.ecosystem_tvl;
    let pts;
    if (ratio > 0.10) pts = 25;
    else if (ratio > 0.05) pts = 20;
    else if (ratio > 0.01) pts = 15;
    else if (ratio > 0.001) pts = 10;
    else pts = 5;
    breakdown.tvl_relative = pts;
    total += pts;
  } else {
    breakdown.tvl_relative = 0;
  }

  // 2. Contract verified (15 pts)
  if (params.is_verified) {
    breakdown.contract_verified = 15;
    total += 15;
  } else {
    breakdown.contract_verified = 0;
  }

  // 3. Tx activity - 24h delta vs 7d avg (20 pts)
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

  // 4. Balance health (10 pts)
  if (params.balance_eth != null) {
    let pts;
    if (params.balance_eth > 10) pts = 10;
    else if (params.balance_eth > 1) pts = 8;
    else if (params.balance_eth > 0.1) pts = 5;
    else if (params.balance_eth > 0) pts = 2;
    else pts = 0;
    breakdown.balance_health = pts;
    total += pts;
  } else {
    breakdown.balance_health = 0;
  }

  // 5. Age + sustained activity (5 pts)
  if (params.created_at) {
    const age = (Date.now() - new Date(params.created_at).getTime()) / (1000 * 60 * 60 * 24);
    const hasActivity = params.tx_count != null && params.tx_count > 0;
    let pts;
    if (age > 7 && hasActivity) pts = 5;
    else if (age > 3 && hasActivity) pts = 3;
    else if (age < 3) pts = 1;
    else pts = 0; // Ghost: old but no activity
    breakdown.age_sustained = pts;
    total += pts;
  } else {
    breakdown.age_sustained = 0;
  }

  // 6. Category strength (10 pts)
  const cat = (params.category || 'other').toLowerCase();
  const catScore = CATEGORY_SCORES[cat] || CATEGORY_SCORES.other;
  breakdown.category_strength = catScore;
  total += catScore;

  // 7. DeFiLlama listed (15 pts)
  if (params.defillama_listed) {
    breakdown.defillama_listed = 15;
    total += 15;
  } else {
    breakdown.defillama_listed = 0;
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
  CATEGORY_SCORES,
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
