const express = require("express");
const complaintController = require("../controllers/complaintController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const complaintCreateLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 20, message: "Too many complaint submissions. Try again later." });
router.use(protect);

router.get("/", complaintController.listComplaints);
router.post("/", authorizeRoles("admin", "faculty", "student", "technician"), complaintCreateLimiter, complaintController.createComplaint);
router.patch("/:id/assign", authorizeRoles("admin"), complaintController.assignComplaint);
router.patch("/:id/work", authorizeRoles("technician"), complaintController.updateWork);
router.patch("/:id/verify", authorizeRoles("faculty"), complaintController.verifyRepair);
router.patch("/:id", authorizeRoles("admin"), complaintController.updateGenericComplaint);

module.exports = router;
