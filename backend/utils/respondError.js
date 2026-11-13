function respondError(res, error, operation, fallbackMessage) {
  if (error?.code === 11000) return res.status(409).json({ message: "A record with these details already exists." });
  if (["ValidationError", "CastError"].includes(error?.name)) return res.status(400).json({ message: "Request data is invalid." });
  console.error(`${operation} failed:`, { error: error?.name || "Error", code: error?.code || "unknown" });
  return res.status(500).json({ message: fallbackMessage });
}

module.exports = respondError;
