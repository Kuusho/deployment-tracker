#!/usr/bin/env node
/**
 * Milestone alert sender — runs 5 min after enrichment via cron
 * Reads unalerted milestones, sends Telegram alerts, marks as alerted
 *
 * Usage: npm run milestones
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TelegramBot = require('node-telegram-bot-api');
const db = require('../lib/db');
const scoring = require('../lib/scoring');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const bot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN) : null;

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}

function formatMilestoneMessage(milestone) {
  const val = scoring.formatNumber(milestone.actual_value);
  const thresh = scoring.formatNumber(milestone.threshold);

  if (milestone.type === 'ecosystem') {
    const metricLabels = {
      tvl: 'Total TVL',
      total_txs: 'Total Transactions',
      active_wallets: 'Active Wallets',
      deployment_count: 'Deployments Tracked',
    };
    const label = metricLabels[milestone.metric] || milestone.metric;
    return `*MEGAETH ECOSYSTEM MILESTONE*\n\n` +
      `${label} has crossed *${thresh}*\n` +
      `Current: *${val}*\n\n` +
      `#MegaETH #Milestone`;
  }

  if (milestone.type === 'project') {
    const metricLabels = {
      tvl: 'TVL',
    };
    const label = metricLabels[milestone.metric] || milestone.metric;
    return `*PROJECT MILESTONE*\n\n` +
      `@${milestone.subject}: ${label} crossed *$${thresh}*\n` +
      `Current: *$${val}*\n\n` +
      `#MegaETH #Milestone`;
  }

  return `*MILESTONE*: ${milestone.metric} crossed ${thresh} (now: ${val})`;
}

async function sendMilestoneAlert(milestone) {
  if (!bot || !TELEGRAM_CHANNEL_ID) {
    log(`  [DRY] Would alert: ${milestone.type}/${milestone.metric} crossed ${scoring.formatNumber(milestone.threshold)}`);
    return true;
  }

  const message = formatMilestoneMessage(milestone);
  try {
    await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: 'Markdown' });
    log(`  Alert sent: ${milestone.type}/${milestone.metric} = ${scoring.formatNumber(milestone.threshold)}`);
    return true;
  } catch (err) {
    log(`  Alert failed: ${err.message}`, 'ERROR');
    return false;
  }
}

async function main() {
  log('=== Milestone checker starting ===');

  const milestones = db.getUnalertedMilestones();
  log(`Found ${milestones.length} unalerted milestones`);

  if (milestones.length === 0) {
    log('Nothing to alert');
    db.close();
    return;
  }

  let sent = 0;
  for (const milestone of milestones) {
    const success = await sendMilestoneAlert(milestone);
    if (success) {
      db.markMilestoneAlerted(milestone.id);
      sent++;
    }
    // Brief pause between messages to avoid Telegram rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  log(`=== Milestone checker complete: ${sent}/${milestones.length} alerts sent ===`);
  db.close();
}

main().catch(err => {
  log(`Fatal milestone error: ${err.message}`, 'FATAL');
  db.close();
  process.exit(1);
});
