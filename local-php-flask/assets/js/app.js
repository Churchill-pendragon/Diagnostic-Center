"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  user: null,
  csrf: null,
  view: "dashboard",
  labPending: 0,
  caches: { patients: [], tests: [], staff: [] },
};

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: "⌂", roles: ["Admin", "Receptionist", "Lab Technician"] },
  { id: "appointments", label: "Appointments", icon: "▣", roles: ["Admin", "Receptionist"] },
  { id: "patients", label: "Patients", icon: "◎", roles: ["Admin", "Receptionist"] },
  { id: "lab", label: "Laboratory", icon: "△", roles: ["Admin", "Lab Technician"], badge: true },
  { id: "catalog", label: "Test Catalog", icon: "⌬", roles: ["Admin", "Receptionist", "Lab Technician"] },
  { id: "reports", label: "Reports", icon: "≡", roles: ["Admin", "Receptionist", "Lab Technician"] },
  { id: "staff", label: "Staff Accounts", icon: "◇", roles: ["Admin"] },
  { id: "profile", label: "Profile", icon: "○", roles: ["Admin", "Receptionist", "Lab Technician"] },
  { id: "logout", label: "Logout", icon: "↪", roles: ["Admin", "Receptionist", "Lab Technician"] },
];

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindPermanentEvents();
  updateClock();
  window.setInterval(updateClock, 1000);
  try {
    const session = await api("api/auth.php?action=session", {}, false);
    if (session.authenticated) {
      state.user = session.user;
      state.csrf = session.csrf_token;
      showApplication();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin();
    $("#login-error").textContent = error.message;
  }
}

function bindPermanentEvents() {
  $("#login-form").addEventListener("submit", handleLogin);
  $("#menu-button").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#modal-layer").addEventListener("click", (event) => {
    if (event.target.closest("[data-close-modal]")) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modal-layer").classList.contains("hidden")) closeModal();
  });
}

async function api(path, options = {}, redirectOnUnauthorized = true) {
  const headers = new Headers(options.headers || {});
  if (options.body && typeof options.body !== "string") {
    headers.set("Content-Type", "application/json");
    options.body = JSON.stringify(options.body);
  }
  if (state.csrf && options.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) {
    headers.set("X-CSRF-Token", state.csrf);
  }
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : { error: await response.text() };
  if (!response.ok) {
    if (response.status === 401 && redirectOnUnauthorized) {
      state.user = null;
      state.csrf = null;
      showLogin();
    }
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("button[type='submit']", form);
  $("#login-error").textContent = "";
  setButtonLoading(button, true, "Signing in…");
  try {
    const formData = new FormData(form);
    const result = await api("api/auth.php?action=login", {
      method: "POST",
      body: { username: formData.get("username"), password: formData.get("password") },
    }, false);
    state.user = result.user;
    state.csrf = result.csrf_token;
    form.reset();
    showApplication();
    toast("success", "Signed in", `Welcome, ${state.user.full_name}.`);
  } catch (error) {
    $("#login-error").textContent = error.message;
  } finally {
    setButtonLoading(button, false);
  }
}

function showLogin() {
  $("#login-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
  window.setTimeout(() => $("#login-form input")?.focus(), 30);
}

function showApplication() {
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  renderNavigation();
  updateAccountSummary();
  const preferred = state.user.role === "Lab Technician" ? "lab" : "dashboard";
  navigate(preferred);
}

function renderNavigation() {
  const allowed = navItems.filter((item) => item.roles.includes(state.user.role));
  $("#nav-list").innerHTML = allowed.map((item) => `
    <button class="nav-link" type="button" data-view="${item.id}">
      <span class="nav-icon" aria-hidden="true">${item.icon}</span>
      <span>${escapeHtml(item.label)}</span>
      ${item.badge ? `<span class="nav-badge ${state.labPending ? "" : "hidden"}" id="lab-nav-badge">${state.labPending}</span>` : ""}
    </button>
  `).join("");
  $$(".nav-link", $("#nav-list")).forEach((button) => {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "logout") logout();
      else navigate(view);
      $("#sidebar").classList.remove("open");
    });
  });
}

function updateAccountSummary() {
  const initials = state.user.full_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  $("#header-avatar").textContent = initials;
  $("#header-name").textContent = state.user.full_name;
  $("#header-role").textContent = state.user.role;
}

async function logout() {
  try {
    await api("api/auth.php?action=logout", { method: "POST", body: {} });
  } catch (error) {
    toast("error", "Logout failed", error.message);
    return;
  }
  state.user = null;
  state.csrf = null;
  showLogin();
}

async function navigate(view) {
  state.view = view;
  $$(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const content = $("#page-content");
  content.innerHTML = loadingPage();
  content.focus();
  const renderers = {
    dashboard: renderDashboard,
    appointments: renderAppointments,
    patients: renderPatients,
    lab: renderLab,
    catalog: renderCatalog,
    reports: renderReports,
    staff: renderStaff,
    profile: renderProfile,
  };
  try {
    await renderers[view]();
  } catch (error) {
    renderFailure(error, () => navigate(view));
  }
}

function pageHeader(title, subtitle, actions = "") {
  return `<div class="page-header"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="header-actions">${actions}</div></div>`;
}

function loadingPage() {
  return `<div class="loading-page" aria-label="Loading"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
}

function renderFailure(error, retry) {
  $("#page-content").innerHTML = `${pageHeader("Something went wrong", "The requested information could not be loaded.")}<div class="alert error">${escapeHtml(error.message)}</div><button class="button button-primary" id="retry-button">Try again</button>`;
  $("#retry-button").addEventListener("click", retry);
}

async function renderDashboard() {
  const result = await api("api/dashboard.php");
  state.labPending = Number(result.lab_stats.samples_collected || 0) + Number(result.lab_stats.analyzing || 0);
  updatePendingBadge();
  const firstName = state.user.full_name.split(" ")[0];
  const rows = result.appointments.map((item) => `
    <tr><td class="cell-main">${escapeHtml(item.appointment_no)}</td><td>${formatTime(item.appointment_date)}</td><td><div class="cell-main">${escapeHtml(item.patient_name)}</div><div class="cell-sub">${escapeHtml(item.phone)}</div></td><td>${escapeHtml(item.tests || "—")}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.booked_by)}</td></tr>
  `).join("");
  const quickActions = [];
  if (["Admin", "Receptionist"].includes(state.user.role)) {
    quickActions.push(quickAction("◎", "New Patient", "Register a patient", "blue", "patients"));
    quickActions.push(quickAction("▣", "New Appointment", "Schedule diagnostic tests", "green", "appointments"));
  }
  quickActions.push(quickAction("△", "Test Catalog", "View available tests", "purple", "catalog"));
  quickActions.push(quickAction("≡", "Reports", "Open verified reports", "amber", "reports"));
  $("#page-content").innerHTML = `
    ${pageHeader(`Welcome, ${firstName} 👋`, "Here’s what is happening at the diagnostic center today.")}
    <section class="stats-grid">
      ${statCard("▣", "Total Appointments (Today)", result.stats.total_today, "Total scheduled for today", "blue")}
      ${statCard("◷", "Waiting Patients", result.stats.waiting, "Status: Scheduled", "amber")}
      ${statCard("△", "In Progress", result.stats.in_progress, "Status: In Progress", "purple")}
      ${statCard("✓", "Completed", result.stats.completed, "Reports completed today", "green")}
    </section>
    <section class="dashboard-grid">
      <div class="panel"><div class="panel-header"><div><h2>Today’s Appointments</h2><p>Current reception schedule</p></div>${["Admin", "Receptionist"].includes(state.user.role) ? '<button class="button button-primary button-small" data-go="appointments">+ New Appointment</button>' : ""}</div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Time</th><th>Patient</th><th>Tests</th><th>Status</th><th>Booked by</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${emptyInline("No appointments scheduled today.")}</td></tr>`}</tbody></table></div>
      </div>
      <div class="panel"><div class="panel-header"><div><h2>Quick Actions</h2><p>Common workspace tasks</p></div></div><div class="panel-body quick-actions">${quickActions.join("")}</div></div>
    </section>`;
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
}

function quickAction(icon, title, text, tone, view) {
  return `<button class="quick-action ${tone}" data-go="${view}"><span class="quick-action-icon">${icon}</span><span><strong>${title}</strong><span>${text}</span></span></button>`;
}

function statCard(icon, label, value, helper, tone) {
  return `<article class="stat-card"><div class="stat-icon ${tone}">${icon}</div><div><small>${escapeHtml(label)}</small><strong>${Number(value || 0)}</strong><span>${escapeHtml(helper)}</span></div></article>`;
}

async function renderPatients(page = 1, query = "") {
  const canEdit = ["Admin", "Receptionist"].includes(state.user.role);
  const result = await api(`api/patients.php?page=${page}&per_page=10&q=${encodeURIComponent(query)}`);
  state.caches.patients = result.data;
  const rows = result.data.map((patient) => `
    <tr>
      <td><div class="cell-main">${escapeHtml(patient.patient_no)}</div><div class="cell-sub">Added ${formatDate(patient.created_at)}</div></td>
      <td><div class="cell-main">${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}</div><div class="cell-sub">${genderLabel(patient.gender)} · DOB ${formatDate(patient.date_of_birth)}</div></td>
      <td>${escapeHtml(patient.phone)}<div class="cell-sub">${escapeHtml(patient.email || "No email")}</div></td>
      <td>${escapeHtml(patient.address || "—")}</td>
      <td><div class="row-actions"><button class="action-button view" data-patient-view="${patient.patient_id}" title="View">○</button>${canEdit ? `<button class="action-button edit" data-patient-edit="${patient.patient_id}" title="Edit">✎</button>` : ""}${state.user.role === "Admin" ? `<button class="action-button delete" data-patient-delete="${patient.patient_id}" title="Delete">×</button>` : ""}</div></td>
    </tr>`).join("");
  $("#page-content").innerHTML = `
    ${pageHeader("Patients", "Register and manage permanent patient records.", canEdit ? '<button class="button button-primary" id="new-patient">+ New Patient</button>' : "")}
    <form class="toolbar" id="patient-search"><input name="q" value="${escapeAttr(query)}" placeholder="Search name, number or phone"><span></span><span></span><button class="button button-primary" type="submit">Search</button></form>
    <div class="table-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Patient ID</th><th>Patient</th><th>Contact</th><th>Address</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="5">${emptyInline("No patients found.")}</td></tr>`}</tbody></table></div>${paginationHtml(result.pagination)}</div>`;
  $("#patient-search").addEventListener("submit", (event) => { event.preventDefault(); renderPatients(1, new FormData(event.currentTarget).get("q")); });
  $("#new-patient")?.addEventListener("click", () => openPatientForm());
  $$('[data-patient-view]').forEach((button) => button.addEventListener("click", () => viewPatient(button.dataset.patientView)));
  $$('[data-patient-edit]').forEach((button) => button.addEventListener("click", () => openPatientForm(findCached("patients", "patient_id", button.dataset.patientEdit))));
  $$('[data-patient-delete]').forEach((button) => button.addEventListener("click", () => deletePatient(button.dataset.patientDelete)));
  bindPagination((newPage) => renderPatients(newPage, query));
}

function viewPatient(id) {
  const patient = findCached("patients", "patient_id", id);
  openModal("Patient details", patient.patient_no, `<div class="detail-grid">${detail("Full name", `${patient.first_name} ${patient.last_name}`)}${detail("Date of birth", formatDate(patient.date_of_birth))}${detail("Gender", genderLabel(patient.gender))}${detail("Phone", patient.phone)}${detail("Email", patient.email || "—")}${detail("Address", patient.address || "—")}</div>`);
}

function openPatientForm(patient = null) {
  const editing = Boolean(patient);
  openModal(editing ? "Edit patient" : "Register new patient", editing ? patient.patient_no : "Create a permanent patient record.", `
    <form id="patient-form"><div class="form-grid">
      ${fieldInput("First name", "first_name", patient?.first_name, true)}${fieldInput("Last name", "last_name", patient?.last_name, true)}
      ${fieldInput("Date of birth", "date_of_birth", patient?.date_of_birth, true, "date")}
      ${fieldSelect("Gender", "gender", [["F","Female"],["M","Male"],["Other","Other"]], patient?.gender, true)}
      ${fieldInput("Phone", "phone", patient?.phone, true, "tel")}${fieldInput("Email", "email", patient?.email, false, "email")}
      <label class="field full"><span>Address</span><textarea name="address">${escapeHtml(patient?.address || "")}</textarea></label>
    </div><div class="modal-footer"><button type="button" class="button button-secondary" data-close-modal>Cancel</button><button class="button button-primary" type="submit">${editing ? "Save changes" : "Save patient"}</button></div></form>`);
  $("#patient-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("button[type='submit']", event.currentTarget);
    setButtonLoading(button, true, "Saving…");
    try {
      const data = formObject(event.currentTarget);
      if (editing) data.patient_id = Number(patient.patient_id);
      await api("api/patients.php", { method: editing ? "PUT" : "POST", body: data });
      closeModal(); toast("success", editing ? "Patient updated" : "Patient registered", "The patient record was saved successfully."); renderPatients();
    } catch (error) { toast("error", "Could not save patient", error.message); setButtonLoading(button, false); }
  });
}

async function deletePatient(id) {
  if (!await confirmAction("Delete patient?", "This also removes the patient’s appointments and laboratory records. This cannot be undone.")) return;
  try { await api("api/patients.php", { method: "DELETE", body: { patient_id: Number(id) } }); toast("success", "Patient deleted", "The record was removed."); renderPatients(); }
  catch (error) { toast("error", "Delete failed", error.message); }
}

async function renderAppointments(page = 1, filters = {}) {
  const params = new URLSearchParams({ page, per_page: 10, q: filters.q || "", status: filters.status || "", date: filters.date || "" });
  const result = await api(`api/appointments.php?${params}`);
  state.caches.appointments = result.data;
  const rows = result.data.map((item) => `<tr>
    <td><div class="cell-main">${escapeHtml(item.appointment_no)}</div><div class="cell-sub">${escapeHtml(item.patient_no)}</div></td>
    <td><div class="cell-main">${formatDateTime(item.appointment_date)}</div><div class="cell-sub">${escapeHtml(item.booked_by)}</div></td>
    <td><div class="cell-main">${escapeHtml(item.patient_name)}</div><div class="cell-sub">${escapeHtml(item.phone)}</div></td>
    <td>${escapeHtml(item.tests || "—")}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td>
    <td><div class="row-actions"><button class="action-button view" data-appointment-view="${item.appointment_id}" title="View">○</button><button class="action-button edit" data-appointment-edit="${item.appointment_id}" title="Edit">✎</button>${state.user.role === "Admin" ? `<button class="action-button delete" data-appointment-delete="${item.appointment_id}" title="Delete">×</button>` : ""}</div></td>
  </tr>`).join("");
  $("#page-content").innerHTML = `
    ${pageHeader("Appointments", "Schedule patient visits and diagnostic tests.", '<button class="button button-primary" id="new-appointment">+ New Appointment</button>')}
    <form class="toolbar" id="appointment-filters"><input name="q" value="${escapeAttr(filters.q || "")}" placeholder="Search patient or appointment"><select name="status"><option value="">All statuses</option>${["Scheduled","In Progress","Completed","Cancelled"].map((value) => `<option ${filters.status === value ? "selected" : ""}>${value}</option>`).join("")}</select><input name="date" type="date" value="${escapeAttr(filters.date || "")}"><button class="button button-primary" type="submit">Search</button></form>
    <div class="table-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Date & time</th><th>Patient</th><th>Tests</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${emptyInline("No appointments found.")}</td></tr>`}</tbody></table></div>${paginationHtml(result.pagination)}</div>`;
  $("#appointment-filters").addEventListener("submit", (event) => { event.preventDefault(); renderAppointments(1, formObject(event.currentTarget)); });
  $("#new-appointment").addEventListener("click", openAppointmentForm);
  $$('[data-appointment-view]').forEach((button) => button.addEventListener("click", () => viewAppointment(button.dataset.appointmentView)));
  $$('[data-appointment-edit]').forEach((button) => button.addEventListener("click", () => openAppointmentEdit(findCached("appointments", "appointment_id", button.dataset.appointmentEdit))));
  $$('[data-appointment-delete]').forEach((button) => button.addEventListener("click", () => deleteAppointment(button.dataset.appointmentDelete)));
  bindPagination((newPage) => renderAppointments(newPage, filters));
}

async function openAppointmentForm() {
  try {
    const [patients, tests] = await Promise.all([api("api/patients.php?page=1&per_page=100"), api("api/tests.php")]);
    if (!patients.data.length) { toast("error", "No patients", "Register a patient before creating an appointment."); return; }
    openModal("New appointment", "Choose a patient, time and one or more diagnostic tests.", `
      <form id="appointment-form"><div class="form-grid">
        <label class="field full"><span>Patient</span><select name="patient_id" required><option value="">Select patient</option>${patients.data.map((p) => `<option value="${p.patient_id}">${escapeHtml(p.patient_no)} — ${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</option>`).join("")}</select></label>
        ${fieldInput("Appointment date and time", "appointment_date", localDateTimeInput(), true, "datetime-local")}
        <label class="field full"><span>Notes</span><textarea name="notes" placeholder="Optional appointment notes"></textarea></label>
        <div class="field full"><span>Diagnostic tests</span><div class="checkbox-grid">${tests.data.map((test) => `<label class="check-card"><input type="checkbox" name="test_ids" value="${test.test_id}"><span><strong>${escapeHtml(test.test_name)}</strong><span>${money(test.price)} · ${escapeHtml(test.category)}</span></span></label>`).join("")}</div></div>
      </div><div class="modal-footer"><button type="button" class="button button-secondary" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Save appointment</button></div></form>`, true);
    $("#appointment-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = formObject(event.currentTarget);
      data.patient_id = Number(data.patient_id);
      data.test_ids = $$('input[name="test_ids"]:checked', event.currentTarget).map((item) => Number(item.value));
      const button = $("button[type='submit']", event.currentTarget); setButtonLoading(button, true, "Saving…");
      try { await api("api/appointments.php", { method: "POST", body: data }); closeModal(); toast("success", "Appointment created", "The selected tests are now in the laboratory workflow."); renderAppointments(); }
      catch (error) { toast("error", "Could not create appointment", error.message); setButtonLoading(button, false); }
    });
  } catch (error) { toast("error", "Unable to open appointment form", error.message); }
}

function viewAppointment(id) {
  const item = findCached("appointments", "appointment_id", id);
  openModal("Appointment details", item.appointment_no, `<div class="detail-grid">${detail("Patient", item.patient_name)}${detail("Patient number", item.patient_no)}${detail("Date and time", formatDateTime(item.appointment_date))}${detail("Status", item.status)}${detail("Tests", item.tests || "—")}${detail("Booked by", item.booked_by)}<div class="detail-card" style="grid-column:1/-1"><small>Notes</small><strong>${escapeHtml(item.notes || "No notes")}</strong></div></div>`);
}

function openAppointmentEdit(item) {
  openModal("Update appointment", item.appointment_no, `<form id="appointment-edit-form"><div class="form-grid">${fieldInput("Date and time", "appointment_date", toInputDateTime(item.appointment_date), true, "datetime-local")}${fieldSelect("Status", "status", ["Scheduled","In Progress","Completed","Cancelled"].map((x) => [x,x]), item.status, true)}<label class="field full"><span>Notes</span><textarea name="notes">${escapeHtml(item.notes || "")}</textarea></label></div><div class="modal-footer"><button type="button" class="button button-secondary" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Save changes</button></div></form>`);
  $("#appointment-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const data = formObject(event.currentTarget); data.appointment_id = Number(item.appointment_id);
    try { await api("api/appointments.php", { method: "PUT", body: data }); closeModal(); toast("success", "Appointment updated", "Changes saved."); renderAppointments(); }
    catch (error) { toast("error", "Update failed", error.message); }
  });
}

async function deleteAppointment(id) {
  if (!await confirmAction("Delete appointment?", "All test results attached to this appointment will also be removed.")) return;
  try { await api("api/appointments.php", { method: "DELETE", body: { appointment_id: Number(id) } }); toast("success", "Appointment deleted", "The appointment was removed."); renderAppointments(); }
  catch (error) { toast("error", "Delete failed", error.message); }
}

async function renderCatalog() {
  const isAdmin = state.user.role === "Admin";
  const result = await api(`api/tests.php?include_inactive=${isAdmin ? "1" : "0"}`);
  state.caches.tests = result.data;
  const rows = result.data.map((test) => `<tr><td><div class="cell-main">${escapeHtml(test.test_code)}</div></td><td><div class="cell-main">${escapeHtml(test.test_name)}</div><div class="cell-sub">${escapeHtml(test.specimen || "No specimen")}</div></td><td>${escapeHtml(test.category)}</td><td>${escapeHtml(test.normal_range)} ${escapeHtml(test.unit || "")}</td><td>${money(test.price)}</td><td><span class="status ${Number(test.active) ? "active" : "inactive"}">${Number(test.active) ? "Active" : "Inactive"}</span></td><td>${isAdmin ? `<div class="row-actions"><button class="action-button edit" data-test-edit="${test.test_id}">✎</button><button class="action-button delete" data-test-delete="${test.test_id}">×</button></div>` : "View only"}</td></tr>`).join("");
  $("#page-content").innerHTML = `${pageHeader("Test Catalog", isAdmin ? "Manage diagnostic tests, prices and reference ranges." : "View available diagnostic tests and reference ranges.", isAdmin ? '<button class="button button-primary" id="new-test">+ New Test</button>' : "")}<div class="table-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Test</th><th>Category</th><th>Reference range</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="7">${emptyInline("No tests in the catalog.")}</td></tr>`}</tbody></table></div></div>`;
  $("#new-test")?.addEventListener("click", () => openTestForm());
  $$('[data-test-edit]').forEach((button) => button.addEventListener("click", () => openTestForm(findCached("tests", "test_id", button.dataset.testEdit))));
  $$('[data-test-delete]').forEach((button) => button.addEventListener("click", () => deleteTest(button.dataset.testDelete)));
}

function openTestForm(test = null) {
  const editing = Boolean(test);
  openModal(editing ? "Edit diagnostic test" : "Add diagnostic test", "Catalog details are used in appointments and reports.", `<form id="test-form"><div class="form-grid">${fieldInput("Test code", "test_code", test?.test_code, true)}${fieldInput("Test name", "test_name", test?.test_name, true)}${fieldInput("Category", "category", test?.category, true)}${fieldInput("Specimen", "specimen", test?.specimen)}${fieldInput("Price (GHS)", "price", test?.price, true, "number", 'step="0.01" min="0"')}${fieldInput("Unit", "unit", test?.unit)}${fieldInput("Normal reference range", "normal_range", test?.normal_range, true)}${fieldSelect("Status", "active", [["1","Active"],["0","Inactive"]], String(test?.active ?? 1), true)}</div><div class="modal-footer"><button type="button" class="button button-secondary" data-close-modal>Cancel</button><button class="button button-primary" type="submit">Save test</button></div></form>`);
  $("#test-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const data = formObject(event.currentTarget); data.price = Number(data.price); data.active = data.active === "1"; if (editing) data.test_id = Number(test.test_id);
    try { await api("api/tests.php", { method: editing ? "PUT" : "POST", body: data }); closeModal(); toast("success", editing ? "Test updated" : "Test added", "The catalog was saved."); renderCatalog(); }
    catch (error) { toast("error", "Could not save test", error.message); }
  });
}

async function deleteTest(id) {
  if (!await confirmAction("Remove test?", "Tests already used in reports will be deactivated instead of permanently deleted.")) return;
  try { const result = await api("api/tests.php", { method: "DELETE", body: { test_id: Number(id) } }); toast("success", result.deactivated ? "Test deactivated" : "Test deleted", "The catalog was updated."); renderCatalog(); }
  catch (error) { toast("error", "Action failed", error.message); }
}

async function renderLab() {
  try {
    const result = await api("api/lab.php?action=worklist");
    state.caches.lab = result.data;
    state.labPending = result.stats.pending;
    updatePendingBadge();
    const rows = result.data.map((item) => `<tr><td><div class="cell-main">RES-${item.result_id}</div><div class="cell-sub">${escapeHtml(item.appointment_no)}</div></td><td><div class="cell-main">${escapeHtml(item.first_name)} ${escapeHtml(item.last_name)}</div><div class="cell-sub">${escapeHtml(item.patient_no)} · ${genderLabel(item.gender)}</div></td><td><div class="cell-main">${escapeHtml(item.test_name)}</div><div class="cell-sub">${escapeHtml(item.specimen || "—")}</div></td><td>${escapeHtml(item.normal_range)} ${escapeHtml(item.unit || "")}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td>${item.status === "Sample Collected" ? `<button class="button button-secondary button-small" data-lab-start="${item.result_id}">△ Begin Analysis</button>` : `<button class="button button-primary button-small" data-lab-complete="${item.result_id}">Enter Findings</button>`}</td></tr>`).join("");
    $("#page-content").innerHTML = `${pageHeader("Laboratory – Worklist", "Review samples, record findings and release verified reports.")}<section class="stats-grid">${statCard("▤", "Pending Samples", result.stats.pending, "All active laboratory tests", "blue")}${statCard("◷", "Awaiting Analysis", result.stats.samples_collected, "Sample collected", "amber")}${statCard("△", "Analyzing", result.stats.analyzing, "Currently being processed", "purple")}${statCard("✓", "Report Ready", "—", "See the Reports section", "green")}</section><div class="table-panel" style="margin-top:16px"><div class="table-wrap"><table class="data-table"><thead><tr><th>Result ID</th><th>Patient</th><th>Test</th><th>Reference range</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${emptyInline("No tests are waiting in the laboratory.")}</td></tr>`}</tbody></table></div></div>`;
    $$('[data-lab-start]').forEach((button) => button.addEventListener("click", () => startLabResult(button.dataset.labStart)));
    $$('[data-lab-complete]').forEach((button) => button.addEventListener("click", () => openResultForm(findCached("lab", "result_id", button.dataset.labComplete))));
  } catch (error) {
    $("#page-content").innerHTML = `${pageHeader("Laboratory – Worklist", "The Flask service processes laboratory results and PDF reports.")}<div class="alert error"><strong>Laboratory service unavailable.</strong><br>${escapeHtml(error.message)}</div><div class="panel"><div class="panel-body"><h3>Start it locally</h3><p class="muted">Run <strong>flask-service\\setup_flask.bat</strong> once, then keep <strong>flask-service\\run_flask.bat</strong> open.</p><button class="button button-primary" id="retry-lab">Try again</button></div></div>`;
    $("#retry-lab").addEventListener("click", renderLab);
  }
}

async function startLabResult(id) {
  try { await api("api/lab.php?action=start", { method: "POST", body: { result_id: Number(id) } }); toast("success", "Analysis started", "The sample is now marked as analyzing."); renderLab(); }
  catch (error) { toast("error", "Could not start analysis", error.message); }
}

function openResultForm(item) {
  openModal("Enter laboratory findings", `${item.patient_no} · ${item.test_name}`, `<div class="detail-grid" style="margin-bottom:16px">${detail("Patient", `${item.first_name} ${item.last_name}`)}${detail("Reference range", `${item.normal_range} ${item.unit || ""}`)}</div><form id="result-form"><div class="form-stack"><label class="field"><span>Result / findings</span><textarea name="result_value" required placeholder="Enter measured value and findings"></textarea></label><label class="field"><span>Technician notes</span><textarea name="result_notes" placeholder="Optional notes for the report"></textarea></label></div><div class="modal-footer"><button type="button" class="button button-secondary" data-close-modal>Cancel</button><button class="button button-success" type="submit">Verify & release report</button></div></form>`);
  $("#result-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const data = formObject(event.currentTarget); data.result_id = Number(item.result_id);
    try { await api("api/lab.php?action=complete", { method: "POST", body: data }); closeModal(); toast("success", "Report released", "The verified report is ready for download."); renderLab(); }
    catch (error) { toast("error", "Could not save findings", error.message); }
  });
}

async function renderReports(page = 1, query = "") {
  const result = await api(`api/reports.php?page=${page}&per_page=10&q=${encodeURIComponent(query)}`);
  const rows = result.data.map((report) => `<tr><td><div class="cell-main">RES-${report.result_id}</div><div class="cell-sub">${escapeHtml(report.appointment_no)}</div></td><td><div class="cell-main">${escapeHtml(report.patient_name)}</div><div class="cell-sub">${escapeHtml(report.patient_no)}</div></td><td><div class="cell-main">${escapeHtml(report.test_name)}</div><div class="cell-sub">${escapeHtml(report.test_code)}</div></td><td>${escapeHtml(report.result_value)}</td><td>${escapeHtml(report.verified_by || "Lab Technician")}<div class="cell-sub">${formatDateTime(report.completed_at)}</div></td><td><a class="button button-primary button-small" href="api/lab.php?action=report-pdf&result_id=${report.result_id}" target="_blank" rel="noopener">↓ PDF</a></td></tr>`).join("");
  $("#page-content").innerHTML = `${pageHeader("Reports", "Search and download completed diagnostic reports.")}<form class="toolbar" id="report-search"><input name="q" value="${escapeAttr(query)}" placeholder="Search patient, test or appointment"><span></span><span></span><button class="button button-primary">Search</button></form><div class="table-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Report</th><th>Patient</th><th>Test</th><th>Findings</th><th>Verified by</th><th>Download</th></tr></thead><tbody>${rows || `<tr><td colspan="6">${emptyInline("No completed reports found.")}</td></tr>`}</tbody></table></div>${paginationHtml(result.pagination)}</div>`;
  $("#report-search").addEventListener("submit", (event) => { event.preventDefault(); renderReports(1, new FormData(event.currentTarget).get("q")); });
  bindPagination((newPage) => renderReports(newPage, query));
}

async function renderStaff() {
  const result = await api("api/staff.php"); state.caches.staff = result.data;
  const rows = result.data.map((member) => `<tr><td><div class="cell-main">${escapeHtml(member.full_name)}</div><div class="cell-sub">@${escapeHtml(member.username)}</div></td><td>${escapeHtml(member.role)}</td><td>${escapeHtml(member.email || "—")}<div class="cell-sub">${escapeHtml(member.phone || "No phone")}</div></td><td><span class="status ${Number(member.active) ? "active" : "inactive"}">${Number(member.active) ? "Active" : "Inactive"}</span></td><td>${formatDate(member.created_at)}</td><td><div class="row-actions"><button class="action-button edit" data-staff-edit="${member.staff_id}" title="Edit">✎</button><button class="action-button view" data-staff-password="${member.staff_id}" title="Reset password">⌘</button>${Number(member.staff_id) !== Number(state.user.staff_id) ? `<button class="action-button delete" data-staff-delete="${member.staff_id}" title="Deactivate">×</button>` : ""}</div></td></tr>`).join("");
  $("#page-content").innerHTML = `${pageHeader("Staff Accounts", "Manage employee access and role permissions.", '<button class="button button-primary" id="new-staff">+ New Staff Account</button>')}<div class="table-panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Staff member</th><th>Role</th><th>Contact</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  $("#new-staff").addEventListener("click", () => openStaffForm());
  $$('[data-staff-edit]').forEach((button) => button.addEventListener("click", () => openStaffForm(findCached("staff", "staff_id", button.dataset.staffEdit))));
  $$('[data-staff-password]').forEach((button) => button.addEventListener("click", () => resetStaffPassword(findCached("staff", "staff_id", button.dataset.staffPassword))));
  $$('[data-staff-delete]').forEach((button) => button.addEventListener("click", () => deactivateStaff(button.dataset.staffDelete)));
}

function openStaffForm(member = null) {
  const editing = Boolean(member);
  openModal(editing ? "Edit staff account" : "Create staff account", "Roles control which sections and actions the user can access.", `<form id="staff-form"><div class="form-grid">${fieldInput("Full name", "full_name", member?.full_name, true)}${editing ? fieldInput("Username", "username", member.username, true, "text", "disabled") : fieldInput("Username", "username", "", true)}${fieldSelect("Role", "role", ["Admin","Receptionist","Lab Technician"].map((x) => [x,x]), member?.role, true)}${fieldSelect("Status", "active", [["1","Active"],["0","Inactive"]], String(member?.active ?? 1), true)}${fieldInput("Email", "email", member?.email, false, "email")}${fieldInput("Phone", "phone", member?.phone, false, "tel")}${!editing ? fieldInput("Temporary password", "password", "", true, "password", 'minlength="8"') : ""}</div><div class="modal-footer"><button type="button" class="button button-secondary" data-close-modal>Cancel</button><button class="button button-primary">Save account</button></div></form>`);
  $("#staff-form").addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); data.active = data.active === "1"; if (editing) data.staff_id = Number(member.staff_id); try { await api("api/staff.php", { method: editing ? "PUT" : "POST", body: data }); closeModal(); toast("success", "Staff account saved", "Access settings were updated."); renderStaff(); } catch (error) { toast("error", "Could not save account", error.message); } });
}

function resetStaffPassword(member) {
  openModal("Reset staff password", `Set a new temporary password for ${member.full_name}.`, `<form id="password-reset-form"><label class="field"><span>New password</span><input name="password" type="password" minlength="8" required></label><div class="modal-footer"><button type="button" class="button button-secondary" data-close-modal>Cancel</button><button class="button button-primary">Reset password</button></div></form>`);
  $("#password-reset-form").addEventListener("submit", async (event) => { event.preventDefault(); const data = formObject(event.currentTarget); data.staff_id = Number(member.staff_id); data.action = "reset-password"; try { await api("api/staff.php", { method: "PUT", body: data }); closeModal(); toast("success", "Password reset", "Give the temporary password to the staff member securely."); } catch (error) { toast("error", "Reset failed", error.message); } });
}

async function deactivateStaff(id) {
  if (!await confirmAction("Deactivate staff account?", "The staff member will no longer be able to sign in.")) return;
  try { await api("api/staff.php", { method: "DELETE", body: { staff_id: Number(id) } }); toast("success", "Account deactivated", "Access has been removed."); renderStaff(); } catch (error) { toast("error", "Action failed", error.message); }
}

async function renderProfile() {
  const result = await api("api/profile.php"); const profile = result.data;
  $("#page-content").innerHTML = `${pageHeader("Profile", "Update your contact details and password.")}<div class="dashboard-grid"><div class="panel"><div class="panel-header"><div><h2>Personal information</h2><p>Your staff profile</p></div></div><div class="panel-body"><form id="profile-form"><div class="form-grid">${fieldInput("Full name", "full_name", profile.full_name, true)}${fieldInput("Username", "username", profile.username, true, "text", "disabled")}${fieldInput("Role", "role", profile.role, true, "text", "disabled")}${fieldInput("Email", "email", profile.email, false, "email")}${fieldInput("Phone", "phone", profile.phone, false, "tel")}</div><div class="modal-footer"><button class="button button-primary">Save profile</button></div></form></div></div><div class="panel"><div class="panel-header"><div><h2>Change password</h2><p>Use at least eight characters</p></div></div><div class="panel-body"><form id="own-password-form" class="form-stack">${fieldInput("Current password", "current_password", "", true, "password")}${fieldInput("New password", "new_password", "", true, "password", 'minlength="8"')}<button class="button button-primary">Update password</button></form></div></div></div>`;
  $("#profile-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const response = await api("api/profile.php", { method: "PUT", body: formObject(event.currentTarget) }); state.user = response.user; updateAccountSummary(); renderNavigation(); toast("success", "Profile updated", "Your information was saved."); } catch (error) { toast("error", "Update failed", error.message); } });
  $("#own-password-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await api("api/auth.php?action=change-password", { method: "POST", body: formObject(event.currentTarget) }); event.currentTarget.reset(); toast("success", "Password changed", "Use the new password next time you sign in."); } catch (error) { toast("error", "Password not changed", error.message); } });
}

function updatePendingBadge() {
  $("#notification-count").textContent = state.labPending;
  const badge = $("#lab-nav-badge");
  if (badge) { badge.textContent = state.labPending; badge.classList.toggle("hidden", state.labPending === 0); }
}

function openModal(title, subtitle, body, wide = false) {
  const layer = $("#modal-layer"); const modal = $(".modal", layer);
  modal.classList.toggle("wide", wide);
  $("#modal-content").innerHTML = `<div class="modal-header"><h2 id="modal-title">${escapeHtml(title)}</h2><p>${escapeHtml(subtitle || "")}</p></div>${body}`;
  layer.classList.remove("hidden"); layer.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden";
  window.setTimeout(() => $("input, select, textarea, button", $("#modal-content"))?.focus(), 20);
}

function closeModal() {
  $("#modal-layer").classList.add("hidden"); $("#modal-layer").setAttribute("aria-hidden", "true"); document.body.style.overflow = "";
}

function confirmAction(title, message) {
  return new Promise((resolve) => {
    const layer = $("#confirm-layer"); $("#confirm-title").textContent = title; $("#confirm-message").textContent = message; layer.classList.remove("hidden"); layer.setAttribute("aria-hidden", "false");
    const finish = (answer) => { layer.classList.add("hidden"); layer.setAttribute("aria-hidden", "true"); ok.onclick = null; cancel.onclick = null; resolve(answer); };
    const ok = $("#confirm-ok"); const cancel = $("#confirm-cancel"); ok.onclick = () => finish(true); cancel.onclick = () => finish(false);
  });
}

function toast(type, title, message) {
  const item = document.createElement("div"); item.className = `toast ${type}`; item.innerHTML = `<b>${type === "success" ? "✓" : type === "error" ? "!" : "i"}</b><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`; $("#toast-region").append(item); window.setTimeout(() => item.remove(), 4500);
}

function setButtonLoading(button, loading, label = "Please wait…") {
  if (!button) return;
  if (loading) { button.dataset.original = button.innerHTML; button.disabled = true; button.textContent = label; }
  else { button.disabled = false; if (button.dataset.original) button.innerHTML = button.dataset.original; }
}

function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function findCached(cache, key, id) { return state.caches[cache].find((item) => String(item[key]) === String(id)); }
function detail(label, value) { return `<div class="detail-card"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value ?? "—")}</strong></div>`; }
function emptyInline(text) { return `<div class="empty-state"><div><b>○</b><h3>Nothing to display</h3><p>${escapeHtml(text)}</p></div></div>`; }
function genderLabel(value) { return value === "F" ? "Female" : value === "M" ? "Male" : value; }
function statusClass(value) { return String(value).toLowerCase().replaceAll(" ", "-"); }
function money(value) { return new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS" }).format(Number(value || 0)); }
function formatDate(value) { if (!value) return "—"; const date = new Date(String(value).includes("T") ? value : `${String(value).replace(" ", "T")}Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GH", { day: "2-digit", month: "short", year: "numeric" }).format(date); }
function formatDateTime(value) { if (!value) return "—"; const date = new Date(String(value).includes("T") ? value : `${String(value).replace(" ", "T")}Z`); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GH", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
function formatTime(value) { if (!value) return "—"; const date = new Date(`${String(value).replace(" ", "T")}Z`); return new Intl.DateTimeFormat("en-GH", { hour: "2-digit", minute: "2-digit" }).format(date); }
function localDateTimeInput() { const date = new Date(Date.now() + 30 * 60 * 1000); date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function toInputDateTime(value) { if (!value) return ""; return String(value).replace(" ", "T").slice(0, 16); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
function escapeAttr(value) { return escapeHtml(value); }

function fieldInput(label, name, value = "", required = false, type = "text", extra = "") {
  return `<label class="field"><span>${escapeHtml(label)}${required ? " *" : ""}</span><input name="${escapeAttr(name)}" type="${escapeAttr(type)}" value="${escapeAttr(value ?? "")}" ${required ? "required" : ""} ${extra}></label>`;
}

function fieldSelect(label, name, options, selected = "", required = false) {
  return `<label class="field"><span>${escapeHtml(label)}${required ? " *" : ""}</span><select name="${escapeAttr(name)}" ${required ? "required" : ""}>${options.map(([value, text]) => `<option value="${escapeAttr(value)}" ${String(selected) === String(value) ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
}

function paginationHtml(pagination) {
  if (!pagination || pagination.pages <= 1) return `<div class="pagination"><span>Showing ${pagination?.total || 0} records</span></div>`;
  const buttons = [];
  for (let page = 1; page <= pagination.pages; page += 1) {
    if (page === 1 || page === pagination.pages || Math.abs(page - pagination.page) <= 2) buttons.push(`<button class="page-button ${page === pagination.page ? "active" : ""}" data-page="${page}">${page}</button>`);
    else if (buttons.at(-1) !== "<span>…</span>") buttons.push("<span>…</span>");
  }
  return `<div class="pagination"><span>${pagination.total} records · Page ${pagination.page} of ${pagination.pages}</span><div class="pagination-buttons">${buttons.join("")}</div></div>`;
}

function bindPagination(callback) { $$('[data-page]').forEach((button) => button.addEventListener("click", () => callback(Number(button.dataset.page)))); }

function updateClock() {
  const now = new Date();
  $("#sidebar-day").textContent = new Intl.DateTimeFormat("en-GH", { weekday: "long" }).format(now);
  $("#sidebar-date").textContent = new Intl.DateTimeFormat("en-GH", { day: "2-digit", month: "short", year: "numeric" }).format(now);
  $("#sidebar-time").textContent = new Intl.DateTimeFormat("en-GH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
}

