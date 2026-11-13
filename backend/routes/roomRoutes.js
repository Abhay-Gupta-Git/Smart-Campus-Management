const express = require("express");
const roomController = require("../controllers/roomController");
const { recommendRooms } = require("../controllers/roomRecommendationController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.get("/recommendations", recommendRooms);
router.post("/:id/maintenance/recompute", authorizeRoles("admin"), roomController.recomputeMaintenance);
router.patch("/:id/inspection", authorizeRoles("admin", "faculty", "technician"), roomController.inspectRoom);
router.get("/", roomController.listRooms);
router.get("/:id", roomController.getRoom);
router.post("/", authorizeRoles("admin"), roomController.createRoom);
router.patch("/:id", authorizeRoles("admin"), roomController.updateRoom);
router.delete("/:id", authorizeRoles("admin"), roomController.deleteRoom);

module.exports = router;
