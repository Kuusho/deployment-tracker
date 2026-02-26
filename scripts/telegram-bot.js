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
 *   /brief    - AI-generated alpha brief (/brief or /brief [project])
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
const { sql, ensureInit } = db;
const narrator = require('../lib/narrator');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN not set');
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

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

function formatSupply(n) {
  if (n == null) return 'N/A';
  if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

function kpiBar(current, target, width = 10) {
  const pct = Math.min(current / target, 1);
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${(pct * 100).toFixed(1)}%`;
}

function classificationEmoji(c) {
  const map = { ALPHA: '🚀', ROUTINE: '🟢', WARNING: '⚠️', RISK: '🔴' };
  return map[c] || '⬜';
}

async function getEcosystemStats() {
  const rows = await sql`
    SELECT * FROM tracker_ecosystem_metrics ORDER BY snapshot_at DESC LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getTopProjects(limit = 10) {
  return sql`
    SELECT d.project, d.category, d.megamafia,
           pm.score, pm.classification, pm.tvl_usd, pm.tx_count, pm.usdm_balance,
           pm.snapshot_at
    FROM tracker_deployments d
    LEFT JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
    ORDER BY pm.score DESC NULLS LAST, pm.tvl_usd DESC NULLS LAST
    LIMIT ${limit}
  `;
}

async function getWarnings() {
  return sql`
    SELECT d.project, d.category,
           pm.score, pm.classification, pm.tvl_usd,
           pm.snapshot_at
    FROM tracker_deployments d
    LEFT JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
      AND pm.classification IN ('WARNING', 'RISK')
    ORDER BY pm.score ASC NULLS LAST
    LIMIT 20
  `;
}

async function getRecentMilestonesBot(limit = 5) {
  return sql`
    SELECT * FROM tracker_milestones
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

async function getProjectBySlug(query) {
  const q = query.toLowerCase().replace('@', '');
  const rows = await sql`
    SELECT d.*, pm.score, pm.classification, pm.tvl_usd, pm.tx_count, pm.is_verified,
           pm.usdm_balance, pm.usdm_balance_delta,
           ar.result_address as resolved_address
    FROM tracker_deployments d
    LEFT JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    LEFT JOIN tracker_address_resolutions ar ON ar.deployment_id = d.id AND ar.success = 1
    WHERE LOWER(d.project) LIKE ${'%' + q + '%'} OR LOWER(d.defillama_slug) LIKE ${'%' + q + '%'}
    ORDER BY pm.snapshot_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ─── Command Handlers ───────────────────────────────────────────────────────

async function cmdStart(msg) {
  const name = msg.from?.first_name || 'anon';
  const text = `🐰 *Bunny Intel*

gm ${name}.

i'm pan. i track the megaeth ecosystem in real-time — contracts, TVL, USDM flows, MegaMafia deployments, throughput signals.

the data powering @korewapandesu's posts lives here.

*what i can do:*
/status — ecosystem health snapshot
/tvl — protocol TVL breakdown
/stables — USDM + CUSD supply, circulation, staking
/top — highest signal projects
/warnings — risk alerts
/alpha — alpha signals
/intel — latest enrichment summary
/brief — AI alpha brief (ecosystem or project)
/help — all commands

bunny speed gud. 🐰`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdHelp(msg) {
  const text = `🐰 *Bunny Intel Commands*

*Data:*
/status — ecosystem snapshot
/tvl — TVL by protocol
/stables — USDM + CUSD supply & circulation
/top — top projects by score
/warnings — WARNING + RISK alerts
/alpha — alpha-tier signals
/intel — enrichment run summary
/project [name] — deep dive

*AI:*
/brief — alpha brief (or /brief [project])

*Info:*
/start — intro
/help — this message

_premium tier (x402) coming soon_`;

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdStatus(msg) {
  const eco = await getEcosystemStats();

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
  const counts = await sql`
    SELECT pm.classification, COUNT(*) as cnt
    FROM tracker_project_metrics pm
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
    GROUP BY pm.classification
  `;

  if (counts.length > 0) {
    text += `\n*Signal breakdown:*\n`;
    for (const c of counts) {
      text += `${classificationEmoji(c.classification)} ${c.classification}: ${c.cnt}\n`;
    }
  }

  const totalRows = await sql`SELECT COUNT(*) as c FROM tracker_deployments`;
  text += `\n_tracking ${totalRows[0].c} projects_`;

  // TGE KPI progress
  const usdm = await db.getLatestStablecoinMetrics('USDM');
  const cusd = await db.getLatestStablecoinMetrics('CUSD');
  const scusd = await db.getLatestStablecoinMetrics('stcUSD');

  text += `\n\n*TGE KPIs — Road to Token:*\n`;

  // KPI 1: Mafia apps — count known mafia handles present in our DB
  const MAFIA_HANDLES = ['capmoney_', 'kumbaya_xyz', 'Showdown_TCG', 'avon_xyz', 'PrismFi_', 'ubitelmobile'];
  const mafiaRows = await sql`
    SELECT COUNT(*) as c FROM tracker_deployments WHERE project = ANY(${MAFIA_HANDLES})
  `;
  const mafiaCount = parseInt(mafiaRows[0].c);
  text += `\n📱 *KPI 1 — Mafia Apps:*\n`;
  text += `  \`${mafiaCount}/10\` ${kpiBar(mafiaCount, 10)}\n`;

  // KPI 2: USDM $500M
  text += `\n💵 *KPI 2 — USDM $500M:*\n`;
  if (usdm?.total_supply != null) {
    const USDM_TARGET = 500_000_000;
    const APPS_TARGET = 125_000_000; // 25% of 500M
    text += `  Supply: \`${formatSupply(usdm.total_supply)}\` / 500M\n`;
    text += `  ${kpiBar(usdm.total_supply, USDM_TARGET)}\n`;
    if (usdm.apps_deposited_usdm != null) {
      const appsDepPct = usdm.total_supply > 0
        ? ((usdm.apps_deposited_usdm / usdm.total_supply) * 100).toFixed(1)
        : '0';
      text += `  In tracked apps: \`${formatSupply(usdm.apps_deposited_usdm)}\` (${appsDepPct}% of supply)\n`;
      text += `  vs 125M sub-target: ${kpiBar(usdm.apps_deposited_usdm, APPS_TARGET)}\n`;
    }
  } else {
    text += `  _no USDM data — run enrichment_\n`;
  }

  // KPI 3: Daily fees — not tracked
  text += `\n💸 *KPI 3 — Daily Fees ($50K × 30 days):*\n`;
  text += `  _not tracked — check megaeth.com/token_\n`;

  // CUSD + stcUSD summary
  if (cusd?.total_supply != null || scusd?.total_supply != null) {
    text += `\n💵 *Other stablecoins:*\n`;
    if (cusd?.circulating_supply != null) text += `  $CUSD circ: \`${formatSupply(cusd.circulating_supply)}\` (${cusd.holder_count?.toLocaleString() ?? 'N/A'} holders)\n`;
    if (scusd?.total_supply != null) text += `  $stcUSD: \`${formatSupply(scusd.total_supply)}\` staked (${scusd.holder_count?.toLocaleString() ?? 'N/A'} holders)\n`;
  }

  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdTVL(msg) {
  const projects = await sql`
    SELECT d.project, d.category, pm.tvl_usd, pm.classification, pm.score
    FROM tracker_deployments d
    JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
      AND pm.tvl_usd > 0
    ORDER BY pm.tvl_usd DESC
    LIMIT 15
  `;

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
  const projects = await getTopProjects(10);
  const scored = projects.filter(p => p.score !== null);

  if (scored.length === 0) {
    await bot.sendMessage(msg.chat.id, '⬜ no scored projects yet — run enrichment');
    return;
  }

  let text = `🏆 *Top Projects by Signal Score*\n\n`;
  for (const p of scored) {
    const mafia = p.megamafia ? ' ★' : '';
    text += `${classificationEmoji(p.classification)} *${p.score}* \`@${p.project}\`${mafia}`;
    if (p.tvl_usd) text += ` — ${formatTVL(p.tvl_usd)}`;
    if (p.usdm_balance >= 1000) text += ` 💵${formatSupply(p.usdm_balance)}`;
    text += `\n`;
  }

  text += `\n_score: 0-100 | ALPHA ≥75 | ROUTINE 40-74 | WARNING 20-39 | RISK <20_`;
  text += `\n_signals: TVL · tx activity · USDM held · throughput burst · fees · ★ MegaMafia_`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdWarnings(msg) {
  const warnings = await getWarnings();

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

  text += `\n_low scores = no tx activity, no USDM, no throughput burst — not financial advice_`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdAlpha(msg) {
  // High signal: ALPHA classification OR approaching (≥70) OR significant USDM held (≥10K)
  const alphaProjects = await sql`
    SELECT d.project, d.category, d.megamafia, pm.score, pm.tvl_usd, pm.classification,
           pm.usdm_balance, pm.tx_count
    FROM tracker_deployments d
    JOIN tracker_project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
      AND (pm.classification = 'ALPHA' OR pm.score >= 70 OR pm.usdm_balance >= 10000)
    ORDER BY pm.score DESC
    LIMIT 10
  `;

  const milestones = await getRecentMilestonesBot(5);

  let text = `🚀 *Alpha Signals*\n\n`;

  if (alphaProjects.length > 0) {
    text += `*High Signal Projects:*\n`;
    for (const p of alphaProjects) {
      const mafia = p.megamafia ? ' ★' : '';
      text += `🚀 \`@${p.project}\`${mafia} score=${p.score}`;
      if (p.tvl_usd) text += ` ${formatTVL(p.tvl_usd)}`;
      if (p.usdm_balance >= 1000) text += ` 💵${formatSupply(p.usdm_balance)}`;
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
  const latestMetrics = await sql`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN classification='ALPHA' THEN 1 ELSE 0 END) as alpha,
           SUM(CASE WHEN classification='ROUTINE' THEN 1 ELSE 0 END) as routine,
           SUM(CASE WHEN classification='WARNING' THEN 1 ELSE 0 END) as warning,
           SUM(CASE WHEN classification='RISK' THEN 1 ELSE 0 END) as risk,
           MAX(snapshot_at) as last_run,
           SUM(tvl_usd) as total_tvl
    FROM tracker_project_metrics pm
    WHERE pm.id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
  `;

  const milestonesCount = await sql`SELECT COUNT(*) as c FROM tracker_milestones`;
  const resolvedCount = await sql`
    SELECT COUNT(DISTINCT project) as c FROM tracker_deployments WHERE contract_address IS NOT NULL
  `;

  let text = `🧠 *Bunny Intel — Enrichment Summary*\n\n`;

  const lastRun = await sql`SELECT MAX(snapshot_at) as last FROM tracker_project_metrics`;
  if (lastRun[0]?.last) {
    text += `🕐 Last run: \`${lastRun[0].last}\`\n\n`;
  }

  const mafiaFlaggedRows = await sql`SELECT COUNT(*) as c FROM tracker_deployments WHERE megamafia = 1`;
  const usdmTotal = await sql`
    SELECT SUM(usdm_balance) as total FROM tracker_project_metrics
    WHERE id IN (SELECT MAX(id) FROM tracker_project_metrics GROUP BY deployment_id)
      AND usdm_balance IS NOT NULL
  `;

  const m = latestMetrics[0];
  text += `*Coverage:*\n`;
  text += `📦 Projects tracked: ${m.total}\n`;
  text += `🔗 Addresses resolved: ${resolvedCount[0].c}\n`;
  text += `★ MegaMafia flagged: ${mafiaFlaggedRows[0].c}\n`;
  text += `⚡ Milestones detected: ${milestonesCount[0].c}\n\n`;

  text += `*Signal Distribution:*\n`;
  if (m.alpha > 0) text += `🚀 ALPHA: ${m.alpha}\n`;
  text += `🟢 ROUTINE: ${m.routine || 0}\n`;
  text += `⚠️ WARNING: ${m.warning || 0}\n`;
  text += `🔴 RISK: ${m.risk || 0}\n\n`;

  if (m.total_tvl) {
    text += `💰 Total TVL tracked: ${formatTVL(m.total_tvl)}\n`;
  }
  if (usdmTotal[0]?.total) {
    text += `💵 USDM in tracked contracts: ${formatSupply(usdmTotal[0].total)}\n`;
  }

  text += `\n_signals: TVL · tx activity · USDM held · throughput burst · fee proxy · MegaMafia_`;
  text += `\n_sources: Alchemy RPC, Blockscout, DeFiLlama_`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

async function cmdProject(msg, args) {
  if (!args || args.length === 0) {
    await bot.sendMessage(msg.chat.id, 'Usage: /project [name]\nExample: /project kumbaya');
    return;
  }

  const query = args.join(' ');
  const project = await getProjectBySlug(query);

  if (!project) {
    await bot.sendMessage(msg.chat.id, `❌ project not found: \`${query}\`\n\nTry /top to see tracked projects`, { parse_mode: 'Markdown' });
    return;
  }

  const mafiaTag = project.megamafia ? ' ★ MegaMafia' : '';
  let text = `📋 *@${project.project}*${mafiaTag}\n`;
  text += `_${project.category || 'unknown'}_\n\n`;

  if (project.score !== null) {
    text += `${classificationEmoji(project.classification)} *Score: ${project.score}* (${project.classification})\n\n`;
  }

  if (project.tvl_usd) text += `💰 TVL: ${formatTVL(project.tvl_usd)}\n`;
  if (project.tx_count) text += `⚡ Tx count: ${project.tx_count.toLocaleString()}\n`;
  if (project.usdm_balance != null) {
    text += `💵 USDM held: \`${formatSupply(project.usdm_balance)}\``;
    if (project.usdm_balance_delta > 0) text += ` _(+${formatSupply(project.usdm_balance_delta)} last run)_`;
    text += `\n`;
  }

  const addr = project.contract_address || project.resolved_address;
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

async function cmdBrief(msg, args) {
  const chatId = msg.chat.id;

  // Show typing indicator while AI generates
  await bot.sendChatAction(chatId, 'typing');

  try {
    let text;

    if (args && args.length > 0) {
      // Project-specific brief
      const query = args.join(' ');
      const result = await narrator.generateProjectBrief(query);
      if (!result) {
        await bot.sendMessage(chatId, `❌ project not found: \`${query}\`\n\nTry /top to see tracked projects`, { parse_mode: 'Markdown' });
        return;
      }
      text = result;
    } else {
      // Full ecosystem brief
      text = await narrator.generateEcosystemBrief();
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    log(`brief error: ${e.message}`);

    if (e.message.includes('API key') || e.message.includes('authentication')) {
      await bot.sendMessage(chatId, '⚠️ narrator offline — API key not configured');
    } else {
      await bot.sendMessage(chatId, '⚠️ brief generation failed — try again in a moment');
    }
  }
}

async function cmdStables(msg) {
  const stables = await db.getAllLatestStablecoinMetrics();

  if (stables.length === 0) {
    await bot.sendMessage(msg.chat.id, '⬜ no stablecoin data yet — run enrichment first');
    return;
  }

  let text = `💵 *MegaETH Stablecoin Monitor*\n\n`;

  for (const s of stables) {
    const ts = new Date(s.snapshot_at).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: 'UTC'
    });

    text += `*$${s.token_symbol}*\n`;
    if (s.total_supply != null) text += `  📦 Total supply: \`${formatSupply(s.total_supply)}\`\n`;
    if (s.staked_supply != null) text += `  🔒 Staked (in stcUSD): \`${formatSupply(s.staked_supply)}\`\n`;
    if (s.circulating_supply != null && s.token_symbol === 'CUSD') {
      text += `  🔄 Circulating: \`${formatSupply(s.circulating_supply)}\`\n`;
    }
    if (s.holder_count != null) text += `  👤 Holders: ${Number(s.holder_count).toLocaleString()}\n`;
    if (s.transfer_count != null) {
      text += `  ⚡ Transfers: ${Number(s.transfer_count).toLocaleString()}`;
      if (s.transfer_count_delta != null && s.transfer_count_delta > 0) {
        text += ` _(+${s.transfer_count_delta.toLocaleString()} last 30m)_`;
      }
      text += `\n`;
    }
    text += `  🕐 \`${ts} UTC\`\n\n`;
  }

  text += `_contracts verified on [Blockscout](https://megaeth.blockscout.com)_`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}

// ─── Command Registry ────────────────────────────────────────────────────────

bot.onText(/\/start(?:@\w+)?/, (msg) => cmdStart(msg).catch(e => log(`start error: ${e.message}`)));
bot.onText(/\/help(?:@\w+)?/, (msg) => cmdHelp(msg).catch(e => log(`help error: ${e.message}`)));
bot.onText(/\/status(?:@\w+)?/, (msg) => cmdStatus(msg).catch(e => log(`status error: ${e.message}`)));
bot.onText(/\/tvl(?:@\w+)?/, (msg) => cmdTVL(msg).catch(e => log(`tvl error: ${e.message}`)));
bot.onText(/\/top(?:@\w+)?/, (msg) => cmdTop(msg).catch(e => log(`top error: ${e.message}`)));
bot.onText(/\/warnings(?:@\w+)?/, (msg) => cmdWarnings(msg).catch(e => log(`warnings error: ${e.message}`)));
bot.onText(/\/alpha(?:@\w+)?/, (msg) => cmdAlpha(msg).catch(e => log(`alpha error: ${e.message}`)));
bot.onText(/\/intel(?:@\w+)?/, (msg) => cmdIntel(msg).catch(e => log(`intel error: ${e.message}`)));
bot.onText(/\/project(?:@\w+)?(?:\s+(.+))?/, (msg, match) => {
  const args = match[1] ? match[1].trim().split(/\s+/) : [];
  cmdProject(msg, args).catch(e => log(`project error: ${e.message}`));
});
bot.onText(/\/brief(?:@\w+)?(?:\s+(.+))?/, (msg, match) => {
  const args = match[1] ? match[1].trim().split(/\s+/) : [];
  cmdBrief(msg, args).catch(e => log(`brief error: ${e.message}`));
});
bot.onText(/\/stables(?:@\w+)?/, (msg) => cmdStables(msg).catch(e => log(`stables error: ${e.message}`)));

// Register commands with Telegram BotFather API
async function registerCommands() {
  const commands = [
    { command: 'start', description: 'Welcome to Bunny Intel' },
    { command: 'status', description: 'Live ecosystem health snapshot' },
    { command: 'tvl', description: 'TVL breakdown by protocol' },
    { command: 'top', description: 'Top projects by signal score' },
    { command: 'warnings', description: 'WARNING and RISK alerts' },
    { command: 'alpha', description: 'Latest alpha signals' },
    { command: 'intel', description: 'Enrichment run summary' },
    { command: 'project', description: 'Deep dive on a project (/project kumbaya)' },
    { command: 'brief', description: 'AI alpha brief (/brief or /brief sectorone)' },
    { command: 'stables', description: 'USDM + CUSD supply, circulation, staking' },
    { command: 'help', description: 'All commands' },
  ];

  const scopes = [
    { type: 'default' },
    { type: 'all_group_chats' },
    { type: 'all_chat_administrators' },
  ];

  try {
    for (const scope of scopes) {
      await bot.setMyCommands(commands, { scope });
    }
    log('✅ Commands registered with Telegram (private + groups)');
  } catch (e) {
    log(`⚠️ Command registration failed: ${e.message}`);
  }
}

// Startup
async function start() {
  await ensureInit();
  log('🐰 Bunny Intel Telegram Bot starting...');
  await registerCommands();
}

start().catch(err => {
  log(`Startup failed: ${err.message}`);
  process.exit(1);
});

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
