const express = require("express");
const roomController = require("../controllers/roomController");
const { protect, authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);
router.get("/", roomController.listRooms);
router.post("/", authorizeRoles("admin"), roomController.createRoom);
router.patch("/:id", authorizeRoles("admin"), roomController.updateRoom);
router.delete("/:id", authorizeRoles("admin"), roomController.deleteRoom);

module.exports = router;
