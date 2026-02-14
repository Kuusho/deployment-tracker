#!/usr/bin/env node
/**
 * Realtime WSS listener for MegaETH miniBlocks
 * Detects contract deployments (tx.to === null) and high-signal events
 * Long-running process — run with pm2 or systemd
 *
 * Usage: npm run listen
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const db = require('../lib/db');
const ds = require('../lib/data-sources');

const WSS_URL = process.env.MEGAETH_WSS || 'wss://mainnet.megaeth.com/ws';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const bot = TELEGRAM_BOT_TOKEN ? new TelegramBot(TELEGRAM_BOT_TOKEN) : null;

const KEEPALIVE_INTERVAL = 25000; // 25s (spec says 30s max)
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 60000;

let ws = null;
let keepaliveTimer = null;
let reconnectAttempts = 0;

function log(msg, level = 'INFO') {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${msg}`);
}

async function sendAlert(message) {
  if (!bot || !TELEGRAM_CHANNEL_ID) {
    log(`[DRY] ${message}`);
    return;
  }
  try {
    await bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: 'Markdown' });
  } catch (err) {
    log(`Telegram alert failed: ${err.message}`, 'WARN');
  }
}

function connect() {
  log(`Connecting to ${WSS_URL}...`);

  ws = new WebSocket(WSS_URL);

  ws.on('open', () => {
    log('WebSocket connected');
    reconnectAttempts = 0;

    // Subscribe to miniBlocks
    const sub = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_subscribe',
      params: ['miniBlocks'],
    });
    ws.send(sub);
    log('Subscribed to miniBlocks');

    // Start keepalive pings
    keepaliveTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, KEEPALIVE_INTERVAL);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Subscription confirmation
      if (msg.id === 1 && msg.result) {
        log(`Subscription confirmed: ${msg.result}`);
        return;
      }

      // MiniBlock notification
      if (msg.method === 'eth_subscription' && msg.params?.result) {
        handleMiniBlock(msg.params.result);
      }
    } catch (err) {
      log(`Message parse error: ${err.message}`, 'WARN');
    }
  });

  ws.on('close', (code, reason) => {
    log(`WebSocket closed: ${code} ${reason}`, 'WARN');
    cleanup();
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`, 'ERROR');
  });

  ws.on('pong', () => {
    // Keepalive acknowledged
  });
}

function cleanup() {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function scheduleReconnect() {
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts), RECONNECT_MAX_DELAY);
  reconnectAttempts++;
  log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})...`);
  setTimeout(connect, delay);
}

// --- MiniBlock Processing ---

function handleMiniBlock(block) {
  if (!block.transactions || !Array.isArray(block.transactions)) return;

  for (const tx of block.transactions) {
    // Contract deployment: tx.to is null
    if (tx.to === null || tx.to === '0x' || tx.to === undefined) {
      handleContractDeployment(tx, block);
    }
  }
}

async function handleContractDeployment(tx, block) {
  const from = tx.from || 'unknown';
  const hash = tx.hash || 'unknown';

  log(`Contract deployment detected: tx=${hash} from=${from}`);

  // Try to get the deployed contract address from the receipt
  let contractAddress = null;
  try {
    const receipt = await ds.rpcCall('eth_getTransactionReceipt', [hash]);
    if (receipt?.contractAddress) {
      contractAddress = receipt.contractAddress;
    }
  } catch (err) {
    log(`  Failed to get receipt: ${err.message}`, 'WARN');
  }

  // Cross-reference against known projects
  const knownProjects = db.getAllDeployments();
  let matchedProject = null;

  if (contractAddress) {
    matchedProject = knownProjects.find(p =>
      p.contract_address && p.contract_address.toLowerCase() === contractAddress.toLowerCase()
    );
  }

  // Alert for new contract deployments
  const alertMsg = matchedProject
    ? `*REALTIME: Known Project Contract Update*\n\n` +
      `Project: @${matchedProject.project}\n` +
      `Contract: \`${contractAddress}\`\n` +
      `Tx: \`${hash}\`\n\n` +
      `#MegaETH #Realtime`
    : `*REALTIME: New Contract Deployed*\n\n` +
      `From: \`${from}\`\n` +
      `${contractAddress ? `Contract: \`${contractAddress}\`\n` : ''}` +
      `Tx: \`${hash}\`\n\n` +
      `#MegaETH #Realtime`;

  // Only alert for matched projects or if we want all deployments
  if (matchedProject) {
    await sendAlert(alertMsg);
  }
}

// --- Graceful Shutdown ---

function shutdown() {
  log('Shutting down...');
  cleanup();
  if (ws) {
    ws.close();
    ws = null;
  }
  db.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Main ---

log('=== MegaETH Realtime Listener starting ===');
connect();
