const express = require("express");
const facultyController = require("../controllers/facultyController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect, authorizeRoles("admin"));
router.get("/", facultyController.listFaculty);
router.post("/", facultyController.createFaculty);
router.patch("/:id", facultyController.updateFaculty);
router.delete("/:id", facultyController.deleteFaculty);

module.exports = router;
