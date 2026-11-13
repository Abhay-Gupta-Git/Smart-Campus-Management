const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const fs = require("fs");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { hashPassword, isAcceptablePassword } = require("../utils/password");
const User = require("../models/User");
const Room = require("../models/Room");
const CampusClass = require("../models/CampusClass");
const Booking = require("../models/Booking");
const Attendance = require("../models/Attendance");
const Complaint = require("../models/Complaint");
const Notification = require("../models/Notification");
const ActivityLog = require("../models/ActivityLog");
const Notice = require("../models/Notice");

const DEMO_MARKER = "[CampusOS DEMO]";
const CREDENTIALS_PATH = path.resolve(__dirname, "../demo-credentials.local.json");
const BUILDINGS = [
  "CampusOS Demo North Academic Block",
  "CampusOS Demo Science and Innovation Centre",
  "CampusOS Demo Library Annex",
  "CampusOS Demo Arts and Humanities Block",
  "CampusOS Demo Student Commons",
];
const DEPARTMENTS = ["Computer Science", "Mechanical Engineering", "Business", "Biological Sciences", "Arts and Humanities"];
const GIVEN_NAMES = ["Aarav", "Maya", "Ishaan", "Nina", "Rohan", "Leela", "Kabir", "Anaya", "Vihaan", "Sara", "Arjun", "Diya", "Neel", "Tara", "Dev", "Meera", "Kian", "Aditi", "Rehan", "Ira"];
const FAMILY_NAMES = ["Mehta", "Chen", "Rao", "Kapoor", "Iyer", "Shah", "Patel", "Das", "Malik", "Nair", "Sen", "Bose", "Kulkarni", "Fernandes", "Joshi", "Verma", "Sethi", "Banerjee", "Thomas", "Menon"];
const COURSE_NAMES = ["Foundations of Computing", "Applied Mathematics", "Introduction to Biology", "Design Thinking Studio", "Principles of Management", "Data and Society", "Environmental Science", "Physics for Engineers", "Academic Writing", "Networks and Systems"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ROOM_TYPES = ["Classroom", "Lecture Hall", "Laboratory", "Meeting Room", "Auditorium", "Other"];
const EQUIPMENT_TYPES = ["Fan", "AC", "Projector", "Light"];

function dateText(date) { return date.toISOString().slice(0, 10); }
function offsetDate(days) {
  const value = new Date();
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCDate(value.getUTCDate() + days);
  return dateText(value);
}
function personName(index) {
  return `${GIVEN_NAMES[index % GIVEN_NAMES.length]} ${FAMILY_NAMES[Math.floor(index / GIVEN_NAMES.length) % FAMILY_NAMES.length]}`;
}
function credentialFor(credentials, role) {
  const row = credentials[role];
  if (!row || typeof row.email !== "string" || typeof row.password !== "string") {
    throw new Error(`The local credentials file is missing the ${role} login.`);
  }
  if (!isAcceptablePassword(row.password)) {
    throw new Error(`The local ${role} password must be at least 12 characters and at most 72 UTF-8 bytes.`);
  }
  const expectedEmails = { admin: "admin.demo@campusos.test", faculty: "faculty.demo@campusos.test", student: "student.demo@campusos.test", technician: "technician.demo@campusos.test" };
  if (row.email.toLowerCase() !== expectedEmails[role]) throw new Error(`The local ${role} email must remain ${expectedEmails[role]}.`);
  return row;
}

async function ensureRecord(Model, query, markerCheck, document, session, label) {
  let lookup = Model.findOne(query);
  if (Model === Notification) lookup = lookup.select("+dedupeKey");
  const existing = await lookup.session(session);
  if (existing) {
    if (!markerCheck(existing)) throw new Error(`Demo identifier collision at ${label}; no seed changes were committed.`);
    return { record: existing, created: false };
  }
  const record = new Model(document);
  await record.save({ session });
  return { record, created: true };
}

function markerName(name) { return typeof name === "string" && name.includes(DEMO_MARKER); }

async function ensureCollectionsExist(models) {
  const database = mongoose.connection.db;
  const modelCollections = models.map((Model) => Model.collection.collectionName);
  const existingCollections = new Set(
    (await database.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name),
  );

  for (const collectionName of modelCollections) {
    if (existingCollections.has(collectionName)) continue;
    try {
      await database.createCollection(collectionName);
      existingCollections.add(collectionName);
    } catch (error) {
      // Another setup process may have created the collection after listCollections.
      if (error.code !== 48 && error.codeName !== "NamespaceExists") throw error;
    }
  }
}

async function runSeed() {
  if (process.env.NODE_ENV === "production") throw new Error("The demo seeder is disabled when NODE_ENV=production.");
  if (process.env.ALLOW_DEMO_SEED !== "true") throw new Error("Set ALLOW_DEMO_SEED=true in the local command environment to explicitly enable demo seeding.");
  if (!process.env.DEMO_MONGO_URI) throw new Error("DEMO_MONGO_URI must point to a dedicated local demo/test database; no database was changed.");
  if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error("Local demo credentials are missing. See the demo setup instructions in README.md.");

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  for (const role of ["admin", "faculty", "student", "technician"]) credentialFor(credentials, role);
  let databaseUrl;
  try { databaseUrl = new URL(process.env.DEMO_MONGO_URI); } catch { throw new Error("DEMO_MONGO_URI is not a valid MongoDB connection URL."); }
  const databaseHost = databaseUrl.hostname.toLowerCase();
  const requestedDatabase = decodeURIComponent(databaseUrl.pathname.replace(/^\//, "")).split("/")[0].toLowerCase();
  if (!(["localhost", "127.0.0.1", "::1"].includes(databaseHost)) || !/(demo|test)/.test(requestedDatabase) || /prod|live/.test(requestedDatabase)) {
    throw new Error("Refusing to connect: DEMO_MONGO_URI must use a loopback MongoDB host and a database name containing demo or test.");
  }
  process.env.MONGO_URI = process.env.DEMO_MONGO_URI;
  await connectDB();
  const dbName = String(mongoose.connection.name || "").toLowerCase();
  if (!dbName || /(^|[_-])(prod|production|live)([_-]|$)/.test(dbName)) {
    throw new Error("Refusing to seed a production/live or unidentifiable database. Use a dedicated local demo database name.");
  }
  await ensureCollectionsExist([User, Room, CampusClass, Booking, Attendance, Complaint, Notification, ActivityLog, Notice]);
  const [attendanceIndexes, notificationIndexes] = await Promise.all([
    Attendance.collection.indexes(),
    Notification.collection.indexes(),
  ]);
  const attendanceUniqueReady = attendanceIndexes.some((index) => index.name === "uniq_attendance_class_student_date" && index.unique === true);
  const notificationUniqueReady = notificationIndexes.some((index) => index.name === "dedupeKey_1" && index.unique === true && index.sparse === true);
  if (!attendanceUniqueReady || !notificationUniqueReady) {
    throw new Error("Required attendance and notification integrity indexes are missing. Review and run the documented integrity-index migration on this dedicated demo database first.");
  }

  const counts = Object.create(null);
  const count = (collection, created) => { counts[collection] = (counts[collection] || 0) + Number(created); };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const passwordHashes = Object.fromEntries(await Promise.all(["admin", "faculty", "student", "technician"].map(async (role) => [role, await hashPassword(credentials[role].password)])));
      const accountSpecs = [
        { role: "admin", email: credentialFor(credentials, "admin").email.toLowerCase(), passwordHash: passwordHashes.admin, name: `CampusOS Demo Administrator ${DEMO_MARKER}`, department: "Campus Operations", studentId: "DEMO-ADMIN" },
        ...Array.from({ length: 9 }, (_, i) => ({
          role: "faculty", email: i === 0 ? credentials.faculty.email.toLowerCase() : `faculty${String(i + 1).padStart(2, "0")}@campusos.test`,
          passwordHash: passwordHashes.faculty, name: `${personName(i + 3)} ${DEMO_MARKER}`, department: DEPARTMENTS[i % DEPARTMENTS.length], studentId: `DEMO-FAC-${String(i + 1).padStart(2, "0")}`,
        })),
        ...Array.from({ length: 3 }, (_, i) => ({
          role: "technician", email: i === 0 ? credentials.technician.email.toLowerCase() : `technician${String(i + 1).padStart(2, "0")}@campusos.test`,
          passwordHash: passwordHashes.technician, name: `${personName(i + 35)} ${DEMO_MARKER}`, department: "Campus Facilities", studentId: `DEMO-TECH-${String(i + 1).padStart(2, "0")}`,
        })),
        ...Array.from({ length: 130 }, (_, i) => ({
          role: "student", email: i === 0 ? credentials.student.email.toLowerCase() : `student${String(i + 1).padStart(3, "0")}@campusos.test`,
          passwordHash: passwordHashes.student, name: `${personName(i + 70)} ${DEMO_MARKER}`, department: DEPARTMENTS[i % DEPARTMENTS.length], studentId: `DEMO-STU-${String(i + 1).padStart(3, "0")}`,
        })),
      ];
      const usersByEmail = new Map();
      for (const spec of accountSpecs) {
        const result = await ensureRecord(User, { email: spec.email }, (user) => markerName(user.name) && user.role === spec.role && user.studentId === spec.studentId,
          { ...spec, password: spec.passwordHash }, session, `User ${spec.email}`);
        usersByEmail.set(spec.email, result.record);
        count("users", result.created);
      }
      const admin = usersByEmail.get(credentials.admin.email.toLowerCase());
      const faculty = accountSpecs.filter((row) => row.role === "faculty").map((row) => usersByEmail.get(row.email));
      const technicians = accountSpecs.filter((row) => row.role === "technician").map((row) => usersByEmail.get(row.email));
      const students = accountSpecs.filter((row) => row.role === "student").map((row) => usersByEmail.get(row.email));

      const rooms = [];
      for (let i = 0; i < 20; i += 1) {
        const building = BUILDINGS[Math.floor(i / 4)];
        const roomName = `DEMO-${String(101 + (i % 4) + Math.floor(i / 4) * 100)}`;
        const faulty = i < 4;
        const equipment = EQUIPMENT_TYPES.map((type, j) => ({
          type,
          status: faulty && j === i ? (i % 2 ? "Needs Maintenance" : "Not Working") : "Working",
          note: faulty && j === i ? "[CampusOS DEMO] Example open maintenance item" : "[CampusOS DEMO] Inspection recorded",
          inspectedBy: faculty[i % faculty.length]._id,
          inspectedAt: new Date(Date.now() - (i + 1) * 86400000),
        }));
        const result = await ensureRecord(Room, { name: roomName, building }, (room) => room.building.startsWith("CampusOS Demo ") && room.name.startsWith("DEMO-"), {
          name: roomName, building, floor: Math.floor(i / 4), capacity: 24 + (i % 5) * 12, type: ROOM_TYPES[i % ROOM_TYPES.length],
          facilities: ["[CampusOS DEMO] Wi-Fi", "[CampusOS DEMO] Whiteboard"], equipment,
          maintenanceHold: faulty, inspectionHistory: [{ equipment, recordedAt: new Date(Date.now() - (i + 1) * 86400000) }], available: true,
        }, session, `Room ${building}/${roomName}`);
        rooms.push(result.record);
        count("rooms", result.created);
      }

      const classes = [];
      for (let i = 0; i < 10; i += 1) {
        const courseCode = `DEMO${String(101 + i)}`;
        const enrolledStudents = students.slice(i * 13, (i + 1) * 13);
        const classSpec = {
          courseName: `CampusOS Demo: ${COURSE_NAMES[i]}`,
          courseCode,
          section: "DEMO-A",
          faculty: faculty[i % faculty.length]._id,
          room: rooms[4 + i]._id,
          day: DAYS[i % DAYS.length],
          startTime: "09:00",
          endTime: "10:15",
          maxEnrollment: 30,
          enrolledStudents: enrolledStudents.map((student) => student._id),
        };
        const result = await ensureRecord(CampusClass, { courseCode, section: "DEMO-A" }, (item) => item.courseName.startsWith("CampusOS Demo:") && item.courseCode.startsWith("DEMO"), classSpec, session, `Class ${courseCode}`);
        classes.push(result.record);
        count("classes", result.created);
      }

      const bookings = [];
      for (let i = 0; i < 28; i += 1) {
        const bookingDate = offsetDate(-7 - Math.floor(i / 7) * 7 - (i % 7));
        const student = students[i % students.length];
        const room = rooms[i % rooms.length];
        const result = await ensureRecord(Booking, { purpose: `[DEMO-BOOKING-${String(i + 1).padStart(2, "0")}]`, room: room._id, bookedBy: student._id }, (item) => item.purpose.startsWith("[DEMO-BOOKING-"), {
          room: room._id, date: bookingDate, startTime: "11:00", endTime: "12:00", purpose: `[DEMO-BOOKING-${String(i + 1).padStart(2, "0")}] Historical approved seminar`, status: "Approved", bookedBy: student._id,
        }, session, `Booking ${i + 1}`);
        bookings.push(result.record);
        count("bookings", result.created);
      }
      const otherStatuses = ["Pending", "Pending", "Pending", "Approved", "Approved", "Approved", "Rejected", "Rejected", "Rejected", "Cancelled", "Cancelled", "Cancelled"];
      for (let i = 0; i < otherStatuses.length; i += 1) {
        const n = i + 29;
        const room = rooms[(i + 5) % rooms.length];
        const student = students[(i + 20) % students.length];
        const purpose = `[DEMO-BOOKING-${String(n).padStart(2, "0")}] ${otherStatuses[i]} presentation request`;
        const result = await ensureRecord(Booking, { purpose, room: room._id, bookedBy: student._id }, (item) => item.purpose.startsWith("[DEMO-BOOKING-"), {
          room: room._id, date: offsetDate(2 + i), startTime: "13:00", endTime: "14:00", purpose, status: otherStatuses[i], bookedBy: student._id,
        }, session, `Booking ${n}`);
        bookings.push(result.record);
        count("bookings", result.created);
      }

      const attendanceDates = [-2, -9, -16].map(offsetDate);
      const attendanceRows = [];
      for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
        const campusClass = classes[classIndex];
        const enrolled = students.slice(classIndex * 13, (classIndex + 1) * 13);
        for (let dateIndex = 0; dateIndex < attendanceDates.length; dateIndex += 1) {
          for (let studentIndex = 0; studentIndex < enrolled.length; studentIndex += 1) {
            const student = enrolled[studentIndex];
            attendanceRows.push({
              campusClass: campusClass._id,
              student: student._id,
              date: attendanceDates[dateIndex],
              status: (studentIndex + dateIndex) % 11 === 0 ? "late" : (studentIndex + dateIndex) % 7 === 0 ? "absent" : "present",
              markedBy: campusClass.faculty,
            });
          }
        }
      }
      const attendanceKeys = attendanceRows.map(({ campusClass, student, date }) => ({ campusClass, student, date }));
      const existingAttendance = await Attendance.find({ $or: attendanceKeys }).select("campusClass student date").session(session).lean();
      const existingAttendanceKeys = new Set(existingAttendance.map((row) => `${row.campusClass}:${row.student}:${row.date}`));
      const missingAttendance = attendanceRows.filter((row) => !existingAttendanceKeys.has(`${row.campusClass}:${row.student}:${row.date}`));
      if (missingAttendance.length) {
        await Attendance.insertMany(missingAttendance, { session, ordered: true });
        count("attendance", missingAttendance.length);
      }

      const complaintStatuses = ["Open", "Open", "Open", "Open", "Open", "In progress", "In progress", "In progress", "In progress", "Pending Verification", "Pending Verification", "Pending Verification", "Resolved", "Resolved", "Resolved", "Closed", "Closed", "Closed"];
      const complaints = [];
      for (let i = 0; i < complaintStatuses.length; i += 1) {
        const status = complaintStatuses[i];
        const room = i < 12 ? rooms[i % 4] : (i < 15 ? rooms[4 + i] : rooms[8 + (i % 12)]);
        const equipment = i < 12 ? EQUIPMENT_TYPES[i % EQUIPMENT_TYPES.length] : null;
        const assignedTo = ["In progress", "Pending Verification", "Resolved", "Closed"].includes(status) ? technicians[i % technicians.length] : null;
        const closed = status === "Closed";
        const title = `[DEMO-COMPLAINT-${String(i + 1).padStart(2, "0")}] ${equipment || "Campus"} service request`;
        const submittedBy = students[(i * 7) % students.length];
        const history = [{ actor: submittedBy._id, action: "submitted", note: "[CampusOS DEMO] Sample maintenance report", toStatus: "Open" }];
        if (assignedTo) history.push({ actor: admin._id, action: "assigned", note: "[CampusOS DEMO] Assigned to campus facilities", fromStatus: "Open", toStatus: status });
        if (status === "Pending Verification" || status === "Resolved" || closed) history.push({ actor: assignedTo._id, action: "work_submitted", note: "[CampusOS DEMO] Example technician work update", fromStatus: "In progress", toStatus: status, evidence: ["[CampusOS DEMO] Work note recorded"] });
        if (closed) history.push({ actor: faculty[(i + 1) % faculty.length]._id, action: "resolution_verified", note: "[CampusOS DEMO] Repair verified", fromStatus: "Pending Verification", toStatus: "Closed" });
        const query = { title };
        const result = await ensureRecord(Complaint, query, (item) => item.title.startsWith("[DEMO-COMPLAINT-"), {
          title, description: `[CampusOS DEMO] Fictional ${equipment ? `${equipment.toLowerCase()} issue` : "campus service request"} for workflow demonstration.`,
          category: equipment ? "Facilities" : "Campus Services", status, room: room?._id || null, equipment, priority: ["Urgent", "High", "Normal", "Low"][i % 4],
          assignedTo: assignedTo?._id || null, resolutionDetails: assignedTo ? "[CampusOS DEMO] Example repair notes; no real work was performed." : "",
          resolutionEvidence: assignedTo ? ["[CampusOS DEMO] Demonstration evidence note"] : [],
          verifiedBy: closed ? faculty[(i + 1) % faculty.length]._id : null,
          verifiedAt: closed ? new Date(Date.now() - (i + 1) * 3600000) : null,
          verificationNote: closed ? "[CampusOS DEMO] Accepted for workflow illustration." : "",
          history, submittedBy: submittedBy._id,
        }, session, `Complaint ${i + 1}`);
        complaints.push(result.record);
        count("complaints", result.created);
      }

      const noticeSpecs = [
        ["Campus orientation week", "Orientation sessions begin next Monday in the North Academic Block.", "all"],
        ["Library extended hours", "The demo library annex will remain open until 21:00 during project week.", "student"],
        ["Faculty planning meeting", "Department planning sessions are scheduled for Friday morning.", "faculty"],
        ["Facilities safety briefing", "Technicians are invited to the monthly safety briefing.", "all"],
        ["Campus sustainability forum", "Join the campus sustainability forum in the Student Commons.", "all"],
      ];
      const notices = [];
      for (let i = 0; i < noticeSpecs.length; i += 1) {
        const [titleText, body, audience] = noticeSpecs[i];
        const title = `[DEMO-NOTICE-${String(i + 1).padStart(2, "0")}] ${titleText}`;
        const result = await ensureRecord(Notice, { title }, (item) => item.title.startsWith("[DEMO-NOTICE-"), {
          title, body: `[CampusOS DEMO] ${body}`, category: "Campus Update", audience, author: admin._id,
        }, session, `Notice ${i + 1}`);
        notices.push(result.record);
        count("notices", result.created);
      }

      const notificationSpecs = [
        { recipient: admin, complaint: complaints[0], entityType: "complaint", entityId: complaints[0]._id, targetPage: "Complaints", title: "New demo maintenance report", message: "A fictional demo complaint is available for workflow review." },
        { recipient: faculty[0], complaint: complaints[9], entityType: "complaint", entityId: complaints[9]._id, targetPage: "Complaints", title: "Demo repair verification", message: "A fictional repair is waiting for faculty verification." },
        { recipient: technicians[0], complaint: complaints[5], entityType: "complaint", entityId: complaints[5]._id, targetPage: "Complaints", title: "Demo complaint assigned", message: "A fictional facilities request is assigned for demonstration." },
        { recipient: students[0], entityType: "booking", entityId: bookings[0]._id, targetPage: "Room bookings", title: "Demo booking approved", message: "Your fictional historical room booking is approved." },
      ];
      for (let i = 0; i < notificationSpecs.length; i += 1) {
        const item = notificationSpecs[i];
        const dedupeKey = `campusos-demo-notification-${i + 1}`;
        const result = await ensureRecord(Notification, { dedupeKey }, (row) => row.dedupeKey === dedupeKey, {
          ...item, recipient: item.recipient._id, complaint: item.complaint?._id || null, dedupeKey,
          title: `${item.title} ${DEMO_MARKER}`, message: `[CampusOS DEMO] ${item.message}`,
        }, session, `Notification ${i + 1}`);
        count("notifications", result.created);
      }

      const activitySpecs = [
        ...bookings.slice(0, 10).map((booking, i) => ({ actor: booking.bookedBy, action: "demo_seed", entityType: "booking", entityId: booking._id, summary: `[DEMO:ACTIVITY:BOOKING:${i + 1}] Historical booking record created for presentation.` })),
        ...complaints.slice(0, 18).map((complaint, i) => ({ actor: complaint.submittedBy, action: "demo_seed", entityType: "complaint", entityId: complaint._id, summary: `[DEMO:ACTIVITY:COMPLAINT:${i + 1}] Complaint workflow history example.` })),
        ...rooms.slice(0, 5).map((room, i) => ({ actor: admin._id, action: "demo_seed", entityType: "room", entityId: room._id, summary: `[DEMO:ACTIVITY:ROOM:${i + 1}] Room inspection sample.` })),
        ...notices.map((notice, i) => ({ actor: admin._id, action: "demo_seed", entityType: "notice", entityId: notice._id, summary: `[DEMO:ACTIVITY:NOTICE:${i + 1}] Campus notice sample.` })),
      ];
      for (const item of activitySpecs) {
        const result = await ensureRecord(ActivityLog, { action: item.action, entityType: item.entityType, entityId: item.entityId, summary: item.summary },
          (row) => row.action === "demo_seed" && row.summary.startsWith("[DEMO:ACTIVITY:"), item, session, item.summary);
        count("activityLogs", result.created);
      }
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }

  console.log("CampusOS demo seed completed. Counts below are newly created records only:");
  for (const [collection, created] of Object.entries(counts)) console.log(`${collection}: ${created}`);
}

runSeed()
  .catch((error) => {
    console.error("CampusOS demo seed did not complete:", error.message || error.name || "Unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
