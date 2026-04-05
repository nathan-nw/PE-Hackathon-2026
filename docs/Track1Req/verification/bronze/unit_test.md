# 🥉 Bronze Tier Verification: Unit Tests

**Objective:** Create a test suite using `pytest`. Test individual functions in isolation to prove the code works before shipping.

### Test Automation & Isolation
Our codebase utilizes an extensive, isolated test suite built entirely around `pytest`. It is structurally segregated into modular blocks covering the various aspects of the architecture—including the core URL-shortener logic constraints, the Nginx load balancer integrations, and the Python dashboard metrics engine.

These unit tests operate seamlessly as an automated "Shield". They are seamlessly integrated into an automated CI environment, enforcing a strict defense mechanism that ensures every single commit passes the entire test suite successfully before it's permitted to reach production deployments.

### Local Execution Proof
Below is visual confirmation of our isolated test suite successfully passing tests on an individual module.

*(Screenshot of a green, passing test below)*


<img width="1116" height="779" alt="Screenshot 2026-04-05 at 9 38 14 AM" src="https://github.com/user-attachments/assets/14056043-4df5-4041-ad78-2bca31a48bd8" />

