# Error Handling

## Overview

The app uses Flask's `@app.errorhandler` decorators (registered in `app/middleware.py`) to return consistent JSON error responses for all error codes.

## 404 Not Found

Returned when a requested resource doesn't exist. This happens in two ways:

- **Global handler** — any `abort(404)` (e.g. when a short code isn't found during redirect) is caught and returns:
  ```json
  {"error": "Not found"}
  ```
- **Route-level** — individual endpoints return specific messages like `{"error": "URL not found"}` for more context.

## 500 Internal Server Error

Catches unhandled exceptions. The error is logged server-side for debugging, and the client receives a generic response to avoid leaking internals:

```json
{"error": "Internal server error"}
```

## Other Error Codes

| Code | Meaning                | Response                                          |
|------|------------------------|---------------------------------------------------|
| 429  | Rate limit exceeded    | `{"error": "Rate limit exceeded. Try again later."}` |
| 503  | Service unavailable    | `{"error": "Service temporarily unavailable"}`    |
| 503  | Database unavailable   | Detailed message with a hint about DB connectivity |
