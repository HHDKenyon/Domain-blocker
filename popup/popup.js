"use strict";

async function init() {
  const toggle    = document.getElementById("globalToggle");
  const activeList = document.getElementById("activeList");
  const noBlocks  = document.getElementById("noBlocks");

  // Get current status from background
  let status;
  try {
    status = await browser.runtime.sendMessage({ type: "getStatus" });
  } catch (e) {
    console.error("Domain Blocker: failed to get status:", e);
    activeList.innerHTML = '<p class="no-blocks">Extension not responding.</p>';
    return;
  }

  // Global toggle state
  toggle.checked = status.enabled;
  toggle.addEventListener("change", async () => {
    await browser.runtime.sendMessage({ type: "setEnabled", value: toggle.checked });
  });

  // Active blocks list
  const blocks = status.activeBlocks || [];
  activeList.innerHTML = "";

  if (!status.enabled) {
    activeList.innerHTML = '<p class="disabled-hint">Blocking is disabled.</p>';
  } else if (blocks.length === 0) {
    noBlocks.classList.remove("hidden");
  } else {
    for (const block of blocks) {
      const item = document.createElement("div");
      item.className = "block-item";

      let subText = "";
      if (block.reason === "timed") {
        const mins = Math.ceil(block.minutesRemaining);
        subText = `${mins} min${mins !== 1 ? "s" : ""} remaining`;
      } else if (block.reason === "time-limit") {
        subText = "Time limit reached";
      } else {
        subText = "Schedule active";
      }

      item.innerHTML = `
        <span class="block-dot" style="background:${escHtml(block.groupColor || "#e74c3c")}"></span>
        <span class="block-info">
          <span class="block-name">${escHtml(block.groupName)}</span>
          <span class="block-sub">${escHtml(subText)}</span>
        </span>`;

      activeList.appendChild(item);
    }
  }

  // Settings button
  document.getElementById("openSettings").addEventListener("click", () => {
    browser.runtime.openOptionsPage();
    window.close();
  });
}


document.addEventListener("DOMContentLoaded", init);
