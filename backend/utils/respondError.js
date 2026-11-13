const { isTransactionUnsupported } = require("./transactions");

function respondError(res, error, operation, fallbackMessage) {
  if (error?.code === 11000) return res.status(409).json({ message: "A record with these details already exists." });
  if (["ValidationError", "CastError"].includes(error?.name)) return res.status(400).json({ message: "Request data is invalid." });
  if (isTransactionUnsupported(error)) return res.status(503).json({ message: "This operation requires MongoDB transaction support. Configure MongoDB as a replica set and retry." });
  console.error(`${operation} failed:`, { error: error?.name || "Error", code: error?.code || "unknown" });
  return res.status(500).json({ message: fallbackMessage });
}

module.exports = respondError;
