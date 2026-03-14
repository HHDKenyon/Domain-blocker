"use strict";

const params = new URLSearchParams(window.location.search);
const domain = params.get("domain") || "this site";
const group  = params.get("group")  || "";
const reason = params.get("reason") || "scheduled";

document.getElementById("domain").textContent = domain;

if (reason === "time-limit") {
  document.getElementById("icon").textContent  = "⏱️";
  document.getElementById("title").textContent = "Time Limit Reached";
  document.getElementById("reason").textContent =
    group
      ? `You've used up your allowed time for the "${group}" group this session.`
      : "You've used up your allowed time for this site this session.";
  document.getElementById("detail").textContent =
    "Access will be available again when the next scheduled window opens.";
} else {
  document.getElementById("reason").textContent =
    group
      ? `This site is blocked by the "${group}" group schedule.`
      : "This site is currently blocked by a schedule.";
  document.getElementById("detail").textContent =
    "Check your Domain Blocker settings to see when access will resume.";
}
