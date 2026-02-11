#!/usr/bin/env node
/**
 * Backfill deployment history
 * Usage: node backfill-deployments.js [--max-tweets=100]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { TwitterApi } = require('twitter-api-v2');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

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

async function getAllDeploymentTweets(username, maxTweets = 100) {
  try {
    const userId = await getUserId(username);
    if (!userId) return [];

    log(`Fetching up to ${maxTweets} tweets from @${username}...`);
    
    const allTweets = [];
    let paginationToken = undefined;
    
    while (allTweets.length < maxTweets) {
      const params = {
        max_results: Math.min(100, maxTweets - allTweets.length),
        'tweet.fields': ['created_at', 'public_metrics', 'conversation_id'],
      };
      
      if (paginationToken) {
        params.pagination_token = paginationToken;
      }
      
      const response = await client.v2.userTimeline(userId, params);
      
      if (!response.data.data || response.data.data.length === 0) {
        break;
      }
      
      allTweets.push(...response.data.data);
      log(`Fetched ${allTweets.length} tweets so far...`);
      
      // Check if there's more data
      if (!response.data.meta.next_token) {
        break;
      }
      
      paginationToken = response.data.meta.next_token;
      
      // Rate limit protection: small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    log(`Total tweets fetched: ${allTweets.length}`);
    return allTweets;
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

async function sendTelegramAlert(deployment, isBatch = false) {
  if (!bot || !TELEGRAM_CHANNEL_ID) {
    log('Telegram bot or channel ID not configured, skipping alert.', 'WARN');
    return;
  }

  const batchPrefix = isBatch ? '📦 **BACKFILL** - ' : '';
  const message = `${batchPrefix}🚀 *New MegaETH Deployment Detected!*\n\n` +
    `📦 *Project:* @${deployment.project || 'unknown'}\n` +
    `📅 *Time:* ${deployment.createdAt}\n\n` +
    `🔗 [View Tweet](${deployment.url})\n\n` +
    `#MegaETH #Deployment`;

  try {
    await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: 'Markdown' });
    log(`Telegram alert sent for project: @${deployment.project}`);
    
    // Small delay to avoid telegram rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (error) {
    log(`Failed to send Telegram alert: ${error.message}`, 'ERROR');
  }
}

async function backfillDeployments(maxTweets = 100) {
  log(`Starting backfill for last ${maxTweets} tweets...`);
  
  const tweets = await getAllDeploymentTweets('megaeth', maxTweets);
  const tracked = loadTracked();
  const newDeployments = [];

  for (const tweet of tweets) {
    if (tweet.text.toLowerCase().includes('deployment detected')) {
      const tweetId = tweet.id;
      
      // Check if already tracked by ID
      const isTracked = tracked.deployments.some(d => (typeof d === 'string' ? d === tweetId : d.id === tweetId));
      
      if (!isTracked) {
        const project = extractDeployment(tweet.text);
        log(`New deployment detected: @${project || 'unknown'} (${tweet.created_at})`);
        
        const deployment = {
          id: tweetId,
          project,
          url: `https://x.com/megaeth/status/${tweetId}`,
          text: tweet.text,
          createdAt: tweet.created_at
        };
        
        newDeployments.push(deployment);
        tracked.deployments.push(deployment);
        
        await sendTelegramAlert(deployment, true);
      }
    }
  }

  if (newDeployments.length > 0) {
    saveTracked(tracked);
    log(`✅ BACKFILL COMPLETE: Found ${newDeployments.length} new deployment(s)`);
    log(`Total deployments in database: ${tracked.deployments.length}`);
    return newDeployments;
  } else {
    log('No new deployments found in backfill.');
    return [];
  }
}

async function main() {
  if (!TWITTER_API_KEY || !TWITTER_API_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
      log('Twitter API credentials missing. Please set environment variables.', 'FATAL');
      process.exit(1);
  }
  
  // Parse max tweets from command line
  const maxTweetsArg = process.argv.find(arg => arg.startsWith('--max-tweets='));
  const maxTweets = maxTweetsArg ? parseInt(maxTweetsArg.split('=')[1]) : 100;
  
  await backfillDeployments(maxTweets);
}

main().catch(err => {
  log(`Fatal error: ${err.message}`, 'FATAL');
  if (err.stack) log(err.stack, 'FATAL');
  process.exit(1);
});
