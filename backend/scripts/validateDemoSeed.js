const assert = require("node:assert/strict");
const { demoPersonName, validateDemoNameUniqueness } = require("../utils/demoNames");
const {
  BUILDINGS,
  COMPLAINT_WORKFLOW_TRANSITIONS,
  buildRoomSpecs,
  buildClassSpecs,
  buildComplaintSpecs,
  buildAttendanceSpecs,
  validateClassSpecs,
  validateComplaintSpecs,
  validateAttendanceSpecs,
  facultyDepartmentFor,
  studentEnrollmentDate,
  studentYearOfStudy,
  studentSemester,
} = require("./seedDemoData");

function validateDemoSeedPlan() {
  const nameUniqueness = validateDemoNameUniqueness();
  for (const [group, count] of [["student", 6000], ["faculty", 450], ["technician", 36]]) {
    const names = Array.from({ length: count }, (_, index) => demoPersonName(index, group));
    assert.equal(new Set(names).size, count, `${group} full names must be unique`);
  }
  const roomSpecs = buildRoomSpecs().map((room, index) => ({
    ...room,
    _id: `ROOM-${String(index + 1).padStart(3, "0")}`,
    maintenanceHold: room.faulty,
    available: !room.faulty,
  }));
  assert.equal(roomSpecs.length, 120);
  for (const building of BUILDINGS) assert.equal(roomSpecs.filter((room) => room.building === building).length, 20);

  const faculty = Array.from({ length: 450 }, (_, index) => ({
    _id: `FAC-${String(index + 1).padStart(3, "0")}`,
    role: "faculty",
    department: facultyDepartmentFor(index),
  }));
  const students = Array.from({ length: 6000 }, (_, index) => ({
    _id: `STU-${String(index + 1).padStart(4, "0")}`,
    yearOfStudy: studentYearOfStudy(index),
    semester: studentSemester(index),
  }));
  const technicians = Array.from({ length: 36 }, (_, index) => ({
    _id: `TEC-${String(index + 1).padStart(3, "0")}`,
    role: "technician",
    department: `Facilities · Building ${["A", "B", "C", "D", "E", "F"][Math.floor(index / 6)]}`,
  }));
  const admin = { _id: "ADMIN-001", role: "admin" };
  assert.equal(faculty.length, 450);
  assert.equal(technicians.length, 36);

  const classSpecs = buildClassSpecs({ faculty, students, rooms: roomSpecs });
  const schedule = validateClassSpecs(classSpecs, { rooms: roomSpecs, faculty, students });
  classSpecs.forEach((item, index) => { item._id = `CLASS-${String(index + 1).padStart(3, "0")}`; });

  const studentMonthsByYear = new Map();
  const studentYearCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const studentYearSemesterCounts = new Map();
  for (let index = 0; index < students.length; index += 1) {
    const date = studentEnrollmentDate(index);
    const key = String(date.getUTCFullYear());
    studentYearCounts[students[index].yearOfStudy] += 1;
    const yearSemesterKey = `${students[index].yearOfStudy}-${students[index].semester}`;
    studentYearSemesterCounts.set(yearSemesterKey, (studentYearSemesterCounts.get(yearSemesterKey) || 0) + 1);
    if (!studentMonthsByYear.has(key)) studentMonthsByYear.set(key, new Set());
    studentMonthsByYear.get(key).add(date.getUTCMonth());
  }
  for (const months of studentMonthsByYear.values()) assert.ok(months.size >= 7, "Enrollment dates should cover at least seven months in each year.");
  assert.ok(new Set(Object.values(studentYearCounts)).size > 1, "Academic year distribution should vary across actual student records.");

  const studentsById = new Map(students.map((student) => [String(student._id), student]));
  const attendanceRows = buildAttendanceSpecs({ classes: classSpecs, studentsById });
  const attendance = validateAttendanceSpecs(attendanceRows, classSpecs);
  const attendanceStatuses = attendanceRows.reduce((counts, row) => ({ ...counts, [row.status]: counts[row.status] + 1 }), { present: 0, absent: 0, late: 0 });
  assert.ok(attendanceStatuses.absent > 0 && attendanceStatuses.late > 0);

  const complaintSpecs = buildComplaintSpecs({ admin, rooms: roomSpecs, students, faculty, technicians, classSpecs });
  const complaints = validateComplaintSpecs(complaintSpecs);
  assert.ok(COMPLAINT_WORKFLOW_TRANSITIONS.includes("Pending Verification>In progress"), "Rejected repairs must return to In progress.");
  assert.ok(COMPLAINT_WORKFLOW_TRANSITIONS.includes("Pending Verification>Closed"), "Accepted repairs must reach Closed.");

  console.log(JSON.stringify({
    buildings: BUILDINGS.length,
    rooms: roomSpecs.length,
    students: students.length,
    faculty: faculty.length,
    technicians: technicians.length,
    nameUniqueness,
    classes: schedule.classes,
    schedule,
    attendance,
    attendanceStatuses,
    complaints,
    studentYearCounts,
    studentYearSemesterCounts: Object.fromEntries(studentYearSemesterCounts),
    enrollmentMonthsPerYear: Object.fromEntries([...studentMonthsByYear].map(([year, months]) => [year, months.size])),
  }, null, 2));
}

try {
  validateDemoSeedPlan();
} catch (error) {
  console.error(`Demo seed static validation failed: ${error.message}`);
  process.exitCode = 1;
}
