const express = require("express");
const facultyController = require("../controllers/facultyController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../middleware/rateLimit");

const router = express.Router();
const accountMutationLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 20, message: "Too many account changes. Try again later." });

router.use(protect, authorizeRoles("admin"));
router.get("/", facultyController.listFaculty);
router.post("/", accountMutationLimiter, facultyController.createFaculty);
router.patch("/:id", accountMutationLimiter, facultyController.updateFaculty);
router.delete("/:id", facultyController.deleteFaculty);

module.exports = router;
