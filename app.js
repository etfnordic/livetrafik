import { TRIP_TO_LINE } from "./data/trip_to_line.js";

const API_URL = "https://metro.etfnordic.workers.dev"; // worker root (returnerar array)

/* --- Poll + animation tuning (som du redan kör) --- */
const POLL_MS = 3000;

const map = L.map("map").setView([59.3293, 18.0686], 12);
L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ' +
    'Tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>',
}).addTo(map);

const markers = new Map();
const lastPos = new Map(); // {lat, lon, ts}
const lastBearing = new Map(); // bearingDeg
const bearingEstablished = new Map(); // boolean per train id

let timer = null;

/* ----------------------------
   FILTER: grupper + state (NYTT)
----------------------------- */
const GROUPS = [
  {
    id: "tunnelbana",
    name: "Tunnelbana",
    kind: "metro",
    lines: ["10", "11", "13", "14", "17", "18", "19"],
    // chip färg hanteras av CSS (3 band)
  },
  { id: "pendel", name: "Pendeltåg", color: "#ED66A5", lines: ["40", "41", "43", "43X", "48"] },
  { id: "tvarbana", name: "Tvärbana", color: "#E08A32", lines: ["30", "31"] },
  { id: "roslagsbanan", name: "Roslagsbanan", color: "#A86DAE", lines: ["27", "27S", "28", "28S", "29"] },
  { id: "saltsjobanan", name: "Saltsjöbanan", color: "#21B6BA", lines: ["25", "26"] },
  { id: "lidingobanan", name: "Lidingöbanan", color: "#B76934", lines: ["21"] },
  { id: "sparvagcity", name: "Spårväg City", color: "#878C85", lines: ["7"] },
  { id: "nockebybanan", name: "Nockebybanan", color: "#738BA4", lines: ["12"] },
];

const ALL_LINES = GROUPS.flatMap(g => g.lines);

// localStorage state
const STORAGE_KEY = "visibleLinesV1";
let enabledLines = loadEnabledLines();

function loadEnabledLines() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(ALL_LINES);
    const arr = JSON.parse(raw);
    const s = new Set(arr.filter(x => ALL_LINES.includes(x)));
    return s.size ? s : new Set(ALL_LINES);
  } catch {
    return new Set(ALL_LINES);
  }
}

function saveEnabledLines() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabledLines]));
  } catch {}
}

function isLineEnabled(line) {
  return enabledLines.has(normalizeLine(line));
}

function groupCounts(group) {
  const total = group.lines.length;
  const enabled = group.lines.filter(l => enabledLines.has(l)).length;
  return { enabled, total };
}

// Hide/show marker groups utan att delete:a dem
function setTrainVisible(m, visible) {
  if (visible) {
    if (!m.isOnMap) {
      m.group.addTo(map);
      m.isOnMap = true;
    }
  } else {
    if (m.isOnMap) {
      map.removeLayer(m.group);
      m.isOnMap = false;
    }
  }
}

function applyVisibilityAll() {
  // toggla befintliga tåg baserat på deras line
  for (const [, m] of markers.entries()) {
    const visible = isLineEnabled(m.line);
    setTrainVisible(m, visible);
  }

  // “Inga linjer valda”
  const noLinesMsg = document.getElementById("noLinesMsg");
  if (noLinesMsg) noLinesMsg.style.display = enabledLines.size === 0 ? "block" : "none";
}

function toggleGroup(groupId) {
  const group = GROUPS.find(g => g.id === groupId);
  if (!group) return;

  const { enabled, total } = groupCounts(group);
  const shouldEnableAll = enabled !== total; // OFF eller PARTIAL => slå på alla

  if (shouldEnableAll) {
    for (const l of group.lines) enabledLines.add(l);
  } else {
    for (const l of group.lines) enabledLines.delete(l);
  }

  saveEnabledLines();
  renderFilterUI();
  applyVisibilityAll();
}

function toggleLine(line) {
  const l = normalizeLine(line);
  if (enabledLines.has(l)) enabledLines.delete(l);
  else enabledLines.add(l);

  saveEnabledLines();
  renderFilterUI();
  applyVisibilityAll();
}

function setAllLines(on) {
  enabledLines = on ? new Set(ALL_LINES) : new Set();
  saveEnabledLines();
  renderFilterUI();
  applyVisibilityAll();
}

function renderFilterUI() {
  const groupChips = document.getElementById("groupChips");
  const subChips = document.getElementById("subChips");
  if (!groupChips || !subChips) return;

  groupChips.innerHTML = "";
  subChips.innerHTML = "";

  // --- huvudchips ---
  for (const g of GROUPS) {
    const { enabled, total } = groupCounts(g);
    const isOn = enabled > 0;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip" + (g.kind === "metro" ? " chipMetro" : "") + (!isOn ? " chipOff" : "");

    if (g.kind !== "metro") {
      btn.style.background = g.color;
    }

    btn.textContent = g.name;

    // badge "6/7" (visas när >0)
    if (enabled > 0) {
      const badge = document.createElement("div");
      badge.className = "chipBadge";
      badge.textContent = `${enabled}/${total}`;
      btn.appendChild(badge);
    }

    btn.addEventListener("click", () => toggleGroup(g.id));
    groupChips.appendChild(btn);
  }

  // --- underchips (alla grupper visas alltid) ---
  for (const g of GROUPS) {
    const row = document.createElement("div");
    row.className = "subGroup";

    const title = document.createElement("div");
    title.className = "subGroupTitle";
    title.textContent = g.name + ":";
    row.appendChild(title);

    for (const line of g.lines) {
      const on = enabledLines.has(line);

      const b = document.createElement("button");
      b.type = "button";
      b.className = "subChip" + (!on ? " subChipOff" : "");
      b.textContent = line;

      // färg per grupp (tunnelbanans underchips kan färgas per linje via colorForLine)
      const color =
        g.kind === "metro" ? colorForLine(line) :
        (g.color ?? "#111827");

      b.style.background = color;

      b.addEventListener("click", () => toggleLine(line));
      row.appendChild(b);
    }

    subChips.appendChild(row);
  }

  // knappar Alla/Inga
  const btnAll = document.getElementById("btnAll");
  const btnNone = document.getElementById("btnNone");
  if (btnAll) btnAll.onclick = () => setAllLines(true);
  if (btnNone) btnNone.onclick = () => setAllLines(false);

  // “Inga linjer valda”
  const noLinesMsg = document.getElementById("noLinesMsg");
  if (noLinesMsg) noLinesMsg.style.display = enabledLines.size === 0 ? "block" : "none";
}

/* ----------------------------
   Hover/Pin label-state
----------------------------- */
let hoverTrainId = null;
let hoverLabelMarker = null;

let pinnedTrainId = null;
let pinnedLabelMarker = null;

// robust hover-state (för att garantera att labeln försvinner)
let isPointerOverTrain = false;

function buildLabelText(v) {
  return v.headsign ? `${v.line} → ${v.headsign}` : v.line;
}

function hideHoverLabel(trainId) {
  if (hoverTrainId !== trainId) return;
  if (pinnedTrainId === trainId) return;

  if (hoverLabelMarker) {
    map.removeLayer(hoverLabelMarker);
    hoverLabelMarker = null;
  }
  hoverTrainId = null;
}

function showHoverLabel(v, pos) {
  if (pinnedTrainId === v.id) return;

  if (hoverTrainId && hoverTrainId !== v.id && hoverLabelMarker) {
    map.removeLayer(hoverLabelMarker);
    hoverLabelMarker = null;
  }

  hoverTrainId = v.id;

  const icon = makeLabelIcon(v.line, buildLabelText(v), v.speedKmh, false);

  if (!hoverLabelMarker) {
    hoverLabelMarker = L.marker(pos, {
      icon,
      interactive: false,
      zIndexOffset: 2000,
    }).addTo(map);
  } else {
    hoverLabelMarker.setLatLng(pos);
    hoverLabelMarker.setIcon(icon);
  }
}

function togglePinnedLabel(v, pos) {
  if (hoverLabelMarker) {
    map.removeLayer(hoverLabelMarker);
    hoverLabelMarker = null;
    hoverTrainId = null;
  }
  isPointerOverTrain = false;

  if (pinnedTrainId === v.id) {
    if (pinnedLabelMarker) map.removeLayer(pinnedLabelMarker);
    pinnedLabelMarker = null;
    pinnedTrainId = null;
    return;
  }

  if (pinnedLabelMarker) map.removeLayer(pinnedLabelMarker);

  const icon = makeLabelIcon(v.line, buildLabelText(v), v.speedKmh, true);

  pinnedTrainId = v.id;
  pinnedLabelMarker = L.marker(pos, {
    icon,
    interactive: false,
    zIndexOffset: 2500,
  }).addTo(map);
}

map.on("click", () => {
  if (pinnedLabelMarker) {
    map.removeLayer(pinnedLabelMarker);
    pinnedLabelMarker = null;
    pinnedTrainId = null;
  }

  if (hoverLabelMarker) {
    map.removeLayer(hoverLabelMarker);
    hoverLabelMarker = null;
    hoverTrainId = null;
  }

  isPointerOverTrain = false;
});

map.on("mousemove", () => {
  if (!isPointerOverTrain && hoverTrainId && hoverLabelMarker && pinnedTrainId !== hoverTrainId) {
    hideHoverLabel(hoverTrainId);
  }
});

/* ----------------------------
   Utilities
----------------------------- */
function normalizeLine(rawLine) {
  const s = String(rawLine ?? "").trim();
  const m = s.match(/(\d+\s*[A-Z]+|\d+)/i);
  return (m ? m[1] : s).replace(/\s+/g, "").toUpperCase();
}

function colorForLine(line) {
  const l = normalizeLine(line);

  if (l === "7") return "#878C85";
  if (l === "10" || l === "11") return "#0091D2";
  if (l === "12") return "#738BA4";
  if (l === "13" || l === "14") return "#E31F26";
  if (l === "17" || l === "18" || l === "19") return "#00B259";
  if (l === "21") return "#B76934";
  if (l === "25" || l === "26") return "#21B6BA";
  if (l === "27" || l === "27S" || l === "28" || l === "28S" || l === "29") return "#A86DAE";
  if (l === "30" || l === "31") return "#E08A32";
  if (l === "40" || l === "41" || l === "43" || l === "43X" || l === "48") return "#ED66A5";

  return "#111827";
}

function darkenHex(hex, amount = 0.5) {
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const dr = clamp(Math.round(r * (1 - amount)));
  const dg = clamp(Math.round(g * (1 - amount)));
  const db = clamp(Math.round(b * (1 - amount)));
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

function headingFromPoints(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);
  return (toDeg(θ) + 360) % 360;
}

function arrowSvg(fillColor, strokeColor) {
  return `
    <svg width="34" height="34" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 50 L92 10 L62 50 L92 90 Z"
        fill="${fillColor}"
        stroke="${strokeColor}"
        stroke-width="4"
        stroke-linejoin="round"
      />
    </svg>
  `;
}

function fmtSpeed(speedKmh) {
  if (speedKmh == null || Number.isNaN(speedKmh) || speedKmh < 0) return "";
  return ` • ${Math.round(speedKmh)} km/h`;
}

function makeArrowIcon(line, bearingDeg) {
  const color = colorForLine(line);
  const stroke = darkenHex(color, 0.5);

  if (!Number.isFinite(bearingDeg)) {
    const html = `
      <div class="trainMarker" style="filter: drop-shadow(0 2px 2px rgba(0,0,0,.35));">
        <div class="trainDot" style="
          width: 16px; height: 16px;
          border-radius: 999px;
          background: ${color};
          border: 2px solid ${stroke};
        "></div>
      </div>
    `;
    return L.divIcon({
      className: "trainIconWrap",
      html,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  const rot = bearingDeg + 90;

  const html = `
    <div class="trainMarker"
      style="
        transform: rotate(${rot}deg);
        filter: drop-shadow(0 2px 2px rgba(0,0,0,.35));
      ">
      ${arrowSvg(color, stroke)}
    </div>
  `;

  return L.divIcon({
    className: "trainIconWrap",
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

/**
 * Label ovanför tåget.
 * pinned=false => hover-stil
 * pinned=true  => pinnad-stil
 */
function makeLabelIcon(line, labelText, speedKmh, pinned = false) {
  const color = colorForLine(line);
  const text = `${labelText}${fmtSpeed(speedKmh)}`;

  const cls = pinned
    ? "trainLabel trainLabelPos trainLabelPinned"
    : "trainLabel trainLabelPos trainLabelHover";

  return L.divIcon({
    className: "trainLabelWrap",
    html: `
      <div class="${cls}" style="background:${color};">
        ${text}
      </div>
    `,
    iconAnchor: [0, 0],
  });
}

function enrich(v) {
  if (!v?.tripId) return null;
  const info = TRIP_TO_LINE[v.tripId];
  if (!info?.line) return null;

  return {
    ...v,
    line: info.line,
    headsign: info.headsign ?? null,
  };
}

function upsertTrain(v) {
  v.line = normalizeLine(v.line);
  const pos = [v.lat, v.lon];

  let bearing = null;
  let establishedNow = false;

  if (Number.isFinite(v.bearing) && v.bearing > 0) {
    bearing = v.bearing;
    establishedNow = true;
  }

  const prev = lastPos.get(v.id);
  if (bearing == null && prev && prev.lat != null && prev.lon != null) {
    const moved =
      Math.abs(v.lat - prev.lat) > 0.00002 || Math.abs(v.lon - prev.lon) > 0.00002;

    if (moved) {
      bearing = headingFromPoints(prev.lat, prev.lon, v.lat, v.lon);
      establishedNow = true;
    }
  }

  if (establishedNow) {
    bearingEstablished.set(v.id, true);
    lastBearing.set(v.id, bearing);
  }

  if (bearing == null && bearingEstablished.get(v.id) === true && lastBearing.has(v.id)) {
    bearing = lastBearing.get(v.id);
  }

  lastPos.set(v.id, { lat: v.lat, lon: v.lon, ts: v.ts ?? Date.now() });

  const arrowIcon = makeArrowIcon(v.line, Number.isFinite(bearing) ? bearing : NaN);

  const shouldBeVisible = isLineEnabled(v.line);

  if (!markers.has(v.id)) {
    const group = L.layerGroup();

    const arrowMarker = L.marker(pos, {
      icon: arrowIcon,
      interactive: true,
      zIndexOffset: 500,
    });

    arrowMarker.on("mouseover", () => {
      isPointerOverTrain = true;
      const m = markers.get(v.id);
      if (m?.lastV) showHoverLabel(m.lastV, m.lastPos);
    });

    arrowMarker.on("mouseout", () => {
      isPointerOverTrain = false;
      hideHoverLabel(v.id);
    });

    arrowMarker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      const m = markers.get(v.id);
      if (m?.lastV) togglePinnedLabel(m.lastV, m.lastPos);
    });

    group.addLayer(arrowMarker);

    // lägg bara på kartan om linjen är aktiverad
    if (shouldBeVisible) group.addTo(map);

    markers.set(v.id, {
      group,
      arrowMarker,
      lastV: v,
      lastPos: pos,
      line: v.line,
      isOnMap: shouldBeVisible
    });
  } else {
    const m = markers.get(v.id);

    m.lastV = v;
    m.lastPos = pos;
    m.line = v.line;

    m.arrowMarker.setLatLng(pos);
    m.arrowMarker.setIcon(arrowIcon);

    // visibility (hide/show)
    setTrainVisible(m, shouldBeVisible);

    // hover/pinned uppdateringar (om synliga)
    if (hoverTrainId === v.id && hoverLabelMarker && pinnedTrainId !== v.id) {
      showHoverLabel(v, pos);
    }
    if (pinnedTrainId === v.id && pinnedLabelMarker) {
      pinnedLabelMarker.setLatLng(pos);
      pinnedLabelMarker.setIcon(makeLabelIcon(v.line, buildLabelText(v), v.speedKmh, true));
    }
  }
}

async function refreshLive() {
  if (document.visibilityState !== "visible") return;

  const res = await fetch(API_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);

  const data = await res.json();
  const seen = new Set();

  for (const raw of data) {
    if (!raw?.id || raw.lat == null || raw.lon == null) continue;

    const v = enrich(raw);
    if (!v) continue;

    seen.add(v.id);
    upsertTrain(v);
  }

  for (const [id, m] of markers.entries()) {
    if (!seen.has(id)) {
      map.removeLayer(m.group);
      markers.delete(id);
      lastPos.delete(id);
      lastBearing.delete(id);
      bearingEstablished.delete(id);

      if (hoverTrainId === id) hideHoverLabel(id);

      if (pinnedTrainId === id) {
        if (pinnedLabelMarker) map.removeLayer(pinnedLabelMarker);
        pinnedLabelMarker = null;
        pinnedTrainId = null;
      }
    }
  }
}

function startPolling() {
  stopPolling();
  timer = setInterval(() => refreshLive().catch(console.error), POLL_MS);
}
function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}

/* init filter UI */
renderFilterUI();
applyVisibilityAll();

startPolling();
refreshLive().catch(console.error);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    startPolling();
    refreshLive().catch(console.error);
  } else {
    stopPolling();
  }
});
