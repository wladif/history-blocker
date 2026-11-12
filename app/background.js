"use strict";

// ─── Blacklist cache ──────────────────────────────────────────────────────────
//
// Keep the blacklist in memory so history checks are pure in-memory lookups.
// This avoids a storage round-trip on every visit.

let blacklistSet = new Set();

function normalizeDomain(raw) {
  return String(raw)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase()
    .trim();
}

function setBlacklist(list) {
  const entries = Array.isArray(list) ? list : [];
  blacklistSet = new Set(entries.map(normalizeDomain).filter(Boolean));
}

async function loadBlacklist() {
  try {
    const result = await browser.storage.local.get("blacklist");
    setBlacklist(result.blacklist);
  } catch (e) {
    console.error("History Blocker: failed to load blacklist", e);
  }
}

function getHostname(url) {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch (e) {
    return "";
  }
}

function hostnameMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith("." + domain);
}

// A domain matches itself and every subdomain. Walk the hostname labels so
// this stays O(number of labels) and doesn't scan the whole blacklist.
function isBlacklisted(url) {
  const hostname = getHostname(url);
  if (!hostname) return false;

  let candidate = hostname;
  while (candidate) {
    if (blacklistSet.has(candidate)) return true;
    const dot = candidate.indexOf(".");
    if (dot === -1) break;
    candidate = candidate.slice(dot + 1);
  }
  return false;
}

let cacheReady = loadBlacklist();

// Keep the cache in sync when the popup adds or removes a domain.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.blacklist) {
    setBlacklist(changes.blacklist.newValue);
  }
});

// ─── History purge ───────────────────────────────────────────────────────────

// Delete ALL history entries matching a domain (searches the full history).
async function purgeHistoryForDomain(domain) {
  const normalized = normalizeDomain(domain);
  let deleted = 0;

  if (!normalized) return deleted;

  // history.search has no hostname filter, so use the domain as a text query
  // and post-filter on the actual hostname below.
  const items = await browser.history.search({
    text: normalized,
    startTime: 0,
    maxResults: 100000,
  });

  for (const item of items) {
    if (!item.url) continue;
    if (!hostnameMatches(getHostname(item.url), normalized)) continue;

    try {
      await browser.history.deleteUrl({ url: item.url });
      deleted++;
    } catch (e) {
      console.error("History Blocker: failed to delete URL", item.url, e);
    }
  }

  return deleted;
}

// ─── Automatic deletion ──────────────────────────────────────────────────────

// onVisited fires as soon as Firefox records a visit, before the page loads,
// so the entry is removed almost immediately after it is created.
browser.history.onVisited.addListener((item) => {
  if (!item.url) return;

  void cacheReady.then(() => {
    if (!isBlacklisted(item.url)) return;

    browser.history.deleteUrl({ url: item.url }).catch((e) => {
      console.error("History Blocker: failed to delete URL", item.url, e);
    });
  });
});

// Message handler so the popup can request a history purge.
browser.runtime.onMessage.addListener(async (message) => {
  if (!message || message.type !== "PURGE_HISTORY") return;

  // Refresh in case the storage.onChanged event hasn't reached us yet.
  await loadBlacklist();
  const deleted = await purgeHistoryForDomain(message.domain);
  return { deleted };
});
