const express = require("express");
const complaintController = require("../controllers/complaintController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();
router.use(protect);

router.get("/", complaintController.listComplaints);
router.post("/", authorizeRoles("admin", "faculty", "student", "technician"), complaintController.createComplaint);
router.patch("/:id/assign", authorizeRoles("admin"), complaintController.assignComplaint);
router.patch("/:id/work", authorizeRoles("technician"), complaintController.updateWork);
router.patch("/:id/verify", authorizeRoles("faculty"), complaintController.verifyRepair);
router.patch("/:id", authorizeRoles("admin"), complaintController.updateGenericComplaint);

module.exports = router;
