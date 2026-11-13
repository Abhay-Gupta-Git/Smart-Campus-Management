const express = require("express");
const classController = require("../controllers/classController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.get("/", authorizeRoles("admin", "faculty", "student"), classController.listClasses);
router.get("/:id/students", authorizeRoles("admin", "faculty"), classController.listClassStudents);
router.post("/", authorizeRoles("admin"), classController.createClass);
router.put("/:id", authorizeRoles("admin"), classController.updateClass);
router.delete("/:id", authorizeRoles("admin"), classController.deleteClass);

module.exports = router;
