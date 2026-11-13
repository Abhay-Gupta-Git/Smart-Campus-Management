const mongoose = require("mongoose");
const Complaint = require("../models/Complaint");
const Room = require("../models/Room");
const User = require("../models/User");
const recordActivity = require("../utils/activityLog");
const { createNotifications } = require("../utils/notifications");
const { readPagination, readSearch, readSort, escapeRegex, executeListQuery } = require("../utils/pagination");
const { hasOnlyFields } = require("../utils/validation");
const { runTransaction, isTransactionUnsupported, lockRoomReference } = require("../utils/transactions");
const { recomputeRoomMaintenanceState } = require("../services/roomMaintenanceService");

const equipmentTypes = ["Fan", "AC", "Projector", "Light"];
const priorities = ["Low", "Normal", "High", "Urgent"];
const statuses = ["Open", "In progress", "Pending Verification", "Resolved", "Closed"];

async function notifyUsers(recipients, complaint, title, message, eventId) {
  await createNotifications({ recipients, title, message, entityType: "complaint", entityId: complaint._id, targetPage: "Complaints", eventId });
}

async function notifyRole(role, complaint, title, message, eventId) {
  try {
    const users = await User.find({ role }).select("_id").lean();
    await notifyUsers(users.map((user) => user._id), complaint, title, message, eventId);
  } catch (error) {
    console.error("Role notification recipients lookup failed:", JSON.stringify({ event: "notification_recipient_lookup_failed", role, entityId: complaint._id.toString(), error: error.name || "Error", code: error.code || "unknown" }));
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

    const filterParts = Object.keys(baseFilter).length ? [baseFilter] : [];
    if (req.query.recordId !== undefined) {
      if (!validId(req.query.recordId)) return res.status(400).json({ message: "Record filter is invalid." });
      filterParts.push({ _id: req.query.recordId });
    }
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
    } else if (req.query.assignee !== undefined && req.user.role !== "admin") {
      return res.status(400).json({ message: "Assignee filtering is only available to administrators." });
    }

    if (req.query.roomSearch !== undefined) {
      if (typeof req.query.roomSearch !== "string" || req.query.roomSearch.trim().length > 80) return res.status(400).json({ message: "Room search must be 80 characters or fewer." });
      const value = req.query.roomSearch.trim();
      if (value) {
        const regex = { $regex: escapeRegex(value), $options: "i" };
        const roomIds = await Room.find({ $or: [{ name: regex }, { building: regex }] }).distinct("_id");
        filterParts.push({ room: { $in: roomIds } });
      }
    }

    const search = readSearch(req, res);
    if (search === false) return;
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      const searchParts = ["title", "description", "category"].map((field) => ({ [field]: regex }));
      const lookups = [Room.find({ $or: [{ name: regex }, { building: regex }] }).distinct("_id")];
      if (["admin", "faculty"].includes(req.user.role)) lookups.push(User.find({ name: regex }).distinct("_id"));
      if (req.user.role === "admin") lookups.push(User.find({ role: "technician", name: regex }).distinct("_id"));
      const [roomIds, submitterIds = [], technicianIds = []] = await Promise.all(lookups);
      if (roomIds.length) searchParts.push({ room: { $in: roomIds } });
      if (submitterIds.length) searchParts.push({ submittedBy: { $in: submitterIds } });
      if (technicianIds.length) searchParts.push({ assignedTo: { $in: technicianIds } });
      filterParts.push({ $or: searchParts });
    }
    const filter = filterParts.length === 0 ? {} : filterParts.length === 1 ? filterParts[0] : { $and: filterParts };
    const pagination = readPagination(req, res);
    if (pagination === false) return;
    const sort = readSort(req, res, ["createdAt", "updatedAt", "title", "status", "priority"], "createdAt", "desc");
    if (sort === false) return;
    const complaints = await executeListQuery({ query: populatedComplaints(Complaint.find(filter).sort(sort)).lean(), Model: Complaint, filter, pagination, res });
    return res.json(complaints);
  } catch (error) {
    console.error("List complaints failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to load maintenance notices." });
  }
}

async function createComplaint(req, res) {
  const body = req.body || {};
  if (!hasOnlyFields(body, ["title", "description", "category", "room", "equipment", "priority"])) return res.status(400).json({ message: "Request contains unsupported fields." });
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
    const result = await runTransaction(async (session) => {
      const userLock = await User.updateOne(
        { _id: req.user.id },
        { $inc: { referenceVersion: 1 } },
        { session },
      );
      if (!userLock.matchedCount) return { status: 401, message: "Account no longer exists." };
      if (body.room && !await lockRoomReference(Room, body.room, session)) return { status: 404, message: "Room not found." };

      const room = body.room ? await Room.findById(body.room).session(session) : null;
      if (body.room && !room) return { status: 404, message: "Room not found." };
      const [complaint] = await Complaint.create([{
        title: body.title.trim(),
        description: body.description.trim(),
        category: typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 80) : body.room ? "Room maintenance" : "General",
        room: body.room || null,
        equipment: body.room ? body.equipment : null,
        priority,
        submittedBy: req.user.id,
        history: [{ actor: req.user.id, action: body.room ? "Facility issue reported" : "Complaint submitted", note: body.description.trim() }],
      }], { session });

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
        await room.save({ session });
      }
      return { status: 201, complaint };
    });
    if (result.status !== 201) return res.status(result.status).json({ message: result.message });
    const { complaint } = result;

    await recordActivity({ actor: req.user.id, action: "Complaint submitted", entityType: "complaint", entityId: complaint._id, summary: `Submitted: ${complaint.title}` });
    const complaintContext = complaint.room
      ? `${complaint.equipment} issue reported in ${await getRoomLabel(complaint.room)}.`
      : `A new complaint was submitted: ${complaint.title}.`;
    await notifyRole("admin", complaint, "New complaint submitted", complaintContext, `complaint:${complaint._id}:submitted`);
    return res.status(201).json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Create complaint failed:", error.name || "Error");
    if (isTransactionUnsupported(error)) return res.status(503).json({ message: "Complaint submission requires MongoDB transaction support. Configure MongoDB as a replica set and retry." });
    if (error.name === "ValidationError" || error.name === "CastError") return res.status(400).json({ message: "Unable to submit complaint. Check the required fields." });
    return res.status(500).json({ message: "Unable to submit complaint. Please retry." });
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
  if (!hasOnlyFields(req.body || {}, ["technicianId", "note"])) return res.status(400).json({ message: "Request contains unsupported fields." });
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
    await recordActivity({ actor: req.user.id, action: technician ? "Complaint assigned" : "Complaint unassigned", entityType: "complaint", entityId: complaint._id, summary: `${complaint.title}${technician ? ` assigned to ${technician.name}` : " assignment cleared"}.` });
    const label = await getRoomLabel(complaint.room);
    await notifyUsers([complaint.submittedBy, previousAssignee, technician?._id], complaint, technician ? "Maintenance issue assigned" : "Maintenance assignment updated", `${complaint.equipment} issue for ${label} is ${technician ? `assigned to ${technician.name}` : "unassigned"}.`, `complaint-history:${complaint.history.at(-1)._id}`);
    return res.json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Assign complaint failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to assign maintenance issue." });
  }
}

async function updateWork(req, res) {
  const { id } = req.params;
  const { status, note = "", resolutionDetails = "", evidence = [] } = req.body || {};
  if (!hasOnlyFields(req.body || {}, ["status", "note", "resolutionDetails", "evidence"])) return res.status(400).json({ message: "Request contains unsupported fields." });
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
    await recordActivity({ actor: req.user.id, action: status === "Pending Verification" ? "Repair submitted for verification" : "Maintenance progress updated", entityType: "complaint", entityId: complaint._id, summary: `${complaint.title} moved to ${status}.` });
    const label = await getRoomLabel(complaint.room);
    const eventId = `complaint-history:${complaint.history.at(-1)._id}`;
    await notifyRole("admin", complaint, "Maintenance work updated", `${complaint.equipment} issue for ${label} is now ${status}.`, eventId);
    if (status === "Pending Verification") await notifyRole("faculty", complaint, "Repair needs verification", `${complaint.equipment} repair for ${label} is ready for faculty verification.`, eventId);
    await notifyUsers([complaint.submittedBy], complaint, status === "Pending Verification" ? "Repair ready for verification" : "Maintenance work updated", `${complaint.equipment} issue for ${label}: ${status === "Pending Verification" ? "repair submitted for faculty verification" : "work progress updated"}.`, eventId);
    return res.json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Update maintenance work failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to update maintenance work." });
  }
}

async function verifyRepair(req, res) {
  const { id } = req.params;
  const { decision, note = "" } = req.body || {};
  if (!hasOnlyFields(req.body || {}, ["decision", "note"])) return res.status(400).json({ message: "Request contains unsupported fields." });
  if (!validId(id)) return res.status(400).json({ message: "Invalid complaint ID." });
  if (!["accept", "reject"].includes(decision)) return res.status(400).json({ message: "Decision must be accept or reject." });
  if (typeof note !== "string" || note.trim().length > 2000 || (decision === "reject" && !note.trim())) return res.status(400).json({ message: "Provide a rejection reason of up to 2,000 characters." });
  try {
    const result = await runTransaction(async (session) => {
      const existing = await Complaint.findById(id).select("room").session(session);
      if (!existing || !existing.room) return { status: 404, message: "Facility complaint not found." };
      if (!await lockRoomReference(Room, existing.room, session)) return { status: 404, message: "Room not found." };

      const complaint = await Complaint.findById(id).session(session);
      if (!complaint || !complaint.room) return { status: 404, message: "Facility complaint not found." };
      if (complaint.status !== "Pending Verification") return { status: 409, message: "This repair is not awaiting verification." };
      if (complaint.assignedTo?.toString() === req.user.id) return { status: 403, message: "You cannot verify your own repair work." };

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
      await complaint.save({ session });

      if (decision === "accept") {
        const otherEquipmentFault = await Complaint.exists({
          _id: { $ne: complaint._id },
          room: complaint.room,
          equipment: complaint.equipment,
          status: { $ne: "Closed" },
        }).session(session);
        if (!otherEquipmentFault) {
          const room = await Room.findById(complaint.room).session(session);
          if (!room) return { status: 404, message: "Room not found." };
          const inspectedAt = new Date();
          const item = room.equipment.find((entry) => entry.type === complaint.equipment);
          const verifiedCondition = { status: "Working", note: "Repair accepted by faculty", inspectedBy: req.user.id, inspectedAt };
          if (item) Object.assign(item, verifiedCondition);
          else room.equipment.push({ type: complaint.equipment, ...verifiedCondition });
          await room.save({ session });
        }
      }

      const maintenance = await recomputeRoomMaintenanceState(complaint.room, { session, roomAlreadyLocked: true });
      if (!maintenance) return { status: 404, message: "Room not found." };
      return { status: 200, complaint };
    });
    if (result.status !== 200) return res.status(result.status).json({ message: result.message });
    const complaint = result.complaint;
    await recordActivity({ actor: req.user.id, action: decision === "accept" ? "Repair accepted" : "Repair rejected", entityType: "complaint", entityId: complaint._id, summary: `${complaint.title} was ${decision === "accept" ? "accepted and closed" : "returned for more work"}.` });
    const label = await getRoomLabel(complaint.room);
    const recipients = [complaint.assignedTo, complaint.submittedBy];
    await notifyUsers(recipients, complaint, decision === "accept" ? "Repair verified" : "Repair verification rejected", decision === "accept" ? `${complaint.equipment} repair for ${label} was accepted and the issue is closed.` : `${complaint.equipment} repair for ${label} was rejected and returned for more work.`, `complaint-history:${complaint.history.at(-1)._id}`);
    return res.json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Repair verification failed:", JSON.stringify({ event: "repair_verification_failed", complaintId: id, actorId: req.user.id, error: error.name || "Error", code: error.code || "unknown" }));
    if (isTransactionUnsupported(error)) return res.status(503).json({ message: "Repair verification requires MongoDB transaction support. Configure MongoDB as a replica set and retry." });
    return res.status(500).json({ message: "Failed to verify repair." });
  }
}

async function updateGenericComplaint(req, res) {
  if (!validId(req.params.id)) return res.status(400).json({ message: "Invalid complaint ID." });
  const { status } = req.body || {};
  if (!hasOnlyFields(req.body || {}, ["status"])) return res.status(400).json({ message: "Request contains unsupported fields." });
  if (!statuses.includes(status) || ["Pending Verification", "Closed"].includes(status)) return res.status(400).json({ message: "Choose a valid complaint status." });
  try {
    const complaint = await Complaint.findById(req.params.id);
    if (!complaint) return res.status(404).json({ message: "Complaint not found." });
    if (complaint.room) return res.status(400).json({ message: "Facility complaints must use assignment and verification workflow." });
    const oldStatus = complaint.status;
    complaint.status = status;
    complaint.history.push({ actor: req.user.id, action: "Complaint status updated", fromStatus: oldStatus, toStatus: status });
    await complaint.save();
    await recordActivity({ actor: req.user.id, action: "Complaint status updated", entityType: "complaint", entityId: complaint._id, summary: `${complaint.title} moved to ${status}.` });
    await notifyUsers([complaint.submittedBy], complaint, "Complaint updated", `Your complaint status changed to ${status}.`, `complaint-history:${complaint.history.at(-1)._id}`);
    return res.json(await populatedComplaints(Complaint.findById(complaint._id)));
  } catch (error) {
    console.error("Update complaint failed:", error.name || "Error");
    return res.status(500).json({ message: "Failed to update complaint." });
  }
}

module.exports = { listComplaints, createComplaint, assignComplaint, updateWork, verifyRepair, updateGenericComplaint };
