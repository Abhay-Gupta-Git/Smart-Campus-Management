const express = require("express");
const studentController = require("../controllers/studentController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");
const router = express.Router();

router.use(protect);
router.get(
  "/",
  authorizeRoles("admin", "faculty"),
  studentController.listStudents,
);
router.post("/", authorizeRoles("admin"), studentController.createStudent);
router.patch("/:id", authorizeRoles("admin"), studentController.updateStudent);
router.delete("/:id", authorizeRoles("admin"), studentController.deleteStudent);

module.exports = router;
