# Scripts Directory Overview

The `/scripts` folder contains utility scripts designed to automate local development workflows and cloud deployment tasks. It generally provides cross-platform variations for Linux/macOS (`.sh`), Windows PowerShell (`.ps1`), and Windows Command Prompt (`.cmd`).

## Local Development
- **`start.sh` / `start.ps1` / `start.cmd`**
  General wrapper scripts to easily start the entire local Docker environment (`docker compose up --build -d`) so developers don't have to remember the exact flags.

- **`ensure-api-replicas.sh` / `ensure-api-replicas.ps1`**
  Automatically scales the backend API containers (e.g., to 2+ replicas) for local load testing (Silver/Gold tiers) and verifying Nginx load balancing without having to manually modify the Docker Compose files limit.

## Cloud Deployment (Railway)
- **`railway-provision.ps1`**
  A comprehensive automation script for Windows/PowerShell used to programmatically deploy the entire application infrastructure (PostgreSQL, Redis, Services) directly to Railway.

- **`seed-railway.sh` / `seed-railway.ps1`**
  Runs the database seeding tool (`seed.py`) securely against the remote Railway PostgreSQL database to populate it with sample URLs and user data for remote testing.

- **`ensure_railway_dashboard_db.py`**
  A Python utility that safely provisions and initializes the remote Railway database schemas upon a fresh cloud deployment.
