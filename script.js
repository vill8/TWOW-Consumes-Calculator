const RAID_OPTIONS = [
  { name: "Zul Gurub", tier: "tier 1" },
  { name: "Ruins of Ahn'Qiraj", tier: "tier 1" },
  { name: "Molten Core", tier: "tier 1" },
  { name: "Lower Karazhan Halls", tier: "tier 1" },
  { name: "Onyxia's Lair", tier: "tier 2" },
  { name: "Blackwing Lair", tier: "tier 2" },
  { name: "Temple of Ahn'Qiraj", tier: "tier 2.5" },
  { name: "Emerald Sanctum", tier: "tier 2.5" },
  { name: "Timbermaw Hold", tier: "tier 2.5" },
  { name: "Naxxramas", tier: "tier 3" },
  { name: "Upper Karazhan Halls", tier: "tier 3.5" },
];

const CLASS_ROLE_OPTIONS = {
  Warrior: ["Tank", "dps"],
  Hunter: ["rdps", "mdps"],
  Rogue: ["mdps"],
  Shaman: ["Tank", "rdps", "mdps", "Healer"],
  Druid: ["Tank", "rdps", "mdps", "Healer"],
  Priest: ["rdps", "Healer"],
  Warlock: ["rdps"],
  Mage: ["rdps"],
  Paladin: ["Tank", "Healer", "mdps"],
};

const RAID_TIME_OPTIONS = ["00:30", "01:00", "01:30", "02:00", "02:30", "03:00", "03:30"];

const CSV_URLS = [
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRvdqlkCZyzYwW_OWuj5icUFylM0fgN0gy2zrng3j2DVp9yO_W3x_CNU0Sck0FW2jSm1JsmUCmp7ISe/pub?gid=0&single=true&output=csv",
  "https://docs.google.com/spreadsheets/d/1u7a4fR5lp8Jl0fRk5R8KTC7flyoN0BkzysckJdDMIUQ/export?format=csv&gid=0",
];

const raidSelect = document.getElementById("raid");
const classSelect = document.getElementById("class");
const roleSelect = document.getElementById("role");
const raidTimeSelect = document.getElementById("raid-time");
const form = document.getElementById("calculator-form");
const resultsBody = document.getElementById("results-body");
const statusEl = document.getElementById("status");
const button = document.getElementById("calculate-btn");

let consumables = [];
let tooltipEl = null;

function option(value, label = value) {
  const el = document.createElement("option");
  el.value = value;
  el.textContent = label;
  return el;
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function canonicalToken(value) {
  return normalize(value).replace(/[^a-z0-9.]+/g, "");
}

function splitValues(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

function parseCsv(text) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]).map((h) => normalize(h));
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = (cols[idx] || "").trim();
    });
    rows.push(row);
  }

  return rows;
}

function parseDurationMinutes(raw) {
  const value = String(raw || "").toLowerCase().trim();
  if (!value) return 0;

  const hourAndMin = value.match(/(\d+)\s*h(?:our|ours)?[\s:,-]*(\d+)\s*m/);
  if (hourAndMin) {
    return Number(hourAndMin[1]) * 60 + Number(hourAndMin[2]);
  }

  const hours = value.match(/(\d+(?:\.\d+)?)\s*h/);
  if (hours) {
    return Math.round(Number(hours[1]) * 60);
  }

  const mins = value.match(/(\d+)\s*m/);
  if (mins) {
    return Number(mins[1]);
  }

  if (/^\d+$/.test(value)) return Number(value);
  return 0;
}

function parseRaidMinutes(hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  return hh * 60 + mm;
}

function truthy(raw) {
  const value = normalize(raw);
  return ["yes", "true", "1", "y", "persist", "persists"].some((word) =>
    value.includes(word)
  );
}

function roleToCsvRole(role) {
  const normalized = normalize(role);
  if (normalized === "rdps" || normalized === "ranged") return "rdps";
  if (normalized === "mdps" || normalized === "dps" || normalized === "melee") return "mdps";
  return normalized;
}

function tierToCsvTier(tier) {
  return canonicalToken(tier);
}

function tokenAliases(token) {
  const t = canonicalToken(token);
  if (t === "rdps" || t === "ranged" || t === "rangedps") return ["rdps", "ranged", "rangedps"];
  if (t === "mdps" || t === "melee" || t === "meleedps" || t === "dps") {
    return ["mdps", "melee", "meleedps", "dps"];
  }
  return [t];
}

function matchesScope(csvValue, selectedValue) {
  const items = splitValues(csvValue).map(canonicalToken);
  const selectedAliases = tokenAliases(selectedValue);
  if (!items.length) return true;
  if (items.includes("all") || items.includes("*") || items.includes("any")) return true;
  return selectedAliases.some((alias) => items.includes(alias));
}

function calculateQuantity(row, raidMinutes) {
  const durationMins = parseDurationMinutes(row.duration);
  if (!durationMins) return 1;
  return Math.max(1, Math.ceil(raidMinutes / durationMins));
}

function shouldExcludeConsumable(row, selectedClass, selectedRaidName) {
  const normalizedClass = normalize(selectedClass);
  const normalizedRaidName = normalize(selectedRaidName);
  const normalizedName = normalize(row.name);
  const normalizedDuration = normalize(row.duration);
  const haystack = `${row.name || ""} ${row.effect || ""} ${row.stacks || ""}`.toLowerCase();

  // Exclude all greater protection potions and resistance-related consumables/items.
  const blockedPhrases = [
    "greater arcane protection potion",
    "greater fire protection potion",
    "greater frost protection potion",
    "greater nature protection potion",
    "greater shadow protection potion",
    "protection potion",
    "resistance potion",
    "resistance",
  ];

  if (blockedPhrases.some((phrase) => haystack.includes(phrase))) return true;

  if (normalizedName.includes("heavy runecloth bandage")) return true;
  if (normalizedName.includes("sapta")) return true;

  if (normalizedName === "stratholme holy water" && normalizedRaidName !== "naxxramas") return true;

  // Exclude instant potions.
  if (normalizedName.includes("potion") && normalizedDuration === "instant") return true;

  // Exclude Potion of Quickness unless class is in allowed list.
  if (normalizedName === "potion of quickness") {
    const allowedClasses = ["warlock", "warrior", "rogue", "shaman"];
    return !allowedClasses.includes(normalizedClass);
  }

  return false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createTooltip() {
  tooltipEl = document.createElement("div");
  tooltipEl.className = "item-tooltip";
  tooltipEl.hidden = true;
  document.body.appendChild(tooltipEl);
}

function getIconUrl(row) {
  return String(row.iconurl || row.iconUrl || "").trim();
}

function showTooltip(linkEl, mouseX, mouseY) {
  if (!tooltipEl) return;
  const name = linkEl.dataset.itemName || "Unknown Item";
  const effect = linkEl.dataset.itemEffect || "No description available.";
  const duration = linkEl.dataset.itemDuration || "";
  const icon = linkEl.dataset.itemIcon || "";

  tooltipEl.innerHTML = `
    <div class="item-tooltip-head">
      <span class="item-tooltip-icon-wrap">
        ${icon ? `<img src="${icon}" alt="" class="item-tooltip-icon" />` : `<span class="item-tooltip-icon item-tooltip-icon-fallback"></span>`}
      </span>
      <span class="item-tooltip-name">${escapeHtml(name)}</span>
    </div>
    <div class="item-tooltip-effect">${escapeHtml(effect)}</div>
    ${duration ? `<div class="item-tooltip-duration">Duration: ${escapeHtml(duration)}</div>` : ""}
  `;
  tooltipEl.hidden = false;
  positionTooltip(mouseX, mouseY);
}

function positionTooltip(mouseX, mouseY) {
  if (!tooltipEl || tooltipEl.hidden) return;
  const offset = 14;
  const rect = tooltipEl.getBoundingClientRect();
  let left = mouseX + offset;
  let top = mouseY + offset;

  if (left + rect.width > window.innerWidth - 8) {
    left = mouseX - rect.width - offset;
  }
  if (top + rect.height > window.innerHeight - 8) {
    top = mouseY - rect.height - offset;
  }

  tooltipEl.style.left = `${Math.max(8, left)}px`;
  tooltipEl.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.hidden = true;
}

function createItemNameCell(row) {
  const name = row.name || "-";
  const id = String(row.id || "").trim();
  const iconUrl = getIconUrl(row);

  const iconHtml = iconUrl
    ? `<img class="table-item-icon" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="table-item-icon table-item-icon-placeholder" aria-hidden="true"></span>`;

  if (!id) {
    return `<span class="item-name-wrap">${iconHtml}<span>${escapeHtml(name)}</span></span>`;
  }

  const href = `https://database.turtlecraft.gg/?item=${encodeURIComponent(id)}`;
  return `<span class="item-name-wrap">
    ${iconHtml}
    <a
      class="item-link"
      href="${href}"
      target="_blank"
      rel="noopener noreferrer"
      data-item-name="${escapeHtml(name)}"
      data-item-effect="${escapeHtml(row.effect || "")}"
      data-item-duration="${escapeHtml(row.duration || "")}"
      data-item-icon="${escapeHtml(iconUrl)}"
    >${escapeHtml(name)}</a>
  </span>`;
}

function renderRows(rows, raidMinutes) {
  if (!rows.length) {
    resultsBody.innerHTML = `<tr><td class="empty" colspan="6">No consumables found for this setup.</td></tr>`;
    return;
  }

  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  resultsBody.innerHTML = sorted
    .map((row) => {
      const qty = calculateQuantity(row, raidMinutes);
      const persistsYes = truthy(row.persists);
      const persists = persistsYes ? "Yes" : "No";
      const persistsClass = persistsYes ? "pill pill-yes" : "pill pill-no";

      return `
        <tr>
          <td>${createItemNameCell(row)}</td>
          <td>${row.effect || "-"}</td>
          <td>${row.duration || "-"}</td>
          <td><span class="${persistsClass}">${persists}</span></td>
          <td>${row.stacks || "-"}</td>
          <td><strong>${qty}</strong></td>
        </tr>
      `;
    })
    .join("");
}

function populateInputs() {
  RAID_OPTIONS.forEach((r) => raidSelect.appendChild(option(r.name, `${r.name} (${r.tier})`)));
  Object.keys(CLASS_ROLE_OPTIONS).forEach((className) => {
    classSelect.appendChild(option(className));
  });
  RAID_TIME_OPTIONS.forEach((time) => raidTimeSelect.appendChild(option(time)));
  updateRoleOptions();
}

function updateRoleOptions() {
  const selectedClass = classSelect.value;
  const roles = CLASS_ROLE_OPTIONS[selectedClass] || [];
  roleSelect.innerHTML = "";
  roles.forEach((role) => roleSelect.appendChild(option(role, role.toUpperCase())));
}

function filterConsumables() {
  const selectedRaid = RAID_OPTIONS.find((r) => r.name === raidSelect.value);
  const selectedRaidName = selectedRaid?.name || "";
  const selectedTier = tierToCsvTier(selectedRaid?.tier || "");
  const selectedClass = classSelect.value;
  const selectedRole = roleToCsvRole(roleSelect.value);
  const raidMinutes = parseRaidMinutes(raidTimeSelect.value);

  const filtered = consumables.filter((row) => {
    const tierOk = matchesScope(row.tier, selectedTier);
    const classOk = matchesScope(row.classes, selectedClass);
    const roleOk = matchesScope(row.roles, selectedRole);
    const notExcluded = !shouldExcludeConsumable(row, selectedClass, selectedRaidName);
    return tierOk && classOk && roleOk && notExcluded;
  });

  renderRows(filtered, raidMinutes);
}

async function loadCsv() {
  button.disabled = true;
  statusEl.textContent = "Loading consumables from Google Sheets...";
  try {
    let text = "";
    let loadedFrom = "";

    for (const url of CSV_URLS) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) continue;
        text = await response.text();
        if (text && !/google sheets:\s*sign-?in/i.test(text)) {
          loadedFrom = url;
          break;
        }
      } catch (innerErr) {
        console.warn("CSV load failed for", url, innerErr);
      }
    }

    if (!text) {
      throw new Error("All CSV URLs failed or returned sign-in page.");
    }

    consumables = parseCsv(text);

    if (!consumables.length) {
      statusEl.textContent = "No rows found in CSV.";
      return;
    }

    statusEl.textContent = `Loaded ${consumables.length} consumables.`;
    console.info("CSV loaded from:", loadedFrom);
    button.disabled = false;
  } catch (error) {
    statusEl.textContent =
      "Failed to load CSV. Make sure the Google Sheet is published and publicly readable.";
    console.error(error);
  }
}

classSelect.addEventListener("change", updateRoleOptions);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  filterConsumables();
});
resultsBody.addEventListener("mouseover", (event) => {
  const link = event.target.closest(".item-link");
  if (!link) return;
  showTooltip(link, event.clientX, event.clientY);
});
resultsBody.addEventListener("mousemove", (event) => {
  const link = event.target.closest(".item-link");
  if (!link) return;
  positionTooltip(event.clientX, event.clientY);
});
resultsBody.addEventListener("mouseout", (event) => {
  const link = event.target.closest(".item-link");
  if (!link) return;
  if (event.relatedTarget && link.contains(event.relatedTarget)) return;
  hideTooltip();
});
resultsBody.addEventListener("scroll", hideTooltip, true);
window.addEventListener("blur", hideTooltip);

createTooltip();
populateInputs();
loadCsv();
