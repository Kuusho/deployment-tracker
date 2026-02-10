#!/usr/bin/env node
/**
 * Nightly Recap - Summarize 24h of deployments
 * Usage: node nightly-recap.js [--dry-run]
 */

const { TwitterApi } = require('twitter-api-v2');
const fs = require('fs');
const path = require('path');

const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

const TRACKED_FILE = path.join(__dirname, '../memory/deployments-tracked.json');

function loadDeployments() {
  try {
    if (fs.existsSync(TRACKED_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8'));
      return data.deployments || [];
    }
  } catch (error) {
    console.error('Failed to load deployments:', error.message);
  }
  return [];
}

async function main() {
  const deployments = loadDeployments();
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

  // Filter for deployments in the last 24h
  // Note: Old entries are strings (IDs), new entries are objects
  const recent = deployments.filter(d => {
    if (typeof d === 'string') return false; // Can't easily check date for old string IDs without API call
    return new Date(d.createdAt) > twentyFourHoursAgo;
  });

  if (recent.length === 0) {
    console.log('No recent deployments (last 24h) found with metadata.');
    return;
  }

  console.log(`Found ${recent.length} recent deployments.`);

  let recapText = `🌙 MEGAETH NIGHTLY RECAP\n\n`;
  recapText += `the oven was hot today. ${recent.length} new deployments detected:\n\n`;

  recent.forEach(d => {
    recapText += `• @${d.project || 'unknown'}: [summary pending]\n`;
  });

  recapText += `\nbunny speed gud`;

  console.log('Generated Recap:\n', recapText);

  if (process.argv.includes('--dry-run')) {
    console.log('Dry run - not posting.');
    return;
  }

  try {
    const rwClient = client.readWrite;
    await rwClient.v2.tweet(recapText);
    console.log('✅ Recap posted!');
  } catch (error) {
    console.error('❌ Failed to post recap:', error.message);
  }
}

main().catch(console.error);
