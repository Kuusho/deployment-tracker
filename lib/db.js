/**
 * SQLite database layer via node:sqlite (built-in, Node 22+)
 * Singleton connection, WAL mode, synchronous API
 */

const { DatabaseSync } = require('node:sqlite');
// Shim: DatabaseSync uses .run() for exec and .prepare() like better-sqlite3
// but prepare() returns a StatementSync with compatible API
const path = require('path');
const fs = require('fs');

// Compatibility shim: node:sqlite uses DatabaseSync directly
// We wrap it to match better-sqlite3's API surface
class Database {
  constructor(filePath) {
    this._db = new DatabaseSync(filePath);
    this._db.exec('PRAGMA journal_mode = WAL');
    this._db.exec('PRAGMA foreign_keys = ON');
  }
  pragma(str) {
    this._db.exec(`PRAGMA ${str}`);
  }
  exec(sql) {
    this._db.exec(sql);
  }
  prepare(sql) {
    const stmt = this._db.prepare(sql);
    return {
      run: (...args) => stmt.run(...args),
      get: (...args) => stmt.get(...args),
      all: (...args) => stmt.all(...args),
    };
  }
  // Emulate better-sqlite3's transaction() — runs fn synchronously inside BEGIN/COMMIT
  transaction(fn) {
    return (...args) => {
      this._db.exec('BEGIN');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (err) {
        this._db.exec('ROLLBACK');
        throw err;
      }
    };
  }
  close() {
    this._db.close();
  }
}

const DB_PATH = path.join(__dirname, '..', 'data', 'tracker.db');
let _db = null;

function getDb() {
  if (_db) return _db;

  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project TEXT NOT NULL,
      url TEXT,
      tweet_text TEXT,
      created_at TEXT,
      contract_address TEXT,
      category TEXT,
      defillama_slug TEXT,
      contract_verified INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS project_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id TEXT NOT NULL REFERENCES deployments(id),
      tvl_usd REAL,
      tx_count INTEGER,
      tx_count_delta INTEGER,
      balance_wei TEXT,
      balance_eth REAL,
      is_verified INTEGER,
      score INTEGER,
      classification TEXT,
      snapshot_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ecosystem_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_tvl REAL,
      total_addresses INTEGER,
      total_txs INTEGER,
      txs_24h INTEGER,
      avg_gas_price TEXT,
      avg_block_time REAL,
      deployment_count INTEGER,
      snapshot_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      subject TEXT,
      metric TEXT NOT NULL,
      threshold REAL NOT NULL,
      actual_value REAL NOT NULL,
      alerted INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS address_resolutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deployment_id TEXT NOT NULL REFERENCES deployments(id),
      method TEXT NOT NULL,
      query TEXT,
      result_address TEXT,
      confidence REAL,
      success INTEGER DEFAULT 0,
      attempted_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_project_metrics_deployment ON project_metrics(deployment_id);
    CREATE INDEX IF NOT EXISTS idx_project_metrics_snapshot ON project_metrics(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_ecosystem_metrics_snapshot ON ecosystem_metrics(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_milestones_alerted ON milestones(alerted);
    CREATE INDEX IF NOT EXISTS idx_milestones_type ON milestones(type, metric, threshold);
    CREATE INDEX IF NOT EXISTS idx_deployments_contract ON deployments(contract_address);
  `);

  return _db;
}

// --- Deployments ---

function insertDeployment({ id, project, url, tweet_text, created_at, contract_address, category, defillama_slug }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO deployments (id, project, url, tweet_text, created_at, contract_address, category, defillama_slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(id, project, url, tweet_text, created_at, contract_address || null, category || null, defillama_slug || null);
}

function updateDeployment(id, fields) {
  const db = getDb();
  const allowed = ['contract_address', 'category', 'defillama_slug', 'contract_verified'];
  const sets = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE deployments SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function getDeployment(id) {
  return getDb().prepare('SELECT * FROM deployments WHERE id = ?').get(id);
}

function getAllDeployments() {
  return getDb().prepare('SELECT * FROM deployments ORDER BY created_at DESC').all();
}

function getDeploymentsWithAddress() {
  return getDb().prepare('SELECT * FROM deployments WHERE contract_address IS NOT NULL ORDER BY created_at DESC').all();
}

function getDeploymentsWithoutAddress() {
  return getDb().prepare('SELECT * FROM deployments WHERE contract_address IS NULL ORDER BY created_at DESC').all();
}

function getDeploymentCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM deployments').get().count;
}

// --- Project Metrics ---

function insertProjectMetrics({ deployment_id, tvl_usd, tx_count, tx_count_delta, balance_wei, balance_eth, is_verified, score, classification }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO project_metrics (deployment_id, tvl_usd, tx_count, tx_count_delta, balance_wei, balance_eth, is_verified, score, classification)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(deployment_id, tvl_usd ?? null, tx_count ?? null, tx_count_delta ?? null, balance_wei ?? null, balance_eth ?? null, is_verified ?? null, score ?? null, classification ?? null);
}

function getLatestProjectMetrics(deployment_id) {
  return getDb().prepare(`
    SELECT * FROM project_metrics WHERE deployment_id = ? ORDER BY snapshot_at DESC LIMIT 1
  `).get(deployment_id);
}

function getProjectMetricsHistory(deployment_id, limit = 48) {
  return getDb().prepare(`
    SELECT * FROM project_metrics WHERE deployment_id = ? ORDER BY snapshot_at DESC LIMIT ?
  `).all(deployment_id, limit);
}

// --- Ecosystem Metrics ---

function insertEcosystemMetrics({ total_tvl, total_addresses, total_txs, txs_24h, avg_gas_price, avg_block_time, deployment_count }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO ecosystem_metrics (total_tvl, total_addresses, total_txs, txs_24h, avg_gas_price, avg_block_time, deployment_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(total_tvl ?? null, total_addresses ?? null, total_txs ?? null, txs_24h ?? null, avg_gas_price ?? null, avg_block_time ?? null, deployment_count ?? null);
}

function getLatestEcosystemMetrics() {
  return getDb().prepare('SELECT * FROM ecosystem_metrics ORDER BY snapshot_at DESC LIMIT 1').get();
}

function getEcosystemMetricsHistory(limit = 48) {
  return getDb().prepare('SELECT * FROM ecosystem_metrics ORDER BY snapshot_at DESC LIMIT ?').all(limit);
}

// --- Milestones ---

function insertMilestone({ type, subject, metric, threshold, actual_value }) {
  const db = getDb();
  // Check if this exact milestone already exists
  const existing = db.prepare(`
    SELECT id FROM milestones WHERE type = ? AND metric = ? AND threshold = ? AND (subject = ? OR (subject IS NULL AND ? IS NULL))
  `).get(type, metric, threshold, subject, subject);
  if (existing) return existing;

  return db.prepare(`
    INSERT INTO milestones (type, subject, metric, threshold, actual_value)
    VALUES (?, ?, ?, ?, ?)
  `).run(type, subject ?? null, metric, threshold, actual_value);
}

function getUnalertedMilestones() {
  return getDb().prepare('SELECT * FROM milestones WHERE alerted = 0 ORDER BY created_at ASC').all();
}

function markMilestoneAlerted(id) {
  return getDb().prepare('UPDATE milestones SET alerted = 1 WHERE id = ?').run(id);
}

// --- Address Resolutions ---

function logAddressResolution({ deployment_id, method, query, result_address, confidence, success }) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO address_resolutions (deployment_id, method, query, result_address, confidence, success)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(deployment_id, method, query ?? null, result_address ?? null, confidence ?? null, success ? 1 : 0);
}

// --- Utilities ---

function getRecentDeployments(hours = 24) {
  return getDb().prepare(`
    SELECT * FROM deployments WHERE created_at >= datetime('now', '-' || ? || ' hours') ORDER BY created_at DESC
  `).all(hours);
}

function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  getDb,
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
  close,
};
