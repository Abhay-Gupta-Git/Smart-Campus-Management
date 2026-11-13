const mongoose = require("mongoose");
const Room = require("../models/Room");
const recordActivity = require("../utils/activityLog");
const { hasOnlyFields } = require("../utils/validation");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");
const CampusClass = require("../models/CampusClass");
const Booking = require("../models/Booking");
const Complaint = require("../models/Complaint");
const { runTransaction, isTransactionUnsupported, lockRoomReference } = require("../utils/transactions");
const { recomputeRoomMaintenanceState } = require("../services/roomMaintenanceService");

const allowedFields = ["name", "building", "floor", "capacity", "type", "available", "facilities"];

function roomPayload(body) {
  return Object.fromEntries(allowedFields
    .filter((field) => Object.hasOwn(body, field))
    .map((field) => [field, body[field]]));
}

function invalidId(id) {
  return !mongoose.isValidObjectId(id);
}

function sendRoomError(res, error) {
  if (isTransactionUnsupported(error)) return res.status(503).json({ message: "Room deletion requires MongoDB transaction support. Configure MongoDB as a replica set and retry." });
  if (error.code === 11000) {
    return res.status(409).json({ message: "A room with this number already exists in this building." });
  }
  if (error.name === "ValidationError" || error.name === "CastError") {
    return res.status(400).json({ message: error.message });
  }
  console.error("Room request failed:", error.name || "Error");
  return res.status(500).json({ message: "Room request failed" });
}

async function listRooms(req, res) {
  try {
    const filter = {};
    const clauses = [];
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const search = readSearch(req, res);
    if (search === false) return;
    const sort = readSort(req, res, ["name", "building", "floor", "capacity", "type", "available", "createdAt"], "building");
    if (sort === false) return;
    if (req.query.recordId !== undefined) {
      if (!invalidId(req.query.recordId)) filter._id = req.query.recordId;
      else return res.status(400).json({ message: "Record filter is invalid." });
    }
    if (search) clauses.push({ $or: ["name", "building", "facilities"].map((field) => ({
      [field]: { $regex: escapeRegex(search), $options: "i" },
    })) });
    if (req.query.building !== undefined) {
      if (typeof req.query.building !== "string" || req.query.building.trim().length > 80) return res.status(400).json({ message: "Building filter must be 80 characters or fewer." });
      if (req.query.building.trim()) filter.building = { $regex: escapeRegex(req.query.building.trim()), $options: "i" };
    }
    if (req.query.type !== undefined) {
      const validTypes = ["Classroom", "Lecture Hall", "Laboratory", "Meeting Room", "Auditorium", "Other"];
      if (!validTypes.includes(req.query.type)) return res.status(400).json({ message: "Room type filter is invalid." });
      filter.type = req.query.type;
    }
    if (req.query.available !== undefined) {
      if (!["true", "false"].includes(req.query.available)) return res.status(400).json({ message: "Availability filter must be true or false." });
      filter.available = req.query.available === "true";
    }
    if (req.query.operational !== undefined) {
      const equipment = ["Fan", "AC", "Projector", "Light"];
      const faultFilter = { equipment: { $elemMatch: { status: { $in: ["Not Working", "Needs Maintenance"] } } } };
      if (req.query.operational === "Operational") {
        clauses.push({ $and: [
          { maintenanceHold: { $ne: true } },
          ...equipment.map((type) => ({ equipment: { $elemMatch: { type, status: "Working" } } })),
        ] });
      } else if (req.query.operational === "Maintenance required") {
        clauses.push({ $or: [{ maintenanceHold: true }, faultFilter] });
      } else if (req.query.operational === "Not inspected") {
        clauses.push({ $and: [
          { maintenanceHold: { $ne: true } },
          { $nor: [faultFilter] },
          { $or: equipment.map((type) => ({ equipment: { $not: { $elemMatch: { type } } } })) },
        ] });
      } else return res.status(400).json({ message: "Inspection status filter is invalid." });
    }
    if (clauses.length) filter.$and = [...(filter.$and || []), ...clauses];
    const rooms = await executeListQuery({ query: Room.find(filter)
      .select("name building floor capacity type facilities equipment maintenanceHold available createdAt updatedAt")
      .sort(sort), Model: Room, filter, pagination, res });
    return res.json(rooms);
  } catch (error) {
    return sendRoomError(res, error);
  }
}

async function getRoom(req, res) {
  if (invalidId(req.params.id)) return res.status(400).json({ message: "Invalid room ID" });
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });
    return res.json(room);
  } catch (error) {
    return sendRoomError(res, error);
  }
}

async function inspectRoom(req, res) {
  if (invalidId(req.params.id)) return res.status(400).json({ message: "Invalid room ID" });
  const allowedTypes = ["Fan", "AC", "Projector", "Light"];
  const allowedStatuses = ["Working", "Not Working", "Needs Maintenance"];
  const equipment = req.body?.equipment;
  if (!Array.isArray(equipment) || equipment.length !== allowedTypes.length ||
    equipment.some((item) => !item || typeof item !== "object") ||
    new Set(equipment.map((item) => item.type)).size !== allowedTypes.length ||
    equipment.some((item) => !allowedTypes.includes(item.type) || !allowedStatuses.includes(item.status) ||
      (item.note !== undefined && (typeof item.note !== "string" || item.note.length > 500)))) {
    return res.status(400).json({ message: "Submit one condition for each fan, AC, projector, and light." });
  }
  try {
    const result = await runTransaction(async (session) => {
      if (!await lockRoomReference(Room, req.params.id, session)) return null;
      const room = await Room.findById(req.params.id).select("+inspectionHistory").session(session);
      if (!room) return null;
      const inspectedAt = new Date();
      const inspectedEquipment = equipment.map((item) => ({
        type: item.type,
        status: item.status,
        note: item.note?.trim() || "",
        inspectedBy: req.user.id,
        inspectedAt,
      }));
      room.inspectionHistory.push({ equipment: inspectedEquipment, recordedAt: inspectedAt });
      room.equipment = inspectedEquipment;
      await room.save({ session });
      const maintenance = await recomputeRoomMaintenanceState(room._id, { session, roomAlreadyLocked: true });
      return maintenance?.room || null;
    });
    if (!result) return res.status(404).json({ message: "Room not found" });
    const room = result;
    await recordActivity({ actor: req.user.id, action: "Room inspected", entityType: "room", entityId: room._id, summary: `Facility inspection recorded for ${room.name} in ${room.building}.` });
    return res.json(room);
  } catch (error) {
    if (isTransactionUnsupported(error)) return res.status(503).json({ message: "Room inspection requires MongoDB transaction support. Configure MongoDB as a replica set and retry." });
    if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
    console.error("Room inspection failed:", JSON.stringify({ event: "room_inspection_failed", roomId: req.params.id, actorId: req.user.id, error: error.name || "Error", code: error.code || "unknown" }));
    return res.status(500).json({ message: "Failed to save room inspection" });
  }
}

async function recomputeMaintenance(req, res) {
  if (invalidId(req.params.id)) return res.status(400).json({ message: "Invalid room ID" });
  try {
    const result = await recomputeRoomMaintenanceState(req.params.id);
    if (!result) return res.status(404).json({ message: "Room not found" });
    await recordActivity({ actor: req.user.id, action: "Room maintenance state recomputed", entityType: "room", entityId: result.room._id, summary: `Recomputed maintenance state for ${result.room.name} in ${result.room.building}.` });
    return res.json({
      room: result.room,
      maintenanceHold: result.maintenanceHold,
      unresolvedComplaintCount: result.unresolvedComplaintCount,
      faultyEquipment: result.faultyEquipment,
    });
  } catch (error) {
    console.error("Room maintenance recovery failed:", JSON.stringify({ event: "room_maintenance_recompute_failed", roomId: req.params.id, actorId: req.user.id, error: error.name || "Error", code: error.code || "unknown" }));
    if (isTransactionUnsupported(error)) return res.status(503).json({ message: "Maintenance state recovery requires MongoDB transaction support. Configure MongoDB as a replica set and retry." });
    return res.status(500).json({ message: "Failed to recompute room maintenance state." });
  }
}

async function createRoom(req, res) {
  try {
    if (!hasOnlyFields(req.body, allowedFields)) return res.status(400).json({ message: "Request contains unsupported fields." });
    const payload = roomPayload(req.body);
    const duplicate = await Room.findOne({ name: payload.name, building: payload.building })
      .collation({ locale: "en", strength: 2 });
    if (duplicate) return res.status(409).json({ message: "A room with this number already exists in this building." });
    const room = await Room.create(payload);
    await recordActivity({ actor: req.user.id, action: "Room created", entityType: "room", entityId: room._id, summary: `Created ${room.name} in ${room.building}.` });
    return res.status(201).json(room);
  } catch (error) {
    return sendRoomError(res, error);
  }
}

async function updateRoom(req, res) {
  if (invalidId(req.params.id)) return res.status(400).json({ message: "Invalid room ID" });
  try {
    if (!hasOnlyFields(req.body, allowedFields)) return res.status(400).json({ message: "Request contains unsupported fields." });
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });
    const payload = roomPayload(req.body);
    const duplicate = await Room.findOne({
      name: payload.name ?? room.name,
      building: payload.building ?? room.building,
      _id: { $ne: room._id },
    }).collation({ locale: "en", strength: 2 });
    if (duplicate) return res.status(409).json({ message: "A room with this number already exists in this building." });
    Object.assign(room, payload);
    await room.save();
    await recordActivity({ actor: req.user.id, action: "Room updated", entityType: "room", entityId: room._id, summary: `Updated ${room.name} in ${room.building}.` });
    return res.json(room);
  } catch (error) {
    return sendRoomError(res, error);
  }
}

async function deleteRoom(req, res) {
  if (invalidId(req.params.id)) return res.status(400).json({ message: "Invalid room ID" });
  try {
    const result = await runTransaction(async (session) => {
      const room = await Room.findById(req.params.id).select("+inspectionHistory").session(session);
      if (!room) return { status: 404, message: "Room not found" };

      const lock = await Room.updateOne(
        { _id: room._id },
        { $inc: { referenceVersion: 1 } },
        { session },
      );
      if (!lock.matchedCount) return { status: 404, message: "Room not found" };

      const classes = await CampusClass.countDocuments({ room: room._id }).session(session);
      const bookings = await Booking.countDocuments({ room: room._id }).session(session);
      const maintenanceComplaints = await Complaint.countDocuments({ room: room._id }).session(session);
      const inspections = room.inspectionHistory.length || Number(room.equipment.some((item) => item.inspectedAt || item.inspectedBy));
      const references = { classes, bookings, inspections, maintenanceComplaints };
      if (Object.values(references).some(Boolean)) {
        return { status: 409, message: "Room cannot be deleted while classes, bookings, inspections, or maintenance complaints reference it.", references };
      }

      await Room.deleteOne({ _id: room._id }, { session });
      return { status: 200, room };
    });

    if (result.status !== 200) return res.status(result.status).json({ message: result.message, ...(result.references ? { references: result.references } : {}) });
    const room = result.room;
    await recordActivity({ actor: req.user.id, action: "Room deleted", entityType: "room", entityId: room._id, summary: `Deleted ${room.name} in ${room.building}.` });
    return res.json({ message: "Room removed" });
  } catch (error) {
    return sendRoomError(res, error);
  }
}

module.exports = { listRooms, getRoom, inspectRoom, recomputeMaintenance, createRoom, updateRoom, deleteRoom };
