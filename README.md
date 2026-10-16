# CampusOS — Smart Campus Management System

CampusOS is a role-aware campus management app using React, Vite, Tailwind CSS, Express, JWT, and MongoDB.

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

   Set `MONGO_URI` to the intended database, replace `JWT_SECRET` with a long random value, and set `ADMIN_EMAIL` to the exact email address of the authorized administrator. Keep `.env` private and do not commit it.

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

## Roles and access

- **Admin:** manage student and faculty accounts, classes, attendance, rooms, bookings, notices, and complaint records.
- **Faculty:** see assigned classes and enrolled students, mark attendance only for those classes, create notices, and manage their own bookings.
- **Student:** see their profile, enrolled classes and timetable, their own attendance and relevant notices, and submit/view their own complaints.

Public signup supports Student and Faculty roles. The backend accepts only those roles during signup; Administrator accounts are created through the one-time setup command. This project does not currently define a maintenance-staff role.

The server reloads the account role from MongoDB for each protected request. Frontend role display is refreshed from `/api/auth/profile`; a browser-stored role or a client-supplied JWT role does not grant privileges.

## Classes and timetable

Administrators create classes from the Classes page. A class requires a subject name, course code, section, existing faculty account, room, weekday, start/end times, and maximum enrollment. Students can be enrolled when creating or editing a class. The API checks the selected records, prevents duplicate course-code/section pairs, rejects overlapping room or faculty schedules, and stores classes in MongoDB. Students see only enrolled classes; faculty see only their assignments.

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

All endpoints are prefixed with `/api`. Authentication: `/auth/register`, `/auth/login`, `/auth/profile`. Protected resources: `/students`, `/faculty`, `/classes`, `/attendance`, `/rooms`, `/bookings`, `/notices`, `/complaints`, and `/dashboard`. Protected requests use `Authorization: Bearer <token>`.

MongoDB must be reachable before the backend starts. After the initial administrator is set up, create rooms and faculty accounts before creating classes. This project does not seed demo rooms or classes.
