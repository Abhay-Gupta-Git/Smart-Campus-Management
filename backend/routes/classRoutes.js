const express = require("express");
const classController = require("../controllers/classController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.get("/", classController.listClasses);
router.post("/", authorizeRoles("admin"), classController.createClass);
router.put("/:id", authorizeRoles("admin"), classController.updateClass);
router.delete("/:id", authorizeRoles("admin"), classController.deleteClass);

module.exports = router;
