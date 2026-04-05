# 🥇 Gold Tier Verification: Chaos Mode Restart

**Objective:** Kill the application process or container while it's actively handling traffic. Verify that the system is resilient enough to detect the fatal crash and resurrect itself automatically without human intervention.

### Infrastructure Resilience
To defend against unpredictable 3 AM outages, we didn't just write defensive Python code; we actively configured infrastructure-level resurrection policies. In our Docker Compose configuration, the critical backend API services are explicitly governed by automatic lifecycle policies (such as `restart: always`). 

If a container's main process crashes—whether due to an Out-Of-Memory exception, an underlying fatal kernel error, or manual intervention by an engineer simulating a Chaos Engineering event—the Docker engine instantly detects the container halting. Rather than leaving a permanent hole in the API cluster, it automatically spins up a fresh container replacement within seconds to restore service availability.

### Restart Verification
Below is visual evidence confirming that the service automatically recovered, resurrected itself, and reset its uptime clock immediately after we brutally forced a failure using `docker stop` / `docker kill` during our Chaos Mode testing pipeline or through our dashboard.
![image](https://github.com/user-attachments/assets/4bde1bc3-29e4-49bd-972c-89384b7bd95b)
![image (1)](https://github.com/user-attachments/assets/7567ac1f-4f49-4bfb-b79f-f9469e53c9b6)
![image (2)](https://github.com/user-attachments/assets/5f60e5c2-22e5-4657-b547-2e35dc02451c)

