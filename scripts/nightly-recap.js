#!/usr/bin/env node
/**
 * Nightly Recap - Summarize 24h of deployments + ecosystem intel
 * Usage: node nightly-recap.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { TwitterApi } = require('twitter-api-v2');
const db = require('../lib/db');
const scoring = require('../lib/scoring');

function getTwitterClient() {
  return new TwitterApi({
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  });
}

async function main() {
  // Recent deployments from DB
  const recent = await db.getRecentDeployments(24);

  // Ecosystem metrics
  const eco = await db.getLatestEcosystemMetrics();

  // Recent milestones (last 24h)
  const allMilestones = await db.getRecentMilestones(24);

  // Top scored projects
  const topProjects = await db.getTopScoredProjects(5);

  console.log(`Found ${recent.length} recent deployments, ${allMilestones.length} milestones`);

  // Build recap
  let recapText = `MEGAETH NIGHTLY RECAP\n\n`;

  // Ecosystem stats
  if (eco) {
    recapText += `Ecosystem:\n`;
    if (eco.total_tvl) recapText += `  TVL: $${scoring.formatNumber(eco.total_tvl)}\n`;
    if (eco.total_addresses) recapText += `  Wallets: ${scoring.formatNumber(eco.total_addresses)}\n`;
    if (eco.total_txs) recapText += `  Total Txs: ${scoring.formatNumber(eco.total_txs)}\n`;
    if (eco.deployment_count) recapText += `  Projects: ${eco.deployment_count}\n`;
    recapText += `\n`;
  }

  // New deployments
  if (recent.length > 0) {
    recapText += `${recent.length} new deployment${recent.length > 1 ? 's' : ''} today:\n`;
    for (const d of recent) {
      recapText += `  @${d.project} [${d.category || '?'}]\n`;
    }
    recapText += `\n`;
  } else {
    recapText += `No new deployments in the last 24h.\n\n`;
  }

  // Top projects by score
  if (topProjects.length > 0) {
    recapText += `Top signals:\n`;
    for (const p of topProjects) {
      recapText += `  @${p.project}: ${p.score}/100 [${p.classification}]`;
      if (p.tvl_usd) recapText += ` TVL:$${scoring.formatNumber(p.tvl_usd)}`;
      recapText += `\n`;
    }
    recapText += `\n`;
  }

  // Milestones
  if (allMilestones.length > 0) {
    recapText += `Milestones:\n`;
    for (const m of allMilestones.slice(0, 5)) {
      const label = m.subject ? `@${m.subject}` : 'Ecosystem';
      recapText += `  ${label} ${m.metric} crossed ${scoring.formatNumber(m.threshold)}\n`;
    }
    recapText += `\n`;
  }

  recapText += `bunny speed gud`;

  console.log('Generated Recap:\n', recapText);

  if (process.argv.includes('--dry-run')) {
    console.log('Dry run - not posting.');
    await db.close();
    return;
  }

  try {
    const rwClient = getTwitterClient().readWrite;
    await rwClient.v2.tweet(recapText);
    console.log('Recap posted!');
  } catch (error) {
    console.error('Failed to post recap:', error.message);
  }

  await db.close();
}

main().catch(async err => {
  console.error(err);
  await db.close();
});
