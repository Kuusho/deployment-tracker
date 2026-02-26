/**
 * Postgres database layer via postgres npm package (async)
 * Singleton connection pool, tables created lazily on first use.
 *
 * Table names are prefixed with tracker_ to avoid collisions with
 * other tables in the shared Supabase instance.
 *
 * Boolean-like flag columns (megamafia, contract_verified, is_verified,
 * alerted, success) are stored as SMALLINT (0/1) so callers that use
 * === 0 / === 1 comparisons continue to work without changes.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);
let _initialized = false;

async function ensureInit() {
  if (_initialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS tracker_deployments (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      url TEXT,
      tweet_text TEXT,
      created_at TIMESTAMPTZ,
      contract_address TEXT,
      category TEXT,
      defillama_slug TEXT,
      contract_verified SMALLINT DEFAULT 0,
      megamafia SMALLINT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tracker_project_metrics (
      id SERIAL PRIMARY KEY,
      deployment_id TEXT NOT NULL REFERENCES tracker_deployments(id),
      tvl_usd REAL,
      tx_count INTEGER,
      tx_count_delta INTEGER,
      balance_wei TEXT,
      balance_eth REAL,
      is_verified SMALLINT,
      score INTEGER,
      classification TEXT,
      usdm_balance REAL,
      balance_eth_delta REAL,
      usdm_balance_delta REAL,
      snapshot_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tpm_deployment ON tracker_project_metrics(deployment_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tpm_snapshot   ON tracker_project_metrics(snapshot_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS tracker_ecosystem_metrics (
      id SERIAL PRIMARY KEY,
      total_tvl REAL,
      total_addresses INTEGER,
      total_txs INTEGER,
      txs_24h INTEGER,
      avg_gas_price TEXT,
      avg_block_time REAL,
      deployment_count INTEGER,
      snapshot_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tem_snapshot ON tracker_ecosystem_metrics(snapshot_at DESC)`;

  await sql`
    CREATE TABLE IF NOT EXISTS tracker_milestones (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      subject TEXT,
      metric TEXT NOT NULL,
      threshold REAL NOT NULL,
      actual_value REAL NOT NULL,
      alerted SMALLINT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tm_alerted ON tracker_milestones(alerted)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tm_type    ON tracker_milestones(type, metric, threshold)`;

  await sql`
    CREATE TABLE IF NOT EXISTS tracker_address_resolutions (
      id SERIAL PRIMARY KEY,
      deployment_id TEXT NOT NULL REFERENCES tracker_deployments(id),
      method TEXT NOT NULL,
      query TEXT,
      result_address TEXT,
      confidence REAL,
      success SMALLINT DEFAULT 0,
      attempted_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tracker_stablecoin_metrics (
      id SERIAL PRIMARY KEY,
      token_symbol TEXT NOT NULL,
      token_address TEXT NOT NULL,
      total_supply REAL,
      staked_supply REAL,
      circulating_supply REAL,
      holder_count INTEGER,
      transfer_count INTEGER,
      transfer_count_delta INTEGER,
      apps_deposited_usdm REAL,
      snapshot_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tsm_symbol ON tracker_stablecoin_metrics(token_symbol, snapshot_at DESC)`;

  _initialized = true;
}

// --- Deployments ---

async function insertDeployment({ id, project, url, tweet_text, created_at, contract_address, category, defillama_slug, megamafia = 0 }) {
  await ensureInit();
  await sql`
    INSERT INTO tracker_deployments
      (id, project, url, tweet_text, created_at, contract_address, category, defillama_slug, megamafia)
    VALUES
      (${id}, ${project}, ${url ?? null}, ${tweet_text ?? null}, ${created_at ?? null},
       ${contract_address ?? null}, ${category ?? null}, ${defillama_slug ?? null}, ${megamafia ? 1 : 0})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function updateDeployment(id, fields) {
  await ensureInit();
  const allowed = ['contract_address', 'category', 'defillama_slug', 'contract_verified', 'megamafia'];
  const updates = {};
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) updates[key] = val;
  }
  if (Object.keys(updates).length === 0) return;
  updates.updated_at = new Date();
  await sql`UPDATE tracker_deployments SET ${sql(updates)} WHERE id = ${id}`;
}

async function getDeployment(id) {
  await ensureInit();
  const rows = await sql`SELECT * FROM tracker_deployments WHERE id = ${id}`;
  return rows[0] ?? null;
}

async function getAllDeployments() {
  await ensureInit();
  return sql`SELECT * FROM tracker_deployments ORDER BY created_at DESC`;
}

async function getDeploymentsWithAddress() {
  await ensureInit();
  return sql`SELECT * FROM tracker_deployments WHERE contract_address IS NOT NULL ORDER BY created_at DESC`;
}

async function getDeploymentsWithoutAddress() {
  await ensureInit();
  return sql`SELECT * FROM tracker_deployments WHERE contract_address IS NULL ORDER BY created_at DESC`;
}

async function getDeploymentCount() {
  await ensureInit();
  const rows = await sql`SELECT COUNT(*) as count FROM tracker_deployments`;
  return parseInt(rows[0].count);
}

// --- Project Metrics ---

async function insertProjectMetrics({ deployment_id, tvl_usd, tx_count, tx_count_delta, balance_wei, balance_eth, is_verified, score, classification, usdm_balance, balance_eth_delta, usdm_balance_delta }) {
  await ensureInit();
  await sql`
    INSERT INTO tracker_project_metrics
      (deployment_id, tvl_usd, tx_count, tx_count_delta, balance_wei, balance_eth,
       is_verified, score, classification, usdm_balance, balance_eth_delta, usdm_balance_delta)
    VALUES
      (${deployment_id}, ${tvl_usd ?? null}, ${tx_count ?? null}, ${tx_count_delta ?? null},
       ${balance_wei ?? null}, ${balance_eth ?? null}, ${is_verified ?? null},
       ${score ?? null}, ${classification ?? null}, ${usdm_balance ?? null},
       ${balance_eth_delta ?? null}, ${usdm_balance_delta ?? null})
  `;
}

async function getLatestProjectMetrics(deployment_id) {
  await ensureInit();
  const rows = await sql`
    SELECT * FROM tracker_project_metrics
    WHERE deployment_id = ${deployment_id}
    ORDER BY snapshot_at DESC LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getProjectMetricsHistory(deployment_id, limit = 48) {
  await ensureInit();
  return sql`
    SELECT * FROM tracker_project_metrics
    WHERE deployment_id = ${deployment_id}
    ORDER BY snapshot_at DESC LIMIT ${limit}
  `;
}

// --- Ecosystem Metrics ---

async function insertEcosystemMetrics({ total_tvl, total_addresses, total_txs, txs_24h, avg_gas_price, avg_block_time, deployment_count }) {
  await ensureInit();
  await sql`
    INSERT INTO tracker_ecosystem_metrics
      (total_tvl, total_addresses, total_txs, txs_24h, avg_gas_price, avg_block_time, deployment_count)
    VALUES
      (${total_tvl ?? null}, ${total_addresses ?? null}, ${total_txs ?? null}, ${txs_24h ?? null},
       ${avg_gas_price ?? null}, ${avg_block_time ?? null}, ${deployment_count ?? null})
  `;
}

async function getLatestEcosystemMetrics() {
  await ensureInit();
  const rows = await sql`SELECT * FROM tracker_ecosystem_metrics ORDER BY snapshot_at DESC LIMIT 1`;
  return rows[0] ?? null;
}

async function getEcosystemMetricsHistory(limit = 48) {
  await ensureInit();
  return sql`SELECT * FROM tracker_ecosystem_metrics ORDER BY snapshot_at DESC LIMIT ${limit}`;
}

// --- Milestones ---

async function insertMilestone({ type, subject, metric, threshold, actual_value }) {
  await ensureInit();
  // Return existing row if this milestone was already recorded (dedup by type+metric+threshold+subject)
  const existing = await sql`
    SELECT id FROM tracker_milestones
    WHERE type = ${type} AND metric = ${metric} AND threshold = ${threshold}
      AND (subject = ${subject ?? null} OR (subject IS NULL AND ${subject ?? null} IS NULL))
  `;
  if (existing.length > 0) return existing[0];

  const rows = await sql`
    INSERT INTO tracker_milestones (type, subject, metric, threshold, actual_value)
    VALUES (${type}, ${subject ?? null}, ${metric}, ${threshold}, ${actual_value})
    RETURNING *
  `;
  return rows[0];
}

async function getUnalertedMilestones() {
  await ensureInit();
  return sql`SELECT * FROM tracker_milestones WHERE alerted = 0 ORDER BY created_at ASC`;
}

async function markMilestoneAlerted(id) {
  await ensureInit();
  await sql`UPDATE tracker_milestones SET alerted = 1 WHERE id = ${id}`;
}

// --- Address Resolutions ---

async function logAddressResolution({ deployment_id, method, query, result_address, confidence, success }) {
  await ensureInit();
  await sql`
    INSERT INTO tracker_address_resolutions
      (deployment_id, method, query, result_address, confidence, success)
    VALUES
      (${deployment_id}, ${method}, ${query ?? null}, ${result_address ?? null},
       ${confidence ?? null}, ${success ? 1 : 0})
  `;
}

// --- Stablecoin Metrics ---

async function insertStablecoinMetrics({ token_symbol, token_address, total_supply, staked_supply, circulating_supply, holder_count, transfer_count, transfer_count_delta, apps_deposited_usdm }) {
  await ensureInit();
  await sql`
    INSERT INTO tracker_stablecoin_metrics
      (token_symbol, token_address, total_supply, staked_supply, circulating_supply,
       holder_count, transfer_count, transfer_count_delta, apps_deposited_usdm)
    VALUES
      (${token_symbol}, ${token_address}, ${total_supply ?? null}, ${staked_supply ?? null},
       ${circulating_supply ?? null}, ${holder_count ?? null}, ${transfer_count ?? null},
       ${transfer_count_delta ?? null}, ${apps_deposited_usdm ?? null})
  `;
}

async function getLatestStablecoinMetrics(symbol) {
  await ensureInit();
  const rows = await sql`
    SELECT * FROM tracker_stablecoin_metrics
    WHERE token_symbol = ${symbol} ORDER BY snapshot_at DESC LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getAllLatestStablecoinMetrics() {
  await ensureInit();
  // DISTINCT ON (token_symbol) gives one row per token — the most recent
  return sql`
    SELECT DISTINCT ON (token_symbol) *
    FROM tracker_stablecoin_metrics
    ORDER BY token_symbol, snapshot_at DESC
  `;
}

async function getStablecoinMetricsHistory(symbol, limit = 48) {
  await ensureInit();
  return sql`
    SELECT * FROM tracker_stablecoin_metrics
    WHERE token_symbol = ${symbol} ORDER BY snapshot_at DESC LIMIT ${limit}
  `;
}

// --- Utilities ---

async function getRecentDeployments(hours = 24) {
  await ensureInit();
  return sql`
    SELECT * FROM tracker_deployments
    WHERE created_at >= now() - make_interval(hours => ${hours})
    ORDER BY created_at DESC
  `;
}

async function close() {
  await sql.end();
}

// --- Extended helpers for callers that previously used getDb() directly ---

async function bulkSetMegamafia(handles) {
  if (!handles || handles.length === 0) return;
  await ensureInit();
  await sql`UPDATE tracker_deployments SET megamafia = 1 WHERE project = ANY(${handles})`;
}

async function getMegaMafiaCount() {
  await ensureInit();
  const rows = await sql`SELECT COUNT(*) as c FROM tracker_deployments WHERE megamafia = 1`;
  return parseInt(rows[0].c);
}

async function getLatestUsdmDepositedSum() {
  await ensureInit();
  const rows = await sql`
    SELECT SUM(usdm_balance) as total
    FROM tracker_project_metrics
    WHERE id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
      AND usdm_balance IS NOT NULL
  `;
  return rows[0]?.total ?? null;
}

async function getRecentMilestones(hours = 24) {
  await ensureInit();
  return sql`
    SELECT * FROM tracker_milestones
    WHERE created_at >= now() - make_interval(hours => ${hours})
    ORDER BY created_at DESC
  `;
}

async function getTopScoredProjects(limit = 5) {
  await ensureInit();
  return sql`
    SELECT d.project, d.category, pm.score, pm.classification, pm.tvl_usd, pm.tx_count
    FROM tracker_project_metrics pm
    JOIN tracker_deployments d ON d.id = pm.deployment_id
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
    ORDER BY pm.score DESC NULLS LAST
    LIMIT ${limit}
  `;
}

module.exports = {
  sql,
  ensureInit,
  insertDeployment,
  updateDeployment,
  getDeployment,
  getAllDeployments,
  getDeploymentsWithAddress,
  getDeploymentsWithoutAddress,
  getDeploymentCount,
  insertProjectMetrics,
  getLatestProjectMetrics,
  getProjectMetricsHistory,
  insertEcosystemMetrics,
  getLatestEcosystemMetrics,
  getEcosystemMetricsHistory,
  insertMilestone,
  getUnalertedMilestones,
  markMilestoneAlerted,
  logAddressResolution,
  getRecentDeployments,
  insertStablecoinMetrics,
  getLatestStablecoinMetrics,
  getAllLatestStablecoinMetrics,
  getStablecoinMetricsHistory,
  bulkSetMegamafia,
  getMegaMafiaCount,
  getLatestUsdmDepositedSum,
  getRecentMilestones,
  getTopScoredProjects,
  close,
};
