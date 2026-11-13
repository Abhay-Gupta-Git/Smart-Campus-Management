const express = require("express");
const adminUserController = require("../controllers/adminUserController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();
router.use(protect, authorizeRoles("admin"));
const provisionLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 10, message: "Too many account provisioning requests. Try again later." });
router.get("/technicians", adminUserController.listTechnicians);
router.post("/technicians", provisionLimiter, adminUserController.provisionTechnician);
router.post("/", provisionLimiter, adminUserController.provisionConfiguredAdmin);

module.exports = router;
