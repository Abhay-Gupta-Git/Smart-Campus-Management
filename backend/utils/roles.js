function normalizeRole(role) {
  const value = String(role || "").trim().toLowerCase();
  if (["admin", "administrator"].includes(value)) return "admin";
  if (["faculty", "teacher"].includes(value)) return "faculty";
  if (value === "student") return "student";
  if (["technician", "tech team", "tech_team"].includes(value)) return "technician";
  return null;
}

module.exports = { normalizeRole };
