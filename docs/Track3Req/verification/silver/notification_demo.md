# 🥈 Silver Tier Verification: Notification Routing Demo

**Objective:** Execute a live infrastructure fire drill. Break the application explicitly and verify that the resulting emergency alerts are securely routed to an external human operator channel (Discord) within five minutes.

### The Routing Pipeline
When Prometheus mathematically evaluates that an alert threshold (such as `ServiceDown` or `HighErrorRate`) has broken its 2-minute safety barrier, it forwards the internal SOS signal to the central Alertmanager. 

Alertmanager doesn't just log the error into the void—it is rigorously configured to route the alert safely outside of our isolated docker infrastructure. It fires a targeted webhook payload explicitly to our dedicated engineering Discord channel. This guarantees that on-call operators, regardless of their location, receive an immediate, color-coded push notification the absolute second the cluster's integrity is verified to be compromised.

### Live Demo Verification
Below is the explicit visual verification proving that the end-to-end routing pipeline is fully functional constraint-wise. We intentionally broke the application infrastructure, and you can see the immediate push notification natively delivered to the designated operator channel!


<img width="1468" height="742" alt="Screenshot 2026-04-05 at 10 48 52 AM" src="https://github.com/user-attachments/assets/0f855bc0-8bc9-40c9-89bb-0d5c21e1ef9a" />
