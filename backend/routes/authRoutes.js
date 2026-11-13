const express = require("express");
const { register, login } = require("../controllers/authController");
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
