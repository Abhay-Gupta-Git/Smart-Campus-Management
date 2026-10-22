import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  DoorOpen,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareWarning,
  Plus,
  Search,
  Users,
} from "lucide-react";
     
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const navigationItems = [
  ["Overview", LayoutDashboard],
  ["Students", Users],
  ["Faculty", Users],
  ["Classes", ClipboardCheck],
  ["Attendance", ClipboardCheck],
  ["Classrooms", DoorOpen],
  ["Room bookings", CalendarDays],
  ["Notices", Megaphone],
  ["Complaints", MessageSquareWarning],
];

const resourceEndpoints = {
  Students: "/students",
  Faculty: "/faculty",
  Classes: "/classes",
  Attendance: "/attendance",
  Classrooms: "/rooms",
  "Room bookings": "/bookings",
  Notices: "/notices",
  Complaints: "/complaints",
};

async function requestApi(path, token, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(responseData.message || "Request failed");
  }

  return responseData;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [sessionReady, setSessionReady] = useState(
    !localStorage.getItem("token"),
  );
  const [page, setPage] = useState("Overview");
  const [dashboard, setDashboard] = useState({});
  const [records, setRecords] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);

  useEffect(() => {
    if (!token) {
      setSessionReady(true);
      return;
    }

    requestApi("/auth/profile", token)
      .then(({ user: currentUser }) => {
        setUser(currentUser);
        localStorage.setItem("user", JSON.stringify(currentUser));
      })
      .catch(handleLogout)
      .finally(() => setSessionReady(true));
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    requestApi("/dashboard", token)
      .then(setDashboard)
      .catch((error) => setErrorMessage(error.message));

    loadRecords(page);
  }, [token, page]);

  async function loadRecords(selectedPage = page) {
    const endpoint = resourceEndpoints[selectedPage];

    if (!endpoint) {
      setRecords([]);
      return;
    }

    setIsLoading(true);
    try {
      const results = await requestApi(endpoint, token);
      setRecords(results);
    } catch (error) {
      setRecords([]);
      setErrorMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleLogin(loginToken, signedInUser) {
    localStorage.setItem("token", loginToken);
    localStorage.setItem("user", JSON.stringify(signedInUser));
    setToken(loginToken);
    setUser(signedInUser);
    setSessionReady(true);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken("");
    setUser(null);
    setSessionReady(true);
  }

  async function createRecord(record) {
    const endpoint = resourceEndpoints[page];

    try {
      await requestApi(
        editingRecord ? `${endpoint}/${editingRecord._id}` : endpoint,
        token,
        {
          method: editingRecord
            ? ["Faculty", "Students", "Classrooms"].includes(page)
              ? "PATCH"
              : "PUT"
            : "POST",
          body: JSON.stringify(record),
        },
      );

      setIsModalOpen(false);
      setEditingRecord(null);
      setErrorMessage("");
      setSuccessMessage(
        `${getRecordLabel(page)} ${editingRecord ? "updated" : "created"} successfully.`,
      );
      await loadRecords(page);
      const updatedDashboard = await requestApi("/dashboard", token);
      setDashboard(updatedDashboard);
    } catch (error) {
      setErrorMessage(error.message);
    }
  }

  if (!token || !sessionReady) {
    if (token && !sessionReady) {
      return <div className="auth">Checking your secure session...</div>;
    }
    return <AuthenticationPage onLogin={handleLogin} />;
  }

  const canCreateRecord = canCreateResource(page, user?.role);

  return (
    <div className="app">
      <Sidebar
        activePage={page}
        dashboard={dashboard}
        user={user}
        onNavigate={setPage}
        onLogout={handleLogout}
      />

      <main className="main">
        <TopBar
          page={page}
          user={user}
          searchText={searchText}
          onSearch={setSearchText}
        />

        <section className="content">
          <PageHeading
            page={page}
            user={user}
            canCreateRecord={canCreateRecord}
            onCreate={() => {
              setEditingRecord(null);
              setIsModalOpen(true);
            }}
          />

          {errorMessage && (
            <ErrorNotice
              message={errorMessage}
              onDismiss={() => setErrorMessage("")}
            />
          )}
          {successMessage && (
            <div className="success" role="status">
              {successMessage}
              <button
                onClick={() => setSuccessMessage("")}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}

          {page === "Overview" ? (
            <DashboardPage dashboard={dashboard} onNavigate={setPage} />
          ) : (
            <ResourceTable
              page={page}
              records={records}
              isLoading={isLoading}
              searchText={searchText}
              onSearch={setSearchText}
              canEdit={
                user?.role === "admin" &&
                [
                  "Classes",
                  "Faculty",
                  "Students",
                  "Classrooms",
                  "Room bookings",
                  "Notices",
                  "Complaints",
                ].includes(page)
              }
              onEdit={(record) => {
                setEditingRecord(record);
                setIsModalOpen(true);
              }}
              onDelete={async (record) => {
                const itemLabel =
                  page === "Classes"
                    ? `${record.courseCode} ${record.section}`
                    : record.name || record.title || "this record";
                if (!window.confirm(`Delete ${itemLabel}?`)) {
                  return;
                }

                try {
                  await requestApi(
                    `${resourceEndpoints[page]}/${record._id}`,
                    token,
                    {
                      method: "DELETE",
                    },
                  );
                  await loadRecords(page);
                  setSuccessMessage(
                    `${getRecordLabel(page)} deleted successfully.`,
                  );
                } catch (error) {
                  setErrorMessage(error.message);
                }
              }}
              onResolve={async (record) => {
                try {
                  await requestApi(`/complaints/${record._id}`, token, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "Resolved" }),
                  });
                  await loadRecords(page);
                  setSuccessMessage("Complaint marked as resolved.");
                } catch (error) {
                  setErrorMessage(error.message);
                }
              }}
            />
          )}
        </section>
      </main>

      {isModalOpen && (
        <RecordModal
          page={page}
          token={token}
          onClose={() => setIsModalOpen(false)}
          onSubmit={createRecord}
          initialRecord={editingRecord}
        />
      )}
    </div>
  );
}

function Sidebar({ activePage, dashboard, user, onNavigate, onLogout }) {
  const role = user?.role || "student";
  const allowedPages = {
    admin: [
      "Overview",
      "Students",
      "Faculty",
      "Classes",
      "Attendance",
      "Classrooms",
      "Room bookings",
      "Notices",
      "Complaints",
    ],
    faculty: [
      "Overview",
      "Classes",
      "Students",
      "Attendance",
      "Classrooms",
      "Room bookings",
      "Notices",
      "Complaints",
    ],
    student: ["Overview", "Classes", "Attendance", "Notices", "Complaints"],
  }[role] || ["Overview"];

  return (
    <aside className="sidebar">
      <div className="brand">
        <b className="brandmark">
          <Building2 size={20} />
        </b>
        <span>
          campus<span>OS</span>
          <small>SMART CAMPUS PLATFORM</small>
        </span>
      </div>

      <div className="section-label">WORKSPACE</div>

      {navigationItems
        .filter(([label]) => allowedPages.includes(label))
        .map(([label, Icon]) => (
          <button
            key={label}
            className={`navitem ${activePage === label ? "active" : ""}`}
            onClick={() => onNavigate(label)}
          >
            <Icon size={18} />
            {label}
            {label === "Complaints" && dashboard.openComplaints > 0 && (
              <i>{dashboard.openComplaints}</i>
            )}
          </button>
        ))}

      <div className="side-foot">
        <div className="org">
          <Building2 size={18} />
          <span>
            <strong>Northstar University</strong>
            <small>{role[0].toUpperCase() + role.slice(1)} workspace</small>
          </span>
          <span aria-hidden="true">⌄</span>
        </div>

        <button className="account" onClick={onLogout}>
          <b>{user?.name?.[0] || "A"}</b>
          <span>
            <strong>{user?.name || "Admin"}</strong>
            <small>{user?.role || "admin"}</small>
          </span>
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}

function TopBar({ page, user, searchText, onSearch }) {
  return (
    <header>
      <div className="crumb">
        <Menu size={18} />
        Workspace <span>/</span> <strong>{page}</strong>
      </div>

      <div className="head-actions">
        <div className="search">
          <Search size={16} />
          <input
            placeholder="Search anything..."
            value={searchText}
            onChange={(event) => onSearch(event.target.value)}
          />
          <kbd>Ctrl K</kbd>
        </div>
        <button className="bell" aria-label="Notifications">
          <Bell size={18} />
          <i />
        </button>
        <b className="userdot">{user?.name?.[0] || "A"}</b>
      </div>
    </header>
  );
}

function PageHeading({ page, user, canCreateRecord, onCreate }) {
  const title =
    page === "Overview"
      ? `Good morning, ${user?.name?.split(" ")[0] || "there"}`
      : page;
  const description =
    page === "Overview"
      ? "Here's what's happening across your campus today."
      : `Manage and keep track of ${page.toLowerCase()}.`;

  return (
    <div className="pageheading">
      <div>
        <label>
          {new Date()
            .toLocaleDateString(undefined, {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })
            .toUpperCase()}
        </label>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>

      {canCreateRecord && (
        <button className="primary" onClick={onCreate}>
          <Plus size={17} /> Add {getRecordLabel(page)}
        </button>
      )}
    </div>
  );
}

function ErrorNotice({ message, onDismiss }) {
  return (
    <div className="error">
      {message}
      <button onClick={onDismiss} aria-label="Dismiss error">
        ×
      </button>
    </div>
  );
}

function DashboardPage({ dashboard, onNavigate }) {
  const student = dashboard.role === "student";
  const faculty = dashboard.role === "faculty";
  const classes = Array.isArray(dashboard.classes) ? dashboard.classes : [];
  const notices = dashboard.notices || dashboard.recentNotices || [];
  const cards = student
    ? [
        [
          "Enrolled classes",
          dashboard.classes?.length || 0,
          ClipboardCheck,
          "#7657df",
        ],
        [
          "Attendance rate",
          `${dashboard.attendanceSummary?.percentage || 0}%`,
          CheckCircle2,
          "#27a58a",
        ],
        [
          "Attendance records",
          dashboard.attendance?.length || 0,
          CalendarDays,
          "#f2a94b",
        ],
        ["Notices", dashboard.notices?.length || 0, Megaphone, "#4f8fe8"],
      ]
    : faculty
      ? [
          [
            "Assigned classes",
            dashboard.classes?.length || 0,
            ClipboardCheck,
            "#7657df",
          ],
          [
            "Enrolled students",
            classes.reduce(
              (count, campusClass) =>
                count + (campusClass.enrolledStudents?.length || 0),
              0,
            ),
            Users,
            "#27a58a",
          ],
          [
            "Attendance marked today",
            dashboard.attendanceToday || 0,
            CheckCircle2,
            "#f2a94b",
          ],
          [
            "Today's bookings",
            dashboard.bookings?.length || 0,
            CalendarDays,
            "#4f8fe8",
          ],
        ]
      : [
          ["Students", dashboard.students || 0, Users, "#7657df"],
          [
            "Faculty members",
            dashboard.faculty || 0,
            ClipboardCheck,
            "#27a58a",
          ],
          ["Classes", dashboard.classes || 0, CalendarDays, "#f2a94b"],
          [
            "Open complaints",
            dashboard.openComplaints || 0,
            MessageSquareWarning,
            "#4f8fe8",
          ],
        ];

  return (
    <>
      <div className="cards">
        {cards.map(([label, value, Icon, color]) => (
          <MetricCard
            key={label}
            label={label}
            value={value}
            Icon={Icon}
            color={color}
          />
        ))}
      </div>

      <div className="overview-grid">
        <div className="panel">
          <PanelHeading
            title={
              student
                ? "My timetable"
                : faculty
                  ? "Assigned classes"
                  : "Campus summary"
            }
            subtitle="Information from your campus account"
          />
          {classes.length ? (
            classes.map((campusClass) => (
              <div className="glance-row" key={campusClass._id}>
                <b className="gicon purple">
                  <Clock3 size={17} />
                </b>
                <span>
                  <strong>
                    {campusClass.courseName} ({campusClass.courseCode})
                  </strong>
                  <small>
                    {campusClass.day}, {campusClass.startTime}–
                    {campusClass.endTime} ·{" "}
                    {campusClass.room?.name || "Room not assigned"}
                  </small>
                </span>
              </div>
            ))
          ) : (
            <div className="empty">
              No classes are assigned to your account yet.
            </div>
          )}
          {!student && !faculty && (
            <button className="viewall" onClick={() => onNavigate("Classes")}>
              Manage classes <ArrowUpRight size={15} />
            </button>
          )}
        </div>
        <div className="panel glance">
          <PanelHeading
            title="Latest notices"
            subtitle="Updates for your role"
          />
          {notices.length ? (
            notices.map((notice) => (
              <div className="glance-row" key={notice._id}>
                <b className="gicon amber">
                  <Megaphone size={17} />
                </b>
                <span>
                  <strong>{notice.title}</strong>
                  <small>
                    {notice.category} ·{" "}
                    {new Date(notice.createdAt).toLocaleDateString()}
                  </small>
                </span>
              </div>
            ))
          ) : (
            <div className="empty">No notices to show.</div>
          )}
          <button className="viewall" onClick={() => onNavigate("Notices")}>
            View notices <ArrowUpRight size={15} />
          </button>
        </div>
      </div>

      {student && (
        <div className="panel">
          <PanelHeading
            title="My attendance"
            subtitle="Your recent attendance records"
          />
          {(dashboard.attendance || []).slice(0, 5).map((record) => (
            <div className="activity-row" key={record._id}>
              <span>
                <strong>{record.campusClass?.courseName || "Class"}</strong>
                <small>{record.date}</small>
              </span>
              <em>{record.status}</em>
            </div>
          ))}
          {!dashboard.attendance?.length && (
            <div className="empty">No attendance has been recorded yet.</div>
          )}
        </div>
      )}
    </>
  );
}

function MetricCard({ label, value, Icon, color }) {
  return (
    <div className="card">
      <div className="card-icon" style={{ color, background: `${color}16` }}>
        <Icon size={19} />
      </div>
      <strong>
        {typeof value === "number" ? value.toLocaleString() : value}
      </strong>
      <small>{label}</small>
    </div>
  );
}

function PanelHeading({ title, subtitle, children }) {
  return (
    <div className="panelhead">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function ResourceTable({
  page,
  records,
  isLoading,
  searchText,
  onSearch,
  canEdit,
  onEdit,
  onDelete,
  onResolve,
}) {
  const matchingRecords = records.filter((record) =>
    JSON.stringify(record).toLowerCase().includes(searchText.toLowerCase()),
  );

  return (
    <div className="panel tablepanel">
      <PanelHeading title={page} subtitle={`${records.length} records`}>
        <div className="filter">
          <Search size={16} />
          <input
            placeholder={`Filter ${page.toLowerCase()}`}
            value={searchText}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
      </PanelHeading>

      <div className="tablewrap">
        <table>
          <TableHeader page={page} />
          <tbody>
            {matchingRecords.map((record, index) => (
              <ResourceRow
                key={record._id || index}
                page={page}
                record={record}
                canEdit={canEdit}
                onEdit={onEdit}
                onDelete={onDelete}
                onResolve={onResolve}
              />
            ))}
          </tbody>
        </table>

        {isLoading ? (
          <div className="empty">Loading {page.toLowerCase()}...</div>
        ) : (
          records.length === 0 && (
            <div className="empty">
              <AlertCircle size={20} />
              <span>No records yet. Add a record to get started.</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function TableHeader({ page }) {
  const columnSets = {
    Students: [
      "Student",
      "Student ID",
      "Department",
      "Email",
      "Status",
      "Actions",
    ],
    Faculty: ["Faculty", "Department", "Email", "Actions"],
    Classes: [
      "Course",
      "Code / section",
      "Faculty",
      "Room",
      "Schedule",
      "Enrollment",
      "Actions",
    ],
    Attendance: ["Student", "Date", "Status"],
    Classrooms: ["Room", "Building", "Type", "Capacity", "Status", "Actions"],
    "Room bookings": [
      "Room",
      "Date",
      "Time",
      "Purpose",
      "Booked by",
      "Actions",
    ],
    Notices: ["Notice", "Category", "Published", "Actions"],
    Complaints: [
      "Complaint",
      "Category",
      "Submitted by",
      "Status",
      "Date",
      "Actions",
    ],
  };

  return (
    <thead>
      <tr>
        {columnSets[page].map((column) => (
          <th key={column}>{column}</th>
        ))}
      </tr>
    </thead>
  );
}

function ResourceRow({ page, record, canEdit, onEdit, onDelete, onResolve }) {
  if (page === "Faculty") {
    return (
      <tr>
        <td>
          <strong>{record.name}</strong>
        </td>
        <td>{record.department || "—"}</td>
        <td>{record.email}</td>
        <td>
          {canEdit && (
            <>
              <button className="table-action" onClick={() => onEdit(record)}>
                Edit
              </button>
              <button
                className="table-action danger"
                onClick={() => onDelete(record)}
              >
                Delete
              </button>
            </>
          )}
        </td>
      </tr>
    );
  }

  if (page === "Classes") {
    return (
      <tr>
        <td>
          <strong>{record.courseName}</strong>
        </td>
        <td>
          {record.courseCode} / {record.section}
        </td>
        <td>{record.faculty?.name || "—"}</td>
        <td>{record.room?.name || "—"}</td>
        <td>
          {record.day}, {record.startTime}–{record.endTime}
        </td>
        <td>
          {record.enrolledStudents?.length || 0} / {record.maxEnrollment}
        </td>
        <td>
          {canEdit && (
            <>
              <button className="table-action" onClick={() => onEdit(record)}>
                Edit
              </button>
              <button
                className="table-action danger"
                onClick={() => onDelete(record)}
              >
                Delete
              </button>
            </>
          )}
        </td>
      </tr>
    );
  }

  if (page === "Students") {
    return (
      <tr>
        <td>
          <strong>{record.name}</strong>
        </td>
        <td>{record.studentId || "—"}</td>
        <td>{record.department || "—"}</td>
        <td>{record.email}</td>
        <td>
          <em>Active</em>
        </td>
        <td>
          {canEdit && (
            <>
              <button className="table-action" onClick={() => onEdit(record)}>
                Edit
              </button>
              <button
                className="table-action danger"
                onClick={() => onDelete(record)}
              >
                Delete
              </button>
            </>
          )}
        </td>
      </tr>
    );
  }

  if (page === "Attendance") {
    return (
      <tr>
        <td>{record.student?.name}</td>
        <td>{record.date}</td>
        <td>
          <em>{record.status}</em>
        </td>
      </tr>
    );
  }

  if (page === "Classrooms") {
    return (
      <tr>
        <td>
          <strong>{record.name}</strong>
        </td>
        <td>{record.building}</td>
        <td>{record.type}</td>
        <td>{record.capacity}</td>
        <td>
          <em>Available</em>
        </td>
        <td>
          {canEdit && (
            <>
              <button className="table-action" onClick={() => onEdit(record)}>
                Edit
              </button>
              <button
                className="table-action danger"
                onClick={() => onDelete(record)}
              >
                Delete
              </button>
            </>
          )}
        </td>
      </tr>
    );
  }

  if (page === "Room bookings") {
    return (
      <tr>
        <td>{record.room?.name}</td>
        <td>{record.date}</td>
        <td>
          {record.startTime}–{record.endTime}
        </td>
        <td>{record.purpose}</td>
        <td>{record.bookedBy?.name}</td>
        <td>
          {canEdit && (
            <>
              <button className="table-action" onClick={() => onEdit(record)}>
                Edit
              </button>
              <button
                className="table-action danger"
                onClick={() => onDelete(record)}
              >
                Delete
              </button>
            </>
          )}
        </td>
      </tr>
    );
  }

  if (page === "Notices") {
    return (
      <tr>
        <td>
          <strong>{record.title}</strong>
          <small>{record.body}</small>
        </td>
        <td>{record.category}</td>
        <td>{new Date(record.createdAt).toLocaleDateString()}</td>
        <td>
          {canEdit && (
            <button
              className="table-action danger"
              onClick={() => onDelete(record)}
            >
              Delete
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <strong>{record.title}</strong>
        <small>{record.description}</small>
      </td>
      <td>{record.category}</td>
      <td>{record.submittedBy?.name}</td>
      <td>
        <em>{record.status}</em>
      </td>
      <td>{new Date(record.createdAt).toLocaleDateString()}</td>
      <td>
        {canEdit && record.status !== "Resolved" && (
          <button className="table-action" onClick={() => onResolve(record)}>
            Mark resolved
          </button>
        )}
      </td>
    </tr>
  );
}

function AuthenticationPage({ onLogin }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [formValues, setFormValues] = useState({ role: "student" });
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (isRegistering && formValues.role === "admin") {
      setMessage(
        "Administrator accounts are initialized separately. Run npm run setup:admin --prefix backend from the project root.",
      );
      return;
    }

    try {
      const action = isRegistering ? "register" : "login";
      const response = await fetch(`${API_URL}/auth/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formValues),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Request failed");
      }

      if (isRegistering) {
        setIsRegistering(false);
        setMessage("Account created. Sign in to continue.");
        return;
      }

      onLogin(result.token, result.user);
    } catch (error) {
      setMessage(error.message);
    }
  }

  function updateField(event) {
    setFormValues({ ...formValues, [event.target.name]: event.target.value });
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="brand authbrand">
          <b className="brandmark">
            <Building2 size={20} />
          </b>
          <span>
            campus<span>OS</span>
            <small>SMART CAMPUS PLATFORM</small>
          </span>
        </div>

        <label>CAMPUS MANAGEMENT, SIMPLIFIED</label>
        <h1>{isRegistering ? "Create your account" : "Welcome back"}</h1>
        <p>Sign in to manage your campus workspace.</p>

        {message && <div className="error">{message}</div>}

        {isRegistering && (
          <label>
            Full name
            <input
              name="name"
              required
              placeholder="Alex Morgan"
              onChange={updateField}
            />
          </label>
        )}

        <label>
          Email address
          <input
            name="email"
            required
            type="email"
            placeholder="you@campus.edu"
            onChange={updateField}
          />
        </label>

        <label>
          Password
          <input
            name="password"
            required
            minLength="8"
            type="password"
            placeholder="At least 8 characters"
            onChange={updateField}
          />
        </label>

        {isRegistering && (
          <>
            <label>
              Role
              <select name="role" defaultValue="student" onChange={updateField}>
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
                <option value="admin">Administrator (one-time setup)</option>
              </select>
              {formValues.role === "admin" && (
                <small>
                  Administrator accounts are created with the secure backend
                  setup command, not public signup.
                </small>
              )}
            </label>
            <label>
              Department
              <input
                name="department"
                placeholder="Computer Science"
                onChange={updateField}
              />
            </label>
          </>
        )}

        <button className="primary submit">
          {isRegistering ? "Create account" : "Sign in"}
        </button>

        <div className="switch">
          {isRegistering ? "Already registered?" : "Don't have an account?"}
          <button
            type="button"
            onClick={() => {
              setIsRegistering(!isRegistering);
              setMessage("");
            }}
          >
            {isRegistering ? "Sign in" : "Create account"}
          </button>
        </div>
      </form>

      <small className="authfoot">
        © 2026 CampusOS · Built for better campus experiences
      </small>
    </div>
  );
}

function getRecordLabel(page) {
  const labels = {
    Students: "student",
    Faculty: "faculty member",
    Classes: "class",
    Classrooms: "room",
    "Room bookings": "booking",
    Notices: "notice",
    Complaints: "complaint",
  };

  return labels[page] || "record";
}

function canCreateResource(page, userRole) {
  if (["Students", "Faculty", "Classes", "Classrooms"].includes(page)) {
    return userRole === "admin";
  }

  if (page === "Attendance" || page === "Notices" || page === "Room bookings") {
    return userRole === "admin" || userRole === "faculty";
  }

  return page === "Complaints";
}

function getFormFields(page) {
  const fieldsByPage = {
    Students: [
      ["name", "Full name"],
      ["email", "Email"],
      ["password", "Temporary password"],
      ["studentId", "Student ID"],
      ["department", "Department"],
    ],
    Classrooms: [
      ["name", "Room name"],
      ["building", "Building"],
      ["type", "Room type"],
      ["capacity", "Capacity"],
    ],
    Faculty: [
      ["name", "Full name"],
      ["email", "Email"],
      ["password", "Temporary password"],
      ["department", "Department"],
    ],
    Classes: [
      ["courseName", "Subject / course name"],
      ["courseCode", "Course code"],
      ["section", "Section"],
      ["faculty", "Assigned faculty"],
      ["room", "Room"],
      ["day", "Day"],
      ["startTime", "Start time"],
      ["endTime", "End time"],
      ["maxEnrollment", "Maximum enrollment"],
      ["enrolledStudents", "Enrolled students"],
    ],
    Notices: [
      ["title", "Title"],
      ["body", "Announcement"],
      ["category", "Category"],
      ["audience", "Audience"],
    ],
    Complaints: [
      ["title", "Subject"],
      ["description", "Describe the issue"],
      ["category", "Category"],
    ],
    "Room bookings": [
      ["room", "Room ID"],
      ["date", "Date"],
      ["startTime", "Start time"],
      ["endTime", "End time"],
      ["purpose", "Purpose"],
    ],
    Attendance: [
      ["campusClass", "Class"],
      ["student", "Student"],
      ["date", "Date"],
      ["status", "Attendance status"],
    ],
  };

  return fieldsByPage[page] || [];
}

function RecordModal({ page, token, onClose, onSubmit, initialRecord }) {
  const [formValues, setFormValues] = useState(() => {
    if (!initialRecord) return {};
    return {
      ...initialRecord,
      faculty: initialRecord.faculty?._id || initialRecord.faculty || "",
      room: initialRecord.room?._id || initialRecord.room || "",
      enrolledStudents: (initialRecord.enrolledStudents || []).map(
        (student) => student._id || student,
      ),
    };
  });
  const [students, setStudents] = useState([]);
  const [faculty, setFaculty] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [classes, setClasses] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const fields = getFormFields(page);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        if (page === "Classes") {
          const [facultyList, roomList, studentList] = await Promise.all([
            requestApi("/faculty", token),
            requestApi("/rooms", token),
            requestApi("/students", token),
          ]);
          setFaculty(facultyList);
          setRooms(roomList);
          setStudents(studentList);
        }
        if (page === "Attendance") {
          const classList = await requestApi("/classes", token);
          setClasses(classList);
          const selected =
            classList.find((item) => item._id === formValues.campusClass) ||
            classList[0];
          if (selected) {
            setFormValues((values) => ({
              ...values,
              campusClass: selected._id,
            }));
            setStudents(selected.enrolledStudents || []);
          }
        }
        if (page === "Room bookings")
          setRooms(await requestApi("/rooms", token));
      } catch (error) {
        setFormError(error.message);
      }
    };
    loadOptions();
  }, [page, token]);

  function updateField(event) {
    const { name, value, selectedOptions } = event.target;
    const nextValue =
      name === "enrolledStudents"
        ? Array.from(selectedOptions, (option) => option.value)
        : name === "maxEnrollment" || name === "capacity"
          ? Number(value)
          : value;
    setFormValues((values) => ({ ...values, [name]: nextValue }));
    if (name === "campusClass") {
      const selectedClass = classes.find(
        (campusClass) => campusClass._id === value,
      );
      setStudents(selectedClass?.enrolledStudents || []);
      setFormValues((values) => ({
        ...values,
        campusClass: value,
        student: "",
      }));
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setFormError("");
    try {
      await onSubmit({
        ...formValues,
        capacity: Number(formValues.capacity) || 30,
      });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modalhead">
          <h2>
            {initialRecord ? "Edit" : "Add"} {getRecordLabel(page)}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close form">
            ×
          </button>
        </div>

        {formError && <div className="error">{formError}</div>}

        {fields.map(([name, label]) => (
          <label key={name}>
            {label}
            {name === "day" ? (
              <select
                name={name}
                required
                value={formValues[name] || ""}
                onChange={updateField}
              >
                <option value="">Select day</option>
                {[
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ].map((day) => (
                  <option key={day}>{day}</option>
                ))}
              </select>
            ) : ["faculty", "room", "student", "campusClass"].includes(name) ? (
              <select
                name={name}
                required
                value={formValues[name] || ""}
                onChange={updateField}
              >
                <option value="">Select {label.toLowerCase()}</option>
                {(name === "faculty"
                  ? faculty
                  : name === "room"
                    ? rooms
                    : name === "campusClass"
                      ? classes
                      : students
                ).map((option) => (
                  <option key={option._id} value={option._id}>
                    {option.name ||
                      `${option.courseName} (${option.courseCode})`}
                    {option.studentId ? ` (${option.studentId})` : ""}
                  </option>
                ))}
              </select>
            ) : name === "enrolledStudents" ? (
              <select
                name={name}
                multiple
                value={formValues[name] || []}
                onChange={updateField}
              >
                {students.map((student) => (
                  <option key={student._id} value={student._id}>
                    {student.name}{" "}
                    {student.studentId ? `(${student.studentId})` : ""}
                  </option>
                ))}
              </select>
            ) : name === "audience" ? (
              <select
                name={name}
                required
                value={formValues[name] || "all"}
                onChange={updateField}
              >
                <option value="all">Everyone</option>
                <option value="student">Students</option>
                <option value="faculty">Faculty</option>
              </select>
            ) : name === "status" ? (
              <select name={name} required onChange={updateField}>
                <option value="">Select status</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
                <option value="late">Late</option>
              </select>
            ) : ["body", "description"].includes(name) ? (
              <textarea name={name} required rows="3" onChange={updateField} />
            ) : (
              <input
                name={name}
                required={name !== "password" || !initialRecord}
                type={getInputType(name)}
                value={formValues[name] ?? (name === "maxEnrollment" ? 60 : "")}
                minLength={name === "password" ? 8 : undefined}
                min={
                  name === "capacity" || name === "maxEnrollment"
                    ? 1
                    : undefined
                }
                onChange={updateField}
              />
            )}
          </label>
        ))}

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={isSaving}>
            {isSaving
              ? "Saving..."
              : initialRecord
                ? "Save changes"
                : "Create record"}
          </button>
        </div>
      </form>
    </div>
  );
}

function getInputType(fieldName) {
  if (fieldName === "date") {
    return "date";
  }

  if (fieldName === "capacity") {
    return "number";
  }

  if (fieldName === "password") {
    return "password";
  }

  return "text";
}

export default App;
