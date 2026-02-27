/**
 * Static project registry — canonical display names, descriptions, and websites
 * for all tracked MegaETH deployments. Keyed by X/Twitter handle (matches the
 * `project` column in tracker_deployments).
 *
 * Source: megaeth_projects.md.resolved
 * Update this file whenever new projects are added, then re-run the DB sync.
 */

const REGISTRY = {
  PriorityTrade_: {
    name: 'PriorityTrade',
    description: 'A fast Telegram trading bot designed for MegaETH, integrating with DEX aggregators to route trades.',
    website: null,
  },
  BasedTradingBot: {
    name: 'Based',
    description: '#1 Degen Trading Bot for executing trades across multiple chains, used for sniping launches and trading memecoins.',
    website: 'https://t.me/based_eth_bot',
  },
  GainsNetwork_io: {
    name: 'Gains Network',
    description: 'A decentralized leverage trading platform allowing users to trade crypto, forex, and commodities with up to 1000x leverage.',
    website: 'https://gains.trade',
  },
  birdeye_so: {
    name: 'Birdeye',
    description: 'All-in-one trading data tool: real-time price charts, smart money flows, undiscovered gems, rich historical data across 300+ exchanges.',
    website: 'https://birdeye.so',
  },
  AvailProject: {
    name: 'Avail',
    description: 'Creating a Unified Onchain Economy. Scaling access to users, apps, chains, and liquidity.',
    website: 'https://www.availproject.org',
  },
  BungeeExchange: {
    name: 'Bungee',
    description: 'A liquidity marketplace powered by Socket Protocol that lets you trade any token on any chain.',
    website: 'https://www.bungee.exchange',
  },
  aori_io: {
    name: 'Aori',
    description: 'Infrastructure for High-Frequency Intent Execution on any chain.',
    website: 'https://aori.io',
  },
  AiCrypts: {
    name: 'CryptsAI',
    description: 'Prompt-based RPG on MegaETH. Prompt your way through dungeons, compete for ETH prizes.',
    website: null,
  },
  bananagun: {
    name: 'Banana Gun',
    description: 'The best trading bot, built by on-chain traders.',
    website: 'https://www.bananagun.io',
  },
  chainlink: {
    name: 'Chainlink',
    description: 'The market-leading oracle platform bringing the global financial system onchain. Data, interoperability, compliance, privacy, and orchestration.',
    website: 'https://chain.link',
  },
  infinex: {
    name: 'Infinex',
    description: 'A new kind of crypto superapp. Unified portfolio, serious OpSec, built-in multi-provider trading.',
    website: 'https://infinex.xyz',
  },
  aave: {
    name: 'Aave',
    description: 'The most trusted financial network. Earn, borrow, save, and swap.',
    website: 'https://aave.com',
  },
  telisxyz: {
    name: 'Telis',
    description: 'One-way gas bridge for ETH from Base to MegaETH. Uses hedged perp positions on WCM for crosschain swaps.',
    website: 'https://telis.xyz',
  },
  LidoFinance: {
    name: 'Lido',
    description: 'Ethereum staking and DeFi liquid staking.',
    website: 'https://lido.fi',
  },
  redstone_defi: {
    name: 'RedStone',
    description: 'The data bedrock of the new financial system. Modular, cross-chain blockchain oracle supporting 1,000+ assets for DeFi and institutions.',
    website: 'https://redstone.finance',
  },
  capmoney_: {
    name: 'Cap',
    description: 'Stablecoin protocol with credible financial guarantees, built on Ethereum. First Type III stablecoin.',
    website: 'https://cap.money',
  },
  OffshoreOnMega: {
    name: 'OFFSHORE PROTOCOL',
    description: 'Build an international money laundering empire simulation on MegaETH. GambleFi project within the MegaETH ecosystem.',
    website: null,
  },
  realtime_defi: {
    name: 'Realtime DeFi',
    description: 'DeFi superapp on MegaETH: CLOB + AMM hybrid, launchpad, perps, and aggregator — vertically integrated in one app.',
    website: null,
  },
  clutchpredict: {
    name: 'Clutch Predict',
    description: 'AI-powered sports prediction tool integrating prediction markets into livestreams.',
    website: null,
  },
  mrdn_finance: {
    name: 'Meridian',
    description: 'Infrastructure for AI agent nano-services. x402 payment rails for the agent economy on Base and MegaETH.',
    website: null,
  },
  hitdotone: {
    name: 'Hit',
    description: 'Arcade Finance gamified DeFi: up to 1000x leverage on real markets within the MegaETH ecosystem.',
    website: 'https://hit.one',
  },
  fasterdotfun: {
    name: 'Faster',
    description: 'Fair Launch accelerated by badbunnz_. Create and trade memecoins instantly on MegaETH.',
    website: 'https://faster.fun',
  },
  mtrkr_xyz: {
    name: 'MTRKR',
    description: 'Visualize your MegaETH wallet in real time. Track on-chain activity, DeFi positions, NFTs, and gaming activity.',
    website: 'https://mtrkr.xyz',
  },
  premarket_xyz: {
    name: 'Premarket',
    description: 'Trading platform on MegaETH specialized in premarket options for upcoming TGEs, IPOs, and more. Built by Stryke.',
    website: 'https://premarket.xyz',
  },
  SupernovaLabs_: {
    name: 'Supernova Labs',
    description: 'Native rate exchange on MegaETH. Trade yields, hedge interest rates, crypto cross-rates, and FX. Team behind Streamer.',
    website: null,
  },
  avon_xyz: {
    name: 'Avon',
    description: 'The first real-time credit layer on MegaETH. First lending CLOB (Central Limit Order Book).',
    website: 'https://avon.xyz',
  },
  warpexchange: {
    name: 'WarpX',
    description: 'High-performance AMM / DEX built for the MegaETH real-time blockchain delivering ultra-fast swaps and efficient liquidity.',
    website: 'https://warpexchange.xyz',
  },
  SectorOneDEX: {
    name: 'SectorOne',
    description: 'Native DLMM DEX launching on MegaETH. The most efficient liquidity layer for traders and LPs.',
    website: null,
  },
  PrismFi_: {
    name: 'Prism FI',
    description: 'Your Spectrum of Financial Intelligence. Jupiter-style aggregation leveraging Uniswap V3 concentrated liquidity on MegaETH.',
    website: 'https://prism.fi',
  },
  TopStrikeIO: {
    name: 'TopStrike',
    description: 'Real-time, one-tap football player trading game powered by MegaETH — every moment on the pitch moves the market.',
    website: 'https://topstrike.io',
  },
  thewarren_app: {
    name: 'Warren',
    description: 'Decentralized Content Management System built entirely on the MegaETH network.',
    website: 'https://thewarren.app',
  },
  wcm_inc: {
    name: 'World Markets',
    description: 'Integrates leveraged finance into MegaETH: spot, perps, and lending (all CLOBs, cross-margined). Run carry and basis trades with universal margin.',
    website: 'https://wcm.inc',
  },
  kumbaya_xyz: {
    name: 'Kumbaya',
    description: 'DEX focused on liquidity and trading on MegaETH. Culture-value flywheel and cult formation venue.',
    website: 'https://kumbaya.xyz',
  },
  AveForge: {
    name: 'Ave Forge',
    description: 'On-chain competitive PvP mech battler game on MegaETH. The crypto arena where mechs clash and players earn through risk.',
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
