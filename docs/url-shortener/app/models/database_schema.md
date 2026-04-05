# Database Models

The `models/` directory defines the backend data structures mapped directly to the PostgreSQL schema using the **Peewee ORM**. 

## Schema Definitions
- **`URL` Model**: The central table containing the `original_url`, the generated `short_code`, ownership `user_id`, and tracking metadata like `is_active` (for soft deletes).
- **`Event` Model**: An audit logging table that tracks every modification made to a URL (e.g., when it was created, when it was soft-deleted, when it was visited). Used heavily by the routing blueprints to return historical audit data.
- **`User` Model / `Ban` Model**: Tracks active users and stores permanent or temporary IP ban records to strictly enforce rate limiting and platform security across all load balanced containers.

The models directly interface with `app/database.py` which manages the shared connection pool required to handle horizontal scaling without saturating PostgreSQL active connection limits.
