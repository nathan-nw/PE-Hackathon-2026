# PostgreSQL replication (production orientation)

Docker Compose in this repo runs a **single** Postgres primary for development. For production, plan for:

## Backups

- **Logical dumps** (`pg_dump`) on a schedule — see the `db-backup` service in `docker-compose.yml` (daily retention example).
- **Point-in-time recovery (PITR)** via **WAL archiving** to object storage (e.g. S3-compatible) when you need RPO better than a daily logical dump.
- **Test restores** regularly (tabletop + automated restore to a scratch instance).

## Replication

- **Streaming replication** (physical): one primary, one or more standbys for read scaling and failover (Patroni, repmgr, or managed **RDS Multi-AZ** / **Cloud SQL HA** / **Azure Flexible Server**).
- **Logical replication** for selective tables or cross-version upgrades — higher operational complexity.

Managed databases typically expose **automatic failover** and **cross-region replicas**; self-hosted stacks need explicit **quorum**, **STONITH**, and **connection string** updates after promotion.

## Migrations

- Apply **versioned SQL** (this repo: `url-shortener/migrations/` + `scripts/apply_migrations.py`) or a tool such as Flyway / Alembic in CI **before** or **during** rollout, with **backward-compatible** steps when using rolling deploys (expand/contract pattern).

## Compose vs cloud

Compose does **not** model standby replicas or global LB HA; use **`k8s/`** manifests and your cloud provider’s managed LB + database for multi-AZ patterns.
