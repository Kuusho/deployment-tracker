/**
 * Static project registry — canonical display names, descriptions, and websites
 * for all tracked MegaETH deployments. Keyed by X/Twitter handle (matches the
 * `project` column in tracker_deployments).
 *
 * Kept in sync with bunny-intel/src/data/catalogue.ts — update both together.
 */

const REGISTRY = {
  PriorityTrade_: {
    name: 'PriorityTrade',
    description: 'Fast Telegram trading bot for MegaETH, integrating with DEX aggregators to route trades.',
    website: null,
  },
  BasedTradingBot: {
    name: 'Based',
    description: '#1 Degen Trading Bot for executing trades across multiple chains, including sniping launches and memecoins.',
    website: 'https://t.me/based_eth_bot',
  },
  GainsNetwork_io: {
    name: 'Gains Network',
    description: 'Decentralized leverage trading: crypto, forex, and commodities with up to 1000x leverage.',
    website: 'https://gains.trade',
  },
  birdeye_so: {
    name: 'Birdeye',
    description: 'All-in-one trading data: real-time charts, smart money flows, and historical data across 300+ exchanges.',
    website: 'https://birdeye.so',
  },
  AvailProject: {
    name: 'Avail',
    description: 'Creating a Unified Onchain Economy. Scaling access to users, apps, chains, and liquidity.',
    website: 'https://www.availproject.org',
  },
  BungeeExchange: {
    name: 'Bungee',
    description: 'A liquidity marketplace powered by Socket Protocol. Trade any token on any chain.',
    website: 'https://www.bungee.exchange',
  },
  aori_io: {
    name: 'Aori',
    description: 'Infrastructure for High-Frequency Intent Execution on any chain.',
    website: 'https://aori.io',
  },
  AiCrypts: {
    name: 'CryptsAI',
    description: 'Prompt-based RPG on MegaETH. Prompt your way through dungeons and compete for ETH prizes.',
    website: null,
  },
  bananagun: {
    name: 'Banana Gun',
    description: 'The best trading bot, built by on-chain traders.',
    website: 'https://www.bananagun.io',
  },
  chainlink: {
    name: 'Chainlink',
    description: 'The market-leading oracle platform. Data, interoperability, compliance, and privacy for DeFi.',
    website: 'https://chain.link',
  },
  infinex: {
    name: 'Infinex',
    description: 'A crypto superapp. Unified portfolio, serious OpSec, and built-in multi-provider trading.',
    website: 'https://infinex.xyz',
  },
  aave: {
    name: 'Aave',
    description: 'The most trusted financial network. Earn, borrow, save, and swap.',
    website: 'https://aave.com',
  },
  telisxyz: {
    name: 'Telis',
    description: 'One-way ETH bridge from Base to MegaETH via hedged perp positions on WCM.',
    website: 'https://telis.xyz',
  },
  LidoFinance: {
    name: 'Lido',
    description: 'Ethereum liquid staking. Stake ETH and receive stETH, usable across DeFi.',
    website: 'https://lido.fi',
  },
  redstone_defi: {
    name: 'RedStone',
    description: 'Modular, cross-chain oracle supporting 1,000+ assets for DeFi and institutions.',
    website: 'https://redstone.finance',
  },
  capmoney_: {
    name: 'Cap Money',
    description: 'Stablecoin protocol with credible financial guarantees, built on Ethereum. First Type III stablecoin.',
    website: 'https://cap.money',
  },
  OffshoreOnMega: {
    name: 'OFFSHORE PROTOCOL',
    description: 'Build an international money laundering empire simulation on MegaETH. GambleFi.',
    website: null,
  },
  realtime_defi: {
    name: 'Realtime DeFi',
    description: 'DeFi superapp on MegaETH: CLOB + AMM hybrid, launchpad, perps, and aggregator — all in one.',
    website: null,
  },
  clutchpredict: {
    name: 'Clutch Predict',
    description: 'AI-powered sports prediction tool integrating prediction markets into livestreams.',
    website: null,
  },
  mrdn_finance: {
    name: 'Meridian',
    description: 'Infrastructure for AI agent nano-services. x402 payment rails for the agent economy on MegaETH.',
    website: null,
  },
  hitdotone: {
    name: 'Hit',
    description: 'Arcade Finance gamified DeFi: up to 1000x leverage on real markets.',
    website: 'https://hit.one',
  },
  fasterdotfun: {
    name: 'Faster',
    description: 'Fair Launch accelerated by badbunnz_. Create and trade memecoins instantly on MegaETH.',
    website: 'https://faster.fun',
  },
  mtrkr_xyz: {
    name: 'MTRKR',
    description: 'Visualize your MegaETH wallet in real time. Track on-chain activity, DeFi positions, NFTs, and gaming.',
    website: 'https://mtrkr.xyz',
  },
  premarket_xyz: {
    name: 'Premarket',
    description: 'Premarket options for upcoming TGEs, IPOs, and more on MegaETH. Built by Stryke.',
    website: 'https://premarket.xyz',
  },
  SupernovaLabs_: {
    name: 'Supernova Labs',
    description: 'Native rate exchange on MegaETH. Trade yields, hedge interest rates, crypto cross-rates, and FX.',
    website: null,
  },
  avon_xyz: {
    name: 'Avon',
    description: 'The first real-time credit layer on MegaETH. First lending CLOB (Central Limit Order Book).',
    website: 'https://avon.xyz',
  },
  warpexchange: {
    name: 'Warp Exchange',
    description: 'High-performance AMM / DEX for MegaETH. Ultra-fast swaps and efficient liquidity.',
    website: 'https://warpexchange.xyz',
  },
  SectorOneDEX: {
    name: 'Sector One',
    description: 'Native DLMM DEX on MegaETH. The most efficient liquidity layer for traders and LPs.',
    website: null,
  },
  PrismFi_: {
    name: 'Prism Fi',
    description: 'Jupiter-style DEX aggregation leveraging Uniswap V3 concentrated liquidity on MegaETH.',
    website: 'https://prism.fi',
  },
  TopStrikeIO: {
    name: 'Top Strike',
    description: 'Real-time, one-tap football player trading game on MegaETH. Every moment on the pitch moves the market.',
    website: 'https://topstrike.io',
  },
  thewarren_app: {
    name: 'Warren',
    description: 'Decentralized Content Management System built entirely on the MegaETH network.',
    website: 'https://thewarren.app',
  },
  wcm_inc: {
    name: 'World Markets',
    description: 'Spot, perps, and lending — all CLOBs, all cross-margined on MegaETH. Run carry and basis trades with universal margin.',
    website: 'https://wcm.inc',
  },
  kumbaya_xyz: {
    name: 'Kumbaya',
    description: 'DEX focused on liquidity and trading on MegaETH. Culture-value flywheel.',
    website: 'https://kumbaya.xyz',
  },
  AveForge: {
    name: 'Ave Forge',
    description: 'On-chain competitive PvP mech battler on MegaETH. The crypto arena where mechs clash and players earn through risk.',
    website: null,
  },
  smasherdotfun: {
    name: 'Smasher',
    description: 'Gaming project natively built for MegaETH. Smash your way to a 100x.',
    website: 'https://smasher.fun',
  },
  stompdotgg: {
    name: 'stomp.gg',
    description: 'Super techy onchain monster PvP game on MegaETH.',
    website: 'https://stomp.gg',
  },
};

/**
 * Look up project display name, description, and website by handle.
 * Returns null fields for unknown handles.
 */
function getProject(handle) {
  return REGISTRY[handle] ?? { name: null, description: null, website: null };
}

module.exports = { REGISTRY, getProject };
