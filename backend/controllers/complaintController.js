const mongoose = require("mongoose");
const Complaint = require("../models/Complaint");
const Notification = require("../models/Notification");
const Room = require("../models/Room");
const User = require("../models/User");

const equipmentTypes = ["Fan", "AC", "Projector", "Light"];
const priorities = ["Low", "Normal", "High", "Urgent"];
const statuses = ["Open", "In progress", "Pending Verification", "Resolved", "Closed"];

async function notifyUsers(recipients, complaint, title, message) {
  const uniqueIds = [...new Set(recipients.filter(Boolean).map((id) => id.toString()))];
  if (!uniqueIds.length) return;
  try {
    await Notification.insertMany(uniqueIds.map((recipient) => ({ recipient, complaint: complaint?._id || complaint || null, title, message })));
  } catch (error) {
    console.error("Complaint notification failed:", error.message);
  }
}

async function notifyRole(role, complaint, title, message, extraRecipients = []) {
  try {
    const users = await User.find({ role }).select("_id").lean();
    await notifyUsers([...users.map((user) => user._id), ...extraRecipients], complaint, title, message);
  } catch (error) {
    console.error("Role notification failed:", error.message);
  }
}

function populatedComplaints(query) {
  return query
    .populate("room", "name building equipment")
    .populate("submittedBy", "name")
    .populate("assignedTo", "name")
    .populate("verifiedBy", "name")
    .populate("history.actor", "name role");
}

function validId(id) {
  return mongoose.isValidObjectId(id);
}

function roomLabel(room) {
  return room ? `${room.name} in ${room.building}` : "Campus complaint";
}

async function listComplaints(req, res) {
  try {
    let baseFilter = {};
    if (req.user.role === "technician") baseFilter = { assignedTo: req.user.id };
    else if (req.user.role === "student") baseFilter = { submittedBy: req.user.id };
    else if (req.user.role === "faculty") {
      baseFilter = { $or: [{ submittedBy: req.user.id }, { room: { $ne: null }, status: "Pending Verification" }] };
    }

    const filterParts = [baseFilter];
    if (req.query.room) {
      if (!validId(req.query.room)) return res.status(400).json({ message: "Invalid room filter." });
      filterParts.push({ room: req.query.room });
    }
    if (req.query.priority) {
      if (!priorities.includes(req.query.priority)) return res.status(400).json({ message: "Invalid priority filter." });
      filterParts.push({ priority: req.query.priority });
    }
    if (req.query.status) {
      if (!statuses.includes(req.query.status)) return res.status(400).json({ message: "Invalid status filter." });
      filterParts.push({ status: req.query.status });
    }
    if (req.user.role === "admin" && req.query.assignee) {
      if (req.query.assignee === "unassigned") filterParts.push({ assignedTo: null });
      else if (!validId(req.query.assignee)) return res.status(400).json({ message: "Invalid assignee filter." });
      else filterParts.push({ assignedTo: req.query.assignee });
    }

    const filter = filterParts.length === 1 ? filterParts[0] : { $and: filterParts };
    const complaints = await populatedComplaints(Complaint.find(filter).sort("-createdAt"));
    return res.json(complaints);
  } catch (error) {
    console.error("List complaints failed:", error.message);
    return res.status(500).json({ message: "Failed to load maintenance notices." });
  }
}

async function createComplaint(req, res) {
  const body = req.body || {};
  if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 160 ||
    typeof body.description !== "string" || !body.description.trim() || body.description.trim().length > 3000) {
    return res.status(400).json({ message: "A title and issue description are required." });
  }
  if (body.room && (!validId(body.room) || !equipmentTypes.includes(body.equipment))) {
    return res.status(400).json({ message: "Choose a valid room and equipment type for a facility issue." });
  }
  if (!body.room && body.equipment) return res.status(400).json({ message: "Equipment can only be specified for a room issue." });
  const priority = body.priority || "Normal";
  if (!priorities.includes(priority)) return res.status(400).json({ message: "Choose a valid priority." });
  try {
    if (body.room && !(await Room.exists({ _id: body.room }))) return res.status(404).json({ message: "Room not found." });
    const complaint = await Complaint.create({
      title: body.title.trim(),
      description: body.description.trim(),
      category: typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 80) : body.room ? "Room maintenance" : "General",
      room: body.room || null,
      equipment: body.room ? body.equipment : null,
      priority,
      submittedBy: req.user.id,
      history: [{ actor: req.user.id, action: body.room ? "Facility issue reported" : "Complaint submitted", note: body.description.trim() }],
    });
    if (complaint.room) {
      const room = await Room.findById(complaint.room);
      if (room) {
        const item = room.equipment.find((entry) => entry.type === complaint.equipment);
        const reportedEquipment = {
          type: complaint.equipment,
          status: "Not Working",
          note: "Fault reported; see maintenance complaint.",
        };
        if (item) Object.assign(item, reportedEquipment);
        else room.equipment.push(reportedEquipment);
        room.maintenanceHold = true;
        await room.save();
      }
      await notifyRole("admin", complaint, "New facility issue", `${complaint.equipment} issue reported in ${await getRoomLabel(complaint.room)}.`);
    }
    return res.status(201).json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Create complaint failed:", error.message);
    return res.status(400).json({ message: "Unable to submit complaint. Check the required fields." });
  }
}

async function getRoomLabel(roomId) {
  const room = await Room.findById(roomId).select("name building").lean();
  return room ? roomLabel(room) : "the room";
}

async function assignComplaint(req, res) {
  const { id } = req.params;
  const { note = "" } = req.body || {};
  const technicianId = req.body?.technicianId || null;
  if (!validId(id)) return res.status(400).json({ message: "Invalid complaint ID." });
  if (technicianId !== null && !validId(technicianId)) return res.status(400).json({ message: "Choose a valid technician." });
  if (typeof note !== "string" || note.length > 1000) return res.status(400).json({ message: "Assignment note must be 1,000 characters or fewer." });
  try {
    const complaint = await Complaint.findById(id);
    if (!complaint) return res.status(404).json({ message: "Complaint not found." });
    if (!complaint.room) return res.status(400).json({ message: "Technician assignments are for room facility complaints." });
    if (["Closed", "Resolved"].includes(complaint.status)) return res.status(409).json({ message: "Closed complaints cannot be reassigned." });
    let technician = null;
    if (technicianId) {
      technician = await User.findOne({ _id: technicianId, role: "technician" }).select("_id name");
      if (!technician) return res.status(404).json({ message: "Technician account not found." });
    }
    const previousAssignee = complaint.assignedTo;
    const oldStatus = complaint.status;
    complaint.assignedTo = technician?._id || null;
    complaint.status = technician ? "In progress" : "Open";
    complaint.verifiedBy = null;
    complaint.verifiedAt = null;
    complaint.verificationNote = "";
    complaint.history.push({ actor: req.user.id, action: technician ? "Assigned to technician" : "Technician assignment cleared", note: note.trim(), fromStatus: oldStatus, toStatus: complaint.status });
    await complaint.save();
    const label = await getRoomLabel(complaint.room);
    await notifyUsers([complaint.submittedBy, previousAssignee, technician?._id], complaint, technician ? "Maintenance issue assigned" : "Maintenance assignment updated", `${complaint.equipment} issue for ${label} is ${technician ? `assigned to ${technician.name}` : "unassigned"}.`);
    return res.json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Assign complaint failed:", error.message);
    return res.status(500).json({ message: "Failed to assign maintenance issue." });
  }
}

async function updateWork(req, res) {
  const { id } = req.params;
  const { status, note = "", resolutionDetails = "", evidence = [] } = req.body || {};
  if (!validId(id)) return res.status(400).json({ message: "Invalid complaint ID." });
  if (!["In progress", "Pending Verification"].includes(status)) return res.status(400).json({ message: "Work status must be In progress or Pending Verification." });
  if (typeof note !== "string" || note.trim().length > 2000) return res.status(400).json({ message: "Work update must be 2,000 characters or fewer." });
  if (status === "Pending Verification" && (typeof resolutionDetails !== "string" || !resolutionDetails.trim())) return res.status(400).json({ message: "Resolution details are required before requesting verification." });
  if (typeof resolutionDetails !== "string" || resolutionDetails.length > 3000) return res.status(400).json({ message: "Resolution details must be 3,000 characters or fewer." });
  if (!Array.isArray(evidence) || evidence.length > 5 || (status === "Pending Verification" && evidence.length === 0) || evidence.some((item) => typeof item !== "string" || item.length > 1000 || !/^https?:\/\//i.test(item))) return res.status(400).json({ message: "Submit at least one and at most five HTTP or HTTPS evidence links with a repair." });
  try {
    const complaint = await Complaint.findOne({ _id: id, assignedTo: req.user.id, room: { $ne: null } });
    if (!complaint) return res.status(404).json({ message: "Assigned facility complaint not found." });
    if (!["Open", "In progress"].includes(complaint.status)) return res.status(409).json({ message: "This issue is awaiting verification or already closed." });
    const oldStatus = complaint.status;
    complaint.status = status;
    if (status === "Pending Verification") {
      complaint.resolutionDetails = resolutionDetails.trim();
      complaint.resolutionEvidence = evidence;
      complaint.verifiedBy = null;
      complaint.verifiedAt = null;
      complaint.verificationNote = "";
    }
    complaint.history.push({
      actor: req.user.id,
      action: status === "Pending Verification" ? "Repair submitted for faculty verification" : "Work progress updated",
      note: note.trim() || (status === "Pending Verification" ? resolutionDetails.trim() : ""),
      fromStatus: oldStatus,
      toStatus: status,
      evidence,
    });
    await complaint.save();
    const label = await getRoomLabel(complaint.room);
    await notifyUsers([complaint.submittedBy, req.user.id], complaint, status === "Pending Verification" ? "Repair ready for verification" : "Maintenance work updated", `${complaint.equipment} issue for ${label}: ${status === "Pending Verification" ? "repair submitted for faculty verification" : "work progress updated"}.`);
    await notifyRole("admin", complaint, "Maintenance work updated", `${complaint.equipment} issue for ${label} is now ${status}.`);
    if (status === "Pending Verification") await notifyRole("faculty", complaint, "Repair needs verification", `${complaint.equipment} repair for ${label} is ready for faculty verification.`);
    return res.json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Update maintenance work failed:", error.message);
    return res.status(500).json({ message: "Failed to update maintenance work." });
  }
}

async function verifyRepair(req, res) {
  const { id } = req.params;
  const { decision, note = "" } = req.body || {};
  if (!validId(id)) return res.status(400).json({ message: "Invalid complaint ID." });
  if (!["accept", "reject"].includes(decision)) return res.status(400).json({ message: "Decision must be accept or reject." });
  if (typeof note !== "string" || note.trim().length > 2000 || (decision === "reject" && !note.trim())) return res.status(400).json({ message: "Provide a rejection reason of up to 2,000 characters." });
  try {
    const complaint = await Complaint.findById(id);
    if (!complaint || !complaint.room) return res.status(404).json({ message: "Facility complaint not found." });
    if (complaint.status !== "Pending Verification") return res.status(409).json({ message: "This repair is not awaiting verification." });
    if (complaint.assignedTo?.toString() === req.user.id) return res.status(403).json({ message: "You cannot verify your own repair work." });
    const oldStatus = complaint.status;
    complaint.status = decision === "accept" ? "Closed" : "In progress";
    complaint.verifiedBy = req.user.id;
    complaint.verifiedAt = new Date();
    complaint.verificationNote = note.trim();
    complaint.history.push({
      actor: req.user.id,
      action: decision === "accept" ? "Repair accepted; complaint closed" : "Repair rejected; returned to technician",
      note: note.trim(),
      fromStatus: oldStatus,
      toStatus: complaint.status,
    });
    await complaint.save();
    const label = await getRoomLabel(complaint.room);
    if (decision === "accept") await refreshRoomMaintenance(complaint);
    const recipients = [complaint.assignedTo, complaint.submittedBy];
    await notifyUsers(recipients, complaint, decision === "accept" ? "Repair verified" : "Repair verification rejected", decision === "accept" ? `${complaint.equipment} repair for ${label} was accepted and the issue is closed.` : `${complaint.equipment} repair for ${label} was rejected and returned for more work.`);
    return res.json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Repair verification failed:", error.message);
    return res.status(500).json({ message: "Failed to verify repair." });
  }
}

async function refreshRoomMaintenance(closedComplaint) {
  try {
    const room = await Room.findById(closedComplaint.room);
    if (!room) return;
    const otherFaultForEquipment = await Complaint.exists({
      _id: { $ne: closedComplaint._id },
      room: closedComplaint.room,
      equipment: closedComplaint.equipment,
      status: { $in: ["Open", "In progress", "Pending Verification"] },
    });
    if (!otherFaultForEquipment) {
      const item = room.equipment.find((entry) => entry.type === closedComplaint.equipment);
      const inspectedAt = new Date();
      if (item) {
        item.status = "Working";
        item.note = "Repair accepted by faculty";
        item.inspectedBy = closedComplaint.verifiedBy;
        item.inspectedAt = inspectedAt;
      } else {
        room.equipment.push({ type: closedComplaint.equipment, status: "Working", note: "Repair accepted by faculty", inspectedBy: closedComplaint.verifiedBy, inspectedAt });
      }
    }
    room.maintenanceHold = Boolean(await Complaint.exists({
      room: closedComplaint.room,
      status: { $in: ["Open", "In progress", "Pending Verification"] },
    }));
    await room.save();
  } catch (error) {
    console.error("Room maintenance status refresh failed:", error.message);
  }
}

async function updateGenericComplaint(req, res) {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid complaint ID." });
  const { status } = req.body || {};
  if (!statuses.includes(status) || ["Pending Verification", "Closed"].includes(status)) return res.status(400).json({ message: "Choose a valid complaint status." });
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ message: "Complaint not found." });
    if (complaint.room) return res.status(400).json({ message: "Facility complaints must use assignment and verification workflow." });
    const oldStatus = complaint.status;
    complaint.status = status;
    complaint.history.push({ actor: req.user.id, action: "Complaint status updated", fromStatus: oldStatus, toStatus: status });
    await complaint.save();
    await notifyUsers([complaint.submittedBy], complaint, "Complaint updated", `Your complaint status changed to ${status}.`);
    return res.json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Update complaint failed:", error.message);
    return res.status(500).json({ message: "Failed to update complaint." });
  }
}

module.exports = { listComplaints, createComplaint, assignComplaint, updateWork, verifyRepair, updateGenericComplaint };
