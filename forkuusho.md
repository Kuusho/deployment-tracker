# forkuusho: The Deployment Intel Bot

## The Hook
MegaETH is a real-time blockchain. If you're waiting for a weekly newsletter to hear about new projects, you've already lost. The **Deployment Intel Bot** turns @megaeth's firehose into actionable signal.

## The Architecture
| Component | Tech | Responsibility |
| :--- | :--- | :--- |
| Harvester | Node.js + Twitter v2 | Polls for "Deployment detected" keywords. |
| Memory | JSON Store | Persists project handles, URLs, and timestamps. |
| Broadcaster | Telegram Bot API | Delivers real-time alerts to the inner circle. |
| Recapper | Nightly Script | Aggregates daily data for public engagement. |

## The War Room
### Lesson 1: Data is ephemeral, Context is King
Initially, we only tracked Tweet IDs. When it came time to write a "Nightly Recap" tweet, the bot had no idea *what* was actually deployed without doing 10 more API calls. We pivoted to a full metadata structure in `deployments-tracked.json`. We trade a few kilobytes of disk space for massive speed in content generation.

### Lesson 2: Twitter is the Front Door, Telegram is the Vault
We use Twitter to find the info, but we deliver it to Telegram because that's where the real builders live. It bypasses the algorithm and puts the alpha directly in their pockets.
