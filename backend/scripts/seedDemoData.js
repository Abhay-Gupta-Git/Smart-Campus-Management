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

const CREDENTIALS_PATH = path.resolve(__dirname, "../demo-credentials.local.json");
const BUILDINGS = [
  "Vikram Sarabhai Academic Block",
  "Homi Bhabha Science Centre",
  "Nalanda Library and Learning Centre",
  "Savitribai Phule Arts Block",
  "Sardar Patel Student Centre",
];
const DEPARTMENTS = ["Computer Science", "Information Technology", "Electronics and Communication", "Mechanical Engineering", "Civil Engineering", "Business Administration", "Arts and Humanities"];
const GIVEN_NAMES = ["Aarav", "Aadhya", "Advait", "Ananya", "Arjun", "Bhavna", "Dev", "Diya", "Farhan", "Harini", "Ishaan", "Kavya", "Kunal", "Meera", "Nikhil", "Pranav", "Riya", "Sanjay", "Tanvi", "Zoya"];
const FAMILY_NAMES = ["Agarwal", "Bhat", "Chatterjee", "Deshmukh", "Iyer", "Jadhav", "Kapoor", "Kulkarni", "Menon", "Mukherjee", "Nair", "Patel", "Reddy", "Saxena", "Sharma", "Singh", "Srinivasan", "Verma", "Yadav", "Joshi"];
const COURSE_NAMES = ["Data Structures and Algorithms", "Engineering Mathematics II", "Digital Systems Design", "Thermodynamics", "Surveying and Geomatics", "Principles of Marketing", "Indian Writing in English", "Database Management Systems", "Signals and Systems", "Operations Research", "Environmental Studies", "Object Oriented Programming"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ROOM_TYPES = ["Classroom", "Lecture Hall", "Laboratory", "Meeting Room", "Auditorium"];
const EQUIPMENT_TYPES = ["Fan", "AC", "Projector", "Light"];
const ACADEMIC_START = new Date("2026-07-01T00:00:00.000Z");
function dateText(date) { return date.toISOString().slice(0, 10); }
function academicDate(dayOffset) { const date = new Date(ACADEMIC_START); date.setUTCDate(date.getUTCDate() + dayOffset); return dateText(date); }
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
  return row;
}

async function ensureRecord(Model, query, markerCheck, document, session, label) {
  let lookup = Model.findOne(query);
  if (Model === Notification) lookup = lookup.select("+dedupeKey");
  const existing = await lookup.session(session);
  if (existing) {
    if (!markerCheck(existing)) throw new Error(`Demo identifier collision at ${label}; no seed changes were committed.`);
    const refresh = { ...document };
    if (Model === User) {
      delete refresh.password;
      delete refresh.passwordHash;
    }
    existing.set(refresh);
    await existing.save({ session });
    return { record: existing, created: false };
  }
  const record = new Model(document);
  await record.save({ session });
  return { record, created: true };
}

function seededUser(user) { return user.studentId?.startsWith("DEMO-") || user.studentId?.startsWith("ARU-"); }

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

async function rejectLegacyDemoDataset() {
  const legacyCounts = await Promise.all([
    User.countDocuments({ studentId: /^DEMO-/ }),
    Room.countDocuments({ $or: [{ building: /^CampusOS Demo / }, { name: /^DEMO-/ }] }),
    CampusClass.countDocuments({ courseCode: /^DEMO/ }),
    Booking.countDocuments({ purpose: /^\[DEMO-BOOKING-/ }),
    Complaint.countDocuments({ title: /^\[DEMO-COMPLAINT-/ }),
    Notice.countDocuments({ title: /^\[DEMO-NOTICE-/ }),
  ]);
  if (legacyCounts.some((count) => count > 0)) {
    throw new Error("This database contains records from the legacy demo seed. To avoid mixing or deleting existing data, choose a fresh dedicated local demo database for the Aravalli University dataset.");
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
  await rejectLegacyDemoDataset();

  const counts = Object.create(null);
  const count = (collection, created) => { counts[collection] = (counts[collection] || 0) + Number(created); };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const passwordHashes = Object.fromEntries(await Promise.all(["admin", "faculty", "student", "technician"].map(async (role) => [role, await hashPassword(credentials[role].password)])));
      const accountSpecs = [
        { role: "admin", email: "admin@campus.edu.in", passwordHash: passwordHashes.admin, name: "Ananya Deshmukh", department: "Campus Operations", studentId: "ADM2026001" },
        ...Array.from({ length: 12 }, (_, i) => ({
          role: "faculty", email: `faculty${String(i + 1).padStart(3, "0")}@campus.edu.in`,
          passwordHash: passwordHashes.faculty, name: personName(i + 3), department: DEPARTMENTS[i % DEPARTMENTS.length], studentId: `FAC2026${String(i + 1).padStart(3, "0")}`,
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          role: "technician", email: `facilities${String(i + 1).padStart(3, "0")}@campus.edu.in`,
          passwordHash: passwordHashes.technician, name: personName(i + 35), department: "Campus Facilities", studentId: `TEC2026${String(i + 1).padStart(3, "0")}`,
        })),
        ...Array.from({ length: 130 }, (_, i) => ({
          role: "student", email: `student${String(i + 1).padStart(4, "0")}@campus.edu.in`,
          passwordHash: passwordHashes.student, name: personName(i + 70), department: DEPARTMENTS[i % DEPARTMENTS.length], studentId: `STU2026${String(i + 1).padStart(3, "0")}`,
        })),
      ];
      const usersByEmail = new Map();
      for (const spec of accountSpecs) {
        const result = await ensureRecord(User, { email: spec.email }, (user) => user.role === spec.role && (user.studentId === spec.studentId || seededUser(user)),
          { ...spec, password: spec.passwordHash }, session, `User ${spec.email}`);
        usersByEmail.set(spec.email, result.record);
        count("users", result.created);
      }
      const admin = usersByEmail.get(accountSpecs.find((row) => row.role === "admin").email);
      const faculty = accountSpecs.filter((row) => row.role === "faculty").map((row) => usersByEmail.get(row.email));
      const technicians = accountSpecs.filter((row) => row.role === "technician").map((row) => usersByEmail.get(row.email));
      const students = accountSpecs.filter((row) => row.role === "student").map((row) => usersByEmail.get(row.email));

      const rooms = [];
      for (let i = 0; i < 20; i += 1) {
        const building = BUILDINGS[Math.floor(i / 4)];
        const roomName = `${["A", "B", "C", "D", "E"][Math.floor(i / 4)]}${String(101 + (i % 4))}`;
        const faulty = [2, 7].includes(i);
        const faultyEquipment = { 2: "AC", 7: "AC" }[i];
        const equipment = EQUIPMENT_TYPES.map((type, j) => ({
          type,
          status: faulty && type === faultyEquipment ? "Needs Maintenance" : "Working",
          note: faulty && type === faultyEquipment ? "Reported for facilities follow-up" : "Inspection completed; operating normally",
          inspectedBy: faculty[i % faculty.length]._id,
          inspectedAt: new Date(academicDate(18 - i) + "T09:00:00Z"),
        }));
        const result = await ensureRecord(Room, { name: roomName, building }, (room) => room.name === roomName && BUILDINGS.includes(room.building), {
          name: roomName, building, floor: 1, capacity: 24 + (i % 5) * 12, type: ROOM_TYPES[i % ROOM_TYPES.length],
          facilities: ["Campus Wi-Fi", "Whiteboard", ...(i % 3 === 0 ? ["Notice board"] : [])], equipment,
          maintenanceHold: faulty, inspectionHistory: [{ equipment, recordedAt: new Date(academicDate(18 - i) + "T09:00:00Z") }], available: !faulty,
          createdAt: new Date(academicDate(0) + "T08:00:00Z"),
        }, session, `Room ${building}/${roomName}`);
        rooms.push(result.record);
        count("rooms", result.created);
      }

      const classroomRooms = rooms.filter((room) => !room.maintenanceHold).slice(0, 12);
      const classes = [];
      let studentCursor = 0;
      const enrollmentSizes = [18, 22, 16, 25, 20, 14, 24, 19, 17, 23, 15, 21];
      const classTimes = [["09:00", "10:30"], ["10:45", "12:15"], ["13:00", "14:30"], ["14:45", "16:15"]];
      for (let i = 0; i < COURSE_NAMES.length; i += 1) {
        const courseCode = `ARU${String(201 + i)}`;
        const enrollmentSize = enrollmentSizes[i];
        const enrolledStudents = Array.from({ length: enrollmentSize }, (_, offset) => students[(studentCursor + offset) % students.length]);
        studentCursor = (studentCursor + enrollmentSize) % students.length;
        const [startTime, endTime] = classTimes[i % classTimes.length];
        const classSpec = {
          courseName: COURSE_NAMES[i],
          courseCode,
          section: "A",
          faculty: faculty[i % faculty.length]._id,
          room: classroomRooms[i]._id,
          day: DAYS[i % DAYS.length],
          startTime,
          endTime,
          maxEnrollment: classroomRooms[i].capacity,
          enrolledStudents: enrolledStudents.map((student) => student._id),
          createdAt: new Date(academicDate(2 + i) + "T08:30:00Z"),
        };
        const result = await ensureRecord(CampusClass, { courseCode, section: "A" }, (item) => item.courseCode.startsWith("ARU") || item.courseCode.startsWith("DEMO"), classSpec, session, `Class ${courseCode}`);
        classes.push(result.record);
        count("classes", result.created);
      }

      const bookings = [];
      const operationalRooms = rooms.filter((room) => !room.maintenanceHold && room.available);
      const teachingRoomIds = new Set(classes.map((campusClass) => campusClass.room.toString()));
      const bookingRooms = operationalRooms.filter((room) => !teachingRoomIds.has(room._id.toString()));
      const bookingPurposes = ["Department seminar", "Robotics club workshop", "Project review panel", "Placement preparation session", "Student society meeting", "Laboratory safety briefing", "Alumni mentoring circle"];
      for (let i = 0; i < 28; i += 1) {
        const bookingDate = academicDate(8 + i * 3);
        const student = students[i % students.length];
        const room = bookingRooms[i % bookingRooms.length];
        const purpose = `${bookingPurposes[i % bookingPurposes.length]} - ${student.name}`;
        const bookingTime = classTimes[i % classTimes.length];
        const result = await ensureRecord(Booking, { purpose, room: room._id, bookedBy: student._id }, (item) => item.purpose.includes(" - "), {
          room: room._id, date: bookingDate, startTime: bookingTime[0], endTime: bookingTime[1], purpose, status: "Approved", bookedBy: student._id,
          createdAt: new Date(academicDate(5 + i * 3) + "T10:00:00Z"),
        }, session, `Booking ${i + 1}`);
        bookings.push(result.record);
        count("bookings", result.created);
      }
      const otherStatuses = ["Pending", "Pending", "Pending", "Approved", "Approved", "Approved", "Rejected", "Rejected", "Rejected", "Cancelled", "Cancelled", "Cancelled"];
      for (let i = 0; i < otherStatuses.length; i += 1) {
        const n = i + 29;
        const room = bookingRooms[(i + 5) % bookingRooms.length];
        const student = students[(i + 20) % students.length];
        const purpose = `${["Student research presentation", "Department planning meeting", "Cultural committee rehearsal", "Guest lecture setup"][i % 4]} - ${student.name}`;
        const result = await ensureRecord(Booking, { purpose, room: room._id, bookedBy: student._id }, (item) => item.purpose.includes(" - "), {
          room: room._id, date: academicDate(142 + i), startTime: classTimes[i % classTimes.length][0], endTime: classTimes[i % classTimes.length][1], purpose, status: otherStatuses[i], bookedBy: student._id,
          createdAt: new Date(academicDate(135 + i) + "T10:00:00Z"),
        }, session, `Booking ${n}`);
        bookings.push(result.record);
        count("bookings", result.created);
      }

      const attendanceDates = [98, 105, 112, 119, 126, 133, 140].map(academicDate);
      const attendanceRows = [];
      for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
        const campusClass = classes[classIndex];
        const enrolled = campusClass.enrolledStudents.map((id) => students.find((student) => student._id.equals(id))).filter(Boolean);
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
      const maintenanceIssues = [
        ["Ceiling fan rattles at high speed", "The ceiling fan in the front row makes a loud rattling sound and slows intermittently.", "Fan", "High", 0],
        ["Projector image is out of focus", "The lecture projector remains blurry after lens adjustment; please inspect the focus assembly.", "Projector", "Normal", 5],
        ["Air conditioner not cooling", "The split AC runs continuously but the room temperature remains high.", "AC", "Urgent", 2],
        ["Lighting flickers near the lectern", "Two LED panels flicker during afternoon classes and need an electrical check.", "Light", "High", 3],
        ["Notice board mounting is loose", "The wall-mounted notice board has shifted and needs its brackets tightened.", null, "Low", 1],
        ["Fan regulator needs replacement", "The fan speed changes abruptly when the regulator is turned.", "Fan", "Normal", 7],
        ["Power outlet sparking in lab", "A socket beside the rear workbench sparked when equipment was unplugged.", null, "Urgent", 6],
        ["AC drainage pipe leaking", "Water is collecting below the indoor AC unit after extended use.", "AC", "High", 7],
        ["Projector HDMI connection intermittent", "The display signal drops when the lectern cable is moved.", "Projector", "Normal", 8],
        ["Replace failed corridor light", "The entrance light does not turn on; a replacement fitting has been installed for review.", "Light", "Normal", 9],
        ["Fan motor bearing replaced", "The worn bearing was replaced and the fan ran quietly during the post-repair check.", "Fan", "Normal", 10],
        ["Projector lamp replaced", "A new lamp restored normal brightness; please verify the image before closing.", "Projector", "Low", 11],
        ["AC filter cleaned", "The return-air filter was cleaned and cooling performance returned to normal.", "AC", "Normal", 12],
        ["Lighting ballast replaced", "The faulty ballast was replaced and the fixture passed the electrical check.", "Light", "Normal", 13],
        ["Laboratory fan guard secured", "The loose fan guard was refitted and checked for vibration.", "Fan", "Low", 14],
        ["Lecture hall projector repaired", "The connector board was replaced and a test presentation ran without signal loss.", "Projector", "High", 15],
        ["AC thermostat recalibrated", "The thermostat sensor was recalibrated and the unit now maintains the set temperature.", "AC", "Normal", 16],
        ["Emergency light battery replaced", "The backup battery was replaced and the emergency light passed its discharge test.", "Light", "High", 17],
      ];
      const complaints = [];
      for (let i = 0; i < complaintStatuses.length; i += 1) {
        const status = complaintStatuses[i];
        const [titleText, description, equipment, priority, roomIndex] = maintenanceIssues[i];
        const room = rooms[roomIndex];
        const assignedTo = ["In progress", "Pending Verification", "Resolved", "Closed"].includes(status) ? technicians[i % technicians.length] : null;
        const verified = ["Resolved", "Closed"].includes(status);
        const title = titleText;
        const submittedBy = students[(i * 7) % students.length];
        const history = [{ actor: submittedBy._id, action: "submitted", note: description, toStatus: "Open", createdAt: new Date(academicDate(4 + i) + "T09:00:00Z") }];
        if (assignedTo) history.push({ actor: admin._id, action: "assigned", note: `Assigned to ${assignedTo.name} from Facilities.`, fromStatus: "Open", toStatus: "In progress", createdAt: new Date(academicDate(5 + i) + "T10:00:00Z") });
        if (["Pending Verification", "Resolved", "Closed"].includes(status)) history.push({ actor: assignedTo._id, action: "work_submitted", note: `Technician update: ${description}`, fromStatus: "In progress", toStatus: "Pending Verification", evidence: ["Repair inspection recorded by Facilities"], createdAt: new Date(academicDate(6 + i) + "T15:00:00Z") });
        if (["Resolved", "Closed"].includes(status)) history.push({ actor: faculty[(i + 1) % faculty.length]._id, action: "resolution_verified", note: "Repair verified by the department representative.", fromStatus: "Pending Verification", toStatus: status, createdAt: new Date(academicDate(7 + i) + "T11:00:00Z") });
        const query = { title };
        const result = await ensureRecord(Complaint, query, (item) => item.title === title || item.title.startsWith("[DEMO-COMPLAINT-"), {
          title, description,
          category: "Facilities", status, room: room?._id || null, equipment, priority,
          assignedTo: assignedTo?._id || null, resolutionDetails: assignedTo ? `Facilities completed: ${description}` : "",
          resolutionEvidence: assignedTo ? ["Facilities post-repair inspection completed"] : [],
          verifiedBy: verified ? faculty[(i + 1) % faculty.length]._id : null,
          verifiedAt: ["Resolved", "Closed"].includes(status) ? new Date(academicDate(7 + i) + "T11:00:00Z") : null,
          verificationNote: ["Resolved", "Closed"].includes(status) ? "Repair verified by the department representative." : "",
          history, submittedBy: submittedBy._id,
          createdAt: new Date(academicDate(4 + i) + "T09:00:00Z"),
        }, session, `Complaint ${i + 1}`);
        complaints.push(result.record);
        count("complaints", result.created);
      }

      const noticeSpecs = [
        ["Monsoon Semester 2026 Commencement", "The monsoon semester begins on 13 July. Students should check their department timetable before attending the first lecture.", "all"],
        ["Library hours during examinations", "The Nalanda Library will remain open until 22:00 during the mid-semester assessment period.", "student"],
        ["Department timetable review", "Faculty coordinators are requested to submit timetable amendments to the Academic Office by 24 July.", "faculty"],
        ["Laboratory safety induction", "All laboratory users must complete the safety induction before accessing specialist equipment.", "all"],
        ["Inter-collegiate cultural festival", "Student societies may submit event proposals to the Student Centre by 31 July.", "student"],
      ];
      const notices = [];
      for (let i = 0; i < noticeSpecs.length; i += 1) {
        const [titleText, body, audience] = noticeSpecs[i];
        const title = titleText;
        const result = await ensureRecord(Notice, { title }, (item) => item.title === title || item.title.startsWith("[DEMO-NOTICE-"), {
          title, body, category: "Campus Update", audience, author: admin._id,
          createdAt: new Date(academicDate([0, 40, 22, 15, 30][i]) + "T08:00:00Z"),
        }, session, `Notice ${i + 1}`);
        notices.push(result.record);
        count("notices", result.created);
      }

      const notificationSpecs = [
        { recipient: admin, complaint: complaints[0], entityType: "complaint", entityId: complaints[0]._id, targetPage: "Complaints", title: "New facilities request", message: `${complaints[0].title} was submitted for review.` },
        { recipient: faculty[0], complaint: complaints[9], entityType: "complaint", entityId: complaints[9]._id, targetPage: "Complaints", title: "Repair awaiting verification", message: `${complaints[9].title} is ready for department verification.` },
        { recipient: technicians[0], complaint: complaints[5], entityType: "complaint", entityId: complaints[5]._id, targetPage: "Complaints", title: "Facilities request assigned", message: `${complaints[5].title} has been assigned to your queue.` },
        { recipient: students[0], entityType: "booking", entityId: bookings[0]._id, targetPage: "Room bookings", title: "Room booking approved", message: `Your request for ${bookings[0].date} has been approved.` },
      ];
      for (let i = 0; i < notificationSpecs.length; i += 1) {
        const item = notificationSpecs[i];
        const dedupeKey = `aru-2026-notification-${i + 1}`;
        const result = await ensureRecord(Notification, { dedupeKey }, (row) => row.dedupeKey === dedupeKey, {
          ...item, recipient: item.recipient._id, complaint: item.complaint?._id || null, dedupeKey,
          title: item.title, message: item.message,
        }, session, `Notification ${i + 1}`);
        count("notifications", result.created);
      }

      const activitySpecs = [
        ...bookings.slice(0, 10).map((booking) => ({ actor: booking.bookedBy, action: "booking_recorded", entityType: "booking", entityId: booking._id, summary: `${booking.purpose} scheduled for ${booking.date}.` })),
        ...complaints.slice(0, 18).map((complaint) => ({ actor: complaint.submittedBy, action: "maintenance_request", entityType: "complaint", entityId: complaint._id, summary: `${complaint.title} — ${complaint.status}.` })),
        ...rooms.slice(0, 5).map((room) => ({ actor: admin._id, action: "room_inspected", entityType: "room", entityId: room._id, summary: `${room.building}, room ${room.name} inspection recorded.` })),
        ...notices.map((notice) => ({ actor: admin._id, action: "notice_published", entityType: "notice", entityId: notice._id, summary: `${notice.title} published to ${notice.audience}.` })),
      ];
      for (const item of activitySpecs) {
        const result = await ensureRecord(ActivityLog, { action: item.action, entityType: item.entityType, entityId: item.entityId, summary: item.summary },
          (row) => row.entityId.equals(item.entityId), item, session, item.summary);
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
