# MegaETH Deployment Tracker

Autonomous bot that monitors @megaeth for deployment announcements and sends real-time alerts to Telegram.

## Architecture

**Standalone Infrastructure** - Does NOT require Pan/OpenClaw to be online.

- **Harvester**: Polls Twitter API for "deployment detected" tweets
- **Storage**: JSON persistence in `memory/deployments-tracked.json`
- **Alerting**: Telegram Bot API for instant notifications
- **Logging**: `deployment-tracker.log` for debugging

## Setup

### 1. Install Dependencies
```bash
cd /home/kuusho/ideation-labs/megashETH-labs/deployment-tracker
npm install
```

### 2. Configure Credentials
Credentials are stored in `.env` (already configured):
- Twitter API keys
- Telegram bot token
- Telegram channel ID

### 3. Test Manually
```bash
./run-tracker.sh
```

### 4. Set Up Cron (Autonomous 24/7)

Add to crontab (`crontab -e`):

```cron
# Run deployment tracker every 10 minutes
*/10 * * * * /home/kuusho/ideation-labs/megashETH-labs/deployment-tracker/run-tracker.sh
```

Or every 5 minutes for high-frequency monitoring:
```cron
*/5 * * * * /home/kuusho/ideation-labs/megashETH-labs/deployment-tracker/run-tracker.sh
```

## Usage

### Manual Run
```bash
node scripts/deployment-tracker.js
```

### Check Logs
```bash
tail -f deployment-tracker.log
```

### View Tracked Deployments
```bash
cat memory/deployments-tracked.json
```

## Output

When a new deployment is detected:

1. **Telegram Alert** → Sent to `@kuusho_shouten`
2. **JSON Log** → Saved to `memory/deployments-tracked.json`
3. **Terminal Log** → Written to `deployment-tracker.log`

Example telegram message:
```
🚀 New MegaETH Deployment Detected!

📦 Project: @example_project
📅 Time: 2026-02-10T12:34:56.789Z

🔗 View Tweet

#MegaETH #Deployment
```

## Files

- `scripts/deployment-tracker.js` - Main monitoring script
- `scripts/nightly-recap.js` - Daily digest generator
- `memory/deployments-tracked.json` - Persistent storage
- `deployment-tracker.log` - Error and status logs
- `.env` - Credentials (DO NOT COMMIT)
- `run-tracker.sh` - Cron wrapper script

## Monitoring

Check if the bot is working:
```bash
# View recent logs
tail -20 deployment-tracker.log

# Check last run timestamp
ls -lh deployment-tracker.log

# Verify cron is running
crontab -l | grep deployment
```

## Troubleshooting

**No alerts?**
- Check Twitter API rate limits
- Verify @megaeth hasn't changed tweet format
- Check logs: `tail deployment-tracker.log`

**Telegram not working?**
- Verify bot is admin in channel
- Test with: `curl "https://api.telegram.org/bot<TOKEN>/sendMessage" -d "chat_id=@kuusho_shouten" -d "text=test"`

**Cron not running?**
- Check cron is enabled: `systemctl status cron` (Linux) or `launchctl list | grep cron` (macOS)
- Check cron logs: `grep CRON /var/log/syslog`
