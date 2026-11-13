function validateEnvironment(env = process.env) {
  if (!env.MONGO_URI) throw new Error("MONGO_URI is required.");
  if (!env.JWT_SECRET) throw new Error("JWT_SECRET is required.");
  const isProduction = env.NODE_ENV === "production";

  if (isProduction && (Buffer.byteLength(env.JWT_SECRET, "utf8") < 32 || /replace-with|change-me|example/i.test(env.JWT_SECRET))) {
    throw new Error("Production JWT_SECRET must be a private random value of at least 32 bytes.");
  }
  if (isProduction && !env.CLIENT_URL) throw new Error("CLIENT_URL must be configured in production.");

  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");

  const trustProxy = Number(env.TRUST_PROXY || 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 5) {
    throw new Error("TRUST_PROXY must be an integer from 0 to 5; configure only trusted proxy hops.");
  }

  const rawOrigins = env.CLIENT_URL || "http://localhost:5173";
  const origins = rawOrigins.split(",").map((value) => value.trim()).filter(Boolean).map((value) => {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error("CLIENT_URL must contain valid origin URLs."); }
    if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== value.replace(/\/$/, "")) {
      throw new Error("CLIENT_URL entries must be origins without paths or credentials.");
    }
    return parsed.origin;
  });
  return { port, trustProxy, origins, isProduction };
}

module.exports = { validateEnvironment };
