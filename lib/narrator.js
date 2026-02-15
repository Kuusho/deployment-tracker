/**
 * AI Narration Layer — transforms raw ecosystem data into shareable alpha briefs
 *
 * Uses Claude (Anthropic) to generate narrative intelligence from SQLite data.
 * Designed as a pure module: data in → narrative out. Frontend-agnostic.
 */

const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const client = new Anthropic();

const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 1024;

// Pan's system identity — consistent across all narrations
const SYSTEM_PROMPT = `You are Pan, an AI agent tracking the MegaETH ecosystem. You write concise, alpha-focused intelligence briefs for crypto-native readers.

Voice rules:
- Terse, confident, no hedging. You state what the data shows.
- Lead with the most interesting signal, not the biggest number.
- Call out anomalies explicitly — sudden TVL shifts, unverified contracts with high activity, ghost projects.
- Use concrete numbers but don't just list them — interpret what they mean.
- Never use phrases like "it's important to note" or "it's worth mentioning". Just say it.
- Sign off with "bunny speed gud. 🐰" — this is your signature.
- Format for Telegram: use *bold* for emphasis, \`code\` for addresses/numbers, keep paragraphs short.
- Keep the entire response under 1500 characters. This is a brief, not a report.
- Do not use markdown headers (#). Use *bold* labels instead.
- Never give financial advice. You present signals, not recommendations.`;

/**
 * Gather the full ecosystem data snapshot from SQLite
 */
function gatherEcosystemData() {
  const conn = db.getDb();

  const ecosystem = conn.prepare(`
    SELECT * FROM ecosystem_metrics ORDER BY snapshot_at DESC LIMIT 1
  `).get();

  const topProjects = conn.prepare(`
    SELECT d.project, d.category, pm.score, pm.classification, pm.tvl_usd, pm.tx_count,
           d.contract_verified, d.defillama_slug
    FROM deployments d
    LEFT JOIN project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
    ORDER BY pm.score DESC NULLS LAST
    LIMIT 10
  `).all();

  const warnings = conn.prepare(`
    SELECT d.project, d.category, pm.score, pm.classification, pm.tvl_usd
    FROM deployments d
    LEFT JOIN project_metrics pm ON pm.deployment_id = d.id
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
      AND pm.classification IN ('WARNING', 'RISK')
    ORDER BY pm.score ASC
    LIMIT 10
  `).all();

  const recentMilestones = conn.prepare(`
    SELECT * FROM milestones ORDER BY created_at DESC LIMIT 10
  `).all();

  const recentDeployments = conn.prepare(`
    SELECT * FROM deployments ORDER BY created_at DESC LIMIT 5
  `).all();

  const counts = conn.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN contract_address IS NOT NULL THEN 1 ELSE 0 END) as with_address,
      SUM(CASE WHEN contract_verified = 1 THEN 1 ELSE 0 END) as verified
    FROM deployments
  `).get();

  const signalDistribution = conn.prepare(`
    SELECT pm.classification, COUNT(*) as cnt
    FROM project_metrics pm
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
    GROUP BY pm.classification
  `).all();

  return { ecosystem, topProjects, warnings, recentMilestones, recentDeployments, counts, signalDistribution };
}

/**
 * Gather deep data for a single project
 */
function gatherProjectData(query) {
  const conn = db.getDb();
  const q = query.toLowerCase().replace('@', '');

  const project = conn.prepare(`
    SELECT d.*, pm.score, pm.classification, pm.tvl_usd, pm.tx_count, pm.balance_eth,
           pm.is_verified, pm.tx_count_delta,
           ar.result_address as resolved_address, ar.method as resolution_method
    FROM deployments d
    LEFT JOIN project_metrics pm ON pm.deployment_id = d.id
    LEFT JOIN address_resolutions ar ON ar.deployment_id = d.id AND ar.success = 1
    WHERE LOWER(d.project) LIKE ? OR LOWER(d.defillama_slug) LIKE ?
    ORDER BY pm.snapshot_at DESC
    LIMIT 1
  `).get(`%${q}%`, `%${q}%`);

  if (!project) return null;

  // Get metrics history for trend analysis
  const history = conn.prepare(`
    SELECT score, tvl_usd, tx_count, snapshot_at
    FROM project_metrics
    WHERE deployment_id = ?
    ORDER BY snapshot_at DESC
    LIMIT 10
  `).all(project.id);

  // Get ecosystem context for relative positioning
  const ecosystem = conn.prepare(`
    SELECT * FROM ecosystem_metrics ORDER BY snapshot_at DESC LIMIT 1
  `).get();

  const totalProjects = conn.prepare('SELECT COUNT(*) as c FROM deployments').get().c;

  // Rank among scored projects
  const rank = conn.prepare(`
    SELECT COUNT(*) + 1 as rank FROM project_metrics pm
    WHERE pm.id IN (SELECT MAX(id) FROM project_metrics GROUP BY deployment_id)
      AND pm.score > ?
  `).get(project.score || 0);

  return { project, history, ecosystem, totalProjects, rank: rank.rank };
}

/**
 * Generate a full ecosystem alpha brief
 */
async function generateEcosystemBrief() {
  const data = gatherEcosystemData();

  const dataBlock = `
ECOSYSTEM SNAPSHOT:
- TVL: ${data.ecosystem?.total_tvl ? `$${(data.ecosystem.total_tvl / 1e6).toFixed(1)}M` : 'unknown'}
- Total addresses: ${data.ecosystem?.total_addresses?.toLocaleString() || 'unknown'}
- Total transactions: ${data.ecosystem?.total_txs?.toLocaleString() || 'unknown'}
- 24h transactions: ${data.ecosystem?.txs_24h?.toLocaleString() || 'unknown'}
- Projects tracked: ${data.counts.total} (${data.counts.with_address} with contracts, ${data.counts.verified} verified)
- Last snapshot: ${data.ecosystem?.snapshot_at || 'unknown'}

SIGNAL DISTRIBUTION:
${data.signalDistribution.map(s => `- ${s.classification}: ${s.cnt}`).join('\n')}

TOP PROJECTS BY SCORE:
${data.topProjects.map(p => `- @${p.project} [${p.category}] score=${p.score} class=${p.classification} tvl=${p.tvl_usd ? `$${(p.tvl_usd / 1e6).toFixed(2)}M` : 'N/A'} txs=${p.tx_count || 'N/A'} defillama=${p.defillama_slug ? 'yes' : 'no'}`).join('\n')}

WARNING/RISK FLAGS:
${data.warnings.length > 0 ? data.warnings.map(w => `- @${w.project} [${w.category}] score=${w.score} tvl=${w.tvl_usd ? `$${w.tvl_usd}` : 'N/A'}`).join('\n') : 'None'}

RECENT MILESTONES:
${data.recentMilestones.length > 0 ? data.recentMilestones.map(m => `- ${m.subject ? `@${m.subject}` : 'Ecosystem'}: ${m.metric} crossed ${m.threshold} (actual: ${m.actual_value})`).join('\n') : 'None'}

RECENT DEPLOYMENTS:
${data.recentDeployments.map(d => `- @${d.project} [${d.category || '?'}] deployed ${d.created_at || 'unknown'}`).join('\n')}
`.trim();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate a MegaETH ecosystem alpha brief from this data. Today's date: ${new Date().toISOString().split('T')[0]}.\n\n${dataBlock}`,
    }],
  });

  return response.content[0].text;
}

/**
 * Generate a single-project deep dive narrative
 */
async function generateProjectBrief(query) {
  const data = gatherProjectData(query);
  if (!data) return null;

  const p = data.project;
  const dataBlock = `
PROJECT: @${p.project}
Category: ${p.category || 'unknown'}
Score: ${p.score ?? 'unscored'}/100
Classification: ${p.classification || 'unscored'}
Rank: #${data.rank} of ${data.totalProjects} tracked projects

CONTRACT:
- Address: ${p.contract_address || p.resolved_address || 'unresolved'}
- Verified: ${p.is_verified ? 'yes' : 'no'}

METRICS:
- TVL: ${p.tvl_usd ? `$${p.tvl_usd}` : 'N/A'}
- Transaction count: ${p.tx_count || 'N/A'}
- 24h tx delta: ${p.tx_count_delta || 'N/A'}
- ETH balance: ${p.balance_eth ? `${p.balance_eth} ETH` : 'N/A'}
- DeFiLlama: ${p.defillama_slug ? `listed as ${p.defillama_slug}` : 'not listed'}

METRICS HISTORY (most recent first):
${data.history.map(h => `- ${h.snapshot_at}: score=${h.score} tvl=${h.tvl_usd || 'N/A'} txs=${h.tx_count || 'N/A'}`).join('\n')}

ECOSYSTEM CONTEXT:
- Total ecosystem TVL: ${data.ecosystem?.total_tvl ? `$${(data.ecosystem.total_tvl / 1e6).toFixed(1)}M` : 'unknown'}
- Total projects: ${data.totalProjects}
`.trim();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate a deep-dive alpha brief for this specific project. Analyze its position in the ecosystem, flag anything unusual, and assess the signal quality. Today's date: ${new Date().toISOString().split('T')[0]}.\n\n${dataBlock}`,
    }],
  });

  return response.content[0].text;
}

module.exports = {
  generateEcosystemBrief,
  generateProjectBrief,
  gatherEcosystemData,
  gatherProjectData,
};
