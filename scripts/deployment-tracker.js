#!/usr/bin/env node
/**
 * Track MegaETH deployment announcements
 * Usage: node deployment-tracker.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { TwitterApi } = require('twitter-api-v2');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const db = require('../lib/db');
const ds = require('../lib/data-sources');

// Environment variables
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_SECRET;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const client = new TwitterApi({
  appKey: TWITTER_API_KEY,
  appSecret: TWITTER_API_SECRET,
  accessToken: TWITTER_ACCESS_TOKEN,
  accessSecret: TWITTER_ACCESS_SECRET,
});

const bot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN) : null;

const TRACKED_FILE = path.join(__dirname, '../memory/deployments-tracked.json');
const LOG_FILE = path.join(__dirname, '../deployment-tracker.log');

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (err) {
    // Fallback if log file is not writable
  }
  console.log(logMessage.trim());
}

async function getUserId(username) {
  try {
    const user = await client.v2.userByUsername(username);
    if (!user.data) {
        log(`User @${username} not found`, 'ERROR');
        return null;
    }
    return user.data.id;
  } catch (error) {
    log(`Failed to get ID for @${username}: ${error.message}`, 'ERROR');
    return null;
  }
}

async function getRecentTweets(username, count = 20) {
  try {
    const userId = await getUserId(username);
    if (!userId) return [];

    const tweets = await client.v2.userTimeline(userId, {
      max_results: count,
      'tweet.fields': ['created_at', 'public_metrics', 'conversation_id'],
    });

    return tweets.data.data || [];
  } catch (error) {
    log(`Failed to fetch tweets from @${username}: ${error.message}`, 'ERROR');
    return [];
  }
}

function loadTracked() {
  try {
    if (fs.existsSync(TRACKED_FILE)) {
      const data = JSON.parse(fs.readFileSync(TRACKED_FILE, 'utf8'));
      if (data && Array.isArray(data.deployments)) {
        return data;
      }
    }
  } catch (error) {
    log(`Failed to load tracked deployments: ${error.message}`, 'ERROR');
  }
  return { deployments: [] };
}

function saveTracked(data) {
  try {
    fs.writeFileSync(TRACKED_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    log(`Failed to save tracked deployments: ${error.message}`, 'ERROR');
  }
}

function extractDeployment(text) {
  // Try "Deployment detected for/by @handle"
  let match = text.match(/Deployment detected (?:for|by) @(\w+)/i);
  if (match) {
    return match[1];
  }
  
  // Fallback: "Deployment detected @handle" (no for/by)
  match = text.match(/Deployment detected @(\w+)/i);
  if (match) {
    return match[1];
  }
  
  return null;
}

async function sendTelegramAlert(deployment) {
  if (!bot || !TELEGRAM_CHANNEL_ID) {
    log('Telegram bot or channel ID not configured, skipping alert.', 'WARN');
    return;
  }

  const message = `🚀 *New MegaETH Deployment Detected!*\n\n` +
    `📦 *Project:* @${deployment.project || 'unknown'}\n` +
    `📅 *Time:* ${deployment.createdAt}\n\n` +
    `🔗 [View Tweet](${deployment.url})\n\n` +
    `#MegaETH #Deployment`;

  try {
    await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: 'Markdown' });
    log(`Telegram alert sent for project: @${deployment.project}`);
  } catch (error) {
    log(`Failed to send Telegram alert: ${error.message}`, 'ERROR');
  }
}

async function checkDeployments() {
  log('Checking for new deployments...');
  
  const tweets = await getRecentTweets('megaeth', 20);
  const tracked = loadTracked();
  const newDeployments = [];

  for (const tweet of tweets) {
    if (tweet.text.toLowerCase().includes('deployment detected')) {
      const tweetId = tweet.id;
      
      // Check if already tracked by ID
      const isTracked = tracked.deployments.some(d => (typeof d === 'string' ? d === tweetId : d.id === tweetId));
      
      if (!isTracked) {
        const project = extractDeployment(tweet.text);
        log(`New deployment detected: @${project || 'unknown'}`);
        
        const deployment = {
          id: tweetId,
          project,
          url: `https://x.com/megaeth/status/${tweetId}`,
          text: tweet.text,
          createdAt: tweet.created_at
        };
        
        newDeployments.push(deployment);
        tracked.deployments.push(deployment);

        // Write to SQLite
        try {
          db.insertDeployment({
            id: tweetId,
            project,
            url: deployment.url,
            tweet_text: tweet.text,
            created_at: tweet.created_at,
          });
          log(`Saved to SQLite: @${project}`);

          // Attempt contract address resolution for new deployment
          resolveAddress({ id: tweetId, project }).catch(err =>
            log(`Address resolution deferred for @${project}: ${err.message}`, 'WARN')
          );
        } catch (dbErr) {
          log(`SQLite write failed for @${project}: ${dbErr.message}`, 'ERROR');
        }

        await sendTelegramAlert(deployment);
      }
    }
  }

  if (newDeployments.length > 0) {
    saveTracked(tracked);
    log(`Found ${newDeployments.length} new deployment(s)`);
    return newDeployments;
  } else {
    log('No new deployments since last check.');
    return [];
  }
}

async function resolveAddress(project) {
  try {
    const result = await ds.resolveContractAddress(project);
    if (result && result.address) {
      db.updateDeployment(project.id, { contract_address: result.address });
      log(`Resolved @${project.project} → ${result.address} (${result.method})`);
    }
  } catch (err) {
    log(`Address resolution failed for @${project.project}: ${err.message}`, 'WARN');
  }
}

async function main() {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
      log('Twitter API credentials missing. Please set environment variables.', 'FATAL');
      process.exit(1);
  }
  await checkDeployments();
  db.close();
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'FATAL');
  if (err.stack) log(err.stack, 'FATAL');
  db.close();
  process.exit(1);
});
