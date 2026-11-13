# CampusOS — Smart Campus Management System

CampusOS is a role-aware campus management app using React, Vite, Tailwind CSS, Express, JWT, and MongoDB.

For the complete backend API reference, including request/response shapes, authorization, filters, errors, and examples, see [docs/API.md](docs/API.md).

## Requirements

- Node.js 20.19+ or 22.12+, with npm
- A reachable MongoDB instance (local MongoDB or MongoDB Atlas)

## Setup

1. From the project root, install dependencies:

   ```powershell
   npm install
   npm install --prefix backend
   npm install --prefix frontend
   ```

2. Create the backend environment file:

   ```powershell
   if (-not (Test-Path backend/.env)) {
     Copy-Item backend/.env.example backend/.env
   } else {
     Write-Host "backend/.env already exists; leaving it unchanged."
   }
   ```

   Set `MONGO_URI` to the intended database, replace `JWT_SECRET` with a private random value of at least 32 bytes before production, and set `ADMIN_EMAIL` to the exact email address of the authorized administrator. For production, set `NODE_ENV=production`, configure the frontend origin(s) in `CLIENT_URL` using HTTPS, and set `TRUST_PROXY` only to the number of trusted reverse-proxy hops (normally `0` when directly exposed). Keep `.env` private and do not commit it. `.env.example` files contain placeholders only.

3. Set `ADMIN_EMAIL` to the exact email address that will own the first administrator account. The first admin is created separately from public signup. From the project root, run:

   ```powershell
   npm run setup:admin --prefix backend
   ```

   The setup command checks `ADMIN_EMAIL`, refuses to run if an admin already exists, requires an interactive confirmation, and asks for a hidden password twice. It creates the account if the email is new. If an account already uses that exact configured email, it initializes that account as the first admin and resets its password. It never promotes other accounts. Keep the admin password private. The command is one-time; after initialization, public signup cannot select or request the admin role.

4. Start the API and frontend in separate terminals from the project root:

   ```powershell
   npm run dev --prefix backend
   ```

   ```powershell
   npm run dev --prefix frontend
   ```

   Open the Vite URL shown in the frontend terminal (normally `http://localhost:5173`). The API normally runs at `http://localhost:5000`; check it at `http://localhost:5000/api/health`. Set `VITE_API_URL` in `frontend/.env` only if the API runs at a different URL.

   Alternatively, after installing root dependencies, start both processes from the project root with `npm run dev`.

## Local administrator account recovery

Use this separate recovery command only when the existing administrator cannot sign in. It is a local CLI operation, is restricted to `admin_cs24@gla.ac.in`, and refuses MongoDB addresses that are not loopback (`localhost`, `127.0.0.1`, or `::1`). It does not change any other administrator. Do not use `setup:admin` for this recovery.

1. Confirm `ADMIN_EMAIL` in `backend/.env` is `admin_cs24@gla.ac.in` and `MONGO_URI` points to the intended local MongoDB database. Remote MongoDB/Atlas URIs are refused.
2. Generate a fresh 32-byte (64 hexadecimal character) secret with a password manager and add it temporarily to `backend/.env`:

   ```env
   ADMIN_RECOVERY_SECRET=<paste-your-new-64-character-hex-secret>
   ```

   Replace the placeholder; do not use it literally. Keep the value private. The recovery script requires this exact format and asks you to re-enter it without displaying it.
3. From the project root, run:

   ```powershell
   npm run recover:admin --prefix backend
   ```

   The script checks the recovery secret before connecting to MongoDB. It then previews the target account and operation and requires you to type `RECOVER admin_cs24@gla.ac.in`. If the account exists as Student or Faculty, only its role is changed; its password and other fields are preserved. If it does not exist, the script asks for a name, shows the create preview, then asks for a hidden password twice (at least 12 characters and no more than 72 UTF-8 bytes). The password is hashed with bcrypt before saving. If the target is already an administrator, the script makes no change.
4. Sign in with `admin_cs24@gla.ac.in`. A promoted account keeps its existing password; a newly created account uses the password entered during recovery.
5. Remove the temporary `ADMIN_RECOVERY_SECRET` line from `backend/.env` immediately after the command completes or is cancelled. Do not commit the secret or put it in source code.

The recovery script is an offline maintenance tool, not an HTTP endpoint. It still requires access to the local MongoDB database and an interactive local terminal. A user with control of that computer and database can bypass application-level recovery controls; secure the machine and database credentials accordingly.

## Production deployment

CampusOS does not serve the built frontend from Express. Deploy the API and frontend as separate services:

1. Install reproducibly from the committed lockfiles with `npm ci --prefix backend` and `npm ci --prefix frontend`. If you use the root `npm run dev` launcher, also run `npm ci` at the root.
2. Supply backend configuration through the deployment secret/configuration manager. Set `NODE_ENV=production`, a private random `JWT_SECRET` of at least 32 bytes, `MONGO_URI` for a replica set or sharded cluster, `ADMIN_EMAIL`, `PORT`, the exact HTTPS frontend origin(s) in `CLIENT_URL`, and `TRUST_PROXY` to the actual trusted proxy hop count. Do not copy secrets into frontend variables.
3. Build with `npm run build --prefix frontend`. Set `VITE_API_URL` to the public API base ending in `/api` and optionally set `VITE_INSTITUTION_NAME` before building. These Vite values are public and become part of the static bundle.
4. Publish `frontend/dist` to an HTTPS static host/CDN with single-page-app fallback routing to `index.html`. Configure the static host's security headers separately from the API; the styles currently load Google Fonts from `fonts.googleapis.com` and `fonts.gstatic.com`, so a frontend Content Security Policy must account for those origins or the font import should be self-hosted. Start the API with `npm start --prefix backend`. Configure TLS at a trusted edge and restrict database network access to the API host.
5. Use `GET /api/health` as a readiness check. Ensure the MongoDB replica set has a reachable primary before enabling transaction-backed workflows. The configured in-memory rate limits are per process; horizontally scaled deployments need a shared rate-limit store.

`npm ci` uses the committed package lockfiles. The repository does not include deployment manifests, a shared rate-limit store, or infrastructure provisioning; supply those for the chosen hosting platform. No live infrastructure is changed by these instructions.

## Roles and access

- **Admin:** manage student and faculty accounts, classes, attendance, rooms, bookings, notices, and complaint records.
- **Faculty:** see assigned classes and enrolled students, mark attendance only for those classes, create notices, and manage their own bookings.
- **Student:** see their profile, enrolled classes and timetable, their own attendance and relevant notices, and submit/view their own complaints.
- **Technician:** see assigned maintenance complaints and submit work progress and repair evidence for faculty verification.

Public signup creates Student accounts only. Faculty and Technician accounts are provisioned by an administrator; the first Administrator is created through the one-time setup command. Passwords must be at least 12 characters and no more than 72 UTF-8 bytes when created or changed.

The server reloads the account role from MongoDB for each protected request. JWTs are HS256, must include an unexpired `exp` claim, and use a one-day lifetime. Frontend role display is refreshed from `/api/auth/profile`; a browser-stored role or a client-supplied JWT role does not grant privileges. Login, registration, account mutations, booking requests, and complaint submissions have per-IP rate limits. The in-memory limits are per server process and should be replaced with a shared store when running multiple instances.

The API restricts browser origins to `CLIENT_URL`, sends security headers, limits JSON bodies to 100 KB, and accepts explicit write fields rather than arbitrary request objects. In production, configure TLS at the edge and keep MongoDB network access restricted.

## Classes and timetable

Administrators create classes from the Classes page. A class requires a subject name, course code, section, existing faculty account, room, weekday, start/end times, and maximum enrollment. Students can be enrolled when creating or editing a class. The API checks the selected records, prevents duplicate course-code/section pairs, rejects overlapping room or faculty schedules, and stores classes in MongoDB. Students see only enrolled classes; faculty see only their assignments.

## Local demo dataset

The opt-in demo seeder creates fictional CampusOS records for presentations and workflow testing. It adds 5 building labels as room strings (there is no Building collection), 20 rooms, 130 students, 9 faculty, 3 technicians, 1 demo administrator, 10 classes, 40 bookings, 390 attendance rows, 18 maintenance complaints, room inspection snapshots, 4 notifications, 38 activity entries, and 5 notices. The script uses the existing schemas, role/status enums, and password hashing helper.

The seeder is never run by application startup. First install backend dependencies and, in a dedicated local MongoDB instance, prepare a database whose name contains `demo` or `test`. The seed uses transactions, so configure that local instance as a replica set using the instructions above. Run the existing integrity-index migration against the **same database** selected by `DEMO_MONGO_URI`; the migration reads `MONGO_URI`, so set it to that same URI for the command. `DEMO_MONGO_URI` must use a loopback host (`localhost`, `127.0.0.1`, or `::1`) and a database name containing `demo` or `test`; the seeder refuses production mode, remote hosts, and other database names. Do not point either URI at a shared or production database.

```powershell
$env:DEMO_MONGO_URI = "mongodb://127.0.0.1:27017/campusos_demo?replicaSet=rs0"
$env:MONGO_URI = $env:DEMO_MONGO_URI
$env:ALLOW_DEMO_SEED = "true"
npm run migrate:integrity-indexes --prefix backend
npm run seed:demo --prefix backend
Remove-Item Env:MONGO_URI
Remove-Item Env:DEMO_MONGO_URI
Remove-Item Env:ALLOW_DEMO_SEED
```

The fictional login emails are `admin.demo@campusos.test`, `faculty.demo@campusos.test`, `student.demo@campusos.test`, and `technician.demo@campusos.test`. Their generated temporary passwords are kept only in the Git-ignored local file `backend/demo-credentials.local.json`; open that file locally to sign in. Do not commit or share it, and use these accounts only in the isolated demo database. All demo accounts and records are visibly marked with `[CampusOS DEMO]`, `DEMO-` identifiers, or `CampusOS Demo` building names.

Seeding is repeatable: deterministic emails, room/building pairs, course codes, record prefixes, and notification deduplication keys identify the demo data. Existing marked demo records are reused without being updated; missing demo records are created. A collision with an unmarked record aborts the transaction. The script does not delete records, reset the database, or change existing account passwords. If a demo record has been edited or removed, rerunning fills only missing records and preserves edits. Review the printed count of newly created documents; no seed command is run automatically.

## Booking approval and local MongoDB replica sets

Only administrators can approve or reject room booking requests. The backend enforces this on `PATCH /api/bookings/:id/status`; the frontend shows those controls only in the Admin workspace. Approval uses a MongoDB transaction and a room schedule write to serialize concurrent decisions, so overlapping approvals cannot both succeed.

MongoDB transactions require a replica set (or a sharded cluster). A default standalone local MongoDB server can run CampusOS, but booking creation and approval/rejection, class creation and updates, attendance marking, complaint submission, and protected room/student/class/faculty deletion return a clear `503` until MongoDB supports transactions. Do not remove transaction handling to work around this requirement.

For local development with an existing database, configure the MongoDB instance already in use rather than creating a new database:

1. Identify the active MongoDB service and its configuration file. Back up the existing database and configuration before changing the service configuration. Do not delete the database directory or run setup/reset commands.
2. In the active `mongod` configuration, add or merge this setting at the top level (keep any existing settings):

   ```yaml
   replication:
     replSetName: rs0
   ```

3. Restart that MongoDB service, then connect to that same instance using your normal local `mongosh` connection. Check `rs.status()`. If the instance has not been initialized as a replica set, initialize it once:

   ```javascript
   rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })
   ```

   If the set is already initialized, do not run `rs.initiate` again. Wait until `rs.status()` reports a primary. The member address must be reachable by the backend process; adjust it if your local MongoDB listens on another address or port.
4. In your private `backend/.env`, add `replicaSet=rs0` to the existing `MONGO_URI` query string (use `&` if the URI already has query parameters). Keep the same database name and any existing authentication/options. Do not commit `.env` or paste credentials into documentation.
5. Restart the backend. The existing API will use the same database with transaction support enabled. A single-node replica set is suitable for local development only; use a properly configured replica set or sharded cluster in production.

## Referential integrity and attendance index migration

Room deletion returns `409` while a class, booking, inspection, or maintenance complaint references the room. Student deletion returns `409` while enrollment, attendance, booking, complaint, notification, activity, notice, or inspection history references the account. Class deletion returns `409` when attendance history exists. These checks preserve the existing records; they do not cascade-delete them. Reference writes and protected deletions use transactions and lock the parent record so a concurrent create cannot pass the reference check unnoticed.

Attendance is unique per non-null class, student, and date. The unique partial index excludes legacy attendance records whose `campusClass` is null; the API requires a class when marking new attendance. Before deploying the index change:

1. Back up the intended database and stop CampusOS API instances so no attendance writes run during the migration.
2. Run `npm run migrate:integrity-indexes --prefix backend` against the same database configured in `backend/.env`.
3. If duplicates are reported, the script exits without changing records or indexes. Review the listed IDs and use an approved retention decision to resolve duplicates manually; do not delete rows automatically. Then rerun the migration.
4. Once the script reports success, start the API instances again. The migration replaces the old non-unique compound attendance index with the unique one, ensures the existing attendance query indexes and new room/complaint reference indexes, and removes the redundant single-field complaint `room` and `assignedTo` indexes after confirming their compound replacements exist.

The migration must be run once per database before relying on duplicate prevention. The attendance schema disables automatic index creation so the unique index is not attempted before the duplicate scan. The migration also checks for duplicate notification deduplication keys and creates the sparse unique notification key index; it does not alter notification records. The migration checks for duplicates before replacing any existing compound index. The schema adds a room-leading class index for room reference checks; the existing day-leading class schedule index is retained for timetable conflict queries.

Notification writes are best-effort and idempotent per event and recipient. Run the same integrity-index migration before deploying notification deduplication so concurrent retries cannot create duplicate event notices. Notifications remain private to their recipient; opening one marks it read and navigates to the linked record. Activity history is visible to admins globally and scoped for other roles to actions or records they can access.

`GET /api/notifications` returns the current user's notifications. `PATCH /api/notifications/:id/read`, `PATCH /api/notifications/:id/unread`, and `PATCH /api/notifications/read-all` only update that user's records. New notifications include `entityType`, `entityId`, and `targetPage`; linked collection endpoints accept `recordId` to open the specific record within the caller's existing permissions.

## Useful commands

```powershell
# Production frontend build
npm run build --prefix frontend

# Check backend JavaScript syntax
Get-ChildItem backend -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }

# Check the running API
Invoke-RestMethod http://localhost:5000/api/health
```

Then sign in separately with an admin, faculty, and student account to review their role-specific pages. To verify class persistence, create a class as an admin, refresh the Classes page, and confirm the record remains. Faculty and students should only see their assigned/enrolled classes.

## API map

All routes are prefixed with `/api`. The complete endpoint-by-endpoint documentation is in [docs/API.md](docs/API.md). Major modules are authentication, admin/user provisioning, students, faculty, rooms/recommendations, bookings, classes, complaints/maintenance, notifications, activity, attendance, notices, dashboards, analytics and room forecasts. Protected requests use `Authorization: Bearer <JWT>`.

MongoDB must be reachable before the backend starts. After the initial administrator is set up, create rooms and faculty accounts before creating classes. This project does not seed demo rooms or classes. Follow the setup and database migration instructions above before using transaction-backed APIs in an existing deployment.
