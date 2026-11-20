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

  const responseText = await response.text();
  let responseData;
  try {
    responseData = responseText ? JSON.parse(responseText) : null;
  } catch {
    const contentType = response.headers.get("content-type") || "unknown content type";
    const error = new Error(
      response.ok
        ? `The server returned a non-JSON response for ${path} (${contentType}). Check the API URL and server response.`
        : `Request failed with status ${response.status} (${contentType}).`,
    );
    error.status = response.status;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(responseData?.message || `Request failed with status ${response.status}.`);
    error.status = response.status;
    throw error;
  }

  if (!withMeta) return responseData;

  const listPayload = getListPayload(responseData);
  if (!listPayload) {
    const received = responseData && typeof responseData === "object"
      ? Array.isArray(responseData) ? "an array" : `an object with keys: ${Object.keys(responseData).slice(0, 8).join(", ") || "none"}`
      : `${responseData === null ? "an empty body" : typeof responseData}`;
    const error = new Error(
      `The server returned an unexpected list response for ${path}; expected an array or a supported list envelope, received ${received}.`,
    );
    error.name = "InvalidListResponseError";
    throw error;
  }
  const records = requireRecordArray(listPayload.records, "List");

  const embeddedPagination = listPayload.pagination || {};
  const headerNumber = (name, fallback) => {
    const value = response.headers.get(name);
    if (value === null) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const total = headerNumber(
    "X-Total-Count",
    Number(embeddedPagination.total ?? embeddedPagination.totalCount) || records.length,
  );
  const page = headerNumber(
    "X-Page",
    Number(embeddedPagination.page) || 1,
  );
  const pageSize = headerNumber(
    "X-Page-Size",
    Number(embeddedPagination.pageSize ?? embeddedPagination.limit) || records.length,
  );
  return {
    data: records,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: headerNumber(
        "X-Total-Pages",
        Number(embeddedPagination.totalPages) || (pageSize ? Math.ceil(total / pageSize) : 0),
      ),
    },
  };
}

function getListPayload(payload) {
  if (Array.isArray(payload)) return { records: payload, pagination: {} };
  if (!payload || typeof payload !== "object") return null;

  // The CampusOS API returns arrays directly. The recursive envelope support
  // covers clients/proxies that wrap that response in data/result/resource keys.
  // It deliberately searches only known list and wrapper fields; arbitrary
  // object arrays (for example dashboard widgets) are not treated as records.
  const collectionKeys = new Set([
    "data", "records", "items", "results", "students", "faculty", "technicians",
    "classes", "attendance", "rooms", "bookings", "notices", "complaints",
    "activities", "notifications",
  ]);
  const wrapperKeys = new Set(["response", "result", "payload"]);
  const findRecords = (value, depth = 0) => {
    if (Array.isArray(value)) return { records: value, pagination: {} };
    if (!value || typeof value !== "object" || depth > 4) return null;
    const pagination = value.pagination || value.meta?.pagination || value.meta || {};
    for (const key of collectionKeys) {
      if (Array.isArray(value[key])) return { records: value[key], pagination };
    }
    for (const key of [...collectionKeys, ...wrapperKeys]) {
      const found = findRecords(value[key], depth + 1);
      if (found) {
        return {
          records: found.records,
          pagination: Object.keys(found.pagination || {}).length ? found.pagination : pagination,
        };
      }
    }
    return null;
  };
  return findRecords(payload);
}

function requireRecordArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
    throw new Error(`${label} response is invalid. Refresh the page or contact support.`);
  }
  return value;
}

async function requestList(path, token, options = {}) {
  const payload = await requestApi(path, token, options);
  const listPayload = getListPayload(payload);
  if (!listPayload) throw new Error(`${path} returned an unexpected list response.`);
  return requireRecordArray(listPayload.records, path);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} response is invalid. Refresh the page or contact support.`);
  }
  return value;
}

function normalizeDashboardPayload(payload) {
  const dashboard = requireObject(payload, "Dashboard");
  const roleLists = {
    student: ["classes", "attendance", "notices"],
    faculty: ["classes", "bookings", "notices"],
    admin: ["recentNotices", "buildingSummaries", "maintenanceAlerts", "recentActivity"],
    technician: [],
  };
  if (!Object.hasOwn(roleLists, dashboard.role)) throw new Error("Dashboard response has an unsupported role.");
  for (const field of roleLists[dashboard.role]) {
    requireRecordArray(dashboard[field], `Dashboard ${field}`);
  }
  return dashboard;
}

function normalizeAnalyticsPayload(payload) {
  const analytics = requireObject(payload, "Analytics");
  for (const field of ["totals", "bookings", "complaints", "attendance"]) requireObject(analytics[field], `Analytics ${field}`);
  requireRecordArray(analytics.bookingTrend, "Analytics booking trend");
  requireRecordArray(analytics.roomUsage, "Analytics room usage");
  for (const field of ["departmentDistribution", "yearSemesterDistribution", "enrollmentTrend"]) requireRecordArray(analytics.students?.[field], `Student analytics ${field}`);
  for (const field of ["dailyTrend", "weeklyTrend", "monthlyTrend"]) requireRecordArray(analytics.attendance?.[field], `Attendance analytics ${field}`);
  for (const field of ["dailyTrend", "weeklyTrend", "monthlyTrend", "buildingDistribution", "peakHours", "peakDays"]) requireRecordArray(analytics.bookingAnalytics?.[field], `Booking analytics ${field}`);
  for (const field of ["byBuilding", "equipmentFaults"]) requireRecordArray(analytics.rooms?.[field], `Room analytics ${field}`);
  for (const field of ["byBuilding", "byPriority", "trend", "technicianWorkload"]) requireRecordArray(analytics.complaints?.[field], `Complaint analytics ${field}`);
  return analytics;
}

function normalizeForecastPayload(payload) {
  const forecast = requireObject(payload, "Room forecast");
  requireObject(forecast.history, "Room forecast history");
  requireObject(forecast.forecast, "Room forecast prediction");
  const patterns = requireObject(forecast.historicalPatterns, "Historical patterns");
  for (const field of ["weekdays", "timeSlots", "buildings", "roomTypes"]) requireRecordArray(patterns[field], `Historical ${field}`);
  const periods = requireRecordArray(forecast.forecast.periods, "Forecast periods");
  if (periods.some((period) => typeof period.date !== "string" || typeof period.day !== "string" || typeof period.slot !== "string" || !Number.isFinite(period.expectedBookedHours))) {
    throw new Error("Forecast period data is invalid. Refresh the page or contact support.");
  }
  requireRecordArray(forecast.roomUsage, "Forecast room usage");
  return forecast;
}

function normalizeRecommendationPayload(payload) {
  const result = requireObject(payload, "Room recommendation");
  requireRecordArray(result.recommendations, "Room recommendations");
  return result;
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || "");
  const [user, setUser] = useState(null);
  const [sessionReady, setSessionReady] = useState(
    !localStorage.getItem("token"),
  );
  const [page, setPage] = useState("Overview");
  const [dashboard, setDashboard] = useState({});
  const [dashboardError, setDashboardError] = useState("");
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [listError, setListError] = useState("");
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
  const [logoutMessage, setLogoutMessage] = useState("");
  const [analyticsReturn, setAnalyticsReturn] = useState(false);
  const activeListRequest = useRef(null);
  const dashboardRefreshRequest = useRef(null);
  const logoutPending = useRef(false);

  useEffect(() => {
    const clearRestoredSession = () => {
      if (localStorage.getItem("token")) return;
      setToken("");
      setUser(null);
      setSessionReady(true);
      setDashboard({});
      setDashboardError("");
      setRecords([]);
      setTotalRecords(0);
      setListError("");
      setListQuery({ page: 1, limit: 10 });
      setSearchText("");
      setTechnicians([]);
      setNotificationTarget(null);
      setAnalyticsReturn(false);
      setPage("Overview");
      setErrorMessage("");
      setSuccessMessage("");
      setIsModalOpen(false);
      setEditingRecord(null);
      setInspectionRoom(null);
      setPendingDelete(null);
      activeListRequest.current?.abort();
      activeListRequest.current = null;
      dashboardRefreshRequest.current = null;
    };
    window.addEventListener("pageshow", clearRestoredSession);
    window.addEventListener("storage", clearRestoredSession);
    return () => {
      window.removeEventListener("pageshow", clearRestoredSession);
      window.removeEventListener("storage", clearRestoredSession);
    };
  }, []);
  const refreshDashboard = useCallback(async ({ afterMutation = false } = {}) => {
    if (!token) return;
    const current = dashboardRefreshRequest.current;
    if (current?.token === token) {
      if (afterMutation) current.refreshAgain = true;
      return current.promise;
    }

    const request = { token, refreshAgain: false, promise: null };
    dashboardRefreshRequest.current = request;
    request.promise = (async () => {
      try {
        do {
          request.refreshAgain = false;
          setIsDashboardLoading(true);
          try {
            const result = normalizeDashboardPayload(await requestApi("/dashboard", token));
            if (dashboardRefreshRequest.current === request) {
              setDashboard(result);
              setDashboardError("");
            }
          } catch (error) {
            if (dashboardRefreshRequest.current === request) setDashboardError(error.message || "Unable to load dashboard data.");
          }
        } while (request.refreshAgain && dashboardRefreshRequest.current === request);
      } finally {
        if (dashboardRefreshRequest.current === request) {
          dashboardRefreshRequest.current = null;
          setIsDashboardLoading(false);
        }
      }
    })();
    return request.promise;
  }, [token]);
  const searchTechnicians = useCallback(async (search) => {
    const params = new URLSearchParams({ page: "1", limit: "25" });
    if (search.trim()) params.set("search", search.trim());
    return requestList(`/admin/users/technicians?${params}`, token);
  }, [token]);
  const handleListQueryChange = useCallback((query) => setListQuery(query), []);
  const navigateToPage = useCallback((nextPage) => {
    setAnalyticsReturn(false);
    setNotificationTarget(null);
    setListQuery({ page: 1, limit: 10 });
    setSearchText("");
    setPage(nextPage);
  }, []);
  const navigateToFilteredPage = useCallback((nextPage, query) => {
    setAnalyticsReturn(true);
    setNotificationTarget(null);
    setSearchText("");
    setPage(nextPage);
    setListQuery({ page: 1, limit: 10, ...query });
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

    let active = true;
    setSessionReady(false);
    requestApi("/auth/profile", token)
      .then((result) => {
        if (!active) return;
        const currentUser = requireObject(result?.user, "Profile user");
        if (!currentUser.id || !["admin", "faculty", "student", "technician"].includes(currentUser.role)) {
          throw new Error("Profile response is missing a valid account identity or role.");
        }
        setUser(currentUser);
        localStorage.setItem("user", JSON.stringify(currentUser));
      })
      .catch((error) => {
        if (!active) return;
        if (error.status === 401) {
          clearLocalSession();
        } else {
          try {
            const cachedUser = JSON.parse(localStorage.getItem("user") || "null");
            if (cachedUser && active) setUser(cachedUser);
          } catch {
            localStorage.removeItem("user");
          }
          setErrorMessage(error.message);
        }
      })
      .finally(() => { if (active) setSessionReady(true); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (token) void refreshDashboard();
  }, [token, refreshDashboard]);

  useEffect(() => {
    if (!token || page !== "Overview") return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshDashboard();
    };
    const interval = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [token, page, refreshDashboard]);

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
      requestList("/admin/users/technicians?page=1&limit=25", token)
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
      setListError("");
      setIsLoading(false);
      if (activeListRequest.current === controller) activeListRequest.current = null;
      return;
    }

    setIsLoading(true);
    setListError("");
    setRecords([]);
    try {
      const params = new URLSearchParams();
      Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") params.set(key, value);
      });
      const result = await requestApi(`${endpoint}?${params.toString()}`, token, { signal, withMeta: true });
      // An aborted request may still settle while a newer request is in flight.
      // Only the currently active request may update list data or pagination.
      if (signal.aborted || activeListRequest.current !== controller) return;
      if (!Array.isArray(result.data)) {
        throw new Error("The server returned an unexpected list response. Refresh the page or contact support.");
      }
      setRecords(result.data);
      setTotalRecords(Number.isFinite(result.pagination.total) ? result.pagination.total : result.data.length);
    } catch (error) {
      if (error.name === "AbortError") return;
      setRecords([]);
      setTotalRecords(0);
      setListError(error.message || "Unable to load records.");
    } finally {
      if (!signal?.aborted) setIsLoading(false);
      if (activeListRequest.current === controller) activeListRequest.current = null;
    }
  }

  function handleLogin(loginToken, signedInUser) {
    setLogoutMessage("");
    localStorage.setItem("token", loginToken);
    localStorage.setItem("user", JSON.stringify(signedInUser));
    setToken(loginToken);
    setUser(signedInUser);
    setSessionReady(true);
  }

  function clearLocalSession() {
    setAnalyticsReturn(false);
    activeListRequest.current?.abort();
    activeListRequest.current = null;
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken("");
    setUser(null);
    dashboardRefreshRequest.current = null;
    setDashboard({});
    setDashboardError("");
    setIsDashboardLoading(false);
    setRecords([]);
    setTotalRecords(0);
    setListError("");
    setListQuery({ page: 1, limit: 10 });
    setSearchText("");
    setTechnicians([]);
    setNotificationTarget(null);
    setPage("Overview");
    setIsSidebarOpen(false);
    setErrorMessage("");
    setSuccessMessage("");
    setIsModalOpen(false);
    setEditingRecord(null);
    setInspectionRoom(null);
    setPendingDelete(null);
    setSessionReady(true);
  }

  async function handleLogout() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    const activeToken = token;
    let logoutFailure = "";
    if (activeToken) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        await requestApi("/auth/logout", activeToken, { method: "POST", signal: controller.signal });
      } catch (error) {
        const reason = error.name === "AbortError" ? "the server did not respond in time" : error.message;
        logoutFailure = `Signed out on this device. Server token invalidation could not be confirmed (${reason}). If the token remains active elsewhere, retry after reconnecting.`;
      } finally {
        window.clearTimeout(timeout);
      }
    }
    clearLocalSession();
    setLogoutMessage(logoutFailure);
    logoutPending.current = false;
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
      await refreshDashboard({ afterMutation: true });
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
      await refreshDashboard({ afterMutation: true });
      setSuccessMessage(`${getRecordLabel(page)} deleted successfully.`);
    } catch (error) { setErrorMessage(error.message); }
    finally { setIsDeleting(false); }
  }

  if (!token || !sessionReady) {
    if (token && !sessionReady) {
      return <div className="auth">Checking your secure session...</div>;
    }
    return <AuthenticationPage onLogin={handleLogin} logoutMessage={logoutMessage} />;
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
          onLogout={handleLogout}
        />

        <section className="content">
          {analyticsReturn && <button className="analytics-return-button" type="button" onClick={() => { setAnalyticsReturn(false); navigateToPage("Analytics"); }}>← Back to analytics</button>}
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
            <DashboardPage dashboard={dashboard} dashboardError={dashboardError} isLoading={isDashboardLoading} onNavigate={navigateToPage} onRetry={() => refreshDashboard()} />
          ) : page === "Analytics" && user?.role === "admin" ? (
            <AnalyticsDashboardPage token={token} onDrilldown={navigateToFilteredPage} />
          ) : page === "Room recommendations" ? (
            <RoomRecommendationPage token={token} />
          ) : (
            <ResourceTable
              key={`${page}:${notificationTarget?.page === page ? notificationTarget.id : ""}`}
              page={page}
              initialRecordId={notificationTarget?.page === page ? notificationTarget.id : ""}
              initialQuery={listQuery}
              records={records}
              totalRecords={totalRecords}
              listError={listError}
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
              onSearchTechnicians={searchTechnicians}
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
                  await refreshDashboard({ afterMutation: true });
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
                  await refreshDashboard({ afterMutation: true });
                  setSuccessMessage(`Booking ${status.toLowerCase()}.`);
                } catch (error) {
                  setErrorMessage(error.message);
                }
              }}
              onBookingCancel={async (record) => {
                try {
                  await requestApi(`/bookings/${record._id}/cancel`, token, { method: "PATCH" });
                  await loadRecords(page);
                  await refreshDashboard({ afterMutation: true });
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
                  await refreshDashboard({ afterMutation: true });
                  setSuccessMessage("Maintenance assignment updated.");
                } catch (error) { setErrorMessage(error.message); throw error; }
              }}
              onUpdateWork={async (record, values) => {
                try {
                  await requestApi(`/complaints/${record._id}/work`, token, { method: "PATCH", body: JSON.stringify(values) });
                  await loadRecords(page);
                  await refreshDashboard({ afterMutation: true });
                  setSuccessMessage(values.status === "Pending Verification" ? "Repair submitted for faculty verification." : "Work progress updated.");
                } catch (error) { setErrorMessage(error.message); throw error; }
              }}
              onVerifyRepair={async (record, decision, note) => {
                try {
                  await requestApi(`/complaints/${record._id}/verify`, token, { method: "PATCH", body: JSON.stringify({ decision, note }) });
                  await loadRecords(page);
                  await refreshDashboard({ afterMutation: true });
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
          onSaved={async () => { setInspectionRoom(null); await loadRecords("Classrooms"); await refreshDashboard({ afterMutation: true }); }}
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

function TopBar({ page, user, token, searchText, onSearch, onMenu, isSidebarOpen, onNavigateNotification, onLogout }) {
  const searchInput = useRef(null);
  const accountMenuRef = useRef(null);
  const accountButtonRef = useRef(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);

  useEffect(() => {
    if (!isAccountMenuOpen) return undefined;
    const closeFromOutside = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setIsAccountMenuOpen(false);
    };
    const closeFromEscape = (event) => {
      if (event.key === "Escape") {
        setIsAccountMenuOpen(false);
        accountButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromEscape);
    };
  }, [isAccountMenuOpen]);

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
        <div className="account-menu-wrap" ref={accountMenuRef}>
          <button ref={accountButtonRef} className="userdot" type="button" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={isAccountMenuOpen} onClick={() => setIsAccountMenuOpen((open) => !open)}>
            {user?.name?.[0] || "A"}
          </button>
          {isAccountMenuOpen && <div className="account-menu" role="menu" aria-label="Account menu">
            <div className="account-menu-details">
              <span className="account-menu-label">Account details</span>
              <strong>{user?.name || "Campus account"}</strong>
              <span>{user?.email || ""}</span>
              <small>{user?.role ? `${user.role[0].toUpperCase()}${user.role.slice(1)}` : "Account"}</small>
            </div>
            <button type="button" role="menuitem" onClick={() => { setIsAccountMenuOpen(false); onLogout(); }}><LogOut size={16} /> Sign out</button>
          </div>}
        </div>
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
      const count = Number(result?.unreadCount);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("Unread notification count response is invalid.");
      setUnreadCount(count);
      setNotificationError("");
    } catch (error) { if (requestId === unreadRequestId.current && error.name !== "AbortError") setNotificationError(error.message); }
  }

  async function loadNotifications() {
    setLoading(true);
    try {
      const list = await requestList("/notifications", token);
      setNotifications(list);
      setUnreadCount(list.filter((item) => !item.readAt).length);
      setNotificationError("");
      await loadUnreadCount();
    } catch (error) { if (error.name !== "AbortError") setNotificationError(error.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    let refreshTimer;
    const refresh = () => {
      if (!active || document.hidden) return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => { if (active) loadUnreadCount(); }, 100);
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearTimeout(refreshTimer);
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
      setNotifications((items) => (Array.isArray(items) ? items : []).map((item) => item._id === notification._id ? { ...item, readAt: new Date().toISOString() } : item));
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
      setNotifications((items) => (Array.isArray(items) ? items : []).map((item) => item._id === notification._id ? { ...item, readAt: null } : item));
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
      setNotifications((items) => (Array.isArray(items) ? items : []).map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
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

function AnalyticsDashboardPage({ token, onDrilldown }) {
  const [range, setRange] = useState("30d");
  const [trendGranularity, setTrendGranularity] = useState("daily");
  const [bookingGranularity, setBookingGranularity] = useState("daily");
  const [analytics, setAnalytics] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError("");
    requestApi(`/dashboard/analytics?range=${range}`, token)
      .then((result) => { if (active) setAnalytics(normalizeAnalyticsPayload(result)); })
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
    ["Technicians", analytics.totals.technicians, Wrench, "var(--tone-info)"],
    ["Buildings", analytics.totals.buildings, Building2, "var(--tone-warning)"],
    ["Rooms", analytics.totals.rooms, DoorOpen, "var(--tone-info)"],
    ["Classes", analytics.totals.classes, CalendarDays, "var(--tone-brand)"],
  ];
  const periodRange = analytics.dateWindow ? {
    dateFrom: analytics.dateWindow.startDate,
    dateTo: analytics.dateWindow.endDate,
  } : {};
  const complaintRange = analytics.dateWindow ? {
    createdAtFrom: analytics.dateWindow.startDate,
    createdAtTo: analytics.dateWindow.endDate,
  } : {};

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

      <AnalyticsMetricSection title="Campus overview" metrics={campusMetrics} />
      <AnalyticsGroupHeading title="Academic analytics" description="Student distribution, attendance and enrollment patterns" />
      <div className="analytics-grid">
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Students by department" subtitle="Current enrolled student records" />
          {analytics.students.departmentDistribution.length ? <AnalyticsBars rows={analytics.students.departmentDistribution.map((row) => [row.department, row.students, "var(--tone-brand)"])} /> : <div className="analytics-empty">No student department records are available.</div>}
        </section>
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Year and semester distribution" subtitle="Current values grouped from student academic records" />
          {analytics.students.yearSemesterDistribution.length ? <AnalyticsBars rows={analytics.students.yearSemesterDistribution.map((row) => [`Year ${row.year} · Semester ${row.semester}`, row.students, ["#315fce", "#12a594", "#e49b36", "#8a67ca"][Math.max(0, row.year - 1) % 4]])} /> : <div className="analytics-empty">No year and semester data is available.</div>}
        </section>
      </div>

      <AnalyticsMetricSection title={`Attendance · ${rangeLabel(range)}`} metrics={[
        ["Attendance records", analytics.attendance.total, ClipboardCheck, "var(--tone-info)"],
        ["Present", analytics.attendance.present, CheckCircle2, "var(--tone-success)"],
        ["Late", analytics.attendance.late, Clock3, "var(--tone-warning)"],
        ["Absent", analytics.attendance.absent, AlertCircle, "var(--tone-danger)"],
        ["Attendance rate", `${analytics.attendance.attendanceRate}%`, BarChart3, "var(--tone-brand)"],
      ]} />
      <section className="panel analytics-chart-panel analytics-wide-panel">
        <div className="analytics-chart-heading">
          <PanelHeading title="Attendance patterns" subtitle={`Daily status trends · ${rangeLabel(range)}`} />
          <select aria-label="Attendance trend granularity" value={trendGranularity} onChange={(event) => setTrendGranularity(event.target.value)}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
        </div>
        <AnalyticsTrendChart data={analytics.attendance[`${trendGranularity}Trend`]} series={[
          { key: "present", label: "Present", color: "#16a37a" },
          { key: "late", label: "Late", color: "#e39b32" },
          { key: "absent", label: "Absent", color: "#df5b63" },
        ]} onPoint={trendGranularity === "daily" ? (period, status) => onDrilldown("Attendance", { date: period, ...(status ? { status } : {}) }) : undefined} />
      </section>

      <div className="analytics-grid">
        <section className="panel analytics-chart-panel analytics-wide-panel">
          <PanelHeading title="Student enrollment over time" subtitle="Monthly student account creation from records" />
          <AnalyticsTrendChart data={analytics.students.enrollmentTrend} series={[{ key: "students", label: "Students", color: "#4361d8" }]} area />
        </section>
      </div>

      <AnalyticsGroupHeading title="Room and booking analytics" description={`Booking requests and room usage · ${rangeLabel(range)}`} />
      <AnalyticsMetricSection title={`Bookings · ${rangeLabel(range)}`} metrics={[
        ["Total requests", analytics.bookings.total, CalendarDays, "var(--tone-info)"],
        ["Pending", analytics.bookings.Pending, Clock3, "var(--tone-warning)"],
        ["Approved", analytics.bookings.Approved, CheckCircle2, "var(--tone-success)"],
        ["Rejected", analytics.bookings.Rejected, AlertCircle, "var(--tone-danger)"],
        ["Cancelled", analytics.bookings.Cancelled, CalendarDays, "var(--tone-neutral)"],
      ]} />
      <div className="analytics-grid">
        <section className="panel analytics-chart-panel analytics-wide-panel">
          <div className="analytics-chart-heading"><PanelHeading title="Booking activity" subtitle={`Status by booking date · ${rangeLabel(range)}`} /><select aria-label="Booking trend granularity" value={bookingGranularity} onChange={(event) => setBookingGranularity(event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>
          <BookingTrendChart data={analytics.bookingAnalytics[`${bookingGranularity}Trend`]} granularity={bookingGranularity === "monthly" ? "month" : bookingGranularity} onPoint={(period, status) => {
            const query = { ...periodRange, ...(status ? { status } : {}) };
            if (bookingGranularity === "daily") query.date = period;
            else if (bookingGranularity === "weekly") {
              query.dateFrom = analytics.dateWindow && analytics.dateWindow.startDate > period ? analytics.dateWindow.startDate : period;
              const end = new Date(`${period}T00:00:00.000Z`);
              end.setUTCDate(end.getUTCDate() + 6);
              const weekEnd = end.toISOString().slice(0, 10);
              query.dateTo = analytics.dateWindow && analytics.dateWindow.endDate < weekEnd ? analytics.dateWindow.endDate : weekEnd;
            } else {
              const monthStart = `${period}-01`;
              query.dateFrom = analytics.dateWindow && analytics.dateWindow.startDate > monthStart ? analytics.dateWindow.startDate : monthStart;
              const end = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0));
              const monthEnd = end.toISOString().slice(0, 10);
              query.dateTo = analytics.dateWindow && analytics.dateWindow.endDate < monthEnd ? analytics.dateWindow.endDate : monthEnd;
            }
            onDrilldown("Room bookings", query);
          }} />
        </section>
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Bookings by building" subtitle="Approved room requests" />
          {analytics.bookingAnalytics.buildingDistribution.length ? <AnalyticsBars onSelect={(query) => onDrilldown("Room bookings", query)} rows={analytics.bookingAnalytics.buildingDistribution.map((row) => [row.building, row.bookings, "#4169d8", { building: row.building, status: "Approved", ...periodRange }])} /> : <div className="analytics-empty">No approved booking data for this period.</div>}
        </section>
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Peak booking hours" subtitle="Requests grouped by starting hour" />
          {analytics.bookingAnalytics.peakHours.length ? <PeakBookingHoursChart data={analytics.bookingAnalytics.peakHours} onSelect={(hour) => onDrilldown("Room bookings", { startHour: hour, ...periodRange })} /> : <div className="analytics-empty">No booking data for this period.</div>}
        </section>
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Bookings by weekday" subtitle="Requests by scheduled day" />
          {analytics.bookingAnalytics.peakDays.length ? <AnalyticsBars rows={analytics.bookingAnalytics.peakDays.map((row) => [row.day, row.bookings, "#8a67ca"])} /> : <div className="analytics-empty">No booking data for this period.</div>}
        </section>
      </div>

      <AnalyticsGroupHeading title="Maintenance analytics" description={`Complaints, service status and room readiness · ${rangeLabel(range)}`} />
      <AnalyticsMetricSection title={`Complaints · ${rangeLabel(range)}`} metrics={[
        ["Complaints in period", analytics.complaints.total, MessageSquareWarning, "var(--tone-info)", { page: "Complaints", query: complaintRange }],
        ["Open", analytics.complaints.Open, AlertCircle, "var(--tone-danger)", { page: "Complaints", query: { ...complaintRange, status: "Open" } }],
        ["In progress", analytics.complaints["In progress"], Clock3, "var(--tone-warning)", { page: "Complaints", query: { ...complaintRange, status: "In progress" } }],
        ["Pending verification", analytics.complaints["Pending Verification"], Clock3, "var(--tone-info)", { page: "Complaints", query: { ...complaintRange, status: "Pending Verification" } }],
        ["Resolved or closed", analytics.complaints.Resolved + analytics.complaints.Closed, CheckCircle2, "var(--tone-success)"],
        ...(range !== "all" ? [["All time", analytics.complaints.totalAllTime, ClipboardCheck, "var(--tone-neutral)", { page: "Complaints", query: {} }]] : []),
        ["Avg resolution", `${analytics.complaints.averageResolutionHours} hrs`, Clock3, "var(--tone-brand)"],
      ]} onMetric={(target) => onDrilldown(target.page, target.query)} />
      <div className="analytics-grid">
        <section className="panel analytics-chart-panel analytics-wide-panel">
          <PanelHeading title="Complaint trend" subtitle="Requests created over time" />
          <AnalyticsTrendChart data={analytics.complaints.trend} series={[{ key: "complaints", label: "Complaints", color: "#d55c68" }]} area onPoint={range !== "all" ? (period) => onDrilldown("Complaints", { ...complaintRange, createdAtFrom: period, createdAtTo: period }) : undefined} />
        </section>
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Complaints by priority" subtitle="Current reporting period" />
          <AnalyticsDonut rows={analytics.complaints.byPriority.map((row) => ({ label: row.priority, value: row.complaints, query: { ...complaintRange, priority: row.priority } }))} onSelect={(query) => onDrilldown("Complaints", query)} />
        </section>
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Complaints by building" subtitle="Reported maintenance distribution" />
          {analytics.complaints.byBuilding.length ? <AnalyticsBars onSelect={(query) => onDrilldown("Complaints", query)} rows={analytics.complaints.byBuilding.map((row) => [row.building, row.complaints, "#d55c68", { ...complaintRange, roomSearch: row.building }])} /> : <div className="analytics-empty">No complaint records for this period.</div>}
        </section>
      </div>
      <section className="panel analytics-chart-panel">
        <PanelHeading title="Technician workload and completion" subtitle="Assigned maintenance tasks by technician" />
        {analytics.complaints.technicianWorkload.length ? <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Technician</th><th>Responsibility</th><th>Assigned</th><th>Active</th><th>Awaiting verification</th><th>Completed</th></tr></thead><tbody>{analytics.complaints.technicianWorkload.map((tech) => <tr key={tech.technicianId}><td><strong>{tech.name}</strong></td><td>{tech.department}</td><td>{tech.assigned}</td><td>{tech.active}</td><td>{tech.pendingVerification}</td><td>{tech.completed}</td></tr>)}</tbody></table></div> : <div className="analytics-empty">No technician assignments are recorded.</div>}
      </section>

      <div className="analytics-grid">
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Room readiness by building" subtitle="Operational versus maintenance hold" />
          {analytics.rooms.byBuilding.length ? <div className="analytics-bars">{analytics.rooms.byBuilding.map((row) => <div className="analytics-bar-row building-room-bar" key={row.building}><span>{row.building}</span><div className="building-room-track"><i style={{ width: `${row.operationalRooms / Math.max(1, row.rooms) * 100}%` }} /><b style={{ width: `${row.maintenanceRooms / Math.max(1, row.rooms) * 100}%` }} /></div><strong>{row.operationalRooms}/{row.rooms}</strong></div>)}</div> : <div className="analytics-empty">No room records are available.</div>}
          <div className="analytics-legend"><span><i style={{ background: "#16a37a" }} />Operational</span><span><i style={{ background: "#df5b63" }} />Maintenance hold</span></div>
        </section>
        <section className="panel analytics-chart-panel">
          <PanelHeading title="Equipment faults" subtitle="Non-operational equipment items" />
          {analytics.rooms.equipmentFaults.length ? <AnalyticsBars rows={analytics.rooms.equipmentFaults.map((row) => [row.equipment, row.faults, "#df5b63"])} /> : <div className="analytics-empty">All inspected equipment is operational.</div>}
        </section>
      </div>
      <section className="panel analytics-usage-panel">
        <PanelHeading title="Room booking frequency" subtitle={`Approved bookings and booked hours · ${rangeLabel(range)}`} />
        {analytics.roomUsage.length ? <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>Room</th><th>Building</th><th>Type</th><th>Bookings</th><th>Booked hours</th></tr></thead><tbody>{analytics.roomUsage.slice(0, 20).map((room) => <tr key={room.roomId}><td><strong>{room.name}</strong></td><td>{room.building}</td><td>{room.type}</td><td>{room.approvedBookings}</td><td>{room.bookedHours}</td></tr>)}</tbody></table></div> : <div className="analytics-empty">No approved room bookings for this period.</div>}
      </section>
      <RoomForecastPanel token={token} />
    </div>
  );
}

function AnalyticsTrendChart({ data, series, area = false, onPoint }) {
  const safeData = Array.isArray(data) ? data.filter((row) => row && typeof row.period === "string") : [];
  if (!safeData.length || safeData.every((row) => series.every((item) => !(Number(row[item.key]) > 0)))) {
    return <div className="analytics-empty">No records are available for this trend.</div>;
  }
  const uid = React.useId().replace(/:/g, "");
  const width = 800;
  const height = 260;
  const left = 48;
  const right = 18;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxValue = Math.max(1, ...safeData.flatMap((row) => series.map((item) => Number(row[item.key]) || 0)));
  const xAt = (index) => safeData.length === 1 ? left + plotWidth / 2 : left + (index / (safeData.length - 1)) * plotWidth;
  const yAt = (value) => top + plotHeight - (value / maxValue) * plotHeight;
  const makePath = (points) => points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} Q ${midpoint} ${previous.y}, ${midpoint} ${(previous.y + point.y) / 2} T ${point.x} ${point.y}`;
  }, "");
  const labelStep = Math.max(1, Math.ceil(safeData.length / 8));
  return <div className="analytics-trend-wrap">
    <svg className="analytics-trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend chart based on campus records">
      <defs>{series.map((item, index) => <linearGradient id={`${uid}-gradient-${index}`} key={item.key} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={item.color} stopOpacity="0.25" /><stop offset="100%" stopColor={item.color} stopOpacity="0.015" /></linearGradient>)}</defs>
      {[0, 0.5, 1].map((fraction) => { const y = top + plotHeight * (1 - fraction); return <g key={fraction}><line className="analytics-grid-line" x1={left} y1={y} x2={width - right} y2={y} /><text className="analytics-axis-label" x={left - 8} y={y + 4} textAnchor="end">{Math.round(maxValue * fraction).toLocaleString()}</text></g>; })}
      <text className="analytics-axis-label" x="12" y={top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 12 ${top + plotHeight / 2})`}>Records</text>
      <text className="analytics-axis-label" x={left + plotWidth / 2} y={height - 1} textAnchor="middle">Date / period</text>
      {series.map((item, seriesIndex) => {
        const points = safeData.map((row, index) => ({ x: xAt(index), y: yAt(Number(row[item.key]) || 0), value: Number(row[item.key]) || 0, period: row.period }));
        const line = makePath(points);
        const fillPath = `${line} L ${points[points.length - 1].x} ${top + plotHeight} L ${points[0].x} ${top + plotHeight} Z`;
        return <g key={item.key}>{area && <path d={fillPath} fill={`url(#${uid}-gradient-${seriesIndex})`} />}<path d={line} fill="none" stroke={item.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{points.map((point) => { const selectable = Boolean(onPoint && point.value > 0); return <circle key={`${item.key}-${point.period}`} className={selectable ? "analytics-point-interactive" : undefined} tabIndex={selectable ? 0 : undefined} role={selectable ? "button" : undefined} aria-label={selectable ? `${point.period}: ${point.value.toLocaleString()} ${item.label}. Open matching records.` : undefined} onClick={selectable ? () => onPoint(point.period, item.key) : undefined} onKeyDown={selectable ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPoint(point.period, item.key); } } : undefined} cx={point.x} cy={point.y} r={safeData.length > 25 ? 4 : 6} fill={item.color}><title>{`${point.period}: ${point.value.toLocaleString()} ${item.label.toLowerCase()}`}</title></circle>; })}{points.map((point, index) => (seriesIndex === 0 && (index % labelStep === 0 || index === points.length - 1)) ? <text className="analytics-axis-label" key={`label-${point.period}`} x={point.x} y={height - 12} textAnchor="middle">{point.period.length > 7 ? point.period.slice(5) : point.period}</text> : null)}</g>;
      })}
    </svg>
    <div className="analytics-legend">{series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}</div>
  </div>;
}

function AnalyticsDonut({ rows, onSelect }) {
  const colors = ["#d95462", "#e49b36", "#4668d5", "#18a184"];
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row && Number(row.value) > 0) : [];
  const total = safeRows.reduce((sum, row) => sum + Number(row.value), 0);
  if (!total) return <div className="analytics-empty">No priority records are available.</div>;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return <div className="analytics-donut-layout"><svg viewBox="0 0 160 160" role="img" aria-label="Complaint distribution by priority"><circle cx="80" cy="80" r={radius} fill="none" stroke="#edf1f7" strokeWidth="22" />{safeRows.map((row, index) => { const length = Number(row.value) / total * circumference; const circle = <circle key={row.label} cx="80" cy="80" r={radius} fill="none" stroke={colors[index % colors.length]} strokeWidth="22" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)"><title>{`${row.label}: ${Number(row.value).toLocaleString()} complaints`}</title></circle>; offset += length; return circle; })}<text x="80" y="76" textAnchor="middle" className="analytics-donut-total">{total.toLocaleString()}</text><text x="80" y="96" textAnchor="middle" className="analytics-donut-caption">complaints</text></svg><div className="analytics-donut-legend">{safeRows.map((row, index) => <button className="analytics-donut-item" type="button" key={row.label} onClick={onSelect ? () => onSelect(row.query) : undefined} disabled={!onSelect || !row.query} aria-label={`${row.label}: ${Number(row.value).toLocaleString()} complaints. Open matching records.`}><i style={{ background: colors[index % colors.length] }} />{row.label}<strong>{Number(row.value).toLocaleString()}</strong></button>)}</div></div>;
}

function rangeLabel(range) {
  return range === "all" ? "all time" : range === "7d" ? "last 7 days" : "last 30 days";
}

function AnalyticsGroupHeading({ title, description }) {
  return <div className="analytics-group-heading"><h2>{title}</h2><p>{description}</p></div>;
}

function AnalyticsMetricSection({ title, metrics, onMetric }) {
  return (
    <section className="analytics-section">
      <h2>{title}</h2>
      <div className="analytics-metrics">
        {metrics.map(([label, value, Icon, color, target]) => (
          <MetricCard key={label} label={label} value={value} Icon={Icon} color={color} onClick={target?.page && onMetric ? () => onMetric(target) : undefined} />
        ))}
      </div>
    </section>
  );
}

function BookingTrendChart({ data, granularity, onPoint }) {
  const chartData = Array.isArray(data) ? data.filter((item) => item && typeof item === "object" && typeof item.period === "string").slice(-24) : [];
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
        <text x="11" y={top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 11 ${top + plotHeight / 2})`}>Bookings</text>
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
                return <rect key={status} className="analytics-point-interactive" tabIndex={0} role="button" aria-label={`${item.period}: ${count.toLocaleString()} ${status.toLowerCase()} bookings. Open matching records.`} onClick={() => onPoint?.(item.period, status)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPoint?.(item.period, status); } }} x={x} y={yBottom} width={barWidth} height={barHeight} fill={colors[status]}><title>{`${item.period}: ${count.toLocaleString()} ${status.toLowerCase()} bookings`}</title></rect>;
              })}
              {(index % labelStep === 0 || index === chartData.length - 1) && (
                <text x={x + barWidth / 2} y={height - 12} textAnchor="middle">{granularity === "month" ? item.period : item.period.slice(5)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="analytics-axis-caption"><span>Booking date / period</span><span>Requests</span></div>
      <div className="analytics-legend">
        {statuses.map((status) => <span key={status}><i style={{ background: colors[status] }} />{status}</span>)}
      </div>
    </div>
  );
}

function AnalyticsBars({ rows, onSelect }) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => Array.isArray(row) && row.length >= 3) : [];
  const maxValue = Math.max(1, ...safeRows.map(([, value]) => Number(value) || 0));
  return (
    <div className="analytics-bars">
      {safeRows.map(([label, value, color, query]) => {
        const Row = onSelect && query ? "button" : "div";
        return <Row className={`analytics-bar-row${onSelect && query ? " analytics-bar-action" : ""}`} key={label} {...(onSelect && query ? { type: "button", onClick: () => onSelect(query), "aria-label": `${label}: ${Number(value).toLocaleString()}. Open matching records.` } : {})}>
          <span>{label}</span>
          <span className="analytics-bar-track" title={`${label}: ${Number(value).toLocaleString()}`}><i style={{ width: `${(Number(value) / maxValue) * 100}%`, background: color }} /></span>
          <strong>{Number(value).toLocaleString()}</strong>
        </Row>;
      })}
    </div>
  );
}

function PeakBookingHoursChart({ data, onSelect }) {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, bookings: Number(data.find((row) => Number(row.hour) === hour)?.bookings) || 0 }));
  if (rows.every((row) => row.bookings === 0)) return <div className="analytics-empty">No bookings are recorded in this reporting period.</div>;
  const maxBookings = Math.max(1, ...rows.map((row) => row.bookings));
  const width = 760;
  const height = 230;
  const left = 42;
  const right = 12;
  const top = 14;
  const bottom = 34;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const slot = plotWidth / 24;
  const barWidth = slot * 0.64;
  return <div className="peak-hours-chart-wrap"><svg className="peak-hours-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Bookings by starting hour, across all 24 hours">
    {[0, 0.5, 1].map((fraction) => { const y = top + plotHeight * (1 - fraction); return <g key={fraction}><line className="analytics-grid-line" x1={left} y1={y} x2={width - right} y2={y} /><text className="analytics-axis-label" x={left - 7} y={y + 4} textAnchor="end">{Math.round(maxBookings * fraction)}</text></g>; })}
    {rows.map(({ hour, bookings }) => { const barHeight = bookings / maxBookings * plotHeight; const x = left + hour * slot + (slot - barWidth) / 2; const y = top + plotHeight - barHeight; const activeProps = bookings > 0 ? { className: "analytics-point-interactive", tabIndex: 0, role: "button", "aria-label": `${String(hour).padStart(2, "0")}:00, ${bookings.toLocaleString()} bookings. Open matching records.`, onClick: () => onSelect(hour), onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(hour); } } } : {}; return <g key={hour}><rect {...activeProps} x={x} y={y} width={barWidth} height={barHeight} fill="#159b88" rx="2"><title>{`${String(hour).padStart(2, "0")}:00 — ${bookings.toLocaleString()} bookings`}</title></rect>{hour % 2 === 0 && <text className="analytics-axis-label" x={x + barWidth / 2} y={height - 11} textAnchor="middle">{String(hour).padStart(2, "0")}</text>}</g>; })}
  </svg><div className="analytics-axis-caption"><span>Starting hour (24-hour clock)</span><span>Bookings</span></div></div>;
}

function RoomForecastPanel({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    requestApi("/dashboard/analytics/room-forecast", token)
      .then((result) => { if (active) setData(normalizeForecastPayload(result)); })
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
  const safeRows = Array.isArray(rows) ? rows : [];
  return (
    <section className="panel forecast-pattern">
      <PanelHeading title={title} subtitle={subtitle} />
      {safeRows.length ? <AnalyticsBars rows={safeRows} /> : <div className="analytics-empty">{emptyText || "No booking data."}</div>}
    </section>
  );
}

function ForecastDailyChart({ days }) {
  const safeDays = Array.isArray(days) ? days.filter((day) => day && typeof day === "object") : [];
  if (!safeDays.length) return <div className="analytics-empty">No predictions available.</div>;
  const width = 760;
  const height = 190;
  const left = 44;
  const bottom = 35;
  const top = 12;
  const maxHours = Math.max(1, ...safeDays.map((day) => Number(day.hours) || 0));
  const plotHeight = height - top - bottom;
  const slot = (width - left - 12) / safeDays.length;
  const barWidth = Math.min(44, slot * 0.56);
  return (
    <div className="forecast-chart-wrap">
      <svg className="forecast-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Predicted room usage hours for the next seven days">
        {[0, 0.5, 1].map((fraction) => {
          const y = top + plotHeight * (1 - fraction);
          return <g key={fraction}><line x1={left} y1={y} x2={width - 12} y2={y} stroke="#eceef3" /><text x={left - 8} y={y + 4} textAnchor="end">{(maxHours * fraction).toFixed(1)}</text></g>;
        })}
        {safeDays.map((day, index) => {
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
      const result = normalizeRecommendationPayload(await requestApi(`/rooms/recommendations?${query}`, token));
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

function DashboardPage({ dashboard, dashboardError, isLoading, onNavigate, onRetry }) {
  if (dashboardError && !dashboard.role) return <section className="panel empty-state" role="alert"><p>{dashboardError}</p><button className="secondary" onClick={onRetry}>Retry</button></section>;
  if (!isLoading && !dashboard.role) return <section className="panel empty-state" role="status"><p>Dashboard data is unavailable.</p><button className="secondary" onClick={onRetry}>Retry</button></section>;
  const student = dashboard.role === "student";
  const faculty = dashboard.role === "faculty";
  const technician = dashboard.role === "technician";
  const classes = Array.isArray(dashboard.classes) ? dashboard.classes : [];
  const notices = Array.isArray(dashboard.notices)
    ? dashboard.notices
    : Array.isArray(dashboard.recentNotices)
      ? dashboard.recentNotices
      : [];
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
            ["Repairs completed", dashboard.completedRepairs || 0, CheckCircle2, "var(--tone-info)"],
          ]
      : [
          ["Students", dashboard.students || 0, Users, "var(--tone-brand)"],
          ["Faculty", dashboard.faculty || 0, ClipboardCheck, "var(--tone-success)"],
          ["Technicians", dashboard.technicians || 0, Wrench, "var(--tone-info)"],
          ["Buildings", dashboard.buildings || 0, Building2, "var(--tone-warning)"],
          ["Rooms", dashboard.rooms || 0, DoorOpen, "var(--tone-info)"],
          ["Classes", dashboard.classes || 0, CalendarDays, "var(--tone-warning)"],
          ["Bookings", dashboard.bookings || 0, CalendarDays, "var(--tone-brand)"],
          ["Open complaints", dashboard.openComplaints || 0, MessageSquareWarning, "var(--tone-danger)"],
          ["Maintenance rooms", dashboard.maintenanceRooms || 0, Wrench, "var(--tone-danger)"],
        ];

  return (
    <>
      {dashboardError && <div className="error" role="alert">{dashboardError} <button className="secondary" onClick={onRetry}>Retry</button></div>}
      <div className={`cards dashboard-cards dashboard-${dashboard.role || "loading"}`}>
        {isLoading ? Array.from({ length: dashboard.role === "admin" ? 9 : dashboard.role === "technician" ? 4 : 4 }, (_, index) => <div className="card card-skeleton" key={index}><i /><i /><i /></div>) : cards.map(([label, value, Icon, color]) => (
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
              <p>{dashboard.rooms} rooms across {dashboard.buildings} buildings; {dashboard.bookings} bookings and {dashboard.notices} notices recorded.</p>
              <p>Bookings: {dashboard.bookingStatus?.Approved || 0} approved · {dashboard.bookingStatus?.Pending || 0} pending · {dashboard.bookingStatus?.Rejected || 0} rejected · {dashboard.bookingStatus?.Cancelled || 0} cancelled.</p>
              <p>Seven-day attendance rate: {dashboard.attendanceSummary?.percentage || 0}% · {dashboard.openComplaints} active complaints.</p>
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

      {dashboard.role === "admin" && (
        <div className="dashboard-admin-details">
          <section className="panel">
            <PanelHeading title="Buildings and room readiness" subtitle="Operational and maintenance counts from room records" />
            {dashboard.buildingSummaries.length ? dashboard.buildingSummaries.map((building) => (
              <div className="building-summary-row" key={building._id}>
                <strong>{building._id}</strong><span>{building.rooms} rooms</span>
                <span className="building-operational">{building.operationalRooms} operational</span>
                <span className="building-maintenance">{building.maintenanceRooms} on maintenance hold</span>
              </div>
            )) : <div className="analytics-empty">No building records are available.</div>}
          </section>
          <section className="panel">
            <PanelHeading title="Maintenance alerts" subtitle="Latest unresolved room issues" />
            {dashboard.maintenanceAlerts.length ? dashboard.maintenanceAlerts.slice(0, 6).map((issue) => (
              <div className="activity-row" key={issue._id}>
                <span><strong>{issue.title}</strong><small>{issue.room?.building} · {issue.room?.name} · {issue.assignedTo?.name || "Unassigned"}</small></span>
                <StatusBadge status={issue.priority} />
              </div>
            )) : <div className="analytics-empty">No unresolved maintenance issues.</div>}
          </section>
          <section className="panel">
            <PanelHeading title="Recent campus activity" subtitle="Latest recorded actions" />
            {dashboard.recentActivity.length ? dashboard.recentActivity.map((item) => (
              <div className="activity-row" key={item._id}><span><strong>{item.summary}</strong><small>{item.actor?.name || "Campus administrator"} · {new Date(item.createdAt).toLocaleString()}</small></span></div>
            )) : <div className="analytics-empty">No campus activity is recorded yet.</div>}
          </section>
        </div>
      )}

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

function MetricCard({ label, value, Icon, color, onClick }) {
  const Card = onClick ? "button" : "div";
  return (
    <Card className={`card${onClick ? " metric-card-action" : ""}`} type={onClick ? "button" : undefined} onClick={onClick} aria-label={onClick ? `${label}: ${typeof value === "number" ? value.toLocaleString() : value}. Open matching records.` : undefined}>
      <span className="card-icon" style={{ color, background: `color-mix(in srgb, ${color} 11%, white)` }}>
        <Icon size={19} />
      </span>
      <strong>
        {typeof value === "number" ? value.toLocaleString() : value}
      </strong>
      <small>{label}</small>
    </Card>
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
  initialQuery = {},
  records,
  totalRecords,
  listError,
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
  onSearchTechnicians,
  canInspectRoom,
  onInspectRoom,
  onAssignComplaint,
  onUpdateWork,
  onVerifyRepair,
}) {
  const hasInvalidRecords = !Array.isArray(records);
  const resourceRecords = hasInvalidRecords ? [] : records;
  const resourceTechnicians = Array.isArray(technicians) ? technicians : [];
  const resourceTotal = Number.isSafeInteger(totalRecords) && totalRecords >= 0 ? totalRecords : 0;
  const [filters, setFilters] = useState(() => ({
    roomSearch: initialQuery.roomSearch || "", priority: initialQuery.priority || "", status: initialQuery.status || "",
    assignee: initialQuery.assignee || "", building: initialQuery.building || "", operational: "", type: "", available: "",
    date: initialQuery.date || "", dateFrom: initialQuery.dateFrom || "", dateTo: initialQuery.dateTo || "",
    createdAtFrom: initialQuery.createdAtFrom || "", createdAtTo: initialQuery.createdAtTo || "",
    startHour: initialQuery.startHour === undefined ? "" : String(initialQuery.startHour),
  }));
  const [sort, setSort] = useState({ column: "", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [recordId, setRecordId] = useState(initialRecordId || "");
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(resourceTotal / pageSize));

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
        ? { roomSearch: "roomSearch", priority: "priority", status: "status", assignee: "assignee", createdAtFrom: "createdAtFrom", createdAtTo: "createdAtTo" }
        : page === "Room bookings"
          ? { status: "status", date: "date", roomSearch: "roomSearch", building: "building", dateFrom: "dateFrom", dateTo: "dateTo", startHour: "startHour" }
          : page === "Attendance"
            ? { date: "date", status: "status" }
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

  function clearTableFilters() {
    setFilters({ roomSearch: "", priority: "", status: "", assignee: "", building: "", operational: "", type: "", available: "", date: "", dateFrom: "", dateTo: "", createdAtFrom: "", createdAtTo: "", startHour: "" });
    setSearchText("");
    setRecordId("");
  }

  return (
    <div className="panel tablepanel">
      <PanelHeading title={page === "Complaints" ? "Central Maintenance Notice Board" : page} subtitle={`${resourceTotal.toLocaleString()} records${page === "Complaints" && (filters.createdAtFrom || filters.createdAtTo) ? ` · ${filters.createdAtFrom || "Any date"} to ${filters.createdAtTo || "present"}` : ""}`}>
        <div className="resource-filters">
          <div className="filter"><Search size={16} /><input placeholder={`Filter ${page.toLowerCase()}`} value={searchText} onChange={(event) => onSearch(event.target.value)} /></div>
          {page === "Complaints" && <div className="maintenance-filters">
            <input aria-label="Filter by room or building" placeholder="Room or building" value={filters.roomSearch} onChange={(event) => setFilters((value) => ({ ...value, roomSearch: event.target.value }))} />
            <label className="date-filter">Created from<input aria-label="Complaints created from" type="date" value={filters.createdAtFrom} onChange={(event) => setFilters((value) => ({ ...value, createdAtFrom: event.target.value }))} /></label>
            <label className="date-filter">Created through<input aria-label="Complaints created through" type="date" value={filters.createdAtTo} onChange={(event) => setFilters((value) => ({ ...value, createdAtTo: event.target.value }))} /></label>
            <select aria-label="Filter by priority" value={filters.priority} onChange={(event) => setFilters((value) => ({ ...value, priority: event.target.value }))}>
              <option value="">All priorities</option>{["Low", "Normal", "High", "Urgent"].map((priority) => <option key={priority}>{priority}</option>)}
            </select>
            <select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}>
              <option value="">All statuses</option>{["Open", "In progress", "Pending Verification", "Resolved", "Closed"].map((status) => <option key={status}>{status}</option>)}
            </select>
            {userRole === "admin" && <select aria-label="Filter by assignee" value={filters.assignee} onChange={(event) => setFilters((value) => ({ ...value, assignee: event.target.value }))}>
              <option value="">All assignees</option><option value="unassigned">Unassigned</option>{resourceTechnicians.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
            </select>}
            <button className="clear-filter-button" type="button" onClick={clearTableFilters}>Clear filters</button>
          </div>}
          {page === "Room bookings" && <div className="maintenance-filters"><select aria-label="Filter bookings by status" value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}>
            <option value="">All statuses</option>{["Pending", "Approved", "Rejected", "Cancelled"].map((status) => <option key={status}>{status}</option>)}
          </select><label className="date-filter">From<input aria-label="Bookings from date" type="date" value={filters.dateFrom} onChange={(event) => setFilters((value) => ({ ...value, dateFrom: event.target.value }))} /></label><label className="date-filter">Through<input aria-label="Bookings through date" type="date" value={filters.dateTo} onChange={(event) => setFilters((value) => ({ ...value, dateTo: event.target.value }))} /></label><input aria-label="Filter bookings by building" placeholder="Building" value={filters.building} onChange={(event) => setFilters((value) => ({ ...value, building: event.target.value }))} /><select aria-label="Filter by booking start hour" value={filters.startHour} onChange={(event) => setFilters((value) => ({ ...value, startHour: event.target.value }))}><option value="">All start hours</option>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select><input aria-label="Filter bookings by room" placeholder="Room" value={filters.roomSearch} onChange={(event) => setFilters((value) => ({ ...value, roomSearch: event.target.value }))} /></div>}
          {page === "Attendance" && <div className="maintenance-filters"><label className="date-filter">Attendance date<input aria-label="Filter attendance by date" type="date" value={filters.date} onChange={(event) => setFilters((value) => ({ ...value, date: event.target.value }))} /></label><select aria-label="Filter attendance by status" value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}><option value="">All statuses</option>{["present", "late", "absent"].map((status) => <option key={status}>{status}</option>)}</select></div>}
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
            {resourceRecords.map((record, index) => (
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
                onSearchTechnicians={onSearchTechnicians}
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
        ) : listError ? (
          <div className="empty error" role="alert">
            <AlertCircle size={20} />
            <span>{listError}</span>
          </div>
        ) : hasInvalidRecords ? (
          <div className="empty error" role="alert">
            <AlertCircle size={20} />
            <span>Records could not be displayed because the list response was invalid. Refresh the page or contact support.</span>
          </div>
        ) : (
          resourceRecords.length === 0 && (
            <div className="empty">
              <AlertCircle size={20} />
              <span>{resourceTotal === 0 ? "No records found for these filters." : "No records on this page."}</span>
            </div>
          )
        )}
      </div>
      {!isLoading && !listError && !hasInvalidRecords && resourceTotal > 0 && <div className="table-pagination">
        <span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, resourceTotal)} of {resourceTotal}</span>
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

function MaintenanceRow({ record, userRole, canEdit, technicians, onSearchTechnicians, onResolve, onAssign, onUpdateWork, onVerify }) {
  const [showWorkForm, setShowWorkForm] = useState(false);
  const [note, setNote] = useState("");
  const [resolutionDetails, setResolutionDetails] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [technicianSearch, setTechnicianSearch] = useState("");
  const safeTechnicians = Array.isArray(technicians) ? technicians : [];
  const [technicianOptions, setTechnicianOptions] = useState(safeTechnicians);
  const isFacility = Boolean(record.room);

  useEffect(() => { setTechnicianOptions(safeTechnicians); }, [technicians]);
  useEffect(() => {
    if (userRole !== "admin" || !isFacility || !onSearchTechnicians) return undefined;
    if (!technicianSearch.trim()) {
      setTechnicianOptions(safeTechnicians);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      onSearchTechnicians(technicianSearch)
        .then((options) => { if (active) setTechnicianOptions(options); })
        .catch((error) => { if (active) setActionError(error.message); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [userRole, isFacility, technicianSearch, onSearchTechnicians, technicians]);

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

  const history = Array.isArray(record.history) ? record.history : [];
  const resolutionEvidence = Array.isArray(record.resolutionEvidence) ? record.resolutionEvidence : [];
  return (
    <tr className="maintenance-row">
      <td><strong>{record.title}</strong><small>{record.description}</small></td>
      <td>{record.room ? `${record.room.name} · ${record.room.building}` : "General complaint"}<small>{record.equipment || record.category}</small></td>
      <td><span className={`priority-chip ${String(record.priority || "Normal").toLowerCase()}`}>{record.priority || "Normal"}</span></td>
      <td><StatusBadge status={record.status || "Open"} /></td>
      <td>{record.submittedBy?.name || "—"}</td>
      <td>
        {canEdit && isFacility ? (
          <div className="technician-selector">
            <input aria-label={`Search technicians for ${record.title}`} placeholder="Search technicians" value={technicianSearch} onChange={(event) => setTechnicianSearch(event.target.value)} />
            <select aria-label={`Assign ${record.title}`} disabled={saving || ["Closed", "Resolved"].includes(record.status)} value={record.assignedTo?._id || ""} onChange={(event) => assignTechnician(event.target.value)}>
              <option value="">Unassigned</option>
              {record.assignedTo && !technicianOptions.some((item) => item.id === record.assignedTo._id) && <option value={record.assignedTo._id}>{record.assignedTo.name}</option>}
              {technicianOptions.map((technician) => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
              {!technicianOptions.length && <option value="" disabled>No matching technicians</option>}
            </select>
          </div>
        ) : record.assignedTo?.name || "—"}
      </td>
      <td>
        {new Date(record.createdAt).toLocaleDateString()}
        <details className="complaint-history">
          <summary>History ({history.length})</summary>
          {record.verifiedAt && <p><strong>Verified by:</strong> {record.verifiedBy?.name || "Faculty"} · {new Date(record.verifiedAt).toLocaleString()}</p>}
          {record.resolutionDetails && <p><strong>Resolution:</strong> {record.resolutionDetails}</p>}
          {resolutionEvidence.map((url, index) => <p key={`${url}-${index}`}><strong>Evidence:</strong> {url}</p>)}
          {history.map((item) => <div className="complaint-history-item" key={item._id || `${item.action}-${item.createdAt}`}>
            <strong>{item.action}</strong><small>{item.actor?.name || "User"} · {new Date(item.createdAt).toLocaleString()}</small>
            {item.note && <p>{item.note}</p>}
            {(Array.isArray(item.evidence) ? item.evidence : []).map((url, index) => <small key={`${url}-${index}`}>Evidence: {url}</small>)}
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
  const roomEquipment = Array.isArray(room.equipment) ? room.equipment : [];
  const [equipment, setEquipment] = useState(() => types.map((type) => {
    const current = roomEquipment.find((item) => item?.type === type);
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
        {(columnSets[page] || []).map((column) => (
          <th key={column} aria-sort={sort.column === column ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}><button className="sort-heading" aria-label={`Sort by ${column}`} disabled={!sortableFields[column]} onClick={() => onSort(column)}>{column}{sort.column === column ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>
        ))}
      </tr>
    </thead>
  );
}

function ResourceRow({ page, record, canEdit, onEdit, onDelete, onResolve, onBookingDecision, onBookingCancel, userId, userRole, technicians, onSearchTechnicians, canInspectRoom, onInspectRoom, onAssignComplaint, onUpdateWork, onVerifyRepair }) {
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
    return <MaintenanceRow record={record} userRole={userRole} canEdit={canEdit} technicians={technicians} onSearchTechnicians={onSearchTechnicians} onResolve={onResolve} onAssign={onAssignComplaint} onUpdateWork={onUpdateWork} onVerify={onVerifyRepair} />;
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
          <small>{record.department || record.faculty?.department || ""}</small>
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
        <td>{(Array.isArray(record.equipment) ? record.equipment : []).filter(Boolean).map((item) => <small key={item.type}>{item.type}: {item.status}</small>)}</td>
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

function AuthenticationPage({ onLogin, logoutMessage }) {
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

      if (typeof result?.token !== "string" || !result.token || !result.user || typeof result.user !== "object" || !result.user.role) {
        throw new Error("The sign-in response was incomplete. Refresh the page or contact support.");
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

        {logoutMessage && <div className="error" role="alert">{logoutMessage}</div>}

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
    if (!initialRecord) return page === "Classrooms" ? { type: ROOM_TYPES[0] } : page === "Classes" ? { maxEnrollment: 60 } : {};
    return {
      ...initialRecord,
      type: page === "Classrooms" && !ROOM_TYPES.includes(initialRecord.type) ? "" : initialRecord.type,
      faculty: initialRecord.faculty?._id || initialRecord.faculty || "",
      room: initialRecord.room?._id || initialRecord.room || "",
      enrolledStudents: (Array.isArray(initialRecord.enrolledStudents) ? initialRecord.enrolledStudents : []).map(
        (student) => student._id || student,
      ),
    };
  });
  const enrolledStudentsRef = useRef(formValues.enrolledStudents || []);
  enrolledStudentsRef.current = formValues.enrolledStudents || [];
  const campusClassValueRef = useRef(formValues.campusClass);
  campusClassValueRef.current = formValues.campusClass;
  const [students, setStudents] = useState(() => (Array.isArray(initialRecord?.enrolledStudents) ? initialRecord.enrolledStudents : []).filter((student) => student && typeof student === "object"));
  const [faculty, setFaculty] = useState(() => initialRecord?.faculty && typeof initialRecord.faculty === "object" ? [initialRecord.faculty] : []);
  const [rooms, setRooms] = useState(() => initialRecord?.room && typeof initialRecord.room === "object" ? [initialRecord.room] : []);
  const [classes, setClasses] = useState([]);
  const [facultySearch, setFacultySearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [classSearch, setClassSearch] = useState("");
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const fields = getFormFields(page);

  useEffect(() => {
    if (page !== "Classes") return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setOptionsLoading(true);
      try {
        const params = new URLSearchParams({ page: "1", limit: "25" });
        if (facultySearch.trim()) params.set("search", facultySearch.trim());
        const result = await requestList(`/faculty?${params}`, token, { signal: controller.signal });
        setFaculty(() => {
          const selected = initialRecord?.faculty && typeof initialRecord.faculty === "object" ? [initialRecord.faculty] : [];
          return [...new Map([...selected, ...result].map((item) => [item._id, item])).values()];
        });
      } catch (error) { if (error.name !== "AbortError") setFormError(error.message); }
      finally { if (!controller.signal.aborted) setOptionsLoading(false); }
    }, facultySearch ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, token, facultySearch]);

  useEffect(() => {
    if (!["Classes", "Room bookings", "Complaints"].includes(page)) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setOptionsLoading(true);
      try {
        const params = new URLSearchParams({ page: "1", limit: "100" });
        if (roomSearch.trim()) params.set("search", roomSearch.trim());
        const result = await requestList(`/rooms?${params}`, token, { signal: controller.signal });
        setRooms(() => {
          const selected = initialRecord?.room && typeof initialRecord.room === "object" ? [initialRecord.room] : [];
          return [...new Map([...selected, ...result].map((item) => [item._id, item])).values()];
        });
      } catch (error) { if (error.name !== "AbortError") setFormError(error.message); }
      finally { if (!controller.signal.aborted) setOptionsLoading(false); }
    }, roomSearch ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, token, roomSearch]);

  useEffect(() => {
    if (page !== "Classes" && page !== "Attendance") return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setOptionsLoading(true);
      try {
        const params = new URLSearchParams({ page: "1", limit: "25" });
        if (page === "Attendance") params.set("includeStudents", "false");
        if (classSearch.trim()) params.set("search", classSearch.trim());
        const result = await requestList(`/classes?${params}`, token, { signal: controller.signal });
        setClasses(result);
        if (page === "Attendance" && !campusClassValueRef.current && result[0]) {
          campusClassValueRef.current = result[0]._id;
          setFormValues((values) => ({ ...values, campusClass: result[0]._id }));
        }
      } catch (error) { if (error.name !== "AbortError") setFormError(error.message); }
      finally { if (!controller.signal.aborted) setOptionsLoading(false); }
    }, classSearch ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, token, classSearch]);

  useEffect(() => {
    if (page !== "Classes") return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setOptionsLoading(true);
      try {
        const params = new URLSearchParams({ page: "1", limit: "25" });
        if (studentSearch.trim()) params.set("search", studentSearch.trim());
        const result = await requestList(`/students?${params}`, token, { signal: controller.signal });
        setStudents((current) => {
          const selectedIds = new Set(enrolledStudentsRef.current);
          const selected = current.filter((student) => selectedIds.has(student._id));
          return [...new Map([...selected, ...result].map((student) => [student._id, student])).values()];
        });
      } catch (error) { if (error.name !== "AbortError") setFormError(error.message); }
      finally { if (!controller.signal.aborted) setOptionsLoading(false); }
    }, studentSearch ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, token, studentSearch]);

  useEffect(() => {
    if (page !== "Attendance" || !formValues.campusClass) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setOptionsLoading(true);
      try {
        const params = new URLSearchParams({ page: "1", limit: "25" });
        if (studentSearch.trim()) params.set("search", studentSearch.trim());
        const result = await requestList(`/classes/${formValues.campusClass}/students?${params}`, token, { signal: controller.signal });
        setStudents(result);
      } catch (error) { if (error.name !== "AbortError") setFormError(error.message); }
      finally { if (!controller.signal.aborted) setOptionsLoading(false); }
    }, studentSearch ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [page, token, formValues.campusClass, studentSearch]);

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
      setStudentSearch("");
      setStudents([]);
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
              <>
              {name === "faculty" && <input aria-label="Search faculty" placeholder="Search faculty" value={facultySearch} onChange={(event) => setFacultySearch(event.target.value)} />}
              {name === "room" && <input aria-label="Search rooms" placeholder="Search rooms" value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} />}
              {name === "campusClass" && <input aria-label="Search classes" placeholder="Search classes" value={classSearch} onChange={(event) => setClassSearch(event.target.value)} />}
              {name === "student" && <input aria-label="Search enrolled students" placeholder="Search enrolled students" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} />}
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
              {optionsLoading && <small role="status">Loading options…</small>}
              {!optionsLoading && !((name === "faculty" ? faculty : name === "room" ? rooms : name === "campusClass" ? classes : students).length) && <small>No matching options. Change your search.</small>}
              </>
            ) : name === "enrolledStudents" ? (
              <>
              <input aria-label="Search students to enroll" placeholder="Search students to enroll" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} />
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
                {!students.length && <small>No matching students. Change your search.</small>}
              <small>Search and select students. Enrollment is validated against class capacity and schedule conflicts.</small>
              </>
            ) : name === "equipment" ? (
              <select name={name} value={formValues[name] || ""} onChange={updateField} disabled={!formValues.room}>
                <option value="">General room issue (plumbing, furniture, network)</option>{["Fan", "AC", "Projector", "Light"].map((item) => <option key={item}>{item}</option>)}
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
