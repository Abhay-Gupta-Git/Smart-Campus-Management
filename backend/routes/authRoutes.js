const express = require("express");
const { register, login } = require("../controllers/authController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);

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
