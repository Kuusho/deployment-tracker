#!/usr/bin/env node
'use strict';
const s = require('./lib/scoring');

const cases = [
    {
        label: '1. DeFi (aave) — TVL+listed, no USDM, moderate burst, no fee delta',
        params: { tvl_usd: 1e6, ecosystem_tvl: 10e6, is_verified: true, tx_count_delta: 200, tx_count_7d_avg: 100, balance_eth: 5, balance_eth_delta: 0, tx_count: 3000, defillama_listed: true, usdm_balance: null, usdm_balance_delta: null, megamafia: false, project: 'aave', snapshot_interval_minutes: 30 },
    },
    {
        label: '2. Gaming MegaMafia — 50k USDM, high burst, 500 USDM fee delta',
        params: { tvl_usd: null, ecosystem_tvl: 10e6, is_verified: true, tx_count_delta: 3000, tx_count_7d_avg: 100, balance_eth: 0.1, balance_eth_delta: 0, tx_count: 8000, defillama_listed: false, usdm_balance: 50000, usdm_balance_delta: 500, megamafia: true, project: 'smasherdotfun', snapshot_interval_minutes: 30 },
    },
    {
        label: '3. AVON vault — 100k USDM, no DeFiLlama, growing USDM (+1000), MegaMafia',
        params: { tvl_usd: null, ecosystem_tvl: 10e6, is_verified: true, tx_count_delta: 600, tx_count_7d_avg: 200, balance_eth: 2, balance_eth_delta: 0.02, tx_count: 5000, defillama_listed: false, usdm_balance: 100000, usdm_balance_delta: 1000, megamafia: true, project: 'avon_xyz', snapshot_interval_minutes: 30 },
    },
    {
        label: '4. Infra — no TVL, no USDM, earning ETH fees (+0.05 ETH delta)',
        params: { tvl_usd: null, ecosystem_tvl: 10e6, is_verified: true, tx_count_delta: 300, tx_count_7d_avg: 80, balance_eth: 1.2, balance_eth_delta: 0.05, tx_count: 1000, defillama_listed: false, usdm_balance: null, usdm_balance_delta: null, megamafia: false, project: 'birdeye_so', snapshot_interval_minutes: 30 },
    },
    {
        label: '5. Ghost — zero everything',
        params: { tvl_usd: null, ecosystem_tvl: 10e6, is_verified: false, tx_count_delta: 0, tx_count_7d_avg: 0, balance_eth: 0, balance_eth_delta: 0, tx_count: 0, defillama_listed: false, usdm_balance: null, usdm_balance_delta: null, megamafia: false, project: 'unknown', snapshot_interval_minutes: 30 },
    },
];

console.log('\n=== Scoring Trace ===\n');
for (const { label, params } of cases) {
    const r = s.scoreProject(params);
    console.log(`${label}`);
    console.log(`  score=${r.score}  class=${r.classification}`);
    console.log(`  breakdown: ${JSON.stringify(r.breakdown)}\n`);
}

const wSum = Object.values(s.WEIGHTS).reduce((a, b) => a + b, 0);
console.log(`Weights: ${JSON.stringify(s.WEIGHTS)}`);
console.log(`Weights sum: ${wSum} ${wSum === 100 ? '✓ OK' : '✗ MISMATCH'}`);
