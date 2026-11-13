function isValidEmail(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hasOnlyFields(body, allowedFields) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const allowed = new Set(allowedFields);
  return Object.keys(body).every((key) => allowed.has(key));
}

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

module.exports = { isValidEmail, hasOnlyFields, isValidDateString };
