#!/usr/bin/env node
/**
 * ERC-8004 Pan Identity Registration
 * 
 * Registers Pan as a verified onchain agent on MegaETH
 * IdentityRegistry: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 * 
 * Usage:
 *   node scripts/erc8004-register.js --check     (check if already registered)
 *   node scripts/erc8004-register.js --register  (register Pan)
 *   node scripts/erc8004-register.js --info      (show current registration)
 * 
 * Requires: PRIVATE_KEY in .env (owner wallet)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { ethers } = require('ethers');

// ─── Config ─────────────────────────────────────────────────────────────────

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
const MEGAETH_RPC = process.env.ALCHEMY_HTTP_URL;
const MEGAETH_CHAIN_ID = 4326;

// Pan's agent registration file (hosted on-chain or IPFS)
// For MVP: inline data URI
const AGENT_REGISTRATION = {
  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
  name: 'Pan',
  description: 'Pan (パン) — Onchain quant bunny for MegaETH. Real-time deployment intel, TVL tracking, ecosystem monitoring, and fast alpha. Bunny speed gud.',
  image: 'https://pbs.twimg.com/profile_images/korewapandesu/photo.jpg',
  services: [
    {
      name: 'twitter',
      endpoint: 'https://x.com/korewapandesu'
    },
    {
      name: 'telegram',
      endpoint: 'https://t.me/kuusho_shouten'
    }
  ],
  x402Support: true,  // will enable payment gating
  active: true,
  supportedTrust: ['reputation']
};

// ERC-8004 Identity Registry ABI (minimal)
const IDENTITY_ABI = [
  // register(string agentURI) → uint256 agentId
  'function register(string calldata agentURI) external returns (uint256)',
  // tokenURI(uint256 tokenId) → string
  'function tokenURI(uint256 tokenId) external view returns (string)',
  // balanceOf(address owner) → uint256
  'function balanceOf(address owner) external view returns (uint256)',
  // ownerOf(uint256 tokenId) → address
  'function ownerOf(uint256 tokenId) external view returns (address)',
  // name() → string
  'function name() external view returns (string)',
  // totalSupply() → uint256 (ERC-721 optional, try it)
  'function totalSupply() external view returns (uint256)',
  // Event
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function getProvider() {
  if (!MEGAETH_RPC) throw new Error('ALCHEMY_HTTP_URL not set');
  const provider = new ethers.JsonRpcProvider(MEGAETH_RPC, {
    chainId: MEGAETH_CHAIN_ID,
    name: 'megaeth'
  });
  return provider;
}

async function checkRegistration(address) {
  const provider = await getProvider();
  const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

  try {
    const balance = await contract.balanceOf(address);
    log(`Address ${address} has ${balance} agent registration(s)`);
    return Number(balance) > 0;
  } catch (e) {
    log(`balanceOf failed: ${e.message}`);
    return false;
  }
}

async function register(privateKey) {
  const provider = await getProvider();
  const wallet = new ethers.Wallet(privateKey, provider);
  
  log(`Registering from address: ${wallet.address}`);

  // Check if already registered
  const alreadyRegistered = await checkRegistration(wallet.address);
  if (alreadyRegistered) {
    log('Already registered! Skipping re-registration.');
    return null;
  }

  const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, wallet);

  // Build agent URI (data: URI for on-chain storage)
  const agentURI = 'data:application/json;base64,' + 
    Buffer.from(JSON.stringify(AGENT_REGISTRATION)).toString('base64');

  log(`Agent URI length: ${agentURI.length} chars`);
  log('Sending registration transaction...');

  try {
    // Estimate gas first
    const gasEstimate = await contract.register.estimateGas(agentURI);
    log(`Gas estimate: ${gasEstimate.toString()}`);

    const tx = await contract.register(agentURI, {
      gasLimit: gasEstimate * 120n / 100n  // 20% buffer
    });
    
    log(`Transaction sent: ${tx.hash}`);
    log(`Explorer: https://megaeth.blockscout.com/tx/${tx.hash}`);

    const receipt = await tx.wait();
    log(`✅ Confirmed in block ${receipt.blockNumber}`);

    // Find the Transfer event to get agentId
    const iface = new ethers.Interface(IDENTITY_ABI);
    for (const log_entry of receipt.logs) {
      try {
        const parsed = iface.parseLog(log_entry);
        if (parsed?.name === 'Transfer') {
          const agentId = parsed.args.tokenId.toString();
          log(`🎉 Pan's Agent ID: ${agentId}`);
          log(`Identity: eip155:${MEGAETH_CHAIN_ID}:${IDENTITY_REGISTRY}:${agentId}`);
          return agentId;
        }
      } catch {}
    }
  } catch (e) {
    log(`❌ Registration failed: ${e.message}`);
    if (e.data) log(`Revert data: ${e.data}`);
    throw e;
  }
}

async function showInfo() {
  const provider = await getProvider();
  const contract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

  try {
    const name = await contract.name();
    log(`Registry name: ${name}`);

    let totalSupply;
    try {
      totalSupply = await contract.totalSupply();
      log(`Total agents registered: ${totalSupply.toString()}`);
    } catch {
      log('totalSupply not available on this registry');
    }

    // Check if a PRIVATE_KEY is set and show their registration
    if (process.env.PRIVATE_KEY) {
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
      log(`\nChecking registration for: ${wallet.address}`);
      const balance = await contract.balanceOf(wallet.address);
      log(`Agent registrations: ${balance.toString()}`);
    }
  } catch (e) {
    log(`Error: ${e.message}`);
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  log('🐰 Pan ERC-8004 Registration Tool');
  log(`Chain: MegaETH (${MEGAETH_CHAIN_ID})`);
  log(`Identity Registry: ${IDENTITY_REGISTRY}`);
  log(`Reputation Registry: ${REPUTATION_REGISTRY}`);
  log('');

  if (cmd === '--check' || cmd === '-c') {
    const address = args[1] || (process.env.PRIVATE_KEY 
      ? new ethers.Wallet(process.env.PRIVATE_KEY).address 
      : null);
    
    if (!address) {
      console.error('❌ Provide address as argument or set PRIVATE_KEY in .env');
      process.exit(1);
    }
    await checkRegistration(address);

  } else if (cmd === '--register' || cmd === '-r') {
    if (!process.env.PRIVATE_KEY) {
      console.error('❌ PRIVATE_KEY not set in .env');
      console.error('Set it to your wallet private key to register Pan on-chain');
      process.exit(1);
    }
    const agentId = await register(process.env.PRIVATE_KEY);
    if (agentId) {
      log(`\n🎉 Pan is now a verified onchain agent!`);
      log(`Agent ID: ${agentId}`);
      log(`Identity: eip155:${MEGAETH_CHAIN_ID}:${IDENTITY_REGISTRY}:${agentId}`);
      log(`\nAdd to .env:`);
      log(`PAN_AGENT_ID=${agentId}`);
      log(`PAN_IDENTITY_REGISTRY=${IDENTITY_REGISTRY}`);
    }

  } else if (cmd === '--info' || cmd === '-i') {
    await showInfo();

  } else {
    console.log('Usage:');
    console.log('  node scripts/erc8004-register.js --check [address]');
    console.log('  node scripts/erc8004-register.js --register  (requires PRIVATE_KEY in .env)');
    console.log('  node scripts/erc8004-register.js --info');
  }
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
