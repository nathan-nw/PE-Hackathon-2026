# Bottleneck Analysis

Before optimizing, our application became bottlenecked by redundant database queries and connection pool saturation under high concurrency (200+ users). We fixed this by introducing Redis as an in-memory caching layer for URL endpoints and rate limits, while also scaling horizontally with Nginx to distribute load across multiple application instances.
