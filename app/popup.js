"use strict";

const domainInput   = document.getElementById("domainInput");
const btnAdd        = document.getElementById("btnAdd");
const btnAddCurrent = document.getElementById("btnAddCurrent");
const btnClearAll   = document.getElementById("btnClearAll");
const domainList    = document.getElementById("domainList");
const emptyState    = document.getElementById("emptyState");
const errorMsg      = document.getElementById("errorMsg");
const countBadge    = document.getElementById("count");
const purgeStatus   = document.getElementById("purgeStatus");

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function getBlacklist() {
  const result = await browser.storage.local.get("blacklist");
  return result.blacklist || [];
}

async function saveBlacklist(list) {
  await browser.storage.local.set({ blacklist: list });
}

// ─── Validation ───────────────────────────────────────────────────────────────

function normalizeDomain(raw) {
  return raw.replace(/^https?:\/\//i, "")
            .replace(/^www\./i, "")
            .split("/")[0]
            .toLowerCase()
            .trim();
}

function isValidDomain(domain) {
  return /^[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?)+$/i.test(domain);
}

// ─── Purge status toast ───────────────────────────────────────────────────────

function showPurgeStatus(msg, isError = false) {
  purgeStatus.textContent = msg;
  purgeStatus.style.color = isError ? "var(--error)" : "var(--success)";
  purgeStatus.style.opacity = "1";
  clearTimeout(purgeStatus._timer);
  purgeStatus._timer = setTimeout(() => {
    purgeStatus.style.opacity = "0";
  }, 3500);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function updateCount(list) {
  countBadge.textContent = list.length === 1 ? "1 domain" : `${list.length} domains`;
}

function renderList(list) {
  updateCount(list);
  Array.from(domainList.querySelectorAll(".domain-item")).forEach(el => el.remove());

  if (list.length === 0) {
    emptyState.style.display = "block";
    btnClearAll.style.display = "none";
    return;
  }

  emptyState.style.display = "none";
  btnClearAll.style.display = "block";

  list.forEach((domain) => {
    const item = document.createElement("div");
    item.className = "domain-item";
    item.innerHTML = `
      <div class="domain-dot"></div>
      <span class="domain-name" title="${domain}">${domain}</span>
      <button class="btn-remove" aria-label="Remove ${domain}" data-domain="${domain}">×</button>
    `;
    domainList.appendChild(item);
  });
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function addDomain(raw) {
  errorMsg.textContent = "";
  const domain = normalizeDomain(raw);

  if (!domain) {
    errorMsg.textContent = "Please enter a domain.";
    return;
  }
  if (!isValidDomain(domain)) {
    errorMsg.textContent = "Invalid domain format. Try: example.com";
    return;
  }

  const list = await getBlacklist();
  if (list.includes(domain)) {
    errorMsg.textContent = `"${domain}" is already blocked.`;
    return;
  }

  list.push(domain);
  await saveBlacklist(list);
  renderList(list);
  domainInput.value = "";
  domainInput.focus();

  // Ask background script to purge existing history for this domain
  showPurgeStatus(`Scanning history for ${domain}…`);
  try {
    const response = await browser.runtime.sendMessage({
      type: "PURGE_HISTORY",
      domain,
    });
    if (response && response.deleted > 0) {
      showPurgeStatus(`✓ Removed ${response.deleted} past visit${response.deleted > 1 ? "s" : ""} to ${domain}`);
    } else {
      showPurgeStatus(`✓ No previous visits found for ${domain}`);
    }
  } catch (e) {
    showPurgeStatus("Could not scan history: " + e.message, true);
  }
}

async function removeDomain(domain) {
  let list = await getBlacklist();
  list = list.filter(d => d !== domain);
  await saveBlacklist(list);
  renderList(list);
}

async function clearAll() {
  await saveBlacklist([]);
  renderList([]);
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

btnAdd.addEventListener("click", () => addDomain(domainInput.value));

domainInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addDomain(domainInput.value);
  if (e.key !== "Enter") errorMsg.textContent = "";
});

domainInput.addEventListener("input", () => { errorMsg.textContent = ""; });

btnAddCurrent.addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    domainInput.value = normalizeDomain(tab.url);
    await addDomain(domainInput.value);
  }
});

btnClearAll.addEventListener("click", async () => {
  if (confirm("Remove all blocked domains?")) await clearAll();
});

domainList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-remove");
  if (btn) await removeDomain(btn.dataset.domain);
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  const list = await getBlacklist();
  renderList(list);
  domainInput.focus();
})();
