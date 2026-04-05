# 🚨 In Case of Emergency: Incident Response Runbook

This guide tells you exactly what to do when an alert fires in Discord. Follow these steps calmly. You do not need deep technical knowledge to use this guide.

## 🔴 Critical Alerts (Act Now)

These alerts mean something is fundamentally broken and users are directly impacted.

### 1. `ServiceDown`
**What it means:** The entire application is completely offline. No users can access it.
**How to fix it:**
1. Check if the application containers stopped running:
   ```bash
   docker compose ps
   ```
2. Restart the app services to try to bring them back online:
   ```bash
   docker compose start url-shortener-a url-shortener-b
   ```
3. If they crash again immediately, check why they are crashing:
   ```bash
   docker compose logs url-shortener-a url-shortener-b
   ```

### 2. `APITargetDown`
**What it means:** One of our application servers crashed. The system is still partially running, but it has less capacity.
**How to fix it:**
1. Check the Discord alert to see which specific target went down (e.g. `url-shortener-a`).
2. Restart the crashed server:
   ```bash
   docker compose start url-shortener-a
   ```
3. Verify it is running again:
   ```bash
   docker compose ps
   ```

### 3. `HighErrorRate`
**What it means:** More than 10% of users are seeing immediate errors right now.
**How to fix it:**
1. This is usually caused by the database breaking. Check if the database (`db`) is running:
   ```bash
   docker compose ps
   ```
2. If the database is stopped or stuck, restart it:
   ```bash
   docker compose restart db
   ```
3. If the database was already running normally, you need to check the app logs to see what the exact error is:
   ```bash
   docker compose logs url-shortener-a | grep ERROR
   ```

---

## 🟠 Warning Alerts (Investigate Tomorrow)

These alerts mean the system is struggling but still working. You don't need to wake up for these, but review them during normal business hours.

### 1. `High5xxRate`
**What it means:** A steady stream of backend errors is happening, but it hasn't crossed the 10% critical threshold.
**How to investigate:** Look at the error logs. A single broken link or feature might be causing this for a specific group of users.

### 2. `HighLatencyP99`
**What it means:** The application is responding very slowly (taking longer than 2 seconds) for some users.
**How to investigate:** The database might need optimization, or the system might be receiving more traffic than it can handle. Check the metrics dashboard to see the total traffic volume.

### 3. `High429Rate`
**What it means:** Users are hitting our application too fast and getting blocked by our rate limiter.
**How to investigate:** Check the server logs. If it's a single IP address acting aggressively, they are already blocked automatically. If it's lots of normal users, we may need to increase our servers' capacities.
