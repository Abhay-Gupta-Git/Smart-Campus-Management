const mongoose = require("mongoose");
const Room = require("../models/Room");
const recordActivity = require("../utils/activityLog");

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
  if (error.code === 11000) {
    return res.status(409).json({ message: "A room with this number already exists in this building." });
  }
  if (error.name === "ValidationError" || error.name === "CastError") {
    return res.status(400).json({ message: error.message });
  }
  console.error("Room request failed:", error.message);
  return res.status(500).json({ message: "Room request failed" });
}

async function listRooms(req, res) {
  try {
    const rooms = await Room.find().sort("building name");
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
    const room = await Room.findById(req.params.id).select("+inspectionHistory");
    if (!room) return res.status(404).json({ message: "Room not found" });
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
    await room.save();
    await recordActivity({ actor: req.user.id, action: "Room inspected", entityType: "room", entityId: room._id, summary: `Facility inspection recorded for ${room.name} in ${room.building}.` });
    return res.json(room);
  } catch (error) {
    if (error.name === "ValidationError") return res.status(400).json({ message: error.message });
    console.error("Room inspection failed:", error.message);
    return res.status(500).json({ message: "Failed to save room inspection" });
  }
}

async function createRoom(req, res) {
  try {
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
    const room = await Room.findByIdAndDelete(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });
    await recordActivity({ actor: req.user.id, action: "Room deleted", entityType: "room", entityId: room._id, summary: `Deleted ${room.name} in ${room.building}.` });
    return res.json({ message: "Room removed" });
  } catch (error) {
    return sendRoomError(res, error);
  }
}

module.exports = { listRooms, getRoom, inspectRoom, createRoom, updateRoom, deleteRoom };
