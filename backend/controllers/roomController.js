const Room = require("../models/Room");

async function listRooms(req, res) {
  try {
    const rooms = await Room.find().sort("building name");
    return res.json(rooms);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load classrooms" });
  }
}

async function createRoom(req, res) {
  try {
    const room = await Room.create(req.body);
    return res.status(201).json(room);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

async function updateRoom(req, res) {
  try {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    return res.json(room);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

async function deleteRoom(req, res) {
  try {
    const room = await Room.findByIdAndDelete(req.params.id);

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    return res.json({ message: "Room removed" });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
}

module.exports = { listRooms, createRoom, updateRoom, deleteRoom };
