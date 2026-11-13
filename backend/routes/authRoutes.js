const express = require("express");
const { register, login } = require("../controllers/authController");
const User = require("../models/User");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../middleware/rateLimit");
const router = express.Router();

const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, limit: 12, message: "Too many sign-in attempts. Try again later." });
const registerLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 8, message: "Too many account creation attempts. Try again later." });

router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);

router.get("/profile", protect, (req, res) => {
  return res.json({ user: req.user });
});

router.post("/logout", protect, async (req, res) => {
  try {
    const result = await User.updateOne(
      { _id: req.user.id },
      { $inc: { tokenVersion: 1 } },
    );
    if (!result.matchedCount) return res.status(401).json({ message: "Account no longer exists." });
    return res.json({ message: "Signed out. Active sessions have been invalidated." });
  } catch (error) {
    console.error("Session invalidation failed:", { actorId: req.user.id, error: error.name || "Error", code: error.code || "unknown" });
    return res.status(500).json({ message: "Unable to invalidate the current session." });
  }
});

router.get(
  "/student-dashboard",
  protect,
  authorizeRoles("student"),
  (req, res) => {
    return res.json({
      message: "Welcome to Student Dashboard",
      user: req.user,
    });
  },
);

router.get(
  "/faculty-dashboard",
  protect,
  authorizeRoles("faculty"),
  (req, res) => {
    return res.json({
      message: "Welcome to Faculty Dashboard",
      user: req.user,
    });
  },
);

router.get("/admin-dashboard", protect, authorizeRoles("admin"), (req, res) => {
  return res.json({ message: "Welcome to Admin Dashboard", user: req.user });
});

module.exports = router;
