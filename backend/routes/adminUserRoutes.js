const express = require("express");
const adminUserController = require("../controllers/adminUserController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect, authorizeRoles("admin"));
router.post("/", adminUserController.provisionConfiguredAdmin);

module.exports = router;
