/**
 * API wrappers for DeFiLlama, Blockscout, MegaETH RPC
 * Uses global fetch (Node 18+), no extra HTTP deps
 */

const db = require('./db');

const ALCHEMY_RPC = process.env.ALCHEMY_HTTP_URL || process.env.MEGAETH_ALCHEMY_RPC || 'https://rpc.megaeth.com';
const PUBLIC_RPC = 'https://rpc.megaeth.com';
const BLOCKSCOUT_BASE = 'https://megaeth.blockscout.com/api/v2';
const DEFILLAMA_BASE = 'https://api.llama.fi';

// --- Fetch with retry ---

async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status >= 500) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await sleep(delay);
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText} for ${url}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- DeFiLlama ---

let _protocolsCache = null;
let _protocolsCacheTime = 0;
const PROTOCOLS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function defillamaGetEcosystemTvl() {
  const data = await fetchWithRetry(`${DEFILLAMA_BASE}/v2/historicalChainTvl/MegaETH`);
  if (!Array.isArray(data) || data.length === 0) return null;
  const latest = data[data.length - 1];
  return { tvl: latest.tvl, date: latest.date, history: data };
}

async function defillamaGetProtocols() {
  const now = Date.now();
  if (_protocolsCache && (now - _protocolsCacheTime) < PROTOCOLS_CACHE_TTL) {
    return _protocolsCache;
  }
  const data = await fetchWithRetry(`${DEFILLAMA_BASE}/protocols`);
  const megaProtocols = data.filter(p =>
    p.chains && Array.isArray(p.chains) && p.chains.includes('MegaETH')
  );
  _protocolsCache = megaProtocols;
  _protocolsCacheTime = now;
  return megaProtocols;
}

async function defillamaGetProtocolTvl(slug) {
  return fetchWithRetry(`${DEFILLAMA_BASE}/protocol/${slug}`);
}

// --- Blockscout ---

async function blockscoutGetStats() {
  return fetchWithRetry(`${BLOCKSCOUT_BASE}/stats`);
}

async function blockscoutSearchContracts(query) {
  const data = await fetchWithRetry(`${BLOCKSCOUT_BASE}/search?q=${encodeURIComponent(query)}`);
  if (!data || !data.items) return [];
  return data.items.filter(item =>
    item.type === 'contract' || item.type === 'address' || item.type === 'token'
  );
}

async function blockscoutGetContract(address) {
  return fetchWithRetry(`${BLOCKSCOUT_BASE}/smart-contracts/${address}`);
}

async function blockscoutGetAddress(address) {
  return fetchWithRetry(`${BLOCKSCOUT_BASE}/addresses/${address}`);
}

async function blockscoutGetTokens(params = {}) {
  const query = new URLSearchParams(params).toString();
  return fetchWithRetry(`${BLOCKSCOUT_BASE}/tokens${query ? '?' + query : ''}`);
}

// --- MegaETH RPC ---

async function rpcCall(method, params = [], useAlchemy = true) {
  const url = useAlchemy ? ALCHEMY_RPC : PUBLIC_RPC;
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (data.error) throw new Error(`RPC error: ${data.error.message}`);
  return data.result;
}

async function rpcGetCode(address) {
  const code = await rpcCall('eth_getCode', [address, 'latest']);
  return { code, isContract: code !== '0x' && code !== '0x0' };
}

async function rpcGetTransactionCount(address) {
  const hex = await rpcCall('eth_getTransactionCount', [address, 'latest']);
  return parseInt(hex, 16);
}

async function rpcGetBalance(address) {
  const hex = await rpcCall('eth_getBalance', [address, 'latest']);
  const wei = BigInt(hex);
  return { wei: wei.toString(), eth: Number(wei) / 1e18 };
}

async function rpcGetBlockNumber() {
  const hex = await rpcCall('eth_blockNumber');
  return parseInt(hex, 16);
}

// --- Contract Address Resolver ---

// Known contract addresses for major protocols
const KNOWN_ADDRESSES = {
  aave: '0x6A000a123a55b0E15CeCff1FE5f1D5B56FCB7f92', // Aave V3 Pool on MegaETH
  chainlink: null,
  LidoFinance: null,
};

async function resolveContractAddress(project) {
  const projectName = project.project;
  const deploymentId = project.id;

  // 1. Check hardcoded known addresses
  if (KNOWN_ADDRESSES[projectName] !== undefined && KNOWN_ADDRESSES[projectName] !== null) {
    const address = KNOWN_ADDRESSES[projectName];
    try {
      const { isContract } = await rpcGetCode(address);
      if (isContract) {
        db.logAddressResolution({
          deployment_id: deploymentId, method: 'known_address', query: projectName,
          result_address: address, confidence: 1.0, success: true,
        });
        return { address, confidence: 1.0, method: 'known_address' };
      }
    } catch (err) {
      // Fall through to other methods
    }
  }

  // 2. Blockscout search
  try {
    const results = await blockscoutSearchContracts(projectName);
    if (results.length > 0) {
      const best = results[0];
      const address = best.address || best.address_hash;
      if (address) {
        const { isContract } = await rpcGetCode(address);
        if (isContract) {
          db.logAddressResolution({
            deployment_id: deploymentId, method: 'blockscout_search', query: projectName,
            result_address: address, confidence: 0.7, success: true,
          });
          return { address, confidence: 0.7, method: 'blockscout_search' };
        }
      }
    }
  } catch (err) {
    // Log failure and continue
  }

  // 3. DeFiLlama protocol match
  try {
    const protocols = await defillamaGetProtocols();
    const match = protocols.find(p =>
      p.name.toLowerCase().includes(projectName.toLowerCase()) ||
      (p.slug && p.slug.toLowerCase().includes(projectName.toLowerCase()))
    );
    if (match && match.address) {
      db.logAddressResolution({
        deployment_id: deploymentId, method: 'defillama_match', query: projectName,
        result_address: match.address, confidence: 0.6, success: true,
      });
      return { address: match.address, confidence: 0.6, method: 'defillama_match' };
    }
  } catch (err) {
    // Fall through
  }

  // No resolution found
  db.logAddressResolution({
    deployment_id: deploymentId, method: 'all_methods_failed', query: projectName,
    result_address: null, confidence: 0, success: false,
  });
  return null;
}

// --- Cached protocol lookup for enrichment ---

async function getCachedProtocols() {
  return defillamaGetProtocols();
}

function getProtocolTvlForProject(protocols, projectName, defillamaSlug) {
  if (defillamaSlug) {
    const match = protocols.find(p => p.slug === defillamaSlug);
    if (match) {
      const chainTvl = match.chainTvls?.MegaETH || match.tvl || 0;
      return chainTvl;
    }
  }
  // Fuzzy match by name
  const match = protocols.find(p =>
    p.name.toLowerCase().includes(projectName.toLowerCase()) ||
    p.slug?.toLowerCase().includes(projectName.toLowerCase())
  );
  return match?.chainTvls?.MegaETH || match?.tvl || null;
}

module.exports = {
  fetchWithRetry,
  sleep,
  defillamaGetEcosystemTvl,
  defillamaGetProtocols,
  defillamaGetProtocolTvl,
  blockscoutGetStats,
  blockscoutSearchContracts,
  blockscoutGetContract,
  blockscoutGetAddress,
  blockscoutGetTokens,
  rpcCall,
  rpcGetCode,
  rpcGetTransactionCount,
  rpcGetBalance,
  rpcGetBlockNumber,
  resolveContractAddress,
  getCachedProtocols,
  getProtocolTvlForProject,
};
