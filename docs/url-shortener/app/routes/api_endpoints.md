# API Routes

The `routes/` directory contains the Flask blueprints that define every HTTP endpoint in the API backend.

## Route Blueprints
- **`urls.py`**: The primary router. Handles `POST /shorten`, `GET /urls`, `GET /<short_code>`, and handles the soft deletions or updates for individual links. This route interacts closely with `cache.py` to seamlessly bypass the database on cache hits.
- **`admin.py`**: Exposes secure tools like `POST /admin/bans/toggle` which allows system administrators (or automated load testers like k6) to temporarily disable the IP-banning defense mechanisms during stress tests. 
- **`users.py`**: Routes for fetching data specific to a given user, such as retrieving all owned URLs via `GET /users/<id>/urls`.
- **`events.py`**: Routes dedicated to exposing the audit logs (creations, deletions, reactivations) for a specific URL via `GET /urls/<url_id>/events`.
