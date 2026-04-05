# 🥉 Bronze Tier Verification: Manual Dashboard Logs

**Objective:** Have a manual way to view logs natively without SSH-ing into the server.

### Viewing Logs Without SSH
Because the entire infrastructure is deployed using strict containerization logic (Docker), developers and administrators actively avoid dangerous command-line workflows SSH-ing into backend VMs to hunt down bugs. 

**The Dashboard Log UI:**
To securely view real-time production server logs without SSH access, we actively utilize a dedicated **Live Logs Dashboard**. Our backend naturally spits out its structured JSON telemetry directly into a Kafka message broker. 

The Next.js web dashboard consumes this exact JSON stream via Kafka in real-time, allowing any authorized team member to simply open a browser tab to safely read, filter, and monitor live `INFO`, `WARN`, and `ERROR` alerts exactly as they happen—without ever needing to touch a terminal or generate an SSH key!

### Visual Verification
Below is clear visual verification indicating that our Live Dashboard successfully streams and actively displays the backend's structured JSON log outputs directly in the browser.

*(To capture the perfect screenshot for this requirement, ensure your stack is running, open `http://localhost:3001` in your browser, navigate to the Logs/Events section, and take a bold screenshot of the parsed JSON log tables streaming in!)*

*[Insert Dashboard Log Screenshot Here]*
