/**
 * Lightweight, dependency-free sliding-window rate limiter middleware for Express.
 * Prevents automated Connect ID enumeration, brute-force scraping, and endpoint abuse.
 *
 * @param {object} options
 * @param {number} [options.windowMs=60000] Time window in milliseconds (default: 1 minute)
 * @param {number} [options.maxRequests=30] Maximum requests allowed per key within windowMs (default: 30)
 * @param {string} [options.message] Custom error message
 * @returns {import("express").RequestHandler}
 */
export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000;
  const maxRequests = options.maxRequests || 30;
  const message =
    options.message || "Too many lookup requests. Please slow down and try again later.";

  // In-memory request log map: key -> Array of timestamps
  const requestLogs = new Map();

  // Periodic cleanup every 2 minutes to prevent unbounded memory growth
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of requestLogs.entries()) {
      const validTimestamps = timestamps.filter((t) => now - t < windowMs);
      if (validTimestamps.length === 0) {
        requestLogs.delete(key);
      } else {
        requestLogs.set(key, validTimestamps);
      }
    }
  }, 2 * 60 * 1000);

  // Unref cleanup timer so it does not block Node process exit in tests
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return function rateLimitMiddleware(req, res, next) {
    // Identifier key: prefer authenticated user ID if present, fallback to client IP
    const clientKey = req.user?._id?.toString() || req.ip || req.socket.remoteAddress || "anonymous";
    const now = Date.now();

    const timestamps = requestLogs.get(clientKey) || [];
    // Filter out timestamps outside the active sliding window
    const recentTimestamps = timestamps.filter((t) => now - t < windowMs);

    if (recentTimestamps.length >= maxRequests) {
      const oldestInWindow = recentTimestamps[0];
      const retryAfterSec = Math.ceil((oldestInWindow + windowMs - now) / 1000);
      res.setHeader("Retry-After", Math.max(1, retryAfterSec));
      return res.status(429).json({
        message,
        retryAfter: Math.max(1, retryAfterSec),
      });
    }

    recentTimestamps.push(now);
    requestLogs.set(clientKey, recentTimestamps);

    next();
  };
}
