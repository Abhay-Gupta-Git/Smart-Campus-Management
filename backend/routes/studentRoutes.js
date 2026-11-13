const express = require("express");
const studentController = require("../controllers/studentController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const { createRateLimiter } = require("../middleware/rateLimit");
const router = express.Router();
const accountMutationLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 20, message: "Too many account changes. Try again later." });

router.use(protect);
router.get(
  "/",
  authorizeRoles("admin", "faculty"),
  studentController.listStudents,
);
router.post("/", authorizeRoles("admin"), accountMutationLimiter, studentController.createStudent);
router.patch("/:id", authorizeRoles("admin"), accountMutationLimiter, studentController.updateStudent);
router.delete("/:id", authorizeRoles("admin"), studentController.deleteStudent);

module.exports = router;
