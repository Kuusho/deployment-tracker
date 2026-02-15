#!/usr/bin/env node
/**
 * Generate Pan's Payment Wallet for x402
 * 
 * This creates a new EOA wallet that will:
 * - Receive x402 payments for API access
 * - Be the "agent wallet" for ERC-8004 registration
 * 
 * IMPORTANT: Save the private key securely. It's printed ONCE.
 * 
 * Usage: node scripts/generate-wallet.js
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../.env');

function log(msg) {
  console.log(msg);
}

async function main() {
  log('🐰 Generating Pan\'s payment wallet...\n');

  // Generate new wallet
  const wallet = ethers.Wallet.createRandom();

  log('═══════════════════════════════════════');
  log('🔑 PAN WALLET GENERATED');
  log('═══════════════════════════════════════');
  log(`Address:     ${wallet.address}`);
  log(`Private Key: ${wallet.privateKey}`);
  log(`Mnemonic:    ${wallet.mnemonic?.phrase}`);
  log('═══════════════════════════════════════');
  log('');
  log('⚠️  SAVE THE PRIVATE KEY — IT WILL NOT BE SHOWN AGAIN');
  log('');

  // Update .env file
  const envContent = fs.readFileSync(ENV_PATH, 'utf8');
  
  let updatedEnv = envContent;

  // Add or update PAN_WALLET_ADDRESS
  if (updatedEnv.includes('PAN_WALLET_ADDRESS=')) {
    updatedEnv = updatedEnv.replace(/PAN_WALLET_ADDRESS=.*/, `PAN_WALLET_ADDRESS="${wallet.address}"`);
  } else {
    updatedEnv += `\n# Pan's Payment Wallet (x402 recipient + ERC-8004 agent wallet)\nPAN_WALLET_ADDRESS="${wallet.address}"\n`;
  }

  // Add PRIVATE_KEY if not already set
  if (!updatedEnv.includes('PRIVATE_KEY=')) {
    updatedEnv += `PRIVATE_KEY="${wallet.privateKey}"\n`;
    log('📝 PRIVATE_KEY written to .env');
  } else {
    log('ℹ️  PRIVATE_KEY already exists in .env — not overwriting');
  }

  fs.writeFileSync(ENV_PATH, updatedEnv);
  log(`✅ PAN_WALLET_ADDRESS written to .env`);
  log('');
  log('Next steps:');
  log('1. Fund the wallet with a tiny amount of ETH for gas (MegaETH)');
  log('   → Use the MegaETH bridge or get ETH from your main wallet');
  log('2. Run: node scripts/erc8004-register.js --register');
  log('   → This registers Pan as a verified onchain agent');
  log('3. Start the API: node scripts/api-server.js');
  log('   → x402 payments will flow to this wallet');
  log('');
  log(`🔗 Check wallet on Blockscout:`);
  log(`   https://megaeth.blockscout.com/address/${wallet.address}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
