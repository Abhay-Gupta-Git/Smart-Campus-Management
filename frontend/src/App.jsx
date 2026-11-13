import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  DoorOpen,
  History,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquareWarning,
  Plus,
  Search,
  Sparkles,
  Wrench,
  Users,
} from "lucide-react";
     
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const INSTITUTION_NAME = import.meta.env.VITE_INSTITUTION_NAME?.trim() || "CampusOS";
const ROOM_TYPES = ["Classroom", "Lecture Hall", "Laboratory", "Meeting Room", "Auditorium", "Other"];

const navigationItems = [
  ["Overview", LayoutDashboard],
  ["Activity history", History],
  ["Analytics", BarChart3],
  ["Students", Users],
  ["Faculty", Users],
  ["Technicians", Wrench],
  ["Classes", ClipboardCheck],
  ["Attendance", ClipboardCheck],
  ["Classrooms", DoorOpen],
  ["Room bookings", CalendarDays],
  ["Room recommendations", Sparkles],
  ["Notices", Megaphone],
  ["Complaints", MessageSquareWarning],
];

const resourceEndpoints = {
  Students: "/students",
  Faculty: "/faculty",
  Technicians: "/admin/users/technicians",
  Classes: "/classes",
  Attendance: "/attendance",
  Classrooms: "/rooms",
  "Room bookings": "/bookings",
  Notices: "/notices",
  Complaints: "/complaints",
  "Activity history": "/activity",
};

async function requestApi(path, token, options = {}) {
  const { withMeta = false, ...requestOptions } = options;
  const response = await fetch(`${API_URL}${path}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...requestOptions.headers,
    },
  });

  const responseData = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(responseData.message || "Request failed");
  }

  if (!withMeta) return responseData;
  return {
    data: responseData,
    pagination: {
      total: Number(response.headers.get("X-Total-Count")) || 0,
      page: Number(response.headers.get("X-Page")) || 1,
      pageSize: Number(response.headers.get("X-Page-Size")) || responseData.length,
      totalPages: Number(response.headers.get("X-Total-Pages")) || 0,
    },
  };
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [sessionReady, setSessionReady] = useState(
    !localStorage.getItem("token"),
  );
  const [page, setPage] = useState("Overview");
  const [dashboard, setDashboard] = useState({});
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [listQuery, setListQuery] = useState({ page: 1, limit: 10 });
  const [searchText, setSearchText] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [inspectionRoom, setInspectionRoom] = useState(null);
  const [technicians, setTechnicians] = useState([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notificationTarget, setNotificationTarget] = useState(null);
  const activeListRequest = useRef(null);
  const handleListQueryChange = useCallback((query) => setListQuery(query), []);
  const navigateToPage = useCallback((nextPage) => {
    setNotificationTarget(null);
    setListQuery({ page: 1, limit: 10 });
    setSearchText("");
    setPage(nextPage);
  }, []);
  const navigateToNotification = useCallback((notification) => {
    const entityType = notification.entityType || (notification.complaint ? "complaint" : null);
    const targetPage = notification.targetPage || ({ booking: "Room bookings", room: "Classrooms", class: "Classes", attendance: "Attendance", complaint: "Complaints", notice: "Notices", account: "Activity history" })[entityType] || (/booking/i.test(notification.title || "") ? "Room bookings" : null);
    if (!targetPage) return;
    const recordId = notification.entityId?._id || notification.entityId || notification.complaint?._id || notification.complaint;
    const target = recordId ? { page: targetPage, id: String(recordId) } : null;
    setNotificationTarget(target);
    setSearchText("");
    setPage(targetPage);
    setListQuery({ page: 1, limit: 10, ...(target?.id ? { recordId: target.id } : {}) });
  }, []);

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

    let active = true;
    setIsDashboardLoading(true);
    requestApi("/dashboard", token)
      .then((result) => { if (active) setDashboard(result); })
      .catch((error) => { if (active) setErrorMessage(error.message); })
      .finally(() => { if (active) setIsDashboardLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    loadRecords(page, listQuery, controller);
    return () => controller.abort();
  }, [token, page, user?.role, listQuery]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    if (page === "Complaints" && user?.role === "admin") {
      requestApi("/admin/users/technicians?limit=100", token)
        .then((result) => { if (active) setTechnicians(result); })
        .catch((error) => { if (active && error.name !== "AbortError") setErrorMessage(error.message); });
    } else {
      setTechnicians([]);
    }
    return () => { active = false; };
  }, [token, page, user?.role]);

  async function loadRecords(selectedPage = page, query = listQuery, controller = new AbortController()) {
    activeListRequest.current?.abort();
    activeListRequest.current = controller;
    const signal = controller.signal;
    const endpoint = resourceEndpoints[selectedPage];

    if (!endpoint) {
      setRecords([]);
      setTotalRecords(0);
      setIsLoading(false);
      if (activeListRequest.current === controller) activeListRequest.current = null;
      return;
    }

    setIsLoading(true);
    setRecords([]);
    setTotalRecords(0);
    try {
      const params = new URLSearchParams();
      Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") params.set(key, value);
      });
      const result = await requestApi(`${endpoint}?${params.toString()}`, token, { signal, withMeta: true });
      setRecords(result.data);
      setTotalRecords(result.pagination.total);
    } catch (error) {
      if (error.name === "AbortError") return;
      setRecords([]);
      setTotalRecords(0);
      setErrorMessage(error.message);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
      if (activeListRequest.current === controller) activeListRequest.current = null;
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
      throw error;
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || isDeleting) return;
    const record = pendingDelete;
    setIsDeleting(true);
    try {
      await requestApi(`${resourceEndpoints[page]}/${record._id}`, token, { method: "DELETE" });
      setPendingDelete(null);
      await loadRecords(page);
      setSuccessMessage(`${getRecordLabel(page)} deleted successfully.`);
    } catch (error) { setErrorMessage(error.message); }
    finally { setIsDeleting(false); }
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
        onNavigate={navigateToPage}
        onLogout={handleLogout}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      <main className="main">
        <TopBar
          page={page}
          user={user}
          token={token}
          searchText={searchText}
          onSearch={setSearchText}
          onMenu={() => setIsSidebarOpen((open) => !open)}
          isSidebarOpen={isSidebarOpen}
          onNavigateNotification={navigateToNotification}
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
            <DashboardPage dashboard={dashboard} isLoading={isDashboardLoading} onNavigate={navigateToPage} />
          ) : page === "Analytics" && user?.role === "admin" ? (
            <AnalyticsDashboardPage token={token} />
          ) : page === "Room recommendations" ? (
            <RoomRecommendationPage token={token} />
          ) : (
            <ResourceTable
              key={`${page}:${notificationTarget?.page === page ? notificationTarget.id : ""}`}
              page={page}
              initialRecordId={notificationTarget?.page === page ? notificationTarget.id : ""}
              records={records}
              totalRecords={totalRecords}
              onQueryChange={handleListQueryChange}
              isLoading={isLoading}
              searchText={searchText}
              onSearch={setSearchText}
              canEdit={
                user?.role === "admin" &&
                [
                  "Classes",
                  "Faculty",
                  "Students",
                  "Technicians",
                  "Classrooms",
                  "Room bookings",
                  "Notices",
                  "Complaints",
                ].includes(page)
              }
              userId={user?.id || user?._id}
              userRole={user?.role}
              technicians={technicians}
              canInspectRoom={["admin", "faculty", "technician"].includes(user?.role)}
              onInspectRoom={setInspectionRoom}
              onEdit={(record) => {
                setEditingRecord(record);
                setIsModalOpen(true);
              }}
              onDelete={setPendingDelete}
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
                  throw error;
                }
              }}
              onBookingDecision={async (record, status) => {
                try {
                  await requestApi(`/bookings/${record._id}/status`, token, {
                    method: "PATCH",
                    body: JSON.stringify({ status }),
                  });
                  await loadRecords(page);
                  setSuccessMessage(`Booking ${status.toLowerCase()}.`);
                } catch (error) {
                  setErrorMessage(error.message);
                }
              }}
              onBookingCancel={async (record) => {
                try {
                  await requestApi(`/bookings/${record._id}/cancel`, token, { method: "PATCH" });
                  await loadRecords(page);
                  setSuccessMessage("Booking request cancelled.");
                } catch (error) {
                  setErrorMessage(error.message);
                }
              }}
              onAssignComplaint={async (record, technicianId) => {
                try {
                  await requestApi(`/complaints/${record._id}/assign`, token, {
                    method: "PATCH",
                    body: JSON.stringify({ technicianId: technicianId || null }),
                  });
                  await loadRecords(page);
                  setSuccessMessage("Maintenance assignment updated.");
                } catch (error) { setErrorMessage(error.message); throw error; }
              }}
              onUpdateWork={async (record, values) => {
                try {
                  await requestApi(`/complaints/${record._id}/work`, token, { method: "PATCH", body: JSON.stringify(values) });
                  await loadRecords(page);
                  setSuccessMessage(values.status === "Pending Verification" ? "Repair submitted for faculty verification." : "Work progress updated.");
                } catch (error) { setErrorMessage(error.message); throw error; }
              }}
              onVerifyRepair={async (record, decision, note) => {
                try {
                  await requestApi(`/complaints/${record._id}/verify`, token, { method: "PATCH", body: JSON.stringify({ decision, note }) });
                  await loadRecords(page);
                  await requestApi("/dashboard", token).then(setDashboard);
                  setSuccessMessage(decision === "accept" ? "Repair accepted and complaint closed." : "Repair rejected and returned to the technician.");
                } catch (error) { setErrorMessage(error.message); throw error; }
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
      {inspectionRoom && (
        <RoomInspectionModal
          room={inspectionRoom}
          token={token}
          onClose={() => setInspectionRoom(null)}
          onSaved={async () => { setInspectionRoom(null); await loadRecords("Classrooms"); }}
        />
      )}
      {pendingDelete && <div className="overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !isDeleting && setPendingDelete(null)}>
        <section className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
          <div className="modalhead"><h2 id="delete-title">Delete {getRecordLabel(page)}?</h2><button type="button" disabled={isDeleting} onClick={() => setPendingDelete(null)} aria-label="Close confirmation">×</button></div>
          <p>This will permanently remove <strong>{page === "Classes" ? `${pendingDelete.courseCode} ${pendingDelete.section}` : pendingDelete.name || pendingDelete.title || "this record"}</strong>.</p>
          <div className="modal-actions"><button className="secondary" disabled={isDeleting} onClick={() => setPendingDelete(null)}>Keep record</button><button className="danger-button" disabled={isDeleting} onClick={confirmDelete}>{isDeleting ? "Deleting…" : "Delete record"}</button></div>
        </section>
      </div>}
    </div>
  );
}

function Sidebar({ activePage, dashboard, user, onNavigate, onLogout, isOpen, onClose }) {
  const role = user?.role || "student";
  const allowedPages = {
    admin: [
      "Overview",
      "Activity history",
      "Analytics",
      "Technicians",
      "Students",
      "Faculty",
      "Classes",
      "Attendance",
      "Classrooms",
      "Room bookings",
      "Room recommendations",
      "Notices",
      "Complaints",
    ],
    faculty: [
      "Overview",
      "Activity history",
      "Classes",
      "Students",
      "Attendance",
      "Classrooms",
      "Room bookings",
      "Room recommendations",
      "Notices",
      "Complaints",
    ],
    student: ["Overview", "Activity history", "Classes", "Attendance", "Classrooms", "Room bookings", "Room recommendations", "Notices", "Complaints"],
    technician: ["Overview", "Activity history", "Classrooms", "Complaints"],
  }[role] || ["Overview"];

  return (
    <>
    {isOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={onClose} />}
    <aside id="campus-sidebar" className={`sidebar ${isOpen ? "sidebar-open" : ""}`} aria-label="Primary navigation">
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

      <nav className="primary-nav" aria-label="Workspace">
        {navigationItems
          .filter(([label]) => allowedPages.includes(label))
          .map(([label, Icon]) => (
            <button
              key={label}
              className={`navitem ${activePage === label ? "active" : ""}`}
              aria-current={activePage === label ? "page" : undefined}
              onClick={() => { onNavigate(label); onClose(); }}
            >
              <Icon size={18} />
              {label}
              {label === "Complaints" && dashboard.openComplaints > 0 && (
                <i>{dashboard.openComplaints}</i>
              )}
            </button>
          ))}
      </nav>

      <div className="side-foot">
        <div className="org">
          <Building2 size={18} />
          <span>
            <strong>{INSTITUTION_NAME}</strong>
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
    </>
  );
}

function TopBar({ page, user, token, searchText, onSearch, onMenu, isSidebarOpen, onNavigateNotification }) {
  const searchInput = useRef(null);

  useEffect(() => {
    function focusSearch(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <header>
      <div className="crumb">
        <button className="menu-toggle" aria-label="Toggle navigation" aria-expanded={isSidebarOpen} aria-controls="campus-sidebar" onClick={onMenu}><Menu size={18} /></button>
        Workspace <span>/</span> <strong>{page}</strong>
      </div>

      <div className="head-actions">
        <div className="search">
          <Search size={16} />
          <input
            ref={searchInput}
          aria-label={`Search ${page.toLowerCase()}`}
            placeholder={`Search ${page.toLowerCase()}...`}
            value={searchText}
            onChange={(event) => onSearch(event.target.value)}
          />
          <kbd>Ctrl K</kbd>
        </div>
        <NotificationBell token={token} onNavigate={onNavigateNotification} />
        <b className="userdot">{user?.name?.[0] || "A"}</b>
      </div>
    </header>
  );
}

function NotificationBell({ token, onNavigate }) {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [readingId, setReadingId] = useState("");
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const unreadRequestId = useRef(0);

  async function loadUnreadCount() {
    const requestId = ++unreadRequestId.current;
    try {
      const result = await requestApi("/notifications/unread-count", token);
      if (requestId !== unreadRequestId.current) return;
      setUnreadCount(result.unreadCount || 0);
      setNotificationError("");
    } catch (error) { if (requestId === unreadRequestId.current && error.name !== "AbortError") setNotificationError(error.message); }
  }

  async function loadNotifications() {
    setLoading(true);
    try {
      const items = await requestApi("/notifications", token);
      const list = Array.isArray(items) ? items : [];
      setNotifications(list);
      setUnreadCount(list.filter((item) => !item.readAt).length);
      setNotificationError("");
      await loadUnreadCount();
    } catch (error) { if (error.name !== "AbortError") setNotificationError(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    const refresh = () => { if (active && !document.hidden) loadUnreadCount(); };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [token]);

  async function openNotifications() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) await loadNotifications();
  }

  async function markRead(notification) {
    if (notification.readAt || readingId === notification._id) return;
    setReadingId(notification._id);
    try {
      await requestApi(`/notifications/${notification._id}/read`, token, { method: "PATCH" });
      setNotifications((items) => items.map((item) => item._id === notification._id ? { ...item, readAt: new Date().toISOString() } : item));
      setUnreadCount((count) => Math.max(0, count - 1));
      setNotificationError("");
    } catch (error) { setNotificationError(error.message); throw error; }
    finally { setReadingId(""); }
  }

  async function markUnread(notification) {
    if (!notification.readAt || readingId === notification._id) return;
    setReadingId(notification._id);
    try {
      await requestApi(`/notifications/${notification._id}/unread`, token, { method: "PATCH" });
      setNotifications((items) => items.map((item) => item._id === notification._id ? { ...item, readAt: null } : item));
      setUnreadCount((count) => count + 1);
      setNotificationError("");
    } catch (error) { setNotificationError(error.message); }
    finally { setReadingId(""); }
  }

  async function openNotification(notification) {
    try {
      await markRead(notification);
      setIsOpen(false);
      onNavigate(notification);
    } catch { /* Keep the item visible so the user can retry. */ }
  }

  async function markAllRead() {
    if (markingAllRead) return;
    setMarkingAllRead(true);
    try {
      await requestApi("/notifications/read-all", token, { method: "PATCH" });
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
      setUnreadCount(0);
      setNotificationError("");
    } catch (error) { setNotificationError(error.message); }
    finally { setMarkingAllRead(false); }
  }

  return (
    <div className="notification-wrap">
      <button className="bell" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-expanded={isOpen} onClick={openNotifications}>
        <Bell size={18} />{unreadCount > 0 && <i />}
      </button>
      {isOpen && (
        <div className="notification-popover">
          <div className="notification-popover-head"><strong>Notifications</strong><span>{unreadCount} unread</span>{unreadCount > 0 && <button disabled={markingAllRead} onClick={markAllRead}>{markingAllRead ? "Saving…" : "Mark all read"}</button>}</div>
          {notificationError && <div className="notification-error" role="alert">{notificationError}</div>}
          {loading ? <div className="notification-empty">Loading notifications…</div> : notifications.length ? notifications.map((notification) => (
            <div className={`notification-item ${notification.readAt ? "read" : "unread"}`} key={notification._id}>
              <button className="notification-link" disabled={readingId === notification._id} onClick={() => openNotification(notification)}>
                <span className="notification-title">{!notification.readAt && <i aria-label="Unread" />}{notification.title}</span>
                <span>{notification.message}</span>
                <time dateTime={notification.createdAt} title={new Date(notification.createdAt).toLocaleString()}>{new Date(notification.createdAt).toLocaleString()}</time>
              </button>
              <button className="notification-read-toggle" disabled={readingId === notification._id} onClick={() => notification.readAt ? markUnread(notification) : markRead(notification)}>{notification.readAt ? "Mark unread" : "Mark read"}</button>
            </div>
          )) : <div className="notification-empty">No notifications yet.</div>}
        </div>
      )}
    </div>
  );
}

function PageHeading({ page, user, canCreateRecord, onCreate }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const title =
    page === "Overview"
      ? `${greeting}, ${user?.name?.split(" ")[0] || "there"}`
      : page;
  const description =
    page === "Overview"
      ? "Here's what's happening across your campus today."
      : page === "Analytics"
        ? "Campus activity and resource use from recorded data."
      : page === "Room recommendations"
        ? "Find a room that fits your group and schedule."
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

function AnalyticsDashboardPage({ token }) {
  const [range, setRange] = useState("30d");
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError("");
    requestApi(`/dashboard/analytics?range=${range}`, token)
      .then((result) => { if (active) setAnalytics(result); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [range, token]);

  if (isLoading && !analytics) return <div className="panel analytics-message">Loading analytics…</div>;
  if (error && !analytics) return <div className="error" role="alert">{error}</div>;
  if (!analytics) return null;

  const campusMetrics = [
    ["Students", analytics.totals.students, Users, "var(--tone-brand)"],
    ["Faculty", analytics.totals.faculty, ClipboardCheck, "var(--tone-success)"],
    ["Rooms", analytics.totals.rooms, DoorOpen, "var(--tone-warning)"],
    ["Classes", analytics.totals.classes, CalendarDays, "var(--tone-info)"],
  ];
  const bookingMetrics = [
    ["Total bookings", analytics.bookings.total, CalendarDays, "var(--tone-info)"],
    ["Pending", analytics.bookings.Pending, Clock3, "var(--tone-warning)"],
    ["Approved", analytics.bookings.Approved, CheckCircle2, "var(--tone-success)"],
    ["Rejected", analytics.bookings.Rejected, AlertCircle, "var(--tone-danger)"],
    ["Cancelled", analytics.bookings.Cancelled, CalendarDays, "var(--tone-neutral)"],
  ];
  const complaintMetrics = [
    ["Total complaints", analytics.complaints.total, MessageSquareWarning, "var(--tone-info)"],
    ["Open", analytics.complaints.Open, AlertCircle, "var(--tone-danger)"],
    ["In progress", analytics.complaints["In progress"], Clock3, "var(--tone-warning)"],
    ["Pending verification", analytics.complaints["Pending Verification"], Clock3, "var(--tone-info)"],
    ["Resolved", analytics.complaints.Resolved, CheckCircle2, "var(--tone-success)"],
    ["Closed", analytics.complaints.Closed, CheckCircle2, "var(--tone-success)"],
  ];
  const attendanceMetrics = [
    ["Attendance records", analytics.attendance.total, ClipboardCheck, "var(--tone-info)"],
    ["Present", analytics.attendance.present, CheckCircle2, "var(--tone-success)"],
    ["Late", analytics.attendance.late, Clock3, "var(--tone-warning)"],
    ["Absent", analytics.attendance.absent, AlertCircle, "var(--tone-danger)"],
    ["Attendance rate", `${analytics.attendance.attendanceRate}%`, BarChart3, "var(--tone-brand)"],
  ];

  return (
    <div className="analytics-page">
      <div className="analytics-toolbar">
        <span>Reporting period</span>
        <select aria-label="Analytics date range" value={range} onChange={(event) => setRange(event.target.value)}>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        {isLoading && <small>Updating…</small>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      <AnalyticsMetricSection title="Campus totals" metrics={campusMetrics} />
      <AnalyticsMetricSection title={`Bookings · ${rangeLabel(range)}`} metrics={bookingMetrics} />

      <div className="analytics-grid">
        <section className="panel analytics-chart-panel">
          <PanelHeading
            title="Booking trends"
            subtitle={`${analytics.periodGranularity === "month" ? "Monthly" : "Daily"} booking dates, grouped by status`}
          />
          <BookingTrendChart data={analytics.bookingTrend} granularity={analytics.periodGranularity} />
        </section>
        <section className="panel analytics-chart-panel">
          <PanelHeading title={`Complaints · ${rangeLabel(range)}`} subtitle="Current status of complaints created in this period" />
          {analytics.complaints.total ? (
            <AnalyticsBars rows={[
              ["Open", analytics.complaints.Open, "var(--tone-danger)"],
              ["In progress", analytics.complaints["In progress"], "var(--tone-warning)"],
              ["Pending Verification", analytics.complaints["Pending Verification"], "var(--tone-info)"],
              ["Resolved", analytics.complaints.Resolved, "var(--tone-success)"],
              ["Closed", analytics.complaints.Closed, "var(--tone-success)"],
            ]} />
          ) : <div className="analytics-empty">No complaint records for this period.</div>}
        </section>
      </div>

      <section className="panel analytics-usage-panel">
        <PanelHeading title="Room usage" subtitle={`Approved bookings and scheduled hours · ${rangeLabel(range)}`} />
        {analytics.roomUsage.length ? (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead><tr><th>Room</th><th>Building</th><th>Type</th><th>Approved bookings</th><th>Booked hours</th></tr></thead>
              <tbody>{analytics.roomUsage.map((room) => (
                <tr key={room.roomId}>
                  <td><strong>{room.name}</strong></td><td>{room.building}</td><td>{room.type}</td>
                  <td>{room.approvedBookings}</td><td>{room.bookedHours}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="analytics-empty">No approved room bookings for this period.</div>}
      </section>

      <AnalyticsMetricSection title={`Complaint totals · ${rangeLabel(range)}`} metrics={complaintMetrics} />
      <AnalyticsMetricSection title={`Attendance · ${rangeLabel(range)}`} metrics={attendanceMetrics} />
      <section className="panel analytics-chart-panel">
        <PanelHeading title="Attendance breakdown" subtitle="Present and late count as attended" />
        {analytics.attendance.total ? (
          <AnalyticsBars rows={[
            ["Present", analytics.attendance.present, "var(--tone-success)"],
            ["Late", analytics.attendance.late, "var(--tone-warning)"],
            ["Absent", analytics.attendance.absent, "var(--tone-danger)"],
          ]} />
        ) : <div className="analytics-empty">No attendance records for this period.</div>}
      </section>
      <RoomForecastPanel token={token} />
    </div>
  );
}

function rangeLabel(range) {
  return range === "all" ? "all time" : range === "7d" ? "last 7 days" : "last 30 days";
}

function AnalyticsMetricSection({ title, metrics }) {
  return (
    <section className="analytics-section">
      <h2>{title}</h2>
      <div className="analytics-metrics">
        {metrics.map(([label, value, Icon, color]) => (
          <MetricCard key={label} label={label} value={value} Icon={Icon} color={color} />
        ))}
      </div>
    </section>
  );
}

function BookingTrendChart({ data, granularity }) {
  const chartData = data.slice(-24);
  if (!chartData.length || chartData.every((item) => item.total === 0)) {
    return <div className="analytics-empty">No booking records for this period.</div>;
  }
  const width = 800;
  const height = 250;
  const left = 42;
  const right = 14;
  const top = 15;
  const bottom = 37;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const maxValue = Math.max(1, ...chartData.map((item) => item.total));
  const slotWidth = plotWidth / chartData.length;
  const barWidth = Math.min(25, slotWidth * 0.62);
  const colors = { Approved: "var(--tone-success)", Pending: "var(--tone-warning)", Rejected: "var(--tone-danger)", Cancelled: "var(--tone-neutral)" };
  const statuses = Object.keys(colors);
  const labelStep = Math.max(1, Math.ceil(chartData.length / 8));

  return (
    <div className="booking-chart-wrap">
      <svg className="booking-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Booking counts over time by status">
        {[0, 0.5, 1].map((fraction) => {
          const y = top + plotHeight * (1 - fraction);
          return <g key={fraction}><line x1={left} y1={y} x2={width - right} y2={y} stroke="#eceef3" /><text x={left - 8} y={y + 4} textAnchor="end">{Math.round(maxValue * fraction)}</text></g>;
        })}
        {chartData.map((item, index) => {
          const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
          let yBottom = top + plotHeight;
          return (
            <g key={item.period}>
              {statuses.map((status) => {
                const count = item[status] || 0;
                if (!count) return null;
                const barHeight = (count / maxValue) * plotHeight;
                yBottom -= barHeight;
                return <rect key={status} x={x} y={yBottom} width={barWidth} height={barHeight} fill={colors[status]}><title>{`${item.period}: ${count} ${status.toLowerCase()}`}</title></rect>;
              })}
              {(index % labelStep === 0 || index === chartData.length - 1) && (
                <text x={x + barWidth / 2} y={height - 12} textAnchor="middle">{granularity === "month" ? item.period : item.period.slice(5)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="analytics-legend">
        {statuses.map((status) => <span key={status}><i style={{ background: colors[status] }} />{status}</span>)}
      </div>
    </div>
  );
}

function AnalyticsBars({ rows }) {
  const maxValue = Math.max(1, ...rows.map(([, value]) => value));
  return (
    <div className="analytics-bars">
      {rows.map(([label, value, color]) => (
        <div className="analytics-bar-row" key={label}>
          <span>{label}</span>
          <div className="analytics-bar-track"><i style={{ width: `${(value / maxValue) * 100}%`, background: color }} /></div>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function RoomForecastPanel({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    requestApi("/dashboard/analytics/room-forecast", token)
      .then((result) => { if (active) setData(result); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [token]);

  if (isLoading) return <section className="panel analytics-message">Loading room usage forecast…</section>;
  if (error) return <div className="error" role="alert">{error}</div>;
  if (!data) return null;

  const actualWeekdays = data.historicalPatterns.weekdays;
  const actualSlots = data.historicalPatterns.timeSlots;
  const actualBuildings = data.historicalPatterns.buildings.slice(0, 6);
  const actualTypes = data.historicalPatterns.roomTypes;
  const forecastDays = new Map();
  for (const period of data.forecast.periods) {
    const item = forecastDays.get(period.date) || { label: `${period.day.slice(0, 3)} ${period.date.slice(5)}`, hours: 0 };
    item.hours += period.expectedBookedHours;
    forecastDays.set(period.date, item);
  }
  const highPeriods = data.forecast.periods
    .filter((period) => period.demandLevel === "High demand")
    .sort((a, b) => b.expectedBookedHours - a.expectedBookedHours)
    .slice(0, 5);
  const lowPeriods = data.forecast.periods
    .filter((period) => period.demandLevel === "Low demand")
    .sort((a, b) => a.expectedBookedHours - b.expectedBookedHours)
    .slice(0, 5);
  const expectedHours = data.forecast.periods.reduce((sum, period) => sum + period.expectedBookedHours, 0);

  return (
    <section className="forecast-module">
      <div className="forecast-module-heading">
        <div>
          <span className="forecast-kicker">ADMIN FORECASTING</span>
          <h2>Room Usage Forecasting</h2>
          <p>Historical actuals and rule-based estimates, shown separately.</p>
        </div>
        <span className="forecast-window">Historical window · {data.history.startDate} to {data.history.endDate}</span>
      </div>

      <div className="panel forecast-actual-panel">
        <PanelHeading title="Historical actuals" subtitle="Approved bookings recorded in the trailing 90 days" />
        <div className="forecast-summary">
          <div><strong>{data.history.approvedBookings}</strong><span>Approved bookings</span></div>
          <div><strong>{data.history.bookedHours}</strong><span>Booked hours</span></div>
          <div><strong>{data.history.activeWeeks}</strong><span>Weeks with bookings</span></div>
        </div>
        {data.history.approvedBookings ? (
          <div className="forecast-pattern-grid">
            <ForecastPattern title="Usage by weekday" subtitle="Average actual booked hours per weekday" rows={actualWeekdays.map((row) => [row.day, row.avgBookedHours, "var(--tone-brand)"])} />
            <ForecastPattern title="Usage by time slot" subtitle="Actual approved hours in each slot" rows={actualSlots.map((row) => [`${row.label} · ${row.startTime}–${row.endTime}`, row.bookedHours, "var(--tone-info)"])} />
            <ForecastPattern title="Usage by building" subtitle="Top six buildings by actual approved hours" rows={actualBuildings.map((row) => [row.building, row.bookedHours, "var(--tone-success)"])} emptyText="No building usage recorded." />
            <ForecastPattern title="Usage by room type" subtitle="Actual approved booked hours" rows={actualTypes.map((row) => [row.roomType, row.bookedHours, "var(--tone-warning)"])} emptyText="No room-type usage recorded." />
          </div>
        ) : (
          <div className="analytics-empty">{data.noDataMessage || "No approved booking data is available."}</div>
        )}
      </div>

      {data.forecast.available ? (
        <div className="panel forecast-prediction-panel">
          <div className="forecast-section-heading">
            <div>
              <span className="forecast-predicted-label">PREDICTION · NEXT 7 DAYS</span>
              <h3>Expected room demand</h3>
              <p>Forecast from historical averages for the same weekday and time slot.</p>
              <p>{data.forecast.demandClassification}</p>
            </div>
            <span>{data.forecast.startDate} to {data.forecast.endDate}</span>
          </div>
          <div className="forecast-summary prediction-summary">
            <div><strong>{expectedHours.toFixed(1)}</strong><span>Predicted booked hours · next 7 days</span></div>
            <div><strong>{data.forecast.periods.length}</strong><span>Day and time-slot estimates</span></div>
            <div><strong>{highPeriods.length}</strong><span>High-demand periods shown</span></div>
          </div>
          <ForecastDailyChart days={[...forecastDays.values()]} />
          <div className="forecast-demand-grid">
            <div className="forecast-demand-list high">
              <h4>Predicted high-demand periods</h4>
              {highPeriods.length ? highPeriods.map((period) => <ForecastPeriod key={`${period.date}-${period.slot}`} period={period} />) : <p>No period exceeded the current historical baseline.</p>}
            </div>
            <div className="forecast-demand-list low">
              <h4>Predicted low-demand periods</h4>
              {lowPeriods.length ? lowPeriods.map((period) => <ForecastPeriod key={`${period.date}-${period.slot}`} period={period} />) : <p>No low-demand periods identified in this forecast.</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="panel forecast-insufficient" role="status">
          <AlertCircle size={21} />
          <div><strong>Forecast unavailable</strong><p>{data.insufficientHistoryMessage}</p></div>
        </div>
      )}

      <div className="panel forecast-rooms-panel">
        <PanelHeading title="Room usage share" subtitle="Per-room share of approved booked hours in the history window" />
        <p className="forecast-limitation">{data.utilizationDefinition} The schema does not store operating hours or occupancy, so this is a booked-hour share, not seat occupancy or schedule-capacity utilization.</p>
        {data.roomUsage.length ? (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead><tr><th>Room</th><th>Building</th><th>Type</th><th>Approved bookings</th><th>Booked hours</th><th>Booked-hour share</th></tr></thead>
              <tbody>{data.roomUsage.map((room) => <tr key={room.roomId}>
                <td><strong>{room.name}</strong></td><td>{room.building}</td><td>{room.type}</td>
                <td>{room.approvedBookings}</td><td>{room.bookedHours}</td><td>{room.utilizationPercent}%</td>
              </tr>)}</tbody>
            </table>
          </div>
        ) : <div className="analytics-empty">No rooms are available for usage reporting.</div>}
      </div>
    </section>
  );
}

function ForecastPattern({ title, subtitle, rows, emptyText }) {
  return (
    <section className="panel forecast-pattern">
      <PanelHeading title={title} subtitle={subtitle} />
      {rows.length ? <AnalyticsBars rows={rows} /> : <div className="analytics-empty">{emptyText || "No booking data."}</div>}
    </section>
  );
}

function ForecastDailyChart({ days }) {
  if (!days.length) return <div className="analytics-empty">No predictions available.</div>;
  const width = 760;
  const height = 190;
  const left = 44;
  const bottom = 35;
  const top = 12;
  const maxHours = Math.max(1, ...days.map((day) => day.hours));
  const plotHeight = height - top - bottom;
  const slot = (width - left - 12) / days.length;
  const barWidth = Math.min(44, slot * 0.56);
  return (
    <div className="forecast-chart-wrap">
      <svg className="forecast-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Predicted room usage hours for the next seven days">
        {[0, 0.5, 1].map((fraction) => {
          const y = top + plotHeight * (1 - fraction);
          return <g key={fraction}><line x1={left} y1={y} x2={width - 12} y2={y} stroke="#eceef3" /><text x={left - 8} y={y + 4} textAnchor="end">{(maxHours * fraction).toFixed(1)}</text></g>;
        })}
        {days.map((day, index) => {
          const barHeight = (day.hours / maxHours) * plotHeight;
          const x = left + index * slot + (slot - barWidth) / 2;
          const y = top + plotHeight - barHeight;
          return <g key={day.label}><rect x={x} y={y} width={barWidth} height={barHeight} fill="var(--tone-brand)" rx="3"><title>{`${day.label}: ${day.hours.toFixed(1)} predicted booked hours`}</title></rect><text x={x + barWidth / 2} y={height - 12} textAnchor="middle">{day.label}</text></g>;
        })}
      </svg>
    </div>
  );
}

function ForecastPeriod({ period }) {
  return <div className="forecast-period-row"><strong>{period.day} · {period.slot}</strong><span>{period.date}</span><em>{period.expectedBookedHours.toFixed(1)} predicted hrs</em></div>;
}

function RoomRecommendationPage({ token }) {
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  const [criteria, setCriteria] = useState({
    capacity: "",
    type: "Classroom",
    building: "",
    date: today,
    startTime: "09:00",
    endTime: "10:00",
  });
  const [recommendations, setRecommendations] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function updateCriteria(event) {
    setCriteria((values) => ({ ...values, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    setMessage("");
    setRecommendations(null);
    try {
      const query = new URLSearchParams({
        capacity: criteria.capacity,
        type: criteria.type,
        date: criteria.date,
        startTime: criteria.startTime,
        endTime: criteria.endTime,
      });
      if (criteria.building.trim()) query.set("building", criteria.building.trim());
      const result = await requestApi(`/rooms/recommendations?${query}`, token);
      setRecommendations(result.recommendations);
      setMessage(result.message || "");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="recommendation-layout">
      <form className="panel recommendation-form" onSubmit={handleSubmit}>
        <div className="panelhead">
          <div>
            <h2>What does your group need?</h2>
            <p>Recommendations use room capacity, type, location preference, and approved bookings.</p>
          </div>
        </div>
        <div className="recommendation-fields">
          <label>
            Required capacity
            <input name="capacity" type="number" min="1" max="10000" step="1" required value={criteria.capacity} onChange={updateCriteria} placeholder="e.g. 30" />
          </label>
          <label>
            Room type
            <select name="type" required value={criteria.type} onChange={updateCriteria}>
              {["Classroom", "Lecture Hall", "Laboratory", "Meeting Room", "Auditorium", "Other"].map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label>
            Building preference <span className="optional-label">Optional</span>
            <input name="building" maxLength="80" value={criteria.building} onChange={updateCriteria} placeholder="Any building" />
          </label>
          <label>
            Date
            <input name="date" type="date" min={today} required value={criteria.date} onChange={updateCriteria} />
          </label>
          <label>
            Start time
            <input name="startTime" type="time" required value={criteria.startTime} onChange={updateCriteria} />
          </label>
          <label>
            End time
            <input name="endTime" type="time" required value={criteria.endTime} onChange={updateCriteria} />
          </label>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary recommendation-submit" disabled={isLoading}>
          <Sparkles size={16} /> {isLoading ? "Finding rooms..." : "Find recommended rooms"}
        </button>
      </form>

      {recommendations !== null && (
        <section className="recommendation-results" aria-live="polite">
          <div className="recommendation-results-heading">
            <h2>Recommended rooms</h2>
            <span>{recommendations.length} available</span>
          </div>
          {recommendations.length ? (
            <div className="recommendation-cards">
              {recommendations.map((room, index) => (
                <article className="panel recommendation-card" key={room._id}>
                  <div className="recommendation-card-title">
                    <span className="recommendation-icon"><Building2 size={19} /></span>
                    <div>
                      <h3>{room.name}</h3>
                      <p>{room.building} · Floor {room.floor ?? 0}</p>
                    </div>
                    {index === 0 && <span className="best-fit">Best fit</span>}
                  </div>
                  <div className="recommendation-details">
                    <span><strong>{room.capacity}</strong> seats</span>
                    <span>{room.type}</span>
                    {room.capacityFit === 0 ? <span>Exact capacity fit</span> : <span>{room.capacityFit} extra {room.capacityFit === 1 ? "seat" : "seats"}</span>}
                    {room.preferredBuilding && <span className="preference-match">Preferred building</span>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="panel recommendation-empty">
              <AlertCircle size={21} />
              <p>{message || "No suitable room is available for this time slot. Try another date, time, or building."}</p>
            </div>
          )}
        </section>
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

function DashboardPage({ dashboard, isLoading, onNavigate }) {
  if (!isLoading && !dashboard.role) return <section className="panel empty-state" role="status">Dashboard data is unavailable. Reload the page to try again.</section>;
  const student = dashboard.role === "student";
  const faculty = dashboard.role === "faculty";
  const technician = dashboard.role === "technician";
  const classes = Array.isArray(dashboard.classes) ? dashboard.classes : [];
  const notices = dashboard.notices || dashboard.recentNotices || [];
  const cards = student
    ? [
        [
          "Enrolled classes",
          dashboard.classes?.length || 0,
          ClipboardCheck,
          "var(--tone-brand)",
        ],
        [
          "Attendance rate",
          `${dashboard.attendanceSummary?.percentage || 0}%`,
          CheckCircle2,
          "var(--tone-success)",
        ],
        [
          "Recent attendance",
          dashboard.attendance?.length || 0,
          CalendarDays,
          "var(--tone-warning)",
        ],
        ["Notices", dashboard.notices?.length || 0, Megaphone, "var(--tone-info)"],
      ]
    : faculty
      ? [
          [
            "Assigned classes",
            dashboard.classes?.length || 0,
            ClipboardCheck,
            "var(--tone-brand)",
          ],
          [
            "Class enrollments",
            classes.reduce(
              (count, campusClass) =>
                count + (campusClass.enrolledStudents?.length || 0),
              0,
            ),
            Users,
            "var(--tone-success)",
          ],
          [
            "Attendance marked today",
            dashboard.attendanceToday || 0,
            CheckCircle2,
            "var(--tone-warning)",
          ],
          [
            "Today's bookings",
            dashboard.bookings?.length || 0,
            CalendarDays,
            "var(--tone-info)",
          ],
        ]
      : technician
        ? [
            ["Assigned maintenance", dashboard.assignedMaintenance || 0, Wrench, "var(--tone-brand)"],
            ["Active issues", dashboard.activeIssues || 0, Clock3, "var(--tone-warning)"],
            ["Awaiting verification", dashboard.pendingVerification || 0, CheckCircle2, "var(--tone-success)"],
          ]
      : [
          ["Students", dashboard.students || 0, Users, "var(--tone-brand)"],
          ["Faculty", dashboard.faculty || 0, ClipboardCheck, "var(--tone-success)"],
          ["Rooms", dashboard.rooms || 0, DoorOpen, "var(--tone-info)"],
          ["Classes", dashboard.classes || 0, CalendarDays, "var(--tone-warning)"],
          ["Bookings", dashboard.bookings || 0, CalendarDays, "var(--tone-brand)"],
          ["Open complaints", dashboard.openComplaints || 0, MessageSquareWarning, "var(--tone-danger)"],
        ];

  return (
    <>
      <div className={`cards dashboard-cards dashboard-${dashboard.role || "loading"}`}>
        {isLoading ? Array.from({ length: dashboard.role === "admin" ? 6 : dashboard.role === "technician" ? 3 : 4 }, (_, index) => <div className="card card-skeleton" key={index}><i /><i /><i /></div>) : cards.map(([label, value, Icon, color]) => (
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
                  : technician
                    ? "Maintenance work"
                    : "Campus summary"
            }
            subtitle={student ? "Your classes and campus updates" : faculty ? "Your teaching schedule and campus activity" : technician ? "Current work assigned to you" : "Live totals from CampusOS records"}
          />
          {isLoading ? <div className="content-skeleton"><i /><i /><i /></div> : classes.length ? (
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
          ) : technician ? (
            <div className="dashboard-role-summary">
              <strong>{dashboard.assignedMaintenance ? `${dashboard.assignedMaintenance} assigned maintenance ${dashboard.assignedMaintenance === 1 ? "issue" : "issues"}` : "No maintenance issues are assigned to you."}</strong>
              <p>{dashboard.pendingVerification ? `${dashboard.pendingVerification} repair ${dashboard.pendingVerification === 1 ? "is" : "are"} awaiting faculty verification.` : "Assigned work and repair updates appear here."}</p>
            </div>
          ) : dashboard.role === "admin" ? (
            <div className="dashboard-role-summary">
              <strong>{dashboard.classes ? `${dashboard.classes} class records` : "No classes have been added yet."}</strong>
              <p>{dashboard.rooms} rooms, {dashboard.bookings} bookings and {dashboard.notices} notices recorded.</p>
            </div>
          ) : (
            <div className="empty">
              No classes are assigned to your account yet.
            </div>
          )}
          {technician ? (
            <button className="viewall" onClick={() => onNavigate("Complaints")}>
              View assigned complaints <ArrowUpRight size={15} />
            </button>
          ) : dashboard.role === "admin" ? (
            <button className="viewall" onClick={() => onNavigate("Classes")}>
              Manage classes <ArrowUpRight size={15} />
            </button>
          ) : null}
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
              <StatusBadge status={record.status} />
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
      <div className="card-icon" style={{ color, background: `color-mix(in srgb, ${color} 11%, white)` }}>
        <Icon size={19} />
      </div>
      <strong>
        {typeof value === "number" ? value.toLocaleString() : value}
      </strong>
      <small>{label}</small>
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status || "Unknown").toLowerCase().replaceAll(" ", "-");
  return <span className={`status-badge status-${normalized}`}>{status || "Unknown"}</span>;
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
  initialRecordId,
  records,
  totalRecords,
  onQueryChange,
  isLoading,
  searchText,
  onSearch,
  canEdit,
  onEdit,
  onDelete,
  onResolve,
  onBookingDecision,
  onBookingCancel,
  userId,
  userRole,
  technicians,
  canInspectRoom,
  onInspectRoom,
  onAssignComplaint,
  onUpdateWork,
  onVerifyRepair,
}) {
  const [filters, setFilters] = useState({ roomSearch: "", priority: "", status: "", assignee: "", building: "", operational: "", type: "", available: "", date: "" });
  const [sort, setSort] = useState({ column: "", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [recordId, setRecordId] = useState(initialRecordId || "");
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize));

  useEffect(() => { setCurrentPage(1); }, [page, searchText, filters]);
  useEffect(() => { if (currentPage > pageCount) setCurrentPage(pageCount); }, [currentPage, pageCount]);
  useEffect(() => {
    if (searchText.trim() || sort.column || Object.values(filters).some(Boolean)) setRecordId("");
  }, [searchText, sort, filters]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const query = { page: currentPage, limit: pageSize };
      if (recordId) query.recordId = recordId;
      if (searchText.trim()) query.search = searchText.trim();
      if (sort.column) {
        const sortFields = getServerSortFields(page);
        if (sortFields[sort.column]) {
          query.sort = sortFields[sort.column];
          query.direction = sort.direction;
        }
      }
      const filterFields = page === "Complaints"
        ? { roomSearch: "roomSearch", priority: "priority", status: "status", assignee: "assignee" }
        : page === "Room bookings"
          ? { status: "status", date: "date", roomSearch: "roomSearch" }
          : page === "Classrooms"
            ? { building: "building", operational: "operational", type: "type", available: "available" }
            : {};
      Object.entries(filterFields).forEach(([key, param]) => { if (filters[key]) query[param] = filters[key]; });
      onQueryChange(query);
    }, searchText.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [page, currentPage, recordId, searchText, sort, filters, onQueryChange]);

  function toggleSort(column) {
    setCurrentPage(1);
    setSort((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <div className="panel tablepanel">
      <PanelHeading title={page === "Complaints" ? "Central Maintenance Notice Board" : page} subtitle={`${totalRecords} records`}>
        <div className="resource-filters">
          <div className="filter"><Search size={16} /><input placeholder={`Filter ${page.toLowerCase()}`} value={searchText} onChange={(event) => onSearch(event.target.value)} /></div>
          {page === "Complaints" && <div className="maintenance-filters">
            <input aria-label="Filter by room or building" placeholder="Room or building" value={filters.roomSearch} onChange={(event) => setFilters((value) => ({ ...value, roomSearch: event.target.value }))} />
            <select aria-label="Filter by priority" value={filters.priority} onChange={(event) => setFilters((value) => ({ ...value, priority: event.target.value }))}>
              <option value="">All priorities</option>{["Low", "Normal", "High", "Urgent"].map((priority) => <option key={priority}>{priority}</option>)}
            </select>
            <select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}>
              <option value="">All statuses</option>{["Open", "In progress", "Pending Verification", "Resolved", "Closed"].map((status) => <option key={status}>{status}</option>)}
            </select>
            {userRole === "admin" && <select aria-label="Filter by assignee" value={filters.assignee} onChange={(event) => setFilters((value) => ({ ...value, assignee: event.target.value }))}>
              <option value="">All assignees</option><option value="unassigned">Unassigned</option>{technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
            </select>}
          </div>}
          {page === "Room bookings" && <div className="maintenance-filters"><select aria-label="Filter bookings by status" value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}>
            <option value="">All statuses</option>{["Pending", "Approved", "Rejected", "Cancelled"].map((status) => <option key={status}>{status}</option>)}
          </select><input aria-label="Filter bookings by date" type="date" value={filters.date} onChange={(event) => setFilters((value) => ({ ...value, date: event.target.value }))} /><input aria-label="Filter bookings by room or building" placeholder="Room or building" value={filters.roomSearch} onChange={(event) => setFilters((value) => ({ ...value, roomSearch: event.target.value }))} /></div>}
          {page === "Classrooms" && <div className="maintenance-filters">
            <input aria-label="Filter rooms by building" placeholder="Building" value={filters.building} onChange={(event) => setFilters((value) => ({ ...value, building: event.target.value }))} />
            <select aria-label="Filter rooms by inspection status" value={filters.operational} onChange={(event) => setFilters((value) => ({ ...value, operational: event.target.value }))}><option value="">All inspection statuses</option>{["Operational", "Maintenance required", "Not inspected"].map((status) => <option key={status}>{status}</option>)}</select>
            <select aria-label="Filter rooms by type" value={filters.type} onChange={(event) => setFilters((value) => ({ ...value, type: event.target.value }))}><option value="">All room types</option>{ROOM_TYPES.map((type) => <option key={type}>{type}</option>)}</select>
            <select aria-label="Filter rooms by availability" value={filters.available} onChange={(event) => setFilters((value) => ({ ...value, available: event.target.value }))}><option value="">Any availability</option><option value="true">Available</option><option value="false">Unavailable</option></select>
          </div>}
        </div>
      </PanelHeading>

      <div className="tablewrap" role="region" aria-label={`${page} table; scroll horizontally to see more columns`} tabIndex={0}>
        <table>
          <TableHeader page={page} sort={sort} onSort={toggleSort} />
          <tbody>
            {records.map((record, index) => (
              <ResourceRow
                key={record._id || index}
                page={page}
                record={record}
                canEdit={canEdit}
                onEdit={onEdit}
                onDelete={onDelete}
                onResolve={onResolve}
                onBookingDecision={onBookingDecision}
                onBookingCancel={onBookingCancel}
                userId={userId}
                userRole={userRole}
                technicians={technicians}
                canInspectRoom={canInspectRoom}
                onInspectRoom={onInspectRoom}
                onAssignComplaint={onAssignComplaint}
                onUpdateWork={onUpdateWork}
                onVerifyRepair={onVerifyRepair}
              />
            ))}
          </tbody>
        </table>

        {isLoading ? (
          <div className="table-skeleton" aria-label={`Loading ${page.toLowerCase()}`}>
            {Array.from({ length: 5 }, (_, index) => <div className="table-skeleton-row" key={index}><i /><i /><i /><i /></div>)}
          </div>
        ) : (
          records.length === 0 && (
            <div className="empty">
              <AlertCircle size={20} />
              <span>{totalRecords === 0 ? "No records found for these filters." : "No records on this page."}</span>
            </div>
          )
        )}
      </div>
      {!isLoading && totalRecords > 0 && <div className="table-pagination">
        <span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalRecords)} of {totalRecords}</span>
        <div><button className="secondary" disabled={currentPage === 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="secondary" disabled={currentPage >= pageCount} onClick={() => setCurrentPage((value) => Math.min(pageCount, value + 1))}>Next</button></div>
      </div>}
    </div>
  );
}

function getTableSortValue(page, column, record) {
  const values = {
    "Activity history": {
      Actor: record.actor?.name, Record: record.entityType, Action: record.action, Details: record.summary, Date: record.createdAt,
    },
    "Room bookings": {
      "Room / inspection": record.room?.name, Date: record.date, Time: record.startTime, Purpose: record.purpose, "Booked by": record.bookedBy?.name, Status: record.status,
    },
    Complaints: {
      Issue: record.title, "Room / equipment": record.room?.name, Priority: record.priority, Status: record.status, "Reported by": record.submittedBy?.name, Assignee: record.assignedTo?.name, "Date / history": record.createdAt,
    },
    Classrooms: {
      "Room number": record.name, Building: record.building, Floor: record.floor, Type: record.type, Capacity: record.capacity, Availability: record.available, "Inspection status": record.operationalStatus,
    },
    Students: { Student: record.name, "Student ID": record.studentId, Department: record.department, Email: record.email },
    Faculty: { Faculty: record.name, Department: record.department, Email: record.email },
    Classes: { Course: record.courseName, "Code / section": record.courseCode, Faculty: record.faculty?.name, Schedule: record.day, Enrollment: record.enrolledStudents?.length },
    Notices: { Notice: record.title, Category: record.category, Published: record.createdAt },
    Technicians: { Technician: record.name, Role: record.role, Created: record.createdAt },
    Attendance: { Student: record.student?.name, Date: record.date, Status: record.status },
  };
  return values[page]?.[column] ?? record[column.toLowerCase()];
}

function getServerSortFields(page) {
  const fields = {
    "Activity history": { Actor: "createdAt", Record: "entityType", Action: "action", Date: "createdAt" },
    Students: { Student: "name", "Student ID": "studentId", Department: "department", Email: "email" },
    Faculty: { Faculty: "name", Department: "department", Email: "email" },
    Technicians: { Technician: "name", Created: "createdAt" },
    Classes: { Course: "courseName", "Code / section": "courseCode", Schedule: "day" },
    Attendance: { Date: "date", Status: "status" },
    Classrooms: { "Room number": "name", Building: "building", Floor: "floor", Type: "type", Capacity: "capacity", Availability: "available" },
    "Room bookings": { Date: "date", Time: "startTime", Purpose: "purpose", Status: "status" },
    Notices: { Notice: "title", Category: "category", Published: "createdAt" },
    Complaints: { Issue: "title", Priority: "priority", Status: "status", "Date / history": "createdAt" },
  };
  return fields[page] || {};
}

function MaintenanceRow({ record, userRole, canEdit, technicians, onResolve, onAssign, onUpdateWork, onVerify }) {
  const [showWorkForm, setShowWorkForm] = useState(false);
  const [note, setNote] = useState("");
  const [resolutionDetails, setResolutionDetails] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const isFacility = Boolean(record.room);

  async function submitWork(status) {
    if (!note.trim()) { setActionError("Add a short work update."); return; }
    if (status === "Pending Verification" && !resolutionDetails.trim()) { setActionError("Add resolution details before submitting for verification."); return; }
    const evidence = evidenceText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean);
    if (status === "Pending Verification" && evidence.length === 0) { setActionError("Add at least one evidence link before requesting verification."); return; }
    setSaving(true);
    setActionError("");
    try {
      await onUpdateWork(record, {
        status,
        note,
        resolutionDetails,
        evidence,
      });
      setShowWorkForm(false);
    } catch (error) { setActionError(error.message); }
    finally { setSaving(false); }
  }

  async function verify(decision) {
    if (decision === "reject" && !verificationNote.trim()) { setActionError("Add a reason before rejecting the repair."); return; }
    setSaving(true);
    setActionError("");
    try { await onVerify(record, decision, verificationNote); }
    catch (error) { setActionError(error.message); }
    finally { setSaving(false); }
  }

  async function assignTechnician(technicianId) {
    if (saving) return;
    setSaving(true);
    setActionError("");
    try { await onAssign(record, technicianId); }
    catch (error) { setActionError(error.message); }
    finally { setSaving(false); }
  }

  async function resolveGeneralComplaint() {
    if (saving) return;
    setSaving(true);
    setActionError("");
    try { await onResolve(record); }
    catch (error) { setActionError(error.message); }
    finally { setSaving(false); }
  }

  const history = record.history || [];
  return (
    <tr className="maintenance-row">
      <td><strong>{record.title}</strong><small>{record.description}</small></td>
      <td>{record.room ? `${record.room.name} · ${record.room.building}` : "General complaint"}<small>{record.equipment || record.category}</small></td>
      <td><span className={`priority-chip ${String(record.priority || "Normal").toLowerCase()}`}>{record.priority || "Normal"}</span></td>
      <td><StatusBadge status={record.status || "Open"} /></td>
      <td>{record.submittedBy?.name || "—"}</td>
      <td>
        {canEdit && isFacility ? (
          <select aria-label={`Assign ${record.title}`} disabled={saving || ["Closed", "Resolved"].includes(record.status)} value={record.assignedTo?._id || ""} onChange={(event) => assignTechnician(event.target.value)}>
            <option value="">Unassigned</option>
            {technicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
          </select>
        ) : record.assignedTo?.name || "—"}
      </td>
      <td>
        {new Date(record.createdAt).toLocaleDateString()}
        <details className="complaint-history">
          <summary>History ({history.length})</summary>
          {record.verifiedAt && <p><strong>Verified by:</strong> {record.verifiedBy?.name || "Faculty"} · {new Date(record.verifiedAt).toLocaleString()}</p>}
          {record.resolutionDetails && <p><strong>Resolution:</strong> {record.resolutionDetails}</p>}
          {record.resolutionEvidence?.map((url, index) => <p key={`${url}-${index}`}><strong>Evidence:</strong> {url}</p>)}
          {history.map((item) => <div className="complaint-history-item" key={item._id || `${item.action}-${item.createdAt}`}>
            <strong>{item.action}</strong><small>{item.actor?.name || "User"} · {new Date(item.createdAt).toLocaleString()}</small>
            {item.note && <p>{item.note}</p>}
            {item.evidence?.map((url, index) => <small key={`${url}-${index}`}>Evidence: {url}</small>)}
          </div>)}
        </details>
      </td>
      <td className="maintenance-actions">
        {userRole === "technician" && isFacility && ["Open", "In progress"].includes(record.status) && (
          <>
            {!showWorkForm ? <button className="table-action" onClick={() => setShowWorkForm(true)}>Update work</button> : (
              <div className="work-update-form">
                <textarea placeholder="Work update" value={note} onChange={(event) => setNote(event.target.value)} />
                <textarea placeholder="Resolution details (required to submit for verification)" value={resolutionDetails} onChange={(event) => setResolutionDetails(event.target.value)} />
                <textarea placeholder="Evidence links, one per line (required for verification)" value={evidenceText} onChange={(event) => setEvidenceText(event.target.value)} />
                <button className="table-action" disabled={saving} onClick={() => submitWork("In progress")}>Save progress</button>
                <button className="table-action" disabled={saving} onClick={() => submitWork("Pending Verification")}>Submit for verification</button>
                <button className="table-action" onClick={() => setShowWorkForm(false)}>Cancel</button>
              </div>
            )}
          </>
        )}
        {userRole === "faculty" && isFacility && record.status === "Pending Verification" && (
          <div className="verification-actions">
            <textarea placeholder="Verification note / rejection reason" value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} />
            <button className="table-action" disabled={saving} onClick={() => verify("accept")}>Accept repair</button>
            <button className="table-action danger" disabled={saving} onClick={() => verify("reject")}>Reject</button>
          </div>
        )}
        {canEdit && !isFacility && record.status !== "Resolved" && <button className="table-action" disabled={saving} onClick={resolveGeneralComplaint}>{saving ? "Saving…" : "Mark resolved"}</button>}
        {actionError && <small className="inline-action-error">{actionError}</small>}
      </td>
    </tr>
  );
}

function RoomInspectionModal({ room, token, onClose, onSaved }) {
  const types = ["Fan", "AC", "Projector", "Light"];
  const [equipment, setEquipment] = useState(() => types.map((type) => {
    const current = room.equipment?.find((item) => item.type === type);
    return { type, status: current?.status || "Working", note: current?.note || "" };
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function updateItem(type, field, value) {
    setEquipment((items) => items.map((item) => item.type === type ? { ...item, [field]: value } : item));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await requestApi(`/rooms/${room._id}/inspection`, token, { method: "PATCH", body: JSON.stringify({ equipment }) });
      await onSaved();
    } catch (requestError) { setError(requestError.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal inspection-modal" onSubmit={submit}>
        <div className="modalhead"><h2>Inspect {room.name} · {room.building}</h2><button type="button" onClick={onClose} aria-label="Close inspection">×</button></div>
        <p className="inspection-help">Record the current condition for every critical facility. Fault reports remain on maintenance hold until faculty accepts the repair.</p>
        {error && <div className="error">{error}</div>}
        {equipment.map((item) => <div className="inspection-item" key={item.type}>
          <strong>{item.type}</strong>
          <select aria-label={`${item.type} condition`} value={item.status} onChange={(event) => updateItem(item.type, "status", event.target.value)}>
            {["Working", "Not Working", "Needs Maintenance"].map((status) => <option key={status}>{status}</option>)}
          </select>
          <input maxLength="500" placeholder="Inspection note (optional)" value={item.note} onChange={(event) => updateItem(item.type, "note", event.target.value)} />
        </div>)}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save inspection"}</button></div>
      </form>
    </div>
  );
}

function TableHeader({ page, sort, onSort }) {
  const sortableFields = getServerSortFields(page);
  const columnSets = {
    "Activity history": ["Actor", "Record", "Action", "Details", "Date"],
    Students: [
      "Student",
      "Student ID",
      "Department",
      "Email",
      "Role",
      "Actions",
    ],
    Faculty: ["Faculty", "Department", "Email", "Actions"],
    Classes: [
      "Course",
      "Code / section",
      "Faculty",
      "Room / inspection",
      "Schedule",
      "Enrollment",
      "Actions",
    ],
    Attendance: ["Student", "Date", "Status"],
    Classrooms: ["Room number", "Building", "Floor", "Type", "Capacity", "Availability", "Inspection status", "Equipment", "Actions"],
    "Room bookings": [
      "Room / inspection",
      "Date",
      "Time",
      "Purpose",
      "Booked by",
      "Status",
      "Actions",
    ],
    Notices: ["Notice", "Category", "Published", "Actions"],
    Complaints: [
      "Issue",
      "Room / equipment",
      "Priority",
      "Status",
      "Reported by",
      "Assignee",
      "Date / history",
      "Actions",
    ],
    Technicians: ["Technician", "Role", "Created"],
  };

  return (
    <thead>
      <tr>
        {columnSets[page].map((column) => (
          <th key={column} aria-sort={sort.column === column ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="sort-heading" aria-label={`Sort by ${column}`} disabled={!sortableFields[column]} onClick={() => onSort(column)}>{column}{sort.column === column ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
        ))}
      </tr>
    </thead>
  );
}

function ResourceRow({ page, record, canEdit, onEdit, onDelete, onResolve, onBookingDecision, onBookingCancel, userId, userRole, technicians, canInspectRoom, onInspectRoom, onAssignComplaint, onUpdateWork, onVerifyRepair }) {
  const [actionBusy, setActionBusy] = useState("");
  async function runBookingAction(action, actionName) {
    if (actionBusy) return;
    setActionBusy(actionName);
    try { await action(); }
    finally { setActionBusy(""); }
  }
  if (page === "Activity history") {
    return <tr><td><strong>{record.actor?.name || "CampusOS"}</strong><small>{record.actor?.role || "System"}</small></td><td><span className="entity-chip">{record.entityType}</span></td><td>{record.action}</td><td>{record.summary}</td><td>{new Date(record.createdAt).toLocaleString()}</td></tr>;
  }
  if (page === "Technicians") {
    return <tr><td><strong>{record.name}</strong></td><td>Technician</td><td>{new Date(record.createdAt).toLocaleDateString()}</td></tr>;
  }

  if (page === "Complaints") {
    return <MaintenanceRow record={record} userRole={userRole} canEdit={canEdit} technicians={technicians} onResolve={onResolve} onAssign={onAssignComplaint} onUpdateWork={onUpdateWork} onVerify={onVerifyRepair} />;
  }
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
        <td>{record.room?.name || "—"}<small>{record.room?.operationalStatus || ""}</small></td>
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
          <span className="entity-chip">Student</span>
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
          <StatusBadge status={record.status} />
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
        <td>{record.floor ?? 0}</td>
        <td>{record.type}</td>
        <td>{record.capacity}</td>
        <td>
          <StatusBadge status={record.available ? "Available" : "Unavailable"} />
        </td>
        <td><StatusBadge status={record.operationalStatus || "Not inspected"} /></td>
        <td>{(record.equipment || []).map((item) => <small key={item.type}>{item.type}: {item.status}</small>)}</td>
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
          {canInspectRoom && <button className="table-action" onClick={() => onInspectRoom(record)}>Inspect</button>}
        </td>
      </tr>
    );
  }

  if (page === "Room bookings") {
    return (
      <tr>
        <td>{record.room?.name}<small>{record.room?.operationalStatus || "Not inspected"}</small></td>
        <td>{record.date}</td>
        <td>
          {record.startTime}–{record.endTime}
        </td>
        <td>{record.purpose}</td>
        <td>{record.bookedBy?.name}</td>
        <td><StatusBadge status={record.status || "Pending"} /></td>
        <td>
          {canEdit && record.status === "Pending" && (
            <>
              <button className="table-action" disabled={Boolean(actionBusy)} onClick={() => runBookingAction(() => onBookingDecision(record, "Approved"), "approve")}>
                {actionBusy === "approve" ? "Approving…" : "Approve"}
              </button>
              <button
                className="table-action danger"
                disabled={Boolean(actionBusy)}
                onClick={() => runBookingAction(() => onBookingDecision(record, "Rejected"), "reject")}
              >
                {actionBusy === "reject" ? "Rejecting…" : "Reject"}
              </button>
            </>
          )}
          {String(record.bookedBy?._id) === String(userId) && ["Pending", "Approved"].includes(record.status) && (
            <button className="table-action danger" disabled={Boolean(actionBusy)} onClick={() => runBookingAction(() => onBookingCancel(record), "cancel")}>{actionBusy === "cancel" ? "Cancelling…" : "Cancel"}</button>
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

    try {
      const action = isRegistering ? "register" : "login";
      const response = await fetch(`${API_URL}/auth/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRegistering
          ? { ...formValues, role: "student" }
          : { email: formValues.email, password: formValues.password }),
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
            minLength={isRegistering ? 12 : undefined}
            maxLength="72"
            type="password"
            placeholder={isRegistering ? "At least 12 characters" : "Your password"}
            onChange={updateField}
          />
        </label>

        {isRegistering && (
          <>
            <small className="auth-role-note">Student accounts can self-register. Faculty, technician, and administrator accounts are provisioned by campus administrators.</small>
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
    Technicians: "technician",
    Classes: "class",
    Classrooms: "room",
    "Room bookings": "booking",
    Notices: "notice",
    Complaints: "complaint",
  };

  return labels[page] || "record";
}

function canCreateResource(page, userRole) {
  if (["Students", "Faculty", "Technicians", "Classes", "Classrooms"].includes(page)) {
    return userRole === "admin";
  }

  if (page === "Room bookings") return ["admin", "faculty", "student"].includes(userRole);

  if (page === "Attendance" || page === "Notices") {
    return userRole === "admin" || userRole === "faculty";
  }

  return page === "Complaints";
}

function getFormFields(page) {
  const fieldsByPage = {
    Students: [
      ["name", "Full name"],
      ["email", "Email"],
      ["password", "Temporary password (12+ characters)"],
      ["studentId", "Student ID"],
      ["department", "Department"],
    ],
    Technicians: [
      ["name", "Technician name"],
      ["email", "Email"],
      ["password", "Temporary password (12+ characters)"],
    ],
    Classrooms: [
      ["name", "Room number"],
      ["building", "Building"],
      ["floor", "Floor"],
      ["type", "Room type"],
      ["capacity", "Capacity"],
      ["available", "Availability"],
    ],
    Faculty: [
      ["name", "Full name"],
      ["email", "Email"],
      ["password", "Temporary password (12+ characters)"],
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
      ["room", "Room (optional; choose for a facility issue)"],
      ["equipment", "Faulty equipment"],
      ["priority", "Priority"],
    ],
    "Room bookings": [
      ["room", "Room"],
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
    if (!initialRecord) return page === "Classrooms" ? { type: ROOM_TYPES[0] } : {};
    return {
      ...initialRecord,
      type: page === "Classrooms" && !ROOM_TYPES.includes(initialRecord.type) ? "" : initialRecord.type,
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
        if (page === "Complaints") setRooms(await requestApi("/rooms", token));
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
          : ["maxEnrollment", "capacity", "floor"].includes(name)
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
      const payload = Object.fromEntries(fields
        .filter(([name]) => Object.hasOwn(formValues, name))
        .map(([name]) => [name, formValues[name]]));
      await onSubmit({
        ...payload,
        ...(page === "Classrooms" ? { capacity: Number(formValues.capacity) || 30 } : {}),
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
            {name === "type" ? (
              <select name={name} required value={formValues[name] || ""} onChange={updateField}>
                <option value="" disabled>Select room type</option>
                {ROOM_TYPES.map((roomType) => <option key={roomType} value={roomType}>{roomType}</option>)}
              </select>
            ) : name === "day" ? (
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
                required={name !== "room"}
                value={formValues[name] || ""}
                onChange={updateField}
              >
                <option value="">{name === "room" ? "General complaint (no room)" : `Select ${label.toLowerCase()}`}</option>
                {(name === "faculty"
                  ? faculty
                  : name === "room"
                    ? rooms
                    : name === "campusClass"
                      ? classes
                      : students
                ).map((option) => (
                  <option
                    key={option._id}
                    value={option._id}
                    disabled={name === "room" && page === "Room bookings" && !option.available}
                  >
                    {name === "room"
                      ? `${option.building} · ${option.name} · ${option.operationalStatus || "Not inspected"}${option.available ? "" : " · Unavailable"}`
                      : option.name ||
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
            ) : name === "equipment" ? (
              <select name={name} required={Boolean(formValues.room)} value={formValues[name] || ""} onChange={updateField} disabled={!formValues.room}>
                <option value="">Select equipment</option>{["Fan", "AC", "Projector", "Light"].map((item) => <option key={item}>{item}</option>)}
              </select>
            ) : name === "priority" ? (
              <select name={name} value={formValues[name] || "Normal"} onChange={updateField}>
                {["Low", "Normal", "High", "Urgent"].map((priority) => <option key={priority}>{priority}</option>)}
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
            ) : name === "available" ? (
              <select name={name} value={formValues[name] ?? true} onChange={(event) => setFormValues((values) => ({ ...values, available: event.target.value === "true" }))}>
                <option value="true">Available</option>
                <option value="false">Unavailable</option>
              </select>
            ) : ["body", "description", "purpose"].includes(name) ? (
              <textarea name={name} required rows="3" onChange={updateField} />
            ) : (
              <input
                name={name}
                required={name !== "password" || !initialRecord}
                type={getInputType(name)}
                value={formValues[name] ?? (name === "maxEnrollment" ? 60 : "")}
                minLength={name === "password" ? 12 : undefined}
                maxLength={name === "password" ? 72 : name === "purpose" ? 500 : undefined}
                min={
                  name === "date"
                    ? new Date().toISOString().slice(0, 10)
                    : name === "capacity" || name === "maxEnrollment"
                      ? 1
                      : name === "floor"
                        ? 0
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
  if (fieldName === "date") return "date";
  if (fieldName === "email") return "email";
  if (["startTime", "endTime"].includes(fieldName)) return "time";

  if (["capacity", "floor"].includes(fieldName)) {
    return "number";
  }

  if (fieldName === "password") {
    return "password";
  }

  return "text";
}

export default App;
