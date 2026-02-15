#!/usr/bin/env node
/**
 * Bunny Intel - Telegram Bot with Slash Commands
 * 
 * Commands:
 *   /start    - Welcome + intro to Bunny Intel
 *   /status   - Live MegaETH ecosystem health snapshot
 *   /tvl      - Current TVL breakdown by protocol
 *   /top      - Top projects by signal score
 *   /alpha    - Latest alpha signals (ALPHA tier only)
 *   /warnings - Projects flagged WARNING or RISK
 *   /project  - Deep dive on specific project (/project kumbaya)
 *   /intel    - Latest enrichment run summary
 *   /help     - Command list
 * 
 * Premium (via x402 — coming soon):
 *   /realtime - Live deployment feed subscription
 *   /custom   - Custom alert filters
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TelegramBot = require('node-telegram-bot-api');
const db = require('../lib/db');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not set');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });
const conn = db.getDb();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTVL(n) {
  if (!n) return 'N/A';
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function classificationEmoji(c) {
  const map = { ALPHA: '🚀', ROUTINE: '🟢', WARNING: '⚠️', RISK: '🔴' };
  return map[c] || '⬜';
}

function getEcosystemStats() {
  const eco = conn.prepare(`
    SELECT * FROM ecosystem_metrics ORDER BY snapshot_at DESC LIMIT 1
  `).get();
  return eco;
}

function getTopProjects(limit = 10) {
  return conn.prepare(`
    SELECT d.project, d.category, 
           pm.score, pm.classification, pm.tvl_usd, pm.tx_count,
           pm.snapshot_at
    FROM deployments d
    LEFT JOIN project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
    ORDER BY pm.score DESC NULLS LAST, pm.tvl_usd DESC NULLS LAST
    LIMIT ?
  `).all(limit);
}

function getWarnings() {
  return conn.prepare(`
    SELECT d.project, d.category,
           pm.score, pm.classification, pm.tvl_usd,
           pm.snapshot_at
    FROM deployments d
    LEFT JOIN project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
      AND pm.classification IN ('WARNING', 'RISK')
    ORDER BY pm.score ASC NULLS LAST
    LIMIT 20
  `).all();
}

function getRecentMilestones(limit = 5) {
  return conn.prepare(`
    SELECT * FROM milestones
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
}

function getProjectBySlug(query) {
  const q = query.toLowerCase().replace('@', '');
  return conn.prepare(`
    SELECT d.*, pm.score, pm.classification, pm.tvl_usd, pm.tx_count, pm.is_verified,
           ar.address as resolved_address
    FROM deployments d
    LEFT JOIN project_metrics pm ON pm.deployment_id = d.id
    LEFT JOIN address_resolutions ar ON ar.deployment_id = d.id AND ar.success = 1
    WHERE LOWER(d.project) LIKE ? OR LOWER(d.defillama_slug) LIKE ?
    ORDER BY pm.snapshot_at DESC
    LIMIT 1
  `).get(`%${q}%`, `%${q}%`);
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function cmdStart(msg) {
  const name = msg.from?.first_name || 'anon';
  const text = `🐰 *Bunny Intel*

gm ${name}.

i'm pan. i track the megaeth ecosystem in real-time — contracts, TVL, deployments, behavioral signals.

the data powering @korewapandesu's posts lives here.

*what i can do:*
/status — ecosystem health snapshot
/tvl — protocol TVL breakdown  
/top — highest signal projects
/warnings — risk alerts
/alpha — alpha signals
/intel — latest enrichment summary
/help — all commands

bunny speed gud. 🐰`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdHelp(msg) {
  const text = `🐰 *Bunny Intel Commands*

*Data:*
/status — ecosystem snapshot
/tvl — TVL by protocol
/top — top projects by score
/warnings — WARNING + RISK alerts
/alpha — alpha-tier signals
/intel — enrichment run summary
/project [name] — deep dive

*Info:*
/start — intro
/help — this message

_premium tier (x402) coming soon_`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdStatus(msg) {
  const eco = getEcosystemStats();

  let text = `📊 *MegaETH Ecosystem — Live Snapshot*\n\n`;

  if (eco) {
    const ts = new Date(eco.snapshot_at).toLocaleString('en-US', { 
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', 
      timeZone: 'UTC' 
    });
    text += `🕐 \`${ts} UTC\`\n\n`;
    if (eco.total_tvl) text += `💰 *TVL:* ${formatTVL(eco.total_tvl)}\n`;
    if (eco.total_addresses) text += `👤 *Addresses:* ${Number(eco.total_addresses).toLocaleString()}\n`;
    if (eco.txs_24h) text += `⚡ *Txs/24h:* ${Number(eco.txs_24h).toLocaleString()}\n`;
    if (eco.avg_block_time) text += `⏱️ *Block time:* ${eco.avg_block_time}ms\n`;
  } else {
    text += `_no data yet — run enrichment first_\n`;
  }

  // Count projects by classification
  const counts = conn.prepare(`
    SELECT pm.classification, COUNT(*) as cnt
    FROM project_metrics pm
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
    GROUP BY pm.classification
  `).all();

  if (counts.length > 0) {
    text += `\n*Signal breakdown:*\n`;
    for (const c of counts) {
      text += `${classificationEmoji(c.classification)} ${c.classification}: ${c.cnt}\n`;
    }
  }

  text += `\n_tracking ${conn.prepare('SELECT COUNT(*) as c FROM deployments').get().c} projects_`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdTVL(msg) {
  const projects = conn.prepare(`
    SELECT d.project, d.category, pm.tvl_usd, pm.classification, pm.score
    FROM deployments d
    JOIN project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
      AND pm.tvl_usd > 0
    ORDER BY pm.tvl_usd DESC
    LIMIT 15
  `).all();

  if (projects.length === 0) {
    await bot.sendMessage(msg.chat.id, '⬜ no TVL data yet');
    return;
  }

  const totalTVL = projects.reduce((s, p) => s + (p.tvl_usd || 0), 0);
  let text = `💰 *MegaETH TVL Breakdown*\n_total: ${formatTVL(totalTVL)}_\n\n`;

  for (const p of projects) {
    const pct = totalTVL > 0 ? ((p.tvl_usd / totalTVL) * 100).toFixed(1) : '0';
    text += `${classificationEmoji(p.classification)} \`@${p.project}\` — *${formatTVL(p.tvl_usd)}* (${pct}%)\n`;
  }

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdTop(msg) {
  const projects = getTopProjects(10);
  const scored = projects.filter(p => p.score !== null);

  if (scored.length === 0) {
    await bot.sendMessage(msg.chat.id, '⬜ no scored projects yet — run enrichment');
    return;
  }

  let text = `🏆 *Top Projects by Signal Score*\n\n`;
  for (const p of scored) {
    text += `${classificationEmoji(p.classification)} *${p.score}* \`@${p.project}\``;
    if (p.tvl_usd) text += ` — ${formatTVL(p.tvl_usd)}`;
    text += `\n`;
  }

  text += `\n_score: 0-100 | ALPHA >70 | ROUTINE 40-70 | WARNING 20-40 | RISK <20_`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdWarnings(msg) {
  const warnings = getWarnings();

  if (warnings.length === 0) {
    await bot.sendMessage(msg.chat.id, '✅ no warnings or risks detected');
    return;
  }

  let text = `⚠️ *Warning & Risk Flags*\n\n`;
  for (const p of warnings) {
    text += `${classificationEmoji(p.classification)} \`@${p.project}\``;
    text += ` score=${p.score || 'N/A'}`;
    if (p.tvl_usd) text += ` tvl=${formatTVL(p.tvl_usd)}`;
    text += `\n`;
  }

  text += `\n_low scores = unverified contracts, no TVL, no tx data_\n_not financial advice — always verify_`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdAlpha(msg) {
  // Alpha = score > 70 OR massive TVL change
  const alphaProjects = conn.prepare(`
    SELECT d.project, d.category, pm.score, pm.tvl_usd, pm.classification
    FROM deployments d
    JOIN project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
      AND (pm.classification = 'ALPHA' OR pm.score >= 65)
    ORDER BY pm.score DESC
    LIMIT 10
  `).all();

  const milestones = getRecentMilestones(5);

  let text = `🚀 *Alpha Signals*\n\n`;

  if (alphaProjects.length > 0) {
    text += `*High Signal Projects:*\n`;
    for (const p of alphaProjects) {
      text += `🚀 \`@${p.project}\` score=${p.score}`;
      if (p.tvl_usd) text += ` ${formatTVL(p.tvl_usd)}`;
      text += `\n`;
    }
    text += `\n`;
  }

  if (milestones.length > 0) {
    text += `*Recent Milestones:*\n`;
    for (const m of milestones) {
      const label = m.subject ? `@${m.subject}` : `ecosystem`;
      text += `⚡ \`${label}\` — ${m.metric} crossed ${formatTVL(m.threshold)}\n`;
    }
  }

  if (alphaProjects.length === 0 && milestones.length === 0) {
    text += `_no alpha signals detected yet — ecosystem is early_\n`;
    text += `_sectorone dlmm +39,031% 7d is the standout signal this week_`;
  }

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdIntel(msg) {
  const latestMetrics = conn.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN classification='ALPHA' THEN 1 ELSE 0 END) as alpha,
           SUM(CASE WHEN classification='ROUTINE' THEN 1 ELSE 0 END) as routine,
           SUM(CASE WHEN classification='WARNING' THEN 1 ELSE 0 END) as warning,
           SUM(CASE WHEN classification='RISK' THEN 1 ELSE 0 END) as risk,
           MAX(snapshot_at) as last_run,
           SUM(tvl_usd) as total_tvl
    FROM project_metrics pm
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
  `).get();

  const milestonesCount = conn.prepare('SELECT COUNT(*) as c FROM milestones').get();
  const resolvedCount = conn.prepare(`
    SELECT COUNT(DISTINCT project) as c FROM deployments WHERE contract_address IS NOT NULL
  `).get();

  let text = `🧠 *Bunny Intel — Enrichment Summary*\n\n`;
  
  const lastRun = conn.prepare('SELECT MAX(snapshot_at) as last FROM project_metrics').get();
  if (lastRun?.last) {
    text += `🕐 Last run: \`${lastRun.last}\`\n\n`;
  }

  text += `*Coverage:*\n`;
  text += `📦 Projects tracked: ${latestMetrics.total}\n`;
  text += `🔗 Addresses resolved: ${resolvedCount.c}\n`;
  text += `⚡ Milestones detected: ${milestonesCount.c}\n\n`;

  text += `*Signal Distribution:*\n`;
  if (latestMetrics.alpha > 0) text += `🚀 ALPHA: ${latestMetrics.alpha}\n`;
  text += `🟢 ROUTINE: ${latestMetrics.routine || 0}\n`;
  text += `⚠️ WARNING: ${latestMetrics.warning || 0}\n`;
  text += `🔴 RISK: ${latestMetrics.risk || 0}\n\n`;

  if (latestMetrics.total_tvl) {
    text += `💰 Total TVL tracked: ${formatTVL(latestMetrics.total_tvl)}\n`;
  }

  text += `\n_data powered by Alchemy, Blockscout, DeFiLlama, miniblocks.io_`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdProject(msg, args) {
  if (!args || args.length === 0) {
    await bot.sendMessage(msg.chat.id, 'Usage: /project [name]\nExample: /project kumbaya');
    return;
  }

  const query = args.join(' ');
  const project = getProjectBySlug(query);

  if (!project) {
    await bot.sendMessage(msg.chat.id, `❌ project not found: \`${query}\`\n\nTry /top to see tracked projects`, { parse_mode: 'Markdown' });
    return;
  }

  let text = `📋 *@${project.project}*\n`;
  text += `_${project.category || 'unknown'}_\n\n`;

  if (project.score !== null) {
    text += `${classificationEmoji(project.classification)} *Score: ${project.score}* (${project.classification})\n\n`;
  }

  if (project.tvl_usd) text += `💰 TVL: ${formatTVL(project.tvl_usd)}\n`;
  if (project.tx_count) text += `⚡ Tx count: ${project.tx_count.toLocaleString()}\n`;

  const addr = project.contract_address || project.result_address;
  if (addr) {
    text += `\n🔗 Contract: \`${addr}\`\n`;
    text += `📊 [Blockscout](https://megaeth.blockscout.com/address/${addr})\n`;
  }

  if (project.defillama_slug) {
    text += `📈 [DeFiLlama](https://defillama.com/protocol/${project.defillama_slug})\n`;
  }

  if (project.is_verified) {
    text += `\n✅ Contract verified\n`;
  } else if (project.is_verified === 0) {
    text += `\n⚠️ Contract unverified\n`;
  }

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

// ─── Command Registry ────────────────────────────────────────────────────────

bot.onText(/\/start/, (msg) => cmdStart(msg).catch(e => log(`start error: ${e.message}`)));
bot.onText(/\/help/, (msg) => cmdHelp(msg).catch(e => log(`help error: ${e.message}`)));
bot.onText(/\/status/, (msg) => cmdStatus(msg).catch(e => log(`status error: ${e.message}`)));
bot.onText(/\/tvl/, (msg) => cmdTVL(msg).catch(e => log(`tvl error: ${e.message}`)));
bot.onText(/\/top/, (msg) => cmdTop(msg).catch(e => log(`top error: ${e.message}`)));
bot.onText(/\/warnings/, (msg) => cmdWarnings(msg).catch(e => log(`warnings error: ${e.message}`)));
bot.onText(/\/alpha/, (msg) => cmdAlpha(msg).catch(e => log(`alpha error: ${e.message}`)));
bot.onText(/\/intel/, (msg) => cmdIntel(msg).catch(e => log(`intel error: ${e.message}`)));
bot.onText(/\/project(?:\s+(.+))?/, (msg, match) => {
  const args = match[1] ? match[1].trim().split(/\s+/) : [];
  cmdProject(msg, args).catch(e => log(`project error: ${e.message}`));
});

// Register commands with Telegram BotFather API
async function registerCommands() {
  try {
    await bot.setMyCommands([
      { command: 'start', description: 'Welcome to Bunny Intel' },
      { command: 'status', description: 'Live ecosystem health snapshot' },
      { command: 'tvl', description: 'TVL breakdown by protocol' },
      { command: 'top', description: 'Top projects by signal score' },
      { command: 'warnings', description: 'WARNING and RISK alerts' },
      { command: 'alpha', description: 'Latest alpha signals' },
      { command: 'intel', description: 'Enrichment run summary' },
      { command: 'project', description: 'Deep dive on a project (/project kumbaya)' },
      { command: 'help', description: 'All commands' },
    ]);
    log('✅ Commands registered with Telegram');
  } catch (e) {
    log(`⚠️ Command registration failed: ${e.message}`);
  }
}

// Startup
log('🐰 Bunny Intel Telegram Bot starting...');
registerCommands();

bot.on('polling_error', (err) => {
  log(`Polling error: ${err.message}`, 'ERROR');
});

log(`✅ Bot running. Listening for commands...`);
log(`📢 Channel: ${CHANNEL_ID}`);

// Keep alive
process.on('SIGINT', () => {
  log('Shutting down...');
  bot.stopPolling();
  process.exit(0);
});
