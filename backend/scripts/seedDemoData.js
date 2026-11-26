const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const fs = require("fs");
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { hashPassword, isAcceptablePassword } = require("../utils/password");
const { demoPersonName } = require("../utils/demoNames");
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
  "Savitribai Phule Arts  Block",
  "Sardar Patel Student Centre",
  "A.P.J. Abdul Kalam Engineering Complex",
];
const DEPARTMENTS = ["Computer Science", "Information Technology", "Electronics and Communication", "Mechanical Engineering", "Civil Engineering", "Business Administration", "Arts and Humanities"];
const COURSE_NAMES = ["Data Structures and Algorithms", "Database Management Systems", "Computer Networks", "Object Oriented Programming", "Digital Systems Design", "Thermodynamics", "Surveying and Geomatics", "Signals and Systems", "Principles of Marketing", "Operations Research", "Indian Writing in English", "Business Communication"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ROOM_TYPES = ["Classroom", "Lecture Hall", "Laboratory", "Meeting Room", "Auditorium"];
const EQUIPMENT_TYPES = ["Fan", "AC", "Projector", "Light"];
const FACILITY_SPECIALTIES = ["Electrical", "Cooling and ventilation", "Audio visual", "Lighting", "Water systems", "General maintenance"];
const COHORT_SIZES = [38, 40, 42];
const ACADEMIC_START = new Date("2026-07-01T00:00:00.000Z");
const COURSE_DEPARTMENTS = [
  "Computer Science", "Information Technology", "Information Technology", "Computer Science",
  "Electronics and Communication", "Mechanical Engineering", "Civil Engineering", "Electronics and Communication",
  "Business Administration", "Business Administration", "Arts and Humanities", "Business Administration",
];
const COMPLAINT_STATUSES = ["Open", "In progress", "Pending Verification", "Closed"];
const COMPLAINT_STATUS_COUNTS = { "Open": 60, "In progress": 60, "Pending Verification": 60, "Closed": 120 };
const COMPLAINT_PRIORITY_COUNTS = { High: 90, Normal: 90, Urgent: 60, Low: 60 };
const COMPLAINT_WORKFLOW_TRANSITIONS = ["Open>In progress", "In progress>Pending Verification", "Pending Verification>In progress", "Pending Verification>Closed"];
const COMPLAINT_STATUS_BY_BUILDING = [
  { "Open": 8, "In progress": 12, "Pending Verification": 5, "Closed": 25 },
  { "Open": 9, "In progress": 11, "Pending Verification": 8, "Closed": 22 },
  { "Open": 10, "In progress": 10, "Pending Verification": 9, "Closed": 21 },
  { "Open": 11, "In progress": 9, "Pending Verification": 12, "Closed": 18 },
  { "Open": 10, "In progress": 9, "Pending Verification": 11, "Closed": 20 },
  { "Open": 12, "In progress": 9, "Pending Verification": 15, "Closed": 14 },
];
const COMPLAINT_PRIORITY_BY_BUILDING = [
  { High: 18, Normal: 12, Urgent: 8, Low: 12 },
  { High: 16, Normal: 14, Urgent: 9, Low: 11 },
  { High: 15, Normal: 15, Urgent: 10, Low: 10 },
  { High: 14, Normal: 16, Urgent: 11, Low: 9 },
  { High: 13, Normal: 17, Urgent: 10, Low: 10 },
  { High: 14, Normal: 16, Urgent: 12, Low: 8 },
];
function dateText(date) { return date.toISOString().slice(0, 10); }
function academicDate(dayOffset) { const date = new Date(ACADEMIC_START); date.setUTCDate(date.getUTCDate() + dayOffset); return dateText(date); }
function buildTimeSlots() {
  return Array.from({ length: 10 }, (_, slot) => {
    const startMinutes = 8 * 60 + slot * 75;
    const endMinutes = startMinutes + 65;
    const asTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return [asTime(startMinutes), asTime(endMinutes)];
  });
}
function facultyDepartmentFor(index) {
  const ranges = [
    ["Computer Science", 70], ["Information Technology", 70], ["Electronics and Communication", 70],
    ["Mechanical Engineering", 60], ["Civil Engineering", 60], ["Business Administration", 60], ["Arts and Humanities", 60],
  ];
  let cursor = index;
  for (const [department, count] of ranges) {
    if (cursor < count) return department;
    cursor -= count;
  }
  throw new RangeError(`No faculty department is defined for index ${index}.`);
}
function studentEnrollmentDate(index) {
  const yearOfStudy = studentYearOfStudy(index);
  const cohortHash = (index * 37 + Math.floor(index / 13) * 17) % 100;
  const admissionMonths = [[3, 25], [4, 23], [5, 18], [6, 12], [7, 9], [8, 7], [9, 6]];
  let cursor = cohortHash;
  let month = admissionMonths[0][0];
  for (const [candidateMonth, weight] of admissionMonths) {
    if (cursor < weight) { month = candidateMonth; break; }
    cursor -= weight;
  }
  const day = 1 + ((index * 11 + Math.floor(index / 12)) % 27);
  return new Date(Date.UTC(2027 - yearOfStudy, month, day, 9));
}
function studentYearOfStudy(index) {
  const cohortHash = (index * 31 + Math.floor(index / 7) * 13) % 100;
  return cohortHash < 32 ? 1 : cohortHash < 60 ? 2 : cohortHash < 83 ? 3 : 4;
}
function studentSemester(index) { return (studentYearOfStudy(index) - 1) * 2 + 1; }
function buildRoomSpecs() {
  return Array.from({ length: 120 }, (_, i) => {
    const buildingIndex = Math.floor(i / 20);
    const localIndex = i % 20;
    const building = BUILDINGS[buildingIndex];
    const floor = Math.floor(localIndex / 5) + 1;
    const name = `${["A", "B", "C", "D", "E", "F"][buildingIndex]}${floor}${String((localIndex % 5) + 1).padStart(2, "0")}`;
    const faulty = localIndex === 2;
    const type = ROOM_TYPES[localIndex % ROOM_TYPES.length];
    const capacity = type === "Classroom" ? 40 + (localIndex % 4) * 10
      : type === "Lecture Hall" ? 90 + (localIndex % 4) * 10
        : type === "Laboratory" ? 30 + (localIndex % 4) * 5
          : type === "Auditorium" ? 120 + (localIndex % 3) * 30 : 18 + (localIndex % 3) * 6;
    return { index: i, building, name, floor, type, capacity, faulty, createdAt: new Date(academicDate(0) + "T08:00:00Z") };
  });
}
function overlaps(start, end, otherStart, otherEnd) { return start < otherEnd && end > otherStart; }
function categoryAtPosition(position, counts) {
  let cursor = position;
  for (const [label, count] of Object.entries(counts)) {
    if (cursor < count) return label;
    cursor -= count;
  }
  throw new RangeError(`Position ${position} is outside the category distribution.`);
}
function buildClassSpecs({ faculty, students, rooms }) {
  const facultyByDepartment = new Map();
  for (const person of faculty) {
    if (!facultyByDepartment.has(person.department)) facultyByDepartment.set(person.department, []);
    facultyByDepartment.get(person.department).push(person);
  }
  const classroomRooms = rooms.filter((room, index) => index % 20 >= 5 && !room.maintenanceHold && room.available !== false && room.capacity >= 42);
  const timeSlots = buildTimeSlots();
  const classSpecs = [];
  let studentCursor = 0;
  for (let cohort = 0; cohort < 150; cohort += 1) {
    const enrollmentSize = COHORT_SIZES[cohort % COHORT_SIZES.length];
    const enrolledStudents = students.slice(studentCursor, studentCursor + enrollmentSize);
    studentCursor += enrollmentSize;
    for (let courseSlot = 0; courseSlot < 4; courseSlot += 1) {
      const subjectIndex = (cohort % 3) * 4 + courseSlot;
      const department = COURSE_DEPARTMENTS[subjectIndex];
      const facultyPool = facultyByDepartment.get(department) || [];
      if (facultyPool.length < 50) throw new Error(`Course department ${department} needs at least 50 faculty members.`);
      const [startTime, endTime] = timeSlots[cohort % timeSlots.length];
      const roomIndex = ((Math.floor(cohort / 10) * 17) + (courseSlot * 19)) % classroomRooms.length;
      const room = classroomRooms[roomIndex];
      const facultyMember = facultyPool[Math.floor(cohort / 3) % 50];
      classSpecs.push({
        courseName: COURSE_NAMES[subjectIndex], courseCode: `ARU${String(201 + subjectIndex)}`,
        section: String(cohort + 1).padStart(3, "0"), department,
        faculty: facultyMember._id, room: room._id, day: DAYS[courseSlot], startTime, endTime,
        maxEnrollment: room.capacity, enrolledStudents: enrolledStudents.map((student) => student._id),
        createdAt: new Date(academicDate(20 + subjectIndex) + "T08:30:00Z"),
      });
    }
  }
  return classSpecs;
}
function validateClassSpecs(classSpecs, { rooms, faculty, students, expectedClasses = 600, expectedStudents = 6000 } = {}) {
  if (classSpecs.length !== expectedClasses) throw new Error(`Expected ${expectedClasses} classes, got ${classSpecs.length}.`);
  const roomById = new Map((rooms || []).map((room) => [String(room._id), room]));
  const roomIndexById = new Map((rooms || []).map((room, index) => [String(room._id), index]));
  const facultyById = new Map((faculty || []).map((person) => [String(person._id), person]));
  const validStudentIds = new Set((students || []).map((person) => String(person._id)));
  const classesByRoomDay = new Map();
  const classesByFacultyDay = new Map();
  const classesByStudentDay = new Map();
  const studentsByClassCount = new Map();
  let enrollmentReferences = 0;
  const classKeys = new Set();
  for (const item of classSpecs) {
    const key = `${item.courseCode}:${item.section}`;
    if (classKeys.has(key)) throw new Error(`Duplicate course section ${key}.`);
    classKeys.add(key);
    if (!DAYS.includes(item.day) || item.startTime >= item.endTime) throw new Error(`Invalid schedule for ${key}.`);
    const room = roomById.get(String(item.room));
    const roomIndex = roomIndexById.get(String(item.room));
    const facultyMember = facultyById.get(String(item.faculty));
    const subjectIndex = Number(item.courseCode.slice(3)) - 201;
    if (!room || item.enrolledStudents.length > room.capacity) throw new Error(`Room is missing or undersized for ${key}.`);
    if (roomIndex % 20 < 5) throw new Error(`Class ${key} is scheduled in a room reserved for unresolved facilities work.`);
    if (!facultyMember || facultyMember.department !== COURSE_DEPARTMENTS[subjectIndex] || item.department !== COURSE_DEPARTMENTS[subjectIndex]) {
      throw new Error(`Faculty department mismatch for ${key}.`);
    }
    if (item.enrolledStudents.length > item.maxEnrollment) throw new Error(`Maximum enrollment exceeded for ${key}.`);
    const roomKey = `${item.room}:${item.day}`;
    const facultyKey = `${item.faculty}:${item.day}`;
    for (const [map, scheduleKey, label] of [[classesByRoomDay, roomKey, "room"], [classesByFacultyDay, facultyKey, "faculty"]]) {
      const peers = map.get(scheduleKey) || [];
      if (peers.some((other) => overlaps(item.startTime, item.endTime, other.startTime, other.endTime))) {
        throw new Error(`${label} schedule conflict for ${key} on ${item.day}.`);
      }
      peers.push(item);
      map.set(scheduleKey, peers);
    }
    for (const id of item.enrolledStudents) {
      if (!validStudentIds.has(String(id))) throw new Error(`Class ${key} references a missing student.`);
      enrollmentReferences += 1;
      studentsByClassCount.set(String(id), (studentsByClassCount.get(String(id)) || 0) + 1);
    }
    for (const id of item.enrolledStudents) {
      const studentKey = `${id}:${item.day}`;
      const peers = classesByStudentDay.get(studentKey) || [];
      if (peers.some((other) => overlaps(item.startTime, item.endTime, other.startTime, other.endTime))) {
        throw new Error(`Student timetable conflict for ${key} on ${item.day}.`);
      }
      peers.push(item);
      classesByStudentDay.set(studentKey, peers);
    }
  }
  if (studentsByClassCount.size !== expectedStudents || [...studentsByClassCount.values()].some((count) => count !== 4)) {
    throw new Error(`Expected ${expectedStudents} students enrolled in exactly four classes each.`);
  }
  return {
    classes: classSpecs.length,
    students: studentsByClassCount.size,
    enrollmentReferences,
    roomConflicts: 0,
    facultyConflicts: 0,
    studentConflicts: 0,
    capacityViolations: 0,
    departmentMismatches: 0,
  };
}
function facultyByBuildingFor(classSpecs, rooms, faculty) {
  const roomById = new Map(rooms.map((room) => [String(room._id), room]));
  const facultyById = new Map(faculty.map((person) => [String(person._id), person]));
  const result = new Map(BUILDINGS.map((building) => [building, new Map()]));
  for (const item of classSpecs) {
    const room = roomById.get(String(item.room));
    const teacher = facultyById.get(String(item.faculty));
    if (room && teacher) result.get(room.building)?.set(String(teacher._id), teacher);
  }
  return new Map([...result].map(([building, people]) => [building, [...people.values()]]));
}
function buildComplaintSpecs({ admin, rooms, students, faculty, technicians, classSpecs }) {
  const issues = [
    ["Classroom fan not working", "The ceiling fan above the second row does not start when the wall switch is turned on.", "Fan", "Facilities"],
    ["Air conditioner cooling problem", "The split AC runs continuously but the classroom remains warm during afternoon lectures.", "AC", "Facilities"],
    ["Projector not displaying", "The projector powers on, but no image appears from the instructor workstation.", "Projector", "Audio Visual"],
    ["Classroom lights flickering", "Two LED panels flicker intermittently and make the front board difficult to read.", "Light", "Electrical"],
    ["Electrical socket damaged", "The socket beside the laboratory bench is loose and has been isolated for safety.", null, "Electrical"],
    ["Water leakage near wash area", "Water is pooling near the wash area after the morning cleaning round.", null, "Plumbing"],
    ["Laboratory equipment malfunction", "The centrifuge display resets during a run and requires a biomedical equipment check.", null, "Laboratory Equipment"],
    ["Broken classroom furniture", "A joint on the third-row desk has loosened and the desk is unstable.", null, "Furniture"],
    ["Network connectivity problem", "The wired teaching station loses its network connection several times each hour.", null, "Information Technology"],
    ["Washroom maintenance required", "The washroom tap continues to drip after closing and the floor remains wet.", null, "Plumbing"],
    ["Ceiling fan regulator noisy", "The regulator makes a clicking sound and the fan speed fluctuates at settings two and three.", "Fan", "Facilities"],
    ["Lecture hall projector image blurred", "The projected image is soft at the edges after the room was reconfigured.", "Projector", "Audio Visual"],
  ];
  const roomByBuildingFaculty = facultyByBuildingFor(classSpecs, rooms, faculty);
  const assignmentCursorByBuilding = Array(BUILDINGS.length).fill(0);
  return Array.from({ length: 300 }, (_, i) => {
    const localIndex = i % 50;
    const buildingIndex = Math.floor(i / 50);
    const statusDistribution = COMPLAINT_STATUS_BY_BUILDING[buildingIndex];
    const statusPosition = (localIndex * 13 + buildingIndex * 7) % 50;
    const status = categoryAtPosition(statusPosition, statusDistribution);
    const [titleText, issue, equipment, category] = issues[i % issues.length];
    const roomLocalIndex = status === "Closed" ? 5 + (((localIndex * 7) + buildingIndex) % 15) : localIndex % 5;
    const room = rooms[buildingIndex * 20 + roomLocalIndex];
    const techniciansForBuilding = technicians.slice(buildingIndex * 6, (buildingIndex + 1) * 6);
    const assignedTo = status === "Open" ? null : techniciansForBuilding[assignmentCursorByBuilding[buildingIndex]++ % techniciansForBuilding.length];
    if (assignedTo && !assignedTo.department.includes(`Building ${room.name[0]}`)) throw new Error(`Complaint ${i + 1} is assigned outside its building team.`);
    const submitter = i % 5 === 0 ? faculty[(i * 13) % faculty.length] : students[(i * 37) % students.length];
    const responsibleFaculty = roomByBuildingFaculty.get(room.building) || [];
    if (status === "Closed" && responsibleFaculty.length === 0) throw new Error(`No teaching faculty are associated with ${room.building}.`);
    const verifier = status === "Closed" ? responsibleFaculty[(i + 1) % responsibleFaculty.length] : null;
    const priorityDistribution = COMPLAINT_PRIORITY_BY_BUILDING[buildingIndex];
    const priority = categoryAtPosition((localIndex * 7 + buildingIndex * 3) % 50, priorityDistribution);
    const title = `${titleText} · ${room.building} ${room.name} · MT${String(i + 1).padStart(4, "0")}`;
    const description = `${issue} Location: ${room.name}, ${room.building}. Please inspect and update the facilities register.`;
    const submittedOffset = 82 + (i % 56);
    const submittedAt = new Date(academicDate(submittedOffset) + "T09:00:00Z");
    const history = [{ actor: submitter._id, action: "submitted", note: description, toStatus: "Open", createdAt: submittedAt }];
    if (assignedTo) history.push({ actor: admin._id, action: "assigned", note: `Assigned within the ${room.building} facilities team.`, fromStatus: "Open", toStatus: "In progress", createdAt: new Date(academicDate(submittedOffset + 1) + "T10:00:00Z") });
    if (["Pending Verification", "Closed"].includes(status)) history.push({ actor: assignedTo._id, action: "work_submitted", note: `Technician update: ${issue} inspected; corrective work recorded for ${room.name}.`, fromStatus: "In progress", toStatus: "Pending Verification", evidence: ["https://campus.edu.in/facilities/work-order"], createdAt: new Date(academicDate(submittedOffset + 3) + "T15:00:00Z") });
    if (status === "Closed") history.push({ actor: verifier._id, action: "resolution_verified", note: "Repair checked by a faculty member teaching in this building and accepted for use.", fromStatus: "Pending Verification", toStatus: "Closed", createdAt: new Date(academicDate(submittedOffset + 5) + "T11:00:00Z") });
    return {
      query: { title }, markerCheck: (item) => item.title === title || item.title.startsWith("[DEMO-COMPLAINT-"),
      building: room.building, roomLocalIndex,
      label: `Maintenance request ${i + 1}`,
      document: {
        title, description, category, status, room: room._id, equipment, priority,
        assignedTo: assignedTo?._id || null,
        resolutionDetails: ["Pending Verification", "Closed"].includes(status) ? `Facilities completed: ${description}` : "",
        resolutionEvidence: ["Pending Verification", "Closed"].includes(status) ? ["Facilities post-repair inspection completed"] : [],
        verifiedBy: verifier?._id || null,
        verifiedAt: verifier ? new Date(academicDate(submittedOffset + 5) + "T11:00:00Z") : null,
        verificationNote: verifier ? "Repair verified by the responsible building faculty member." : "",
        history, submittedBy: submitter._id, createdAt: submittedAt,
      },
    };
  });
}
function validateComplaintSpecs(specs) {
  const statusCounts = Object.fromEntries(COMPLAINT_STATUSES.map((status) => [status, 0]));
  const priorityCounts = { High: 0, Normal: 0, Urgent: 0, Low: 0 };
  const statusCountsByBuilding = new Map(BUILDINGS.map((building) => [building, { ...Object.fromEntries(COMPLAINT_STATUSES.map((status) => [status, 0])) }]));
  const priorityCountsByBuilding = new Map(BUILDINGS.map((building) => [building, { High: 0, Normal: 0, Urgent: 0, Low: 0 }]));
  const heldRoomLocals = new Map(BUILDINGS.map((building) => [building, new Set()]));
  const technicianWorkload = new Map();
  const allowedTransitions = new Set(COMPLAINT_WORKFLOW_TRANSITIONS);
  for (const { document, building, roomLocalIndex } of specs) {
    statusCounts[document.status] += 1;
    priorityCounts[document.priority] += 1;
    statusCountsByBuilding.get(building)[document.status] += 1;
    priorityCountsByBuilding.get(building)[document.priority] += 1;
    if (document.assignedTo) technicianWorkload.set(String(document.assignedTo), (technicianWorkload.get(String(document.assignedTo)) || 0) + 1);
    if (document.status !== "Closed") heldRoomLocals.get(building).add(roomLocalIndex);
    let previous = "Open";
    for (const item of document.history.slice(1)) {
      if (!allowedTransitions.has(`${item.fromStatus}>${item.toStatus}`) || item.fromStatus !== previous) {
        throw new Error(`Unreachable complaint transition ${item.fromStatus}>${item.toStatus} in ${document.title}.`);
      }
      previous = item.toStatus;
    }
    if (previous !== document.status || (document.status === "Open") !== !document.assignedTo) {
      throw new Error(`Complaint assignment or history does not match ${document.status} for ${document.title}.`);
    }
  }
  for (const [status, expected] of Object.entries(COMPLAINT_STATUS_COUNTS)) if (statusCounts[status] !== expected) throw new Error(`Expected ${expected} ${status} complaints, got ${statusCounts[status]}.`);
  for (const [priority, expected] of Object.entries(COMPLAINT_PRIORITY_COUNTS)) if (priorityCounts[priority] !== expected) throw new Error(`Expected ${expected} ${priority} complaints, got ${priorityCounts[priority]}.`);
  for (let index = 0; index < BUILDINGS.length; index += 1) {
    const building = BUILDINGS[index];
    for (const [status, expected] of Object.entries(COMPLAINT_STATUS_BY_BUILDING[index])) if (statusCountsByBuilding.get(building)[status] !== expected) throw new Error(`Unexpected ${status} count for ${building}.`);
    for (const [priority, expected] of Object.entries(COMPLAINT_PRIORITY_BY_BUILDING[index])) if (priorityCountsByBuilding.get(building)[priority] !== expected) throw new Error(`Unexpected ${priority} count for ${building}.`);
    const roomLocals = heldRoomLocals.get(building);
    if (roomLocals.size !== 5 || [...roomLocals].some((localIndex) => localIndex >= 5)) throw new Error(`Unresolved complaints do not map to the five maintenance rooms in ${building}.`);
  }
  if (technicianWorkload.size !== 36 || [...technicianWorkload.values()].some((count) => count < 6 || count > 7)) throw new Error("Technician assignments must be balanced at six or seven complaints per technician.");
  return { statusCounts, priorityCounts, technicianAssignments: Object.fromEntries(technicianWorkload), statusCountsByBuilding: Object.fromEntries(statusCountsByBuilding), priorityCountsByBuilding: Object.fromEntries(priorityCountsByBuilding) };
}
function buildAttendanceSpecs({ classes, studentsById }) {
  const weekdayOffsets = [117, 118, 112, 113];
  const rows = [];
  for (const campusClass of classes) {
    const enrolled = campusClass.enrolledStudents.map((id) => studentsById.get(String(id))).filter(Boolean);
    if (enrolled.length !== campusClass.enrolledStudents.length) throw new Error(`Class ${campusClass.courseCode}/${campusClass.section} references a missing student.`);
    const courseSlot = DAYS.indexOf(campusClass.day);
    const cohort = Number(campusClass.section) - 1;
    const legacyWeek = Math.floor(cohort / 10) % 4;
    if (courseSlot < 0) throw new Error(`Invalid attendance weekday for ${campusClass.courseCode}/${campusClass.section}.`);
    for (let sessionIndex = 0; sessionIndex < 4; sessionIndex += 1) {
      const date = academicDate(weekdayOffsets[courseSlot] + (legacyWeek - 3 + sessionIndex) * 7);
      for (let studentIndex = 0; studentIndex < enrolled.length; studentIndex += 1) {
        const student = enrolled[studentIndex];
        const attendanceVariation = studentIndex * 3 + cohort + courseSlot * 5 + sessionIndex * 7;
        const legacyAttendanceVariation = studentIndex + cohort + courseSlot;
        rows.push({
          campusClass: campusClass._id, student: student._id, date,
          status: sessionIndex === 3
            ? legacyAttendanceVariation % 13 === 0 ? "late" : (studentIndex * 3 + cohort + courseSlot) % 9 === 0 ? "absent" : "present"
            : attendanceVariation % 17 === 0 ? "late" : attendanceVariation % 10 === 0 ? "absent" : "present",
          markedBy: campusClass.faculty,
        });
      }
    }
  }
  return rows;
}
function validateAttendanceSpecs(rows, classSpecs, expectedStudents = 6000) {
  const classesById = new Map(classSpecs.map((item) => [String(item._id), item]));
  const classStudentSessions = new Map();
  const studentIds = new Set();
  for (const row of rows) {
    if (!["present", "absent", "late"].includes(row.status)) throw new Error(`Invalid attendance status ${row.status}.`);
    const campusClass = classesById.get(String(row.campusClass));
    if (!campusClass || !campusClass.enrolledStudents.some((id) => String(id) === String(row.student)) || String(campusClass.faculty) !== String(row.markedBy)) {
      throw new Error(`Attendance row does not match its class, student, or faculty reference on ${row.date}.`);
    }
    const date = new Date(`${row.date}T00:00:00.000Z`);
    if (DAYS[date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1] !== campusClass.day) throw new Error(`Attendance session falls on the wrong weekday for ${campusClass.courseCode}.`);
    studentIds.add(String(row.student));
    const key = `${row.campusClass}:${row.student}`;
    const dates = classStudentSessions.get(key) || new Set();
    if (dates.has(row.date)) throw new Error(`Duplicate attendance session for ${key} on ${row.date}.`);
    dates.add(row.date);
    classStudentSessions.set(key, dates);
  }
  if (studentIds.size !== expectedStudents || [...classStudentSessions.values()].some((dates) => dates.size !== 4)) {
    throw new Error(`Attendance must contain four distinct sessions for every enrolled student in ${expectedStudents} student records.`);
  }
  const expectedEnrollmentSlots = classSpecs.reduce((total, item) => total + item.enrolledStudents.length, 0);
  if (rows.length !== expectedEnrollmentSlots * 4) throw new Error("Attendance row count does not match class enrollments and session count.");
  return { rows: rows.length, students: studentIds.size, sessionsPerEnrollment: 4 };
}
function studentDepartmentFor(index) {
  let cursor = 0;
  for (let cohort = 0; cohort < 150; cohort += 1) {
    const size = COHORT_SIZES[cohort % COHORT_SIZES.length];
    if (index < cursor + size) {
      const track = cohort % 3;
      const group = Math.floor(cohort / 3);
      if (track === 0) return group % 2 ? "Information Technology" : "Computer Science";
      if (track === 1) return ["Mechanical Engineering", "Electronics and Communication", "Civil Engineering"][group % 3];
      return group % 2 ? "Arts and Humanities" : "Business Administration";
    }
    cursor += size;
  }
  return DEPARTMENTS[0];
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
    CampusClass.countDocuments({ courseCode: /^ARU20/, section: "A" }),
    User.countDocuments({ role: "student", studentId: /^STU2026/ }),
  ]);
  const oldScaleAravalliSeed = legacyCounts[7] > 0 && legacyCounts[7] !== 6000;
  if (legacyCounts.some((count, index) => index < 6 && count > 0) || oldScaleAravalliSeed) {
    throw new Error("This database contains records from the legacy demo seed. To avoid mixing or deleting existing data, choose a fresh dedicated local demo database for the Aravalli University dataset.");
  }
}

async function ensureCleanSeedTarget() {
  const collectionCounts = await Promise.all([
    User.countDocuments(), Room.countDocuments(), CampusClass.countDocuments(), Booking.countDocuments(),
    Attendance.countDocuments(), Complaint.countDocuments(), Notification.countDocuments(), ActivityLog.countDocuments(), Notice.countDocuments(),
  ]);
  if (collectionCounts.every((count) => count === 0)) return;
  const existingSampleStudent = await User.exists({ email: "student0001@campus.edu.in", studentId: "STU20260001", role: "student" });
  if (!existingSampleStudent) {
    throw new Error("The target demo database is not empty and does not contain the Aravalli seed identity. To preserve existing records and keep campus totals exact, choose a fresh dedicated local demo database.");
  }
  const expectedCounts = [
    ["student accounts", await User.countDocuments({ role: "student" }), 6000],
    ["faculty accounts", await User.countDocuments({ role: "faculty" }), 450],
    ["technician accounts", await User.countDocuments({ role: "technician" }), 36],
    ["administrator accounts", await User.countDocuments({ role: "admin" }), 1],
    ["total user accounts", collectionCounts[0], 6487],
    ["rooms", collectionCounts[1], 120],
    ["classes", collectionCounts[2], 600],
    ["bookings", collectionCounts[3], 600],
    ["complaints", collectionCounts[5], 300],
    ["notifications", collectionCounts[6], 4],
    ["activity entries", collectionCounts[7], 77],
    ["notices", collectionCounts[8], 5],
  ];
  const attendanceCount = collectionCounts[4];
  if (attendanceCount !== 24000 && attendanceCount !== 96000) {
    throw new Error("The Aravalli sample attendance count is unexpected. No records were changed; use a clean dedicated demo database or inspect the target first.");
  }
  const mismatch = expectedCounts.find(([, actual, expected]) => actual !== expected);
  if (mismatch) {
    throw new Error(`The demo database contains ${mismatch[0]} outside the canonical seed totals (${mismatch[1]} found; ${mismatch[2]} expected). No records were changed; preserve or review those records separately before reseeding.`);
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
  await ensureCleanSeedTarget();

  const counts = Object.create(null);
  const count = (collection, created) => { counts[collection] = (counts[collection] || 0) + Number(created); };
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const passwordHashes = Object.fromEntries(await Promise.all(["admin", "faculty", "student", "technician"].map(async (role) => [role, await hashPassword(credentials[role].password)])));
      const accountSpecs = [
        { role: "admin", email: credentials.admin.email.trim().toLowerCase(), passwordHash: passwordHashes.admin, name: "Ananya Deshmukh", department: "Campus Operations", studentId: "ADM2026001", createdAt: new Date("2020-06-01T09:00:00Z"), updatedAt: new Date("2026-07-01T09:00:00Z") },
    ...Array.from({ length: 450 }, (_, i) => ({
          role: "faculty", email: i === 0 ? credentials.faculty.email.trim().toLowerCase() : `faculty${String(i + 1).padStart(3, "0")}@campus.edu.in`,
          passwordHash: passwordHashes.faculty, name: demoPersonName(i, "faculty"), department: facultyDepartmentFor(i), studentId: `FAC2026${String(i + 1).padStart(3, "0")}`,
          createdAt: new Date(Date.UTC(2018 + (i % 8), i % 12, 1, 9)), updatedAt: new Date("2026-07-01T09:00:00Z"),
        })),
    ...Array.from({ length: 36 }, (_, i) => ({
          role: "technician", email: i === 0 ? credentials.technician.email.trim().toLowerCase() : `facilities${String(i + 1).padStart(3, "0")}@campus.edu.in`,
          passwordHash: passwordHashes.technician, name: demoPersonName(i, "technician"), department: `Facilities · Building ${["A", "B", "C", "D", "E", "F"][Math.floor(i / 6)]} · ${FACILITY_SPECIALTIES[i % 6]}`, studentId: `TEC2026${String(i + 1).padStart(3, "0")}`,
          createdAt: new Date(Date.UTC(2020 + (i % 6), i % 12, 1, 8)), updatedAt: new Date("2026-07-01T09:00:00Z"),
        })),
    ...Array.from({ length: 6000 }, (_, i) => ({
          role: "student", email: i === 0 ? credentials.student.email.trim().toLowerCase() : `student${String(i + 1).padStart(4, "0")}@campus.edu.in`,
      passwordHash: passwordHashes.student, name: demoPersonName(i, "student"), department: studentDepartmentFor(i), studentId: `STU2026${String(i + 1).padStart(4, "0")}`,
      yearOfStudy: studentYearOfStudy(i),
      semester: studentSemester(i),
      createdAt: studentEnrollmentDate(i),
      updatedAt: new Date("2026-07-01T09:00:00Z"),
        })),
      ];
      const existingUsers = await User.find({ email: { $in: accountSpecs.map((row) => row.email) } }).select("email role studentId").session(session).lean();
      const existingByEmail = new Map(existingUsers.map((user) => [user.email, user]));
      for (const spec of accountSpecs) {
        const existing = existingByEmail.get(spec.email);
        if (existing && (existing.role !== spec.role || (existing.studentId !== spec.studentId && !seededUser(existing)))) {
          throw new Error(`Institutional account collision at ${spec.email}; no seed changes were committed.`);
        }
      }
      const userOperations = accountSpecs.map((spec) => {
        const { passwordHash, ...profile } = spec;
        return { updateOne: { filter: { email: spec.email }, update: { $set: profile, $setOnInsert: { password: passwordHash, phone: "", tokenVersion: 0, referenceVersion: 0 } }, upsert: true } };
      });
      const userWrite = await User.collection.bulkWrite(userOperations, { session, ordered: true });
      count("users", userWrite.upsertedCount || 0);
      const seededUsers = await User.find({ email: { $in: accountSpecs.map((row) => row.email) } }).session(session);
      const usersByEmail = new Map(seededUsers.map((user) => [user.email, user]));
      const admin = usersByEmail.get(accountSpecs.find((row) => row.role === "admin").email);
      const faculty = accountSpecs.filter((row) => row.role === "faculty").map((row) => usersByEmail.get(row.email));
      const technicians = accountSpecs.filter((row) => row.role === "technician").map((row) => usersByEmail.get(row.email));
      const students = accountSpecs.filter((row) => row.role === "student").map((row) => usersByEmail.get(row.email));
      const studentsById = new Map(students.map((student) => [student._id.toString(), student]));

      const rooms = [];
      for (const roomSpec of buildRoomSpecs()) {
        const { index: i, building, name: roomName, floor, type: roomType, capacity, faulty } = roomSpec;
        const faultyEquipment = faulty ? "AC" : null;
        const equipment = EQUIPMENT_TYPES.map((type) => ({
          type,
          status: faulty && type === faultyEquipment ? "Needs Maintenance" : "Working",
          note: faulty && type === faultyEquipment ? "Reported for facilities follow-up" : "Inspection completed; operating normally",
          inspectedBy: faculty[i % faculty.length]._id,
          inspectedAt: new Date(academicDate(18 - i) + "T09:00:00Z"),
        }));
        const result = await ensureRecord(Room, { name: roomName, building }, (room) => room.name === roomName && BUILDINGS.includes(room.building), {
          name: roomName, building, floor, capacity, type: roomType,
          facilities: ["Campus Wi-Fi", "Whiteboard", ...(i % 3 === 0 ? ["Notice board"] : [])], equipment,
          maintenanceHold: faulty, inspectionHistory: [{ equipment, recordedAt: new Date(academicDate(18 - i) + "T09:00:00Z") }], available: !faulty,
          createdAt: new Date(academicDate(0) + "T08:00:00Z"),
        }, session, `Room ${building}/${roomName}`);
        rooms.push(result.record);
        count("rooms", result.created);
      }

      const generatedClassSpecs = buildClassSpecs({ faculty, students, rooms });
      validateClassSpecs(generatedClassSpecs, { rooms, faculty, students });
      const classes = [];
      for (const classSpec of generatedClassSpecs) {
        const { courseCode, section } = classSpec;
        const result = await ensureRecord(CampusClass, { courseCode, section }, (item) => item.courseCode.startsWith("ARU") || item.courseCode.startsWith("DEMO"), classSpec, session, `Class ${courseCode}/${section}`);
        classes.push(result.record);
        count("classes", result.created);
      }

      const bookings = [];
      const timeSlots = buildTimeSlots();
      const operationalRooms = rooms.filter((room) => !room.maintenanceHold && room.available);
      const teachingRoomIds = new Set(classes.map((campusClass) => campusClass.room.toString()));
      const bookingRooms = operationalRooms.filter((room) => !teachingRoomIds.has(room._id.toString()) && rooms.indexOf(room) % 20 >= 5);
      const bookingPurposes = ["Department seminar", "Robotics club workshop", "Project review panel", "Placement preparation session", "Student society meeting", "Laboratory safety briefing", "Alumni mentoring circle", "Research poster session", "Design review", "Entrepreneurship forum", "Peer tutoring clinic", "Guest lecture setup"];
      const bookingStatusFor = (i) => i % 20 < 14 ? "Approved" : i % 20 < 17 ? "Pending" : i % 20 < 19 ? "Rejected" : "Cancelled";
      for (let i = 0; i < 600; i += 1) {
        const bookingDate = academicDate(100 + Math.floor(i / bookingRooms.length) * 3);
        const requester = i % 7 === 0 ? faculty[Math.floor(i / 7) % faculty.length] : students[i % students.length];
        const room = bookingRooms[i % bookingRooms.length];
        const purpose = `BK2026${String(i + 1).padStart(4, "0")} | ${bookingPurposes[i % bookingPurposes.length]} - ${requester.name}`;
        const bookingTime = timeSlots[(i + Math.floor(i / bookingRooms.length)) % timeSlots.length];
        const result = await ensureRecord(Booking, { purpose }, (item) => item.purpose.startsWith("BK2026"), {
          room: room._id, date: bookingDate, startTime: bookingTime[0], endTime: bookingTime[1], purpose, status: bookingStatusFor(i), bookedBy: requester._id,
          createdAt: new Date(academicDate(98 + Math.floor(i / bookingRooms.length) * 3) + "T10:00:00Z"),
        }, session, `Booking ${i + 1}`);
        bookings.push(result.record);
        count("bookings", result.created);
      }

      const attendanceRows = buildAttendanceSpecs({ classes, studentsById });
      validateAttendanceSpecs(attendanceRows, classes);
      for (let index = 0; index < attendanceRows.length; index += 1000) {
        const batch = attendanceRows.slice(index, index + 1000);
        const attendanceKeys = batch.map(({ campusClass, student, date }) => ({ campusClass, student, date }));
        const existingAttendance = await Attendance.find({ $or: attendanceKeys }).select("campusClass student date").session(session).lean();
        const existingKeys = new Set(existingAttendance.map((row) => `${row.campusClass}:${row.student}:${row.date}`));
        const missing = batch.filter((row) => !existingKeys.has(`${row.campusClass}:${row.student}:${row.date}`));
        if (missing.length) {
          await Attendance.insertMany(missing, { session, ordered: true });
          count("attendance", missing.length);
        }
      }

      const complaintSpecs = buildComplaintSpecs({ admin, rooms, students, faculty, technicians, classSpecs: generatedClassSpecs });
      validateComplaintSpecs(complaintSpecs);
      const complaints = [];
      for (const spec of complaintSpecs) {
        const result = await ensureRecord(Complaint, spec.query, spec.markerCheck, spec.document, session, spec.label);
        complaints.push(result.record);
        count("complaints", result.created);
      }

      const complaintsByRoom = new Map();
      for (const complaint of complaints) {
        const roomId = complaint.room.toString();
        const rows = complaintsByRoom.get(roomId) || [];
        rows.push(complaint);
        complaintsByRoom.set(roomId, rows);
      }
      for (const room of rooms) {
        const roomComplaints = complaintsByRoom.get(room._id.toString()) || [];
        const activeComplaints = roomComplaints.filter((complaint) => complaint.status !== "Closed");
        const activeEquipment = new Set(activeComplaints.map((complaint) => complaint.equipment).filter(Boolean));
        for (const equipment of room.equipment) {
          const faulty = activeEquipment.has(equipment.type);
          equipment.status = faulty ? "Not Working" : "Working";
          equipment.note = faulty ? "Fault reported; see active maintenance request." : "Inspected and operational.";
        }
        room.maintenanceHold = activeComplaints.length > 0;
        room.available = !room.maintenanceHold;
        await room.save({ session });
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
        { recipient: faculty[0], complaint: complaints[20], entityType: "complaint", entityId: complaints[20]._id, targetPage: "Complaints", title: "Repair awaiting verification", message: `${complaints[20].title} is ready for department verification.` },
        { recipient: technicians[0], complaint: complaints[12], entityType: "complaint", entityId: complaints[12]._id, targetPage: "Complaints", title: "Facilities request assigned", message: `${complaints[12].title} has been assigned to your queue.` },
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
        ...bookings.slice(0, 30).map((booking) => ({ actor: booking.bookedBy, action: "booking_recorded", entityType: "booking", entityId: booking._id, summary: `${booking.purpose} scheduled for ${booking.date}.` })),
        ...complaints.slice(0, 30).map((complaint) => ({ actor: complaint.submittedBy, action: "maintenance_request", entityType: "complaint", entityId: complaint._id, summary: `${complaint.title} — ${complaint.status}.` })),
        ...rooms.filter((room, index) => index % 10 === 0).map((room) => ({ actor: admin._id, action: "room_inspected", entityType: "room", entityId: room._id, summary: `${room.building}, room ${room.name} inspection recorded.` })),
        ...notices.map((notice) => ({ actor: admin._id, action: "notice_published", entityType: "notice", entityId: notice._id, summary: `${notice.title} published to ${notice.audience}.` })),
      ];
      for (const item of activitySpecs) {
        const result = await ensureRecord(ActivityLog, { action: item.action, entityType: item.entityType, entityId: item.entityId },
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

module.exports = {
  BUILDINGS, COMPLAINT_PRIORITY_COUNTS, COMPLAINT_STATUS_COUNTS, COMPLAINT_WORKFLOW_TRANSITIONS, DEPARTMENTS,
  buildRoomSpecs, buildClassSpecs, buildComplaintSpecs, buildAttendanceSpecs,
  validateClassSpecs, validateComplaintSpecs, validateAttendanceSpecs,
  facultyDepartmentFor, studentEnrollmentDate, studentYearOfStudy, studentSemester,
};

if (require.main === module) {
  runSeed()
    .catch((error) => {
      console.error("CampusOS demo seed did not complete:", error.message || error.name || "Unknown error");
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
}
