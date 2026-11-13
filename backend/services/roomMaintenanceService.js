const Room = require("../models/Room");
const Complaint = require("../models/Complaint");
const { runTransaction, lockRoomReference } = require("../utils/transactions");

/** Rebuild the hold from stored equipment condition and every non-closed room issue. */
async function recomputeRoomMaintenanceState(roomId, { session, roomAlreadyLocked = false } = {}) {
  const recompute = async (activeSession) => {
    if (!roomAlreadyLocked && !await lockRoomReference(Room, roomId, activeSession)) return null;

    const room = await Room.findById(roomId).session(activeSession);
    if (!room) return null;

    const unresolvedComplaintCount = await Complaint.countDocuments({
      room: room._id,
      status: { $ne: "Closed" },
    }).session(activeSession);
    const faultyEquipment = (room.equipment || [])
      .filter((item) => !item || item.status !== "Working")
      .map((item) => item?.type || "Unknown");
    const maintenanceHold = unresolvedComplaintCount > 0 || faultyEquipment.length > 0;

    if (room.maintenanceHold !== maintenanceHold) {
      room.maintenanceHold = maintenanceHold;
      await room.save({ session: activeSession });
    }

    return { room, maintenanceHold, unresolvedComplaintCount, faultyEquipment };
  };

  return session ? recompute(session) : runTransaction(recompute);
}

module.exports = { recomputeRoomMaintenanceState };
