function createRateLimiter({ windowMs, limit, message }) {
  const hits = new Map();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of hits) if (bucket.resetAt <= now) hits.delete(key);
  }, Math.min(windowMs, 60_000));
  cleanup.unref?.();

  
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    let bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    hits.set(key, bucket);
    if (hits.size > 25_000) {
      for (const [candidate, value] of hits) {
        if (value.resetAt <= now) hits.delete(candidate);
      }
      while (hits.size > 25_000) hits.delete(hits.keys().next().value);
    }

    const remaining = Math.max(0, limit - bucket.count);
    res.set("RateLimit-Limit", String(limit));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
    if (bucket.count > limit) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ message });
    }
    return next();
  };
}

module.exports = { createRateLimiter };
