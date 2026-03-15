"use strict";

importScripts("vendor/browser-polyfill.js", "shared/utils.js");

// ---------------------------------------------------------------------------
// In-memory state (rebuilt from storage on startup / storage change)
// ---------------------------------------------------------------------------

let groups   = [];
let settings = { extensionEnabled: true };
let usage    = {};   // windowKey -> { minutesUsed }

// hostname (lowercase) -> [{ group, schedule }]
// Used to quickly check if a hostname belongs to any group/schedule.
let domainIndex = new Map();

// Hostnames currently blocked outright (full-block window active, OR timed
// window active but time exhausted).
let activelyBlocked = new Set();

// Hostnames in an active timed window that still has time remaining.
// hostname -> { scheduleId, windowKey, minutesRemaining }
let timedActive = new Map();

// ---------------------------------------------------------------------------
// Time-tracking state (in-memory only; flushed to storage every alarm tick)
// ---------------------------------------------------------------------------
// We only need to track the single focused timed-domain tab.
let tracking = {
  tabId:      null,
  hostname:   null,
  windowKey:  null,
  startedAt:  null,   // Date.now() when we started counting
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Given a schedule and a Date, returns the window key string if the window
 * is currently active, or null if not.
 *
 * Window key format: "<scheduleId>|<YYYY-MM-DD>|<HH:MM>"
 * where YYYY-MM-DD and HH:MM refer to the *calendar day and start time*
 * of the window opening.
 *
 * Handles overnight windows (endTime < startTime).
 */
function getActiveWindowKey(schedule, now) {
  const day     = now.getDay();       // 0=Sun
  const hhmm    = pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  const start   = schedule.startTime;
  const end     = schedule.endTime;
  const isOver  = end < start;        // overnight window

  // Helper: is hhmm in [start, end)?
  function inRange(t, s, e) {
    if (s <= e) return t >= s && t < e;
    return t >= s || t < e;           // overnight
  }

  if (!inRange(hhmm, start, end)) return null;

  // Which calendar day did this window *open* on?
  let windowDay = day;
  if (isOver && hhmm < start) {
    // We're in the early-morning portion of an overnight window that
    // started yesterday.
    windowDay = (day + 6) % 7;
  }

  // Is windowDay one of the scheduled days?
  if (!schedule.days.includes(windowDay)) return null;

  // Build a Date representing the window-open day
  const openDate = new Date(now);
  if (windowDay !== day) {
    openDate.setDate(openDate.getDate() - 1);
  }

  const dateStr = openDate.getFullYear() + "-" +
                  pad2(openDate.getMonth() + 1) + "-" +
                  pad2(openDate.getDate());
  return `${schedule.id}|${dateStr}|${start}`;
}

function pad2(n) { return String(n).padStart(2, "0"); }

/**
 * Normalise a hostname: lowercase, strip leading "www." for matching purposes.
 * We do NOT strip it; instead we do suffix-matching in matchHostname().
 */
function normaliseHostname(h) {
  return h.toLowerCase().replace(/\.$/, "");
}

/**
 * Returns all index entries whose configured domain is a suffix of reqHostname,
 * e.g. configured "youtube.com" matches "www.youtube.com", "m.youtube.com".
 */
function matchHostname(reqHostname) {
  const h = normaliseHostname(reqHostname);
  const matches = [];
  for (const [domain, entries] of domainIndex) {
    if (h === domain || h.endsWith("." + domain)) {
      matches.push(...entries);
    }
  }
  return matches;
}

/**
 * Returns the configured domain string from activelyBlocked that matches
 * reqHostname (exact or as a parent domain), or null if not blocked.
 * e.g. "www.facebook.com" returns "facebook.com" if that's in activelyBlocked.
 */
function findBlockedDomain(reqHostname) {
  const h = normaliseHostname(reqHostname);
  // Walk from most-specific to least-specific suffix
  const parts = h.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    if (activelyBlocked.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Returns the timedActive entry for reqHostname (exact or suffix match), or null.
 */
function findTimedDomain(reqHostname) {
  const h = normaliseHostname(reqHostname);
  const parts = h.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    if (timedActive.has(candidate)) return { configuredDomain: candidate, ...timedActive.get(candidate) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

function buildDomainIndex() {
  domainIndex.clear();
  for (const group of groups) {
    for (const domain of group.domains) {
      const key = normaliseHostname(domain);
      if (!domainIndex.has(key)) domainIndex.set(key, []);
      for (const schedule of group.schedules) {
        domainIndex.get(key).push({ group, schedule });
      }
    }
  }
}

function rebuildBlockingState() {
  activelyBlocked.clear();
  timedActive.clear();

  if (!settings.extensionEnabled) return;

  const now = new Date();

  for (const group of groups) {
    for (const schedule of group.schedules) {
      const windowKey = getActiveWindowKey(schedule, now);
      if (!windowKey) continue;   // window not active right now

      if (schedule.blockType === "full") {
        for (const domain of group.domains) {
          activelyBlocked.add(normaliseHostname(domain));
        }
      } else {
        // timed block
        const used = (usage[windowKey] || {}).minutesUsed || 0;
        const remaining = schedule.timeLimit - used;

        for (const domain of group.domains) {
          const norm = normaliseHostname(domain);
          if (remaining <= 0) {
            activelyBlocked.add(norm);
          } else {
            // Only set timedActive if not already actively blocked by
            // another schedule (full block wins).
            if (!activelyBlocked.has(norm)) {
              // Take the entry with the least remaining time (most restrictive).
              const existing = timedActive.get(norm);
              if (!existing || remaining < existing.minutesRemaining) {
                timedActive.set(norm, { scheduleId: schedule.id, windowKey, minutesRemaining: remaining });
              }
            }
          }
        }
      }
    }
  }

  // Domains that crossed into activelyBlocked should be removed from timedActive.
  for (const domain of activelyBlocked) {
    timedActive.delete(domain);
  }

  // Sync declarativeNetRequest rules to match current blocking state.
  syncDeclarativeRules().catch(console.error);
}

async function loadAndRebuild() {
  const data = await browser.storage.local.get(["groups", "settings", "usage"]);
  groups   = data.groups   || [];
  settings = data.settings || { extensionEnabled: true };
  usage    = data.usage    || {};
  buildDomainIndex();
  rebuildBlockingState();
}

// ---------------------------------------------------------------------------
// declarativeNetRequest — sync blocking rules
// ---------------------------------------------------------------------------

async function syncDeclarativeRules() {
  // Remove all existing dynamic rules first
  const existing = await browser.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map(r => r.id);

  const addRules = [];
  let ruleId = 1;

  if (settings.extensionEnabled) {
    const now = new Date();
    for (const domain of activelyBlocked) {
      const entries = matchHostname(domain);
      const entry   = entries[0];
      const groupName = entry ? entry.group.name : "";
      let reason = "scheduled";

      if (entry) {
        const wk = getActiveWindowKey(entry.schedule, now);
        if (wk && entry.schedule.blockType === "timed") reason = "time-limit";
      }

      const params = new URLSearchParams({ domain, group: groupName, reason });
      addRules.push({
        id: ruleId++,
        priority: 1,
        action: {
          type: "redirect",
          redirect: {
            extensionPath: "/blocked/blocked.html?" + params.toString(),
          },
        },
        condition: {
          requestDomains: [domain],
          resourceTypes: ["main_frame"],
        },
      });
    }
  }

  await browser.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds });
}

// ---------------------------------------------------------------------------
// Time tracking
// ---------------------------------------------------------------------------

async function flushTracking() {
  if (!tracking.startedAt || !tracking.windowKey) return;
  const elapsed = (Date.now() - tracking.startedAt) / 60000; // minutes
  tracking.startedAt = Date.now(); // reset timer (keep tracking)

  if (elapsed < 0.001) return;

  const key = tracking.windowKey;
  if (!usage[key]) usage[key] = { minutesUsed: 0 };
  usage[key].minutesUsed += elapsed;

  await browser.storage.local.set({ usage });
  // Rebuild in case this flush pushes us over the time limit
  rebuildBlockingState();
}

function startTracking(tabId, hostname, windowKey) {
  if (tracking.startedAt) {
    // Flush old tracking synchronously before switching
    flushTracking().catch(console.error);
  }
  tracking.tabId     = tabId;
  tracking.hostname  = hostname;
  tracking.windowKey = windowKey;
  tracking.startedAt = Date.now();
}

function stopTracking() {
  flushTracking().catch(console.error);
  tracking.tabId     = null;
  tracking.hostname  = null;
  tracking.windowKey = null;
  tracking.startedAt = null;
}

function pauseTracking() {
  if (!tracking.startedAt) return;
  flushTracking().catch(console.error);
  tracking.startedAt = null; // paused
}

function resumeTracking() {
  if (tracking.tabId === null || tracking.startedAt !== null) return;
  tracking.startedAt = Date.now();
}

/**
 * Given a tab, check if it's on a timed domain and update tracking.
 */
async function evaluateTabForTracking(tabId, url) {
  if (!url || !url.startsWith("http")) {
    stopTracking();
    return;
  }
  let hostname;
  try { hostname = new URL(url).hostname; } catch (e) { console.error("Domain Blocker: failed to parse tab URL:", url, e); stopTracking(); return; }
  const timedEntry = findTimedDomain(hostname);
  if (timedEntry) {
    const configuredDomain = timedEntry.configuredDomain;
    if (tracking.tabId === tabId && tracking.hostname === configuredDomain) {
      // Already tracking this — resume if paused
      if (!tracking.startedAt) resumeTracking();
    } else {
      startTracking(tabId, configuredDomain, timedEntry.windowKey);
    }
  } else {
    if (tracking.tabId === tabId) stopTracking();
  }
}

// ---------------------------------------------------------------------------
// Usage pruning
// ---------------------------------------------------------------------------

async function pruneOldUsage() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 35);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  let changed = false;
  for (const key of Object.keys(usage)) {
    // key format: scheduleId|YYYY-MM-DD|HH:MM
    const parts = key.split("|");
    if (parts.length === 3 && parts[1] < cutoffStr) {
      delete usage[key];
      changed = true;
    }
  }
  if (changed) await browser.storage.local.set({ usage });
}

// ---------------------------------------------------------------------------
// Alarm handler (fires every 30 s)
// ---------------------------------------------------------------------------

async function onAlarm(alarm) {
  if (alarm.name !== "tick") return;
  await flushTracking();
  rebuildBlockingState();
  await pruneOldUsage();
}

// ---------------------------------------------------------------------------
// Message handler (for popup)
// ---------------------------------------------------------------------------

function buildStatusMessage() {
  const activeBlocks = [];

  for (const group of groups) {
    for (const schedule of group.schedules) {
      const now = new Date();
      const windowKey = getActiveWindowKey(schedule, now);
      if (!windowKey) continue;

      if (schedule.blockType === "full") {
        // Check if any domain in this group is blocked
        const anyBlocked = group.domains.some(d => activelyBlocked.has(normaliseHostname(d)));
        if (anyBlocked) {
          activeBlocks.push({
            groupName: group.name,
            groupColor: group.color,
            reason: "scheduled",
            minutesRemaining: null,
          });
          break; // one entry per group is enough
        }
      } else {
        const used = (usage[windowKey] || {}).minutesUsed || 0;
        const remaining = schedule.timeLimit - used;
        const anyDomain = group.domains.some(d =>
          activelyBlocked.has(normaliseHostname(d)) || timedActive.has(normaliseHostname(d))
        );
        if (anyDomain) {
          activeBlocks.push({
            groupName: group.name,
            groupColor: group.color,
            reason: remaining <= 0 ? "time-limit" : "timed",
            minutesRemaining: Math.max(0, remaining),
          });
          break;
        }
      }
    }
  }

  return { enabled: settings.extensionEnabled, activeBlocks };
}

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "getStatus") return Promise.resolve(buildStatusMessage());
  if (msg.type === "setEnabled") {
    settings.extensionEnabled = msg.value;
    browser.storage.local.set({ settings }).catch(console.error);
    rebuildBlockingState();
    return Promise.resolve({ ok: true });
  }
  return false;
});

// ---------------------------------------------------------------------------
// Tab / window event listeners
// ---------------------------------------------------------------------------

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await browser.tabs.get(tabId);
    await evaluateTabForTracking(tabId, tab.url);
  } catch (e) { console.error("Domain Blocker: error in onActivated handler:", e); }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  const active = await browser.tabs.query({ active: true, currentWindow: true });
  if (active.length && active[0].id === tabId) {
    await evaluateTabForTracking(tabId, tab.url);
  }
});

browser.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    pauseTracking();
  } else {
    resumeTracking();
  }
});

// ---------------------------------------------------------------------------
// Storage change listener (options page saved something)
// ---------------------------------------------------------------------------

browser.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") loadAndRebuild().catch(console.error);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

browser.alarms.create("tick", { periodInMinutes: 0.5 });
browser.alarms.onAlarm.addListener(onAlarm);

browser.runtime.onStartup.addListener(() => loadAndRebuild().catch(console.error));
browser.runtime.onInstalled.addListener(() => loadAndRebuild().catch(console.error));

// Load immediately in case the background script restarts without a startup event
loadAndRebuild().catch(console.error);
