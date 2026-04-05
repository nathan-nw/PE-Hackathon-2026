# User Frontend Documentation

The User Frontend (`/user-frontend`) is a lightweight, zero-build single-page application (SPA) built entirely with vanilla HTML, CSS, and JavaScript.

## Architecture & Deployment
- **No Build Step:** The frontend doesn't use heavy frameworks like React or Node.js build processes. It relies entirely on a single `index.html` file and inline scripts.
- **Web Server:** Served incredibly fast using an `nginx:alpine` Docker container.
- **Dynamic Configuration:** Because static HTML cannot read Docker environment variables natively, the image uses a custom entrypoint script (`docker-entrypoint.d/25-api-config.sh`). When the container boots, it intercepts the `BACKEND_URL` environment variable and injects it into a generated `api-config.js` file. This lets the static frontend dynamically discover the backend API on load.

## Features
- **URL Shortening Interface:** A sleek UI to submit long URLs, assign User IDs, and request custom short codes.
- **Client-Side History:** Utilizes the browser's `localStorage` to automatically track and display recently created links without needing to query the database.
- **Database Browser:** Includes built-in paginated tables to browse all URLs in the database, check active statuses, and trigger actions like soft-deletions and reactivations.
- **Event Audit Logs:** Fetches and displays JSON audit events (creates, updates, deletes) for debugging URLs directly from the UI.
