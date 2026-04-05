# 🥇 Gold Tier Verification: Graceful Failure

**Objective:** Send bad inputs against the API. The application must return clean, sanitized errors (such as JSON payloads) and safely survive without crashing or leaking Python stack traces to the public.

### Global Exception Architecture
Our platform prevents unhandled crashes using a centralized `middleware.py` hook mechanism. This middleware acts as an overarching shield across all Flask API routes. Whenever an unexpected internal exception occurs (500), an invalid route is called (404), or structurally invalid data is encountered upon ingestion, this middleware catches it unconditionally. It suppresses any potentially sensitive runtime traces and formats a polite, structurally-predictable JSON error message back to the client.

### Live Setup & Verification Demo
To prove the system handles this gracefully, we will intentionally send absolute garbage input data to a critical pipeline and observe the server calmly refuse to crash.

**1. Send Garbage Data via Terminal:**
```bash
curl -X POST http://localhost:8080/shorten \
     -H "Content-Type: application/json" \
     -d '{"original_url": "ht://malformed", "user_id": "banana"}'
```

Because `user_id` strongly requires an integer schema and the system natively understands this, the backend will cleanly reject the bad payload. Instead of blowing up the WSGI processing thread, it returns a safe, polite JSON string explaining exactly why the data was refused. 

*(Capture a screenshot of your terminal executing the bad request and getting the safe JSON response back!)*

*[Insert Screenshot Here]*
