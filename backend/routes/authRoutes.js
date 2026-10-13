
const express = require("express");
const router = express.Router();

const { register, login } = require("../controllers/authController");
const {protect,authorizeRoles} = require("../middleware/authMiddleware");

router.get("/profile", protect, (req, res) => {
  res.status(200).json({
    message: "Protected route accessed successfully",
    user: req.user
  });
});

router.get(
    "/student-dashboard",
    protect,
    authorizeRoles("student"),
    (req, res) => {
      res.json({
        message: "Welcome to Student Dashboard",
        user: req.user
      });
    }
  );
  
  router.get(
    "/faculty-dashboard",
    protect,
    authorizeRoles("faculty"),
    (req, res) => {
      res.json({
        message: "Welcome to Faculty Dashboard",
        user: req.user
      });
    }
  );
  
  router.get(
    "/admin-dashboard",
    protect,
    authorizeRoles("admin"),
    (req, res) => {
      res.json({
        message: "Welcome to Admin Dashboard",
        user: req.user
      });
    }
  );
  

router.post("/register", register);
router.post("/login", login);

module.exports = router;
