# Alerting Architecture & Discord Integration

The application has two independent alerting pipelines that act as its central nervous system—both actively route notifications directly to Discord.

## The Pipelines
1. **Pipeline 1: Infrastructure Metrics (Prometheus)**
   Catches major infrastructure-level issues like entire services going offline, or sustained latency/error rates using Prometheus metrics scraped every 15 seconds.
   `Flask Container -> Prometheus -> Alertmanager -> Discord Webhook`
   
2. **Pipeline 2: Real-time Application Logs (Kafka)**
   Catches individual bad requests in real-time. Every 5xx or ERROR log entry instantly triggers an alert within seconds via the Kafka logs consumer.
   `Flask Container -> Kafka -> Python Consumer -> Discord Webhook`

## Discord Setup Guide
To officially connect the system to your own Discord hackathon channel:
1. Go to Discord Server Settings > Integrations > Webhooks > New Webhook.
2. Copy the Webhook URL.
3. Paste it into your local `.env` file at the root of the repository:
   `DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...`
4. Docker Compose will automatically inject this into the `dashboard-backend`!
