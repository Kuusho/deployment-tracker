#!/usr/bin/env node
/**
 * Bunny Intel - x402-Gated API Server
 *
 * Free endpoints:
 *   GET /health          - Health check
 *   GET /api/ecosystem   - Ecosystem stats snapshot
 *   GET /api/projects    - All projects (name, category, score only)
 *
 * Premium (x402 payment required):
 *   GET /api/deployments        - Full deployment data with enrichment
 *   GET /api/deployments/:id    - Specific project deep data
 *   GET /api/alpha              - Alpha signals feed
 *   GET /api/warnings           - Risk + warning projects
 *
 * Payment: 0.001 USDC on MegaETH per request
 * Recipient: PAN_WALLET_ADDRESS in .env
 *
 * Usage: node scripts/api-server.js
 * Port: 3042 (default) or API_PORT env var
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const db = require('../lib/db');
const { sql, ensureInit } = db;

// x402 — load conditionally (needs wallet setup first)
let paymentMiddleware = null;
let x402ResourceServer = null;
let HTTPFacilitatorClient = null;
let ExactEvmScheme = null;

try {
  const x402express = require('@x402/express');
  const x402server = require('@x402/core/server');
  const x402evm = require('@x402/evm');

  paymentMiddleware = x402express.paymentMiddleware;
  x402ResourceServer = x402express.x402ResourceServer;
  HTTPFacilitatorClient = x402server.HTTPFacilitatorClient;
  ExactEvmScheme = x402evm.ExactEvmScheme;

  console.log('✅ x402 payment middleware loaded');
} catch (e) {
  console.log('⚠️  x402 not available — running in free mode:', e.message);
}

const app = express();
const PORT = process.env.API_PORT || 3042;

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTVL(n) {
  if (!n) return null;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

async function getProjects(includeFullData = false) {
  if (includeFullData) {
    return sql`
      SELECT d.id, d.project, d.category, d.defillama_slug,
             pm.score, pm.classification, pm.tvl_usd, pm.snapshot_at,
             d.contract_address, pm.tx_count, pm.is_verified, pm.balance_eth
      FROM tracker_deployments d
      LEFT JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
      WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
         OR pm.id IS NULL
      ORDER BY pm.tvl_usd DESC NULLS LAST, pm.score DESC NULLS LAST
    `;
  }
  return sql`
    SELECT d.id, d.project, d.category, d.defillama_slug,
           pm.score, pm.classification, pm.tvl_usd, pm.snapshot_at
    FROM tracker_deployments d
    LEFT JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
       OR pm.id IS NULL
    ORDER BY pm.tvl_usd DESC NULLS LAST, pm.score DESC NULLS LAST
  `;
}

async function getEcosystemStats() {
  const rows = await sql`SELECT * FROM tracker_ecosystem_metrics ORDER BY snapshot_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

// ─── Free Endpoints ──────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  const [countRows, lastRows] = await Promise.all([
    sql`SELECT COUNT(*) as c FROM tracker_deployments`,
    sql`SELECT MAX(snapshot_at) as last FROM tracker_project_metrics`,
  ]);
  res.json({
    status: 'ok',
    service: 'Bunny Intel API',
    version: '0.1.0',
    chain: 'MegaETH (4326)',
    projects_tracked: parseInt(countRows[0].c),
    last_enrichment: lastRows[0].last,
    x402_enabled: !!paymentMiddleware,
    twitter: '@korewapandesu',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/ecosystem', async (req, res) => {
  const eco = await getEcosystemStats();
  if (!eco) return res.json({ error: 'no data yet' });

  res.json({
    total_tvl: eco.total_tvl,
    total_tvl_formatted: formatTVL(eco.total_tvl),
    block_number: null,
    txs_per_day: eco.txs_24h,
    unique_addresses: eco.total_addresses,
    avg_block_time_ms: eco.avg_block_time,
    captured_at: eco.snapshot_at,
    source: 'Bunny Intel (Alchemy + Blockscout + DeFiLlama)'
  });
});

app.get('/api/projects', async (req, res) => {
  // Public: name, category, score, classification only
  const projects = await getProjects(false);
  res.json({
    count: projects.length,
    projects: projects.map(p => ({
      project: p.project,
      category: p.category,
      score: p.score,
      classification: p.classification,
      tvl_formatted: formatTVL(p.tvl_usd),
      snapshot_at: p.snapshot_at
    }))
  });
});

// ─── Premium Endpoints (x402 gated) ─────────────────────────────────────────

// Setup payment middleware if available + wallet configured
if (paymentMiddleware && x402ResourceServer && process.env.PAN_WALLET_ADDRESS) {
  try {
    const facilitatorClient = new HTTPFacilitatorClient({
      url: 'https://facilitator.x402.org'
    });

    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register('eip155:4326', new ExactEvmScheme());

    console.log(`💰 x402 payment enabled → ${process.env.PAN_WALLET_ADDRESS}`);

    const paymentRoutes = {
      'GET /api/deployments': {
        accepts: {
          scheme: 'exact',
          price: '$0.001',
          network: 'eip155:4326',
          payTo: process.env.PAN_WALLET_ADDRESS,
        },
        description: 'MegaETH deployment data with full enrichment (Bunny Intel)'
      },
      'GET /api/alpha': {
        accepts: {
          scheme: 'exact',
          price: '$0.001',
          network: 'eip155:4326',
          payTo: process.env.PAN_WALLET_ADDRESS,
        },
        description: 'Alpha signals feed — high conviction signals only (Bunny Intel)'
      },
    };

    app.use(paymentMiddleware(paymentRoutes, resourceServer));
    console.log('✅ x402 middleware active');
  } catch (e) {
    console.log(`⚠️  x402 setup failed: ${e.message} — running without payment gate`);
  }
} else {
  console.log('ℹ️  x402 disabled — PAN_WALLET_ADDRESS not set or modules missing');
  if (!process.env.PAN_WALLET_ADDRESS) {
    console.log('   Run: node scripts/generate-wallet.js to create Pan\'s payment wallet');
  }
}

// Premium: Full deployment data
app.get('/api/deployments', async (req, res) => {
  const projects = await getProjects(true);
  const milestones = await sql`
    SELECT *, subject as project FROM tracker_milestones
    ORDER BY created_at DESC LIMIT 20
  `;

  res.json({
    count: projects.length,
    ecosystem: await getEcosystemStats(),
    recent_milestones: milestones,
    deployments: projects,
    powered_by: 'Bunny Intel',
    twitter: '@korewapandesu'
  });
});

app.get('/api/deployments/:project', async (req, res) => {
  const project = req.params.project.toLowerCase().replace('@', '');

  const rows = await sql`
    SELECT d.*, pm.score, pm.classification, pm.tvl_usd, pm.tx_count,
           pm.balance_eth, pm.is_verified, pm.snapshot_at,
           ar.result_address as resolved_address
    FROM tracker_deployments d
    LEFT JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    LEFT JOIN tracker_address_resolutions ar ON ar.deployment_id = d.id
    WHERE LOWER(d.project) LIKE ${'%' + project + '%'} OR LOWER(d.defillama_slug) LIKE ${'%' + project + '%'}
    ORDER BY pm.snapshot_at DESC
    LIMIT 1
  `;

  const data = rows[0] ?? null;
  if (!data) return res.status(404).json({ error: 'project not found' });

  const milestones = await sql`
    SELECT * FROM tracker_milestones WHERE subject = ${data.project} ORDER BY created_at DESC
  `;

  res.json({ ...data, milestones });
});

app.get('/api/alpha', async (req, res) => {
  const alpha = await sql`
    SELECT d.project, d.category, d.contract_address,
           pm.score, pm.classification, pm.tvl_usd, pm.tx_count, pm.snapshot_at
    FROM tracker_deployments d
    JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
      AND (pm.classification = 'ALPHA' OR pm.score >= 65)
    ORDER BY pm.score DESC
  `;

  const milestones = await sql`
    SELECT *, subject as project FROM tracker_milestones
    ORDER BY created_at DESC LIMIT 10
  `;

  res.json({
    alpha_projects: alpha,
    recent_milestones: milestones,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/warnings', async (req, res) => {
  const warnings = await sql`
    SELECT d.project, d.category, d.contract_address,
           pm.score, pm.classification, pm.tvl_usd, pm.snapshot_at
    FROM tracker_deployments d
    JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
      AND pm.classification IN ('WARNING', 'RISK')
    ORDER BY pm.score ASC
  `;

  res.json({
    count: warnings.length,
    warnings,
    disclaimer: 'Risk scores reflect data availability and contract verification status, not security audits'
  });
});

// ─── 404 ─────────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    available_endpoints: [
      'GET /health',
      'GET /api/ecosystem',
      'GET /api/projects',
      'GET /api/deployments (premium)',
      'GET /api/deployments/:project (premium)',
      'GET /api/alpha (premium)',
      'GET /api/warnings',
    ]
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await ensureInit();
  app.listen(PORT, () => {
    console.log(`\n🐰 Bunny Intel API running on port ${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log(`📦 Projects: http://localhost:${PORT}/api/projects`);
    console.log(`💰 x402 premium: ${paymentMiddleware && process.env.PAN_WALLET_ADDRESS ? 'ENABLED' : 'disabled (set PAN_WALLET_ADDRESS)'}`);
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start API server:', err.message);
  process.exit(1);
});

module.exports = app;
