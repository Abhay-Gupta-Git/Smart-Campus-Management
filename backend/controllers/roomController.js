const mongoose = require("mongoose");
const Room = require("../models/Room");

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

async function createRoom(req, res) {
  try {
    const payload = roomPayload(req.body);
    const duplicate = await Room.findOne({ name: payload.name, building: payload.building })
      .collation({ locale: "en", strength: 2 });
    if (duplicate) return res.status(409).json({ message: "A room with this number already exists in this building." });
    const room = await Room.create(payload);
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
    return res.json({ message: "Room removed" });
  } catch (error) {
    return sendRoomError(res, error);
  }
}

module.exports = { listRooms, getRoom, createRoom, updateRoom, deleteRoom };
