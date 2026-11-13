# CampusOS Backend API Reference

This reference describes the Express routes currently mounted by `backend/server.js`. It is based on the route handlers, middleware, controllers and Mongoose schemas in this repository. It does not describe planned routes.

## Contents

- [Base URL and conventions](#base-url-and-conventions)
- [Authentication](#authentication)
- [Admin and user management](#admin-and-user-management)
- [Student management](#student-management)
- [Faculty management](#faculty-management)
- [Room management and recommendations](#room-management-and-recommendations)
- [Room booking](#room-booking)
- [Class scheduling](#class-scheduling)
- [Maintenance and complaints](#maintenance-and-complaints)
- [Notifications](#notifications)
- [Activity logs](#activity-logs)
- [Attendance](#attendance)
- [Notices](#notices)
- [Dashboards, analytics and forecasting](#dashboards-analytics-and-forecasting)
- [Setup and database prerequisites](#setup-and-database-prerequisites)

## Base URL and conventions

The API prefix is `/api`. The local backend defaults to `http://localhost:5000`; production deployments should use the configured HTTPS origin.

Protected routes require:

```http
Authorization: Bearer <JWT>
Content-Type: application/json
```

The token is HS256, expires after one day, and must contain an unexpired `exp` claim. For protected requests, the server reloads the account and role from MongoDB. Changing a password invalidates earlier tokens. Supported account roles are `admin`, `faculty`, `student`, and `technician` (the UI calls this role Tech Team).

Mutation handlers copy only the fields they use, preventing arbitrary mass assignment. Some explicitly reject undocumented body fields with `400`; others ignore extra fields. Where a handler rejects extras, the endpoint notes it. JSON parse errors return `400`; request bodies above 100 KB return `413`. Unknown routes return `404` with `{ "message": "API route not found." }`. Unhandled server errors return a safe `500` JSON message.

| Method and URL | Authentication | Success | Errors |
|---|---|---|---|
| `GET /api/health` | Public | `200 { ok: true, service: "Smart Campus API" }` when MongoDB is connected | `503 { ok: false, service: "Smart Campus API" }` otherwise |

### Collection queries and pagination

Collection routes that support listing accept `page`, `limit`, `search`, and (where listed) `sort` and `direction`. Pagination is opt-in to preserve the original array response: if both `page` and `limit` are omitted, the route returns its array without pagination headers. If either is supplied, the defaults are `page=1` and `limit=50`; `limit` must be 1–100. Invalid values return `400`.

Paginated responses are still JSON arrays. Metadata is returned in headers:

```http
X-Total-Count: 137
X-Page: 2
X-Page-Size: 50
X-Total-Pages: 3
```

`search` is a single text value of at most 100 characters. Sort fields are endpoint-specific allowlists; `direction` is `asc` or `desc`. Unsupported sort values return `400`. Some list endpoints impose a default maximum when pagination is omitted; these are identified below.

Common authentication errors are `401` (missing, invalid, expired or revoked token) and `403` (role not permitted). Rate-limited routes return `429` with `{ "message": "…" }` and a `Retry-After` header. Activity logging and notification delivery are best effort for many mutations; a successful primary operation does not mean an email or external push was sent (no such delivery integration exists).

Configured per-IP limits are: login 12 per 15 minutes, public registration 8 per hour, Admin account provisioning 10 per hour, student/faculty account creation and updates 20 per hour, booking creation 30 per hour, and complaint submission 20 per hour. The limiter is in-memory per API process, so multi-instance deployments do not share counters.

## Authentication

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `POST /api/auth/register` | Public; rate limited | `{ name, email, password, studentId?, department?, role? }`. `role` may only resolve to `student`; omitted means student. Password is at least 12 characters and at most 72 UTF-8 bytes. | `201 { message, user: { id, name, email, role, studentId, department } }` | `400` invalid/unsupported fields; `403` privileged role signup disabled; `409` email exists; `429`; `500` |
| `POST /api/auth/login` | Public; rate limited | `{ email, password }` | `200 { message, token, user: { id, name, email, role, studentId, department } }` | `400` invalid input; `401` invalid credentials; `403` unsupported stored role; `429`; `500` |
| `GET /api/auth/profile` | Any authenticated role | None | `200 { user: { id, name, email, role, studentId, department } }` | `401`, `403`, `500` |
| `GET /api/auth/student-dashboard` | Student | None | `200 { message, user }` | `401`, `403` |
| `GET /api/auth/faculty-dashboard` | Faculty | None | `200 { message, user }` | `401`, `403` |
| `GET /api/auth/admin-dashboard` | Admin | None | `200 { message, user }` | `401`, `403` |

Registration example:

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Asha Rao","email":"asha@example.edu","password":"<12-or-more-character-password>","studentId":"S-1042","department":"Physics"}'
```

Admin, Faculty and Technician accounts are provisioned separately; public registration cannot assign those roles.

## Admin and user management

All routes below require an authenticated Admin. Account provisioning endpoints have an additional in-memory per-IP rate limit of 10 requests per hour.

| Method and URL | Request | Success | Possible errors |
|---|---|---|---|
| `GET /api/admin/users/technicians` | Query: `search`, `page`, `limit`, `sort=name\|createdAt`, `direction=asc\|desc`. | `200 [{ id, name, role, createdAt }]` | `400` invalid query; `401`; `403`; `500` |
| `POST /api/admin/users/technicians` | `{ name, email, password }`; password rules as above. | `201 { technician: { id, name, role } }` | `400` invalid/unsupported fields; `409` duplicate email; `429`; `500` |
| `POST /api/admin/users` | Provision only the configured `ADMIN_EMAIL`. New account body: `{ email, name, password }`. Promotion of an existing Student/Faculty account body: `{ email }` only; its existing profile and password are preserved. | New account: `201 { message }`; promotion: `200 { message }` | `400` invalid fields or promotion body; `403` email is not configured; `409` configured account already Admin / incompatible account / duplicate; `503` provisioning not configured; `429`; `500` |

This API has no general user listing or arbitrary role-edit endpoint. The initial Admin can also be created through the interactive `backend/scripts/setupInitialAdmin.js` CLI documented in the root README.

## Student management

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/students` | Admin or Faculty. Faculty sees only students enrolled in that faculty member’s classes; email is omitted for Faculty. | Query: `search`; `sort=name\|email\|studentId\|department\|createdAt` for Admin, or `name\|studentId\|department` for Faculty; pagination. | `200` array of student profile objects. Admin fields: `name,email,role,studentId,department,createdAt`; Faculty fields: `name,studentId,department`. | `400`, `401`, `403`, `500` |
| `POST /api/students` | Admin | `{ name, email, password, studentId?, department?, phone? }` | `201` created Student object without password | `400` invalid fields; `409` duplicate email; `429`; `500` |
| `PATCH /api/students/:id` | Admin | Any non-empty subset of `{ name, email, studentId, department, phone, password }`. Password update revokes prior sessions. | `200` updated Student object without password | `400`; `404` student not found; `409` duplicate email; `429`; `500` |
| `DELETE /api/students/:id` | Admin | None | `200 { message: "Student removed" }` | `400` invalid ID; `404`; `409` when campus history/references exist (response includes reference counts); `503` without MongoDB transaction support; `500` |

Student creation/update password requirements are 12 or more characters and at most 72 UTF-8 bytes. Student deletion deliberately preserves history and is blocked while enrollment, attendance, bookings, complaints, notices, notifications, activity or inspection history references the account.

## Faculty management

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/faculty` | Admin | Query: `search`; `sort=name\|email\|department\|createdAt`; pagination. | `200 [{ name, email, role, department, phone, createdAt }]` | `400`, `401`, `403`, `500` |
| `POST /api/faculty` | Admin | `{ name, email, password, department?, phone? }` | `201` created Faculty object without password | `400`; `409` duplicate email; `429`; `500` |
| `PATCH /api/faculty/:id` | Admin | Any non-empty subset of `{ name, email, department, phone, password }`. Password update revokes prior sessions. | `200` updated Faculty object without password | `400`; `404`; `409`; `429`; `500` |
| `DELETE /api/faculty/:id` | Admin | None | `200 { message: "Faculty member removed" }` | `400` invalid ID; `404`; `409` while assigned to a class; `503` without transactions; `500` |

Faculty creation/update password requirements are 12 or more characters and at most 72 UTF-8 bytes.

## Room management and recommendations

Room types are `Classroom`, `Lecture Hall`, `Laboratory`, `Meeting Room`, `Auditorium`, and `Other`. Equipment types are `Fan`, `AC`, `Projector`, and `Light`; conditions are `Working`, `Not Working`, and `Needs Maintenance`.

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/rooms` | Any authenticated role | Query: `recordId`, `search`, `building`, `type`, `available=true\|false`, `operational=Operational\|Maintenance required\|Not inspected`; sort by `name\|building\|floor\|capacity\|type\|available\|createdAt`; pagination. | `200` array of room objects with room fields, equipment and maintenance state | `400` invalid filters; `401`; `500` |
| `GET /api/rooms/:id` | Any authenticated role | Path `id` is a MongoDB ObjectId. | `200` room object, including the inspection operational-status virtual | `400` invalid ID; `404`; `500` |
| `POST /api/rooms` | Admin | Any supported subset of `{ name, building, floor, capacity, type, available, facilities }`; `name` is the room number. Mongoose requires name/building/capacity and applies defaults for floor/type/availability. | `201` created room | `400` validation/unsupported fields; `409` same room number in building; `500` |
| `PATCH /api/rooms/:id` | Admin | Any supported subset of the same room fields | `200` updated room | `400`; `404`; `409` duplicate number/building; `500` |
| `DELETE /api/rooms/:id` | Admin | None | `200 { message: "Room removed" }` | `400`; `404`; `409` if class, booking, inspection or maintenance references exist (includes counts); `503` without transactions; `500` |
| `PATCH /api/rooms/:id/inspection` | Admin, Faculty or Technician | `{ equipment: [{ type, status, note? }, ...] }`. Submit exactly one item per equipment type; note max 500 characters. | `200` updated room with latest equipment state | `400` malformed inspection; `401`; `403`; `404`; `500` |
| `GET /api/rooms/recommendations` | Any authenticated role | Query required: `capacity` (1–10000), `type`, `date` (today or later, `YYYY-MM-DD`), `startTime`, `endTime` (`HH:mm`, end later); optional `building` (max 80 chars). | `200 { recommendations: [room plus capacityFit and preferredBuilding], count, message? }`; empty result returns an explanatory message. Candidates exclude unavailable rooms, maintenance holds, recorded equipment entries not marked Working, non-closed room complaints, overlapping approved bookings and overlapping class schedules for the requested weekday. Results sort by closest capacity fit, then building preference, building, and room number. | `400` invalid criteria; `401`; `500` |

Room listing has no role-specific record restriction beyond authentication. Inspection history is written to the room record and activity history; the response exposes current room data, while the model omits `inspectedBy` from nested equipment serialization.

Room recommendation example:

```bash
curl 'http://localhost:5000/api/rooms/recommendations?capacity=24&type=Classroom&date=2030-04-18&startTime=10%3A00&endTime=11%3A30&building=North' \
  -H 'Authorization: Bearer <JWT>'
```

## Room booking

Booking statuses are `Pending`, `Approved`, `Rejected`, and `Cancelled`. Admin sees all booking requests; Faculty and Students see only their own. Only Admin can approve or reject, and cannot decide their own request.

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `POST /api/bookings` | Admin, Faculty or Student; rate limited | `{ room, date, startTime, endTime, purpose }`; date is today or later in `YYYY-MM-DD`; times are `HH:mm`; end must follow start; purpose 1–500 chars. | `201 { message, booking }` with populated room and requester name | `400` invalid details; `401`; `403`; `404` room/account missing; `409` room unavailable; `429`; `503` without transactions; `500` |
| `GET /api/bookings` | Any authenticated role. Admin sees all; all other roles see their own. | Query: `recordId`, `date`, `status`, `room`, `building`, `roomSearch`, `search`; sort `date\|startTime\|endTime\|createdAt\|status\|purpose`; pagination. Search also matches requester name for Admin. | `200` array of bookings with populated room and requester name | `400` invalid filters; `401`; `500` |
| `PATCH /api/bookings/:id/status` | Admin | `{ status: "Approved" }` or `{ status: "Rejected" }` | `200 { message, booking }` | `400` invalid ID/status; `401`; `403` non-admin or self-decision; `404`; `409` non-pending request or overlapping approved booking; `503` without transactions; `500` |
| `PATCH /api/bookings/:id/cancel` | Admin, Faculty or Student, but the caller must own the booking | Empty body | `200 { message, booking }` | `400` invalid ID; `401`; `403`; `404` not owned/not found; `409` status cannot be cancelled; `500` |

An approval checks for overlapping approved bookings for the same room and date inside a MongoDB transaction while writing a room schedule version. Both transaction support and the room write serialize competing approvals. The backend returns `409` on a conflict. Booking operations require a replica set or sharded MongoDB deployment.

Create and approve examples:

```bash
curl -X POST http://localhost:5000/api/bookings \
  -H 'Authorization: Bearer <JWT>' -H 'Content-Type: application/json' \
  -d '{"room":"<ROOM_OBJECT_ID>","date":"2030-04-18","startTime":"10:00","endTime":"11:30","purpose":"Project meeting"}'

curl -X PATCH http://localhost:5000/api/bookings/<BOOKING_OBJECT_ID>/status \
  -H 'Authorization: Bearer <ADMIN_JWT>' -H 'Content-Type: application/json' \
  -d '{"status":"Approved"}'
```

## Class scheduling

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/classes` | Admin, Faculty or Student. Faculty sees assigned classes; Student sees enrolled classes. | Query: `recordId`, `day`, `search`; sort `courseName\|courseCode\|section\|day\|startTime\|endTime\|createdAt`; pagination. | `200` array with populated faculty, room and enrolled students. Admin receives email fields for populated users; other roles receive limited fields. | `400`; `401`; `403`; `500` |
| `POST /api/classes` | Admin | Required: `{ courseName, courseCode, section, faculty, room, day, startTime, endTime }`; optional `maxEnrollment`, `enrolledStudents` (array of Student IDs). Times `HH:mm`, end later; day is a weekday name. | `201` populated class | `400` invalid fields/assignments; `409` duplicate courseCode+section or schedule conflict; `503` without transactions; `500` |
| `PUT /api/classes/:id` | Admin | Full class body as for creation (all required class detail fields; optional enrollment/capacity) | `200` populated class | `400`; `404`; `409` schedule/unique conflict; `503`; `500` |
| `DELETE /api/classes/:id` | Admin | None | `200 { message: "Class deleted" }` | `400`; `404`; `409` while attendance references class; `503`; `500` |

Scheduling rejects overlaps for either the selected room or faculty member on the same weekday. Course code and section are unique together. Class create/update/delete require MongoDB transaction support.

## Maintenance and complaints

Complaint statuses are `Open`, `In progress`, `Pending Verification`, `Resolved`, and `Closed`; priorities are `Low`, `Normal`, `High`, and `Urgent`.

Visibility for `GET /api/complaints`: Admin sees all; Technician sees assigned complaints; Student sees submitted complaints; Faculty sees complaints they submitted plus facility complaints pending faculty verification.

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/complaints` | Any authenticated role, results scoped as above | Query: `recordId`, `room`, `priority`, `status`, `assignee` (Admin only; ID or `unassigned`), `roomSearch`, `search`; sort `createdAt\|updatedAt\|title\|status\|priority`; pagination. | `200` array populated with room, submitter, assignee, verifier and complaint history actor names/roles | `400` invalid filter or unauthorized assignee filter; `401`; `500` |
| `POST /api/complaints` | Admin, Faculty, Student or Technician; rate limited | `{ title, description, category?, room?, equipment?, priority? }`. Title max 160, description max 3000. For a facility issue, include a valid `room` and equipment type. Priority defaults to `Normal`. | `201` populated complaint with initial history | `400` invalid fields; `404` room missing; `429`; `503` without transactions; `500` |
| `PATCH /api/complaints/:id/assign` | Admin | `{ technicianId?, note? }`; omit/null technicianId to clear assignment; note max 1000. | `200` populated complaint | `400` invalid request or not a facility issue; `404`; `409` closed/resolved complaint; `500` |
| `PATCH /api/complaints/:id/work` | Technician assigned to that facility complaint | `{ status, note?, resolutionDetails?, evidence? }`; status is `In progress` or `Pending Verification`. For verification, `resolutionDetails` is required and `evidence` must contain 1–5 HTTP(S) URLs; note max 2000 and resolution details max 3000. | `200` populated complaint with appended history | `400` invalid fields/status/evidence; `404` not assigned; `409` awaiting verification/closed; `500` |
| `PATCH /api/complaints/:id/verify` | Faculty | `{ decision: "accept"\|"reject", note? }`; rejection requires a non-empty reason; note max 2000. Assigned technician cannot verify their own work. | `200` populated complaint; accepted repair becomes `Closed`, rejected repair returns to `In progress` | `400`; `403` self-verification; `404`; `409` not pending verification; `500` |
| `PATCH /api/complaints/:id` | Admin; for non-facility/general complaints only | `{ status }`; permitted values are `Open`, `In progress`, or `Resolved`. | `200` populated complaint | `400` invalid status or facility complaint; `404`; `500` |

Submitting a room complaint marks the reported equipment `Not Working` and places the room on maintenance hold. Faculty acceptance closes the issue and refreshes room maintenance state when no other active faults remain. Complaint assignment, work updates, and verification append to `history`; notifications are written for the relevant roles/users where configured.

Technician assignment and repair workflow example:

```bash
curl -X PATCH http://localhost:5000/api/complaints/<COMPLAINT_OBJECT_ID>/assign \
  -H 'Authorization: Bearer <ADMIN_JWT>' -H 'Content-Type: application/json' \
  -d '{"technicianId":"<TECHNICIAN_OBJECT_ID>","note":"Please inspect the projector."}'

curl -X PATCH http://localhost:5000/api/complaints/<COMPLAINT_OBJECT_ID>/work \
  -H 'Authorization: Bearer <TECHNICIAN_JWT>' -H 'Content-Type: application/json' \
  -d '{"status":"Pending Verification","resolutionDetails":"Replaced the power module and tested the projector.","evidence":["https://files.example.edu/maintenance/photo-1"]}'
```

## Notifications

All notification endpoints require authentication and only return/update records belonging to the current user. Read state is represented by `readAt` (`null` means unread). Records may include `entityType`, `entityId`, `targetPage`, and an optional populated complaint reference.

| Method and URL | Request | Success | Possible errors |
|---|---|---|---|
| `GET /api/notifications` | Pagination (`page`, `limit`); when omitted, latest 50 are returned. | `200` array, newest first | `400`; `401`; `500` |
| `GET /api/notifications/unread-count` | None | `200 { unreadCount }` | `401`; `500` |
| `PATCH /api/notifications/read-all` | Empty body | `200 { updated }` | `401`; `500` |
| `PATCH /api/notifications/:id/read` | None | `200 { id, readAt }` | `400` invalid ID; `401`; `404` not found for this user; `500` |
| `PATCH /api/notifications/:id/unread` | None | `200 { id, readAt: null }` | `400`; `401`; `404`; `500` |

Notification records are generated by complaint and booking workflows; there is no public endpoint to create arbitrary notifications. Delivery is stored in MongoDB; no email/SMS/push provider is configured.

## Activity logs

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/activity` | Any authenticated role. Admin sees all; other roles see activity scoped to their own actions and accessible records/classes/complaints/notices. | Query: `recordId`, `search`; sort `createdAt\|action\|entityType`; pagination. Without pagination, at most 200 rows are returned. | `200` array of activity entries with populated actor `{ name, role }` | `400` invalid ID/query; `401`; `500` |

Each entry includes actor, action, entity type and ID, summary, and timestamps. Activity logging is performed by supported mutation workflows; it is not a general-purpose client-write API.

## Attendance

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/attendance` | Admin, Faculty or Student. Faculty sees assigned classes; Student sees own attendance. | Query: `recordId`, `date=YYYY-MM-DD`, `status=present\|absent\|late`, `search`; sort `date\|status\|createdAt`; pagination. | `200` array populated with limited student and class details | `400`; `401`; `403`; `500` |
| `POST /api/attendance` | Admin or Faculty | `{ student, campusClass, date, status }`; status `present`, `absent`, or `late`. | `200` attendance record (upserted for class/student/date) | `400`; `401`; `403` if Faculty is not assigned or student is not enrolled; `404` student/class; `409` duplicate-key conflict; `503` without transactions; `500` |

The database enforces uniqueness for `(campusClass, student, date)` when `campusClass` is an ObjectId. Posting the same tuple updates the status and marker rather than creating a second record. The attendance index migration documented in the root README must be completed before relying on this constraint in an existing database.

## Notices

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/notices` | Any authenticated role. Admin sees all; other roles see `all` and their own role audience. | Query: `recordId`, `search`; sort `createdAt\|title\|category`; pagination. | `200` array with populated author name | `400`; `401`; `500` |
| `POST /api/notices` | Admin or Faculty | `{ title, body, category?, audience? }`; title max 160, body max 5000, category max 80; audience `all`, `student`, or `faculty`, default `all`. | `201` created notice | `400`; `401`; `403`; `500` |
| `DELETE /api/notices/:id` | Admin | None | `200 { message: "Notice removed" }` | `401`; `403`; `404`; `500` |

## Dashboards, analytics and forecasting

| Method and URL | Authentication / permission | Request | Success | Possible errors |
|---|---|---|---|---|
| `GET /api/dashboard` | Any authenticated role; response chosen by current role | None | Student: `{ role, profile, classes, attendance, attendanceSummary, notices }`; Faculty: `{ role, profile, classes, attendanceToday, bookings, notices }`; Technician: `{ role, profile, assignedMaintenance, pendingVerification, activeIssues }`; Admin: `{ role, profile, students, faculty, rooms, bookings, notices, classes, openComplaints, recentNotices }`. | `401`; `500` |
| `GET /api/dashboard/analytics` | Admin | Query `range=7d\|30d\|all`, default `30d` | `{ range, generatedAt, totals, bookings, bookingTrend, roomUsage, complaints, attendance, periodGranularity }`. `totals` contains students/faculty/rooms/classes. `complaints` contains `total`, `Open`, `In progress`, `Pending Verification`, `Resolved`, and `Closed`; each status is counted once and is present as zero when empty. | `400` invalid range; `401`; `403`; `500` |
| `GET /api/dashboard/analytics/room-forecast` | Admin | None | Historical approved-booking summary, historical patterns, room utilization and a forecast section. Forecast includes availability, method, minimum-history thresholds and predicted periods. | `401`; `403`; `500` |

Analytics `range` affects date-based bookings, complaints and attendance; student/faculty/room/class totals are current totals. The complaint summary counts all complaints created in the selected period by their current stored status. Room usage in analytics counts approved bookings in the selected date window and reports bookings/booked hours. The separate forecast uses approved bookings in the preceding 90-day window and reports no predictions until it has at least 14 valid bookings across 4 different active weeks. Its method is a weekday-and-time-slot historical mean; it does not call an external AI service. Forecast utilization is each room’s share of all approved booked hours in the history window, not occupancy against room opening hours.

## Setup and database prerequisites

The root [README](../README.md) contains the full setup, environment, initial Admin provisioning, local replica-set, index migration, and run instructions. In brief:

1. Install root, backend and frontend dependencies with `npm install`, `npm install --prefix backend`, and `npm install --prefix frontend`.
2. Copy `backend/.env.example` to `backend/.env` if no private environment file exists. Configure `MONGO_URI`, a private `JWT_SECRET`, `PORT`, `CLIENT_URL`, `TRUST_PROXY`, and `ADMIN_EMAIL`. Values in examples are placeholders; never commit real credentials.
3. Set up the first administrator with `npm run setup:admin --prefix backend`.
4. Start the API and Vite app with `npm run dev --prefix backend` and `npm run dev --prefix frontend`, or run both from the root using `npm run dev`.

MongoDB must be reachable. Transaction-backed operations (booking create and decision, class create/update/delete, attendance writes, complaint submission, and protected room/student/faculty deletion) require a replica set or sharded cluster. Booking cancellation currently uses a normal document update and does not open a transaction. For a local standalone MongoDB instance, follow the careful existing-database replica-set instructions in the root README; do not reset or replace the database. Without transaction support, transaction-backed operations return `503` rather than skipping integrity checks.

The backend validates environment configuration at startup. In production, use a random JWT secret of at least 32 bytes, configure HTTPS browser origins in `CLIENT_URL`, and set `TRUST_PROXY` only to the number of trusted proxy hops. CORS allows configured origins; unauthenticated requests are not allowed to call protected resource routes. The server has no OpenAPI/Swagger generator or API test suite in the current repository.

### Environment variables

Backend variables read by the server/configuration:

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection URI; transaction-backed operations require a replica set or sharded cluster. |
| `JWT_SECRET` | Private signing key; production requires at least 32 bytes and rejects common example placeholders. |
| `PORT` | Backend TCP port; defaults to `5000`. |
| `CLIENT_URL` | Comma-separated allowed browser origins; defaults to `http://localhost:5173` outside production and is required in production. |
| `TRUST_PROXY` | Trusted proxy hop count, integer 0–5; defaults to `0`. |
| `ADMIN_EMAIL` | Email allowed for the configured administrator provisioning command/endpoint. |
| `NODE_ENV` | Set to `production` to enable production configuration checks and HSTS. |
| `ADMIN_RECOVERY_SECRET` | Temporary secret read only by the local admin recovery script; it is not an API setting. Use only as described in the root README. |

The frontend's Vite configuration uses `VITE_API_URL` for the API base URL (defaults to `http://localhost:5000/api`) and `VITE_INSTITUTION_NAME` for the displayed organization label (defaults to `CampusOS`). Vite variables are public and must not contain secrets. The backend environment template is `backend/.env.example`; the current frontend template is `frontend/.env.example`.

Example environment values (placeholders):

```dotenv
MONGO_URI=mongodb://<HOST>:<PORT>/<DATABASE>?replicaSet=<REPLICA_SET>
JWT_SECRET=<PRIVATE_RANDOM_SECRET_AT_LEAST_32_BYTES>
PORT=5000
CLIENT_URL=http://localhost:5173
TRUST_PROXY=0
ADMIN_EMAIL=<INITIAL_ADMIN_EMAIL>
```

Do not copy a placeholder as a production secret. The actual backend template is `backend/.env.example`; no real `.env` values are reproduced here.

## Source-verified limitations and uncovered gaps

- No mounted endpoint was found for general user search/update, direct notification creation, activity-log writes, or attendance deletion; those operations are not part of the current HTTP API.
- Room recommendations are advisory: a booking or class schedule can change after the recommendation response. Booking approval remains the authoritative conflict check and rejects overlapping approved bookings. Invalid stored schedule times are treated as unavailable for the requested period.
- Both `/api/dashboard` and the role-specific `/api/auth/*-dashboard` summary endpoints exist. The latter return a simple welcome message/profile; the former provides the data-backed dashboard payload.
- This repository does not expose an OpenAPI schema, Swagger UI, automated API contract tests, or a deployment-specific TLS/reverse-proxy configuration. Verify those separately for a deployment.
