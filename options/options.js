"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLORS = [
  "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71",
  "#1abc9c", "#3498db", "#9b59b6", "#95a5a6",
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let groups        = [];
let settings      = { extensionEnabled: true };
let editingGroup  = null;   // group being edited (null = new group)
let selectedColor = COLORS[0];

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function loadData() {
  const data = await browser.storage.local.get(["groups", "settings"]);
  groups   = data.groups   || [];
  settings = data.settings || { extensionEnabled: true };
}

async function saveGroups() {
  await browser.storage.local.set({ groups });
}

async function saveSettings() {
  await browser.storage.local.set({ settings });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateId() {
  return crypto.randomUUID();
}

/**
 * Validates and normalises a hostname string.
 * Returns the cleaned hostname, or null if invalid.
 */
function validateDomain(raw) {
  const s = raw.trim().toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!s) return null;
  // Very basic check: must contain at least one dot and no spaces
  if (!/^[a-z0-9._-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderGroupList() {
  const container = document.getElementById("groupList");
  container.innerHTML = "";

  if (groups.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No block groups yet. Create one to get started.</p>
        <button class="btn btn-primary" id="emptyAddBtn">+ New Group</button>
      </div>`;
    container.querySelector("#emptyAddBtn").addEventListener("click", () => openEditor(null));
    return;
  }

  for (const group of groups) {
    const card = document.createElement("div");
    card.className = "group-card";
    card.style.borderLeftColor = group.color || COLORS[0];

    const domainCount   = group.domains.length;
    const scheduleCount = group.schedules.length;

    card.innerHTML = `
      <div class="group-card-info">
        <div class="group-card-name">${escHtml(group.name)}</div>
        <div class="group-card-meta">
          ${domainCount} domain${domainCount !== 1 ? "s" : ""} &bull;
          ${scheduleCount} schedule${scheduleCount !== 1 ? "s" : ""}
        </div>
      </div>
      <div class="group-card-actions">
        <button class="btn btn-ghost btn-sm edit-btn" data-id="${group.id}">Edit</button>
      </div>`;

    card.querySelector(".edit-btn").addEventListener("click", () => openEditor(group));
    container.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Editor open / close
// ---------------------------------------------------------------------------

function openEditor(group) {
  editingGroup = group;
  const editor = document.getElementById("editor");

  document.getElementById("editorTitle").textContent = group ? "Edit Group" : "New Group";
  document.getElementById("groupName").value = group ? group.name : "";
  document.getElementById("domainError").classList.add("hidden");
  document.getElementById("domainError").textContent = "";

  // Domain textarea
  document.getElementById("domainList").value = group ? group.domains.join("\n") : "";

  // Colour swatches
  selectedColor = (group && group.color) ? group.color : COLORS[0];
  renderColorSwatches();

  // Schedules
  const scheduleContainer = document.getElementById("scheduleList");
  scheduleContainer.innerHTML = "";
  if (group) {
    for (const sched of group.schedules) appendScheduleRow(sched);
  }

  // Delete button
  document.getElementById("deleteGroupBtn").classList.toggle("hidden", !group);

  editor.classList.remove("hidden");
  editor.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("groupName").focus();
}

function closeEditor() {
  document.getElementById("editor").classList.add("hidden");
  editingGroup = null;
}

// ---------------------------------------------------------------------------
// Colour swatches
// ---------------------------------------------------------------------------

function renderColorSwatches() {
  const container = document.getElementById("colorSwatches");
  container.innerHTML = "";
  for (const color of COLORS) {
    const swatch = document.createElement("button");
    swatch.className = "color-swatch" + (color === selectedColor ? " selected" : "");
    swatch.style.background = color;
    swatch.title = color;
    swatch.type = "button";
    swatch.addEventListener("click", () => {
      selectedColor = color;
      container.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
      swatch.classList.add("selected");
    });
    container.appendChild(swatch);
  }
}

// ---------------------------------------------------------------------------
// Schedule rows
// ---------------------------------------------------------------------------

function appendScheduleRow(sched) {
  const template = document.getElementById("scheduleTemplate");
  const row = template.content.cloneNode(true).querySelector(".schedule-row");
  const id = sched ? sched.id : generateId();
  row.dataset.id = id;

  // Days
  const days = sched ? sched.days : [1, 2, 3, 4, 5];
  row.querySelectorAll(".day-pill").forEach(pill => {
    const d = parseInt(pill.dataset.day, 10);
    if (days.includes(d)) pill.classList.add("active");
    pill.addEventListener("click", () => pill.classList.toggle("active"));
  });

  // Times
  if (sched) {
    row.querySelector(".time-start").value = sched.startTime;
    row.querySelector(".time-end").value   = sched.endTime;
  }

  // Block type radio name (must be unique per row)
  const radioName = "blockType-" + id;
  row.querySelectorAll("input[type='radio']").forEach(r => { r.name = radioName; });

  if (sched && sched.blockType === "timed") {
    row.querySelector(".radio-timed").checked = true;
    row.querySelector(".time-limit-wrap").classList.remove("hidden");
  } else {
    row.querySelector(".radio-full").checked = true;
  }

  if (sched && sched.timeLimit) {
    row.querySelector(".time-limit-input").value = sched.timeLimit;
  }

  // Toggle time-limit input visibility
  row.querySelectorAll("input[type='radio']").forEach(r => {
    r.addEventListener("change", () => {
      const wrap = row.querySelector(".time-limit-wrap");
      wrap.classList.toggle("hidden", r.value !== "timed" || !r.checked);
      if (r.value === "timed" && r.checked) wrap.classList.remove("hidden");
    });
  });

  // Delete schedule
  row.querySelector(".delete-schedule").addEventListener("click", () => row.remove());

  document.getElementById("scheduleList").appendChild(row);
}

function collectScheduleRows() {
  const rows = document.querySelectorAll("#scheduleList .schedule-row");
  const schedules = [];
  for (const row of rows) {
    const days = [];
    row.querySelectorAll(".day-pill.active").forEach(p => days.push(parseInt(p.dataset.day, 10)));

    const startTime = row.querySelector(".time-start").value;
    const endTime   = row.querySelector(".time-end").value;
    const blockType = row.querySelector(".radio-timed").checked ? "timed" : "full";
    const timeLimit = parseInt(row.querySelector(".time-limit-input").value, 10) || 30;

    schedules.push({
      id: row.dataset.id || generateId(),
      days,
      startTime,
      endTime,
      blockType,
      timeLimit,
    });
  }
  return schedules;
}

// ---------------------------------------------------------------------------
// Save / delete
// ---------------------------------------------------------------------------

function saveGroup() {
  const nameRaw = document.getElementById("groupName").value.trim();
  if (!nameRaw) {
    document.getElementById("groupName").focus();
    return;
  }

  // Parse and validate domains
  const domainLines = document.getElementById("domainList").value.split("\n");
  const domains = [];
  const bad = [];
  for (const line of domainLines) {
    if (!line.trim()) continue;
    const clean = validateDomain(line);
    if (clean) domains.push(clean);
    else bad.push(line.trim());
  }

  const errEl = document.getElementById("domainError");
  if (bad.length) {
    errEl.textContent = "Invalid domains (will be skipped): " + bad.join(", ");
    errEl.classList.remove("hidden");
  } else {
    errEl.classList.add("hidden");
  }

  const schedules = collectScheduleRows();

  if (editingGroup) {
    // Update in place
    const idx = groups.findIndex(g => g.id === editingGroup.id);
    if (idx !== -1) {
      groups[idx] = {
        ...groups[idx],
        name: nameRaw,
        color: selectedColor,
        domains,
        schedules,
      };
    }
  } else {
    groups.push({
      id: generateId(),
      name: nameRaw,
      color: selectedColor,
      domains,
      schedules,
    });
  }

  saveGroups().then(() => {
    closeEditor();
    renderGroupList();
  }).catch(err => console.error("Failed to save groups:", err));
}

function deleteGroup() {
  if (!editingGroup) return;
  if (!confirm(`Delete the group "${editingGroup.name}"? This cannot be undone.`)) return;
  groups = groups.filter(g => g.id !== editingGroup.id);
  saveGroups().then(() => {
    closeEditor();
    renderGroupList();
  }).catch(err => console.error("Failed to delete group:", err));
}

// ---------------------------------------------------------------------------
// Global enable/disable toggle
// ---------------------------------------------------------------------------

async function handleGlobalToggle(checked) {
  settings.extensionEnabled = checked;
  document.getElementById("globalToggleText").textContent = checked ? "Enabled" : "Disabled";
  await saveSettings();
}

// ---------------------------------------------------------------------------
// Escape HTML
// ---------------------------------------------------------------------------

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  await loadData();

  // Global toggle
  const toggle = document.getElementById("globalToggle");
  toggle.checked = settings.extensionEnabled;
  document.getElementById("globalToggleText").textContent =
    settings.extensionEnabled ? "Enabled" : "Disabled";
  toggle.addEventListener("change", e => handleGlobalToggle(e.target.checked));

  // Toolbar "New Group" button
  document.getElementById("addGroupBtn").addEventListener("click", () => openEditor(null));

  // Editor buttons
  document.getElementById("editorCancel").addEventListener("click", closeEditor);
  document.getElementById("saveGroupBtn").addEventListener("click", saveGroup);
  document.getElementById("deleteGroupBtn").addEventListener("click", deleteGroup);
  document.getElementById("addScheduleBtn").addEventListener("click", () => appendScheduleRow(null));

  renderGroupList();
}

document.addEventListener("DOMContentLoaded", init);
