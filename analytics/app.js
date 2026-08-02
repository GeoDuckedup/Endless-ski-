(() => {
  "use strict";
  const SCHEMA = "endless-powder-community-summary-v1";
  const COLORS = {
    caught: "#ef776e",
    tree: "#78d2b1",
    boulder: "#a8b2bb",
    edge: "#f4c75d",
    unknown: "#60798a"
  };
  const THREAT_COLORS = {
    CONTROLLED: "#79c9e9",
    HUNTING: "#f4c75d",
    PREDATORY: "#ed9a58",
    CRITICAL: "#ef776e"
  };
  const OPEN_DEPTH_BANDS = ["D0_249", "D250_499", "D500_999", "D1000_1999", "D2000_3999", "D4000_PLUS"];
  const OPEN_LANE_BANDS = ["FAR_LEFT", "LEFT", "CENTER", "RIGHT", "FAR_RIGHT"];
  const OPEN_DEPTH_LABELS = {
    D0_249: "0–249 m",
    D250_499: "250–499 m",
    D500_999: "500–999 m",
    D1000_1999: "1,000–1,999 m",
    D2000_3999: "2,000–3,999 m",
    D4000_PLUS: "4,000 m+"
  };
  const OPEN_LANE_LABELS = {
    FAR_LEFT: "Far left", LEFT: "Left", CENTER: "Center", RIGHT: "Right", FAR_RIGHT: "Far right"
  };
  const TIME_SCOPES = new Set(["recent", "all"]);
  const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const $ = (id) => document.getElementById(id);
  const LIVE_REFRESH_MS = 5 * 60 * 1000;
  const state = {
    phase: "loading",
    view: "home",
    module: null,
    timeScope: "recent",
    demo: false,
    data: null,
    baseline: null,
    live: null,
    livePhase: "loading",
    openSkiLivePhase: "loading",
    liveCheckedAt: 0,
    liveRefreshing: false,
    error: ""
  };
  let lastChartData = [];
  let liveRefreshTimer = 0;

  const number = (value) =>
    value === null || value === undefined || value === ""
      ? null
      : Number.isFinite(Number(value))
        ? Number(value)
        : null;
  const fmt = (value, digits = 0) => {
    const parsed = number(value);
    if (parsed === null) return "—";
    return parsed.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  };
  const percent = (value) => (number(value) === null ? "—" : fmt(value, 1).replace(".0", ""));
  const safe = (value, fallback = {}) =>
    value && typeof value === "object" ? value : fallback;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function timeScopeFromUrl() {
    return new URLSearchParams(location.search).get("period") === "all" ? "all" : "recent";
  }

  function scopedFeedData(feed) {
    const source = safe(feed);
    const scoped = safe(source.scopes)[state.timeScope];
    return safe(scoped, safe(source.data));
  }

  function monthRangeLabel(months) {
    const keys = [...new Set((Array.isArray(months) ? months : [])
      .map(value => typeof value === "string" ? value : value && value.month)
      .filter(value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""))))].sort();
    if (!keys.length) return state.timeScope === "all" ? "ALL RECORDED" : "RECENT";
    const parsed = keys.map(key => {
      const [year, month] = key.split("-").map(Number);
      return { year, month, label: MONTH_NAMES[month - 1] };
    });
    const first = parsed[0];
    const last = parsed.at(-1);
    if (first.year === last.year)
      return first.month === last.month ? `${first.label} ${first.year}` : `${first.label}–${last.label} ${first.year}`;
    return `${first.label} ${first.year}–${last.label} ${last.year}`;
  }

  function selectedWindowLabel() {
    if (state.timeScope === "recent")
      return monthRangeLabel(safe(state.live && state.live.timeWindows, { recentMonths: [] }).recentMonths);
    const pursuit = scopedFeedData(state.live && state.live.pursuit);
    const openSki = scopedFeedData(state.live && state.live.openSkiAnalytics);
    return monthRangeLabel([
      ...(Array.isArray(pursuit.sourceMonths) ? pursuit.sourceMonths : []),
      ...(Array.isArray(openSki.sourceMonths) ? openSki.sourceMonths : [])
    ]);
  }

  function renderTimeScopeUi() {
    document.querySelectorAll("[data-time-scope]").forEach((button) => {
      const active = button.dataset.timeScope === state.timeScope;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    setText("dataWindow", selectedWindowLabel());
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function showOnly(id) {
    for (const name of ["loadingState", "emptyState", "errorState", "dashboard"])
      $(name).hidden = name !== id;
  }

  function dateLabel(day) {
    if (!day) return "NO RECORDED WINDOW";
    const date = new Date(`${day}T12:00:00Z`);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
  }

  function setStatus(summary) {
    const badge = $("dataStatus");
    badge.classList.toggle("demo", state.demo);
    badge.textContent = state.demo ? "DEMO DATA" : summary.status === "ready" ? "REPORT READY" : "AWAITING RUNS";
  }

  function renderBars(containerId, rows, options = {}) {
    const node = $(containerId);
    node.replaceChildren();
    const max = options.max || Math.max(1, ...rows.map((row) => number(row.value) || 0));
    for (const row of rows) {
      const wrap = document.createElement("div");
      wrap.className = options.mini ? "mini-row" : "bar-row";
      const width = Math.max(0, Math.min(100, ((number(row.value) || 0) / max) * 100));
      wrap.innerHTML = `<label>${row.label}</label><div class="bar-track"><div class="bar-fill" style="--width:${width}%"></div></div><${options.mini ? "strong" : "div"} class="${options.mini ? "" : "bar-value"}">${options.value(row)}</${options.mini ? "strong" : "div"}>`;
      node.appendChild(wrap);
    }
  }

  function donut(containerId, legendId, distribution) {
    const entries = Object.entries(safe(distribution)).filter(([, value]) => number(value.count) > 0);
    const total = entries.reduce((sum, [, value]) => sum + (number(value.count) || 0), 0);
    let cursor = 0;
    const pieces = [];
    for (const [cause, value] of entries) {
      const start = cursor;
      cursor += total ? ((number(value.count) || 0) / total) * 100 : 0;
      pieces.push(`${COLORS[cause] || COLORS.unknown} ${start}% ${cursor}%`);
    }
    $(containerId).style.background = pieces.length
      ? `conic-gradient(${pieces.join(",")})`
      : "conic-gradient(rgba(255,255,255,.08) 0 100%)";
    const legend = $(legendId);
    legend.replaceChildren();
    for (const [cause, value] of entries) {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.innerHTML = `<span class="legend-dot" style="--color:${COLORS[cause] || COLORS.unknown}"></span><span>${cause}</span><strong>${percent(value.rate)}%</strong>`;
      legend.appendChild(row);
    }
    if (!entries.length) legend.textContent = "No submitted deaths yet.";
  }

  function threatBand(exposure) {
    const node = $("threatBand");
    node.replaceChildren();
    for (const key of ["CONTROLLED", "HUNTING", "PREDATORY", "CRITICAL"]) {
      const value = safe(exposure)[key] || {};
      const segment = document.createElement("span");
      segment.style.setProperty("--width", `${Math.max(0, number(value.rate) || 0)}%`);
      segment.style.setProperty("--color", THREAT_COLORS[key]);
      segment.title = `${key.toLowerCase()}: ${percent(value.rate)}%`;
      node.appendChild(segment);
    }
  }

  function drawTrend(rows) {
    lastChartData = Array.isArray(rows) ? rows.slice() : [];
    const canvas = $("trendChart");
    const empty = $("trendEmpty");
    const legend = $("trendLegend");
    if (lastChartData.length < 2) {
      canvas.hidden = true;
      legend.hidden = true;
      empty.hidden = false;
      return;
    }
    canvas.hidden = false;
    legend.hidden = false;
    empty.hidden = true;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width || 900);
    const height = Math.max(200, rect.height || 270);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const pad = { left: 44, right: 24, top: 25, bottom: 46 };
    const values = lastChartData.map((row) => number(row.medianDistance) || 0);
    const maximum = Math.max(100, ...values) * 1.12;
    context.strokeStyle = "rgba(190,223,244,.12)";
    context.lineWidth = 1;
    context.fillStyle = "#718796";
    context.font = "10px system-ui";
    for (let step = 0; step <= 4; step++) {
      const y = pad.top + ((height - pad.top - pad.bottom) * step) / 4;
      context.beginPath();
      context.moveTo(pad.left, y);
      context.lineTo(width - pad.right, y);
      context.stroke();
      context.fillText(`${Math.round(maximum * (1 - step / 4))}m`, 4, y + 3);
    }
    const point = (index, value) => ({
      x: pad.left + ((width - pad.left - pad.right) * index) / (lastChartData.length - 1),
      y: pad.top + (height - pad.top - pad.bottom) * (1 - value / maximum)
    });
    const points = values.map((value, index) => point(index, value));
    const gradient = context.createLinearGradient(0, pad.top, 0, height - pad.bottom);
    gradient.addColorStop(0, "rgba(136,213,247,.32)");
    gradient.addColorStop(1, "rgba(136,213,247,0)");
    context.beginPath();
    context.moveTo(points[0].x, height - pad.bottom);
    points.forEach((p) => context.lineTo(p.x, p.y));
    context.lineTo(points.at(-1).x, height - pad.bottom);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
    context.beginPath();
    points.forEach((p, index) => (index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
    context.strokeStyle = "#88d5f7";
    context.lineWidth = 3;
    context.stroke();
    points.forEach((p, index) => {
      context.beginPath();
      context.arc(p.x, p.y, 5, 0, Math.PI * 2);
      context.fillStyle = "#07111b";
      context.fill();
      context.lineWidth = 3;
      context.strokeStyle = "#88d5f7";
      context.stroke();
      context.fillStyle = "#9db0be";
      context.textAlign = "center";
      context.fillText(lastChartData[index].month, p.x, height - 18);
    });
    legend.innerHTML = `<span style="--color:#88d5f7">Median distance</span><span style="--color:#f4c75d">${lastChartData.reduce((total, row) => total + (number(row.runs) || 0), 0)} recorded runs shown</span>`;
  }

  function cohortWindowLabel(cohort) {
    const window = safe(cohort.sourceWindow);
    return window.firstDay && window.lastDay
      ? `${dateLabel(window.firstDay)} — ${dateLabel(window.lastDay)}`
      : "NO RECORDED WINDOW";
  }

  function coverageVersions(rows) {
    return Array.isArray(rows) && rows.length
      ? rows.map((row) => `${row.label} · ${fmt(row.count)}`).join(" / ")
      : "NO RUNS YET";
  }

  function cohortStatus(cohort) {
    const accepted = number(cohort.accepted) || 0;
    const minimum = number(cohort.minimumRuns) || 3;
    if (cohort.status === "ready") return "COMPARISON READY";
    if (accepted > 0) return `${fmt(Math.max(0, minimum - accepted))} MORE TO UNLOCK`;
    return "AWAITING RUNS";
  }

  function renderCohorts(summary) {
    const telemetry = safe(safe(summary.coverage).pursuitTelemetry);
    const cohorts = safe(telemetry.cohorts);
    const current = safe(cohorts.currentRelease);
    const historical = safe(cohorts.historical);
    const currentStatus = $("currentCohortStatus");
    const historicalStatus = $("historicalCohortStatus");
    currentStatus.textContent = cohortStatus(current);
    historicalStatus.textContent = cohortStatus(historical);
    currentStatus.className = current.status === "ready" ? "ready" : "collecting";
    historicalStatus.className = historical.status === "ready" ? "ready" : "collecting";
    setText("currentCohortCount", fmt(current.accepted));
    setText(
      "currentCohortVersion",
      `${current.buildVersion || "v12c.1"} · ${String(current.telemetryVersion || "telemetry-engine-v2.8").replace("telemetry-engine-", "engine ")}`
    );
    setText("currentCohortWindow", cohortWindowLabel(current));
    setText("historicalCohortCount", fmt(historical.accepted));
    setText("historicalCohortVersion", coverageVersions(historical.buildVersions));
    setText("historicalCohortWindow", cohortWindowLabel(historical));
    const currentMetrics = safe(current.metrics);
    const historicalMetrics = safe(historical.metrics);
    setText("currentCohortMedian", number(currentMetrics.medianDistance) === null ? "—" : `${fmt(currentMetrics.medianDistance)} m`);
    setText("historicalCohortMedian", number(historicalMetrics.medianDistance) === null ? "—" : `${fmt(historicalMetrics.medianDistance)} m`);
    setText("currentCohortFlags", number(currentMetrics.flagAccuracy) === null ? "—" : `${percent(currentMetrics.flagAccuracy)}%`);
    setText("historicalCohortFlags", number(historicalMetrics.flagAccuracy) === null ? "—" : `${percent(historicalMetrics.flagAccuracy)}%`);
    setText("currentCohortLunges", number(currentMetrics.lungeDodgeRate) === null ? "—" : `${percent(currentMetrics.lungeDodgeRate)}%`);
    setText("historicalCohortLunges", number(historicalMetrics.lungeDodgeRate) === null ? "—" : `${percent(historicalMetrics.lungeDodgeRate)}%`);
    setText("currentCohortFps", number(currentMetrics.averageFps) === null ? "—" : fmt(currentMetrics.averageFps, 1));
    setText("historicalCohortFps", number(historicalMetrics.averageFps) === null ? "—" : fmt(historicalMetrics.averageFps, 1));
  }

  function liveMonthLabel(rows) {
    if (!Array.isArray(rows) || !rows.length) return "AWAITING FIRST RUN";
    return rows.map((row) => {
      const [year, month] = String(row.month || "").split("-");
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
      const label = Number.isFinite(date.getTime())
        ? date.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).toUpperCase()
        : String(row.month || "");
      return `${label} · ${fmt(row.runs)}`;
    }).join(" / ");
  }

  function renderLiveMix(attacks, unavailable = false) {
    const node = $("liveAttackMix");
    node.replaceChildren();
    const byRange = safe(attacks.byRange);
    const byPerformance = safe(attacks.byPerformance);
    const rows = [
      ["SHORT", number(byRange.SHORT) || 0],
      ["MID", number(byRange.MID) || 0],
      ["LONG", number(byRange.LONG) || 0],
      ["STRUGGLING", number(byPerformance.STRUGGLING) || 0],
      ["STABLE", number(byPerformance.STABLE) || 0],
      ["FAST", number(byPerformance.FAST) || 0],
      ["HOT", number(byPerformance.HOT) || 0]
    ];
    const maximum = Math.max(0, ...rows.map(([, value]) => value));
    if (!maximum) {
      const empty = document.createElement("p");
      empty.className = "live-mix-empty";
      empty.textContent = unavailable ? "—" : "No committed live attacks yet.";
      node.appendChild(empty);
      return;
    }
    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "live-mix-row";
      const title = document.createElement("label");
      title.textContent = label;
      const track = document.createElement("div");
      track.className = "bar-track";
      const bar = document.createElement("div");
      bar.className = "bar-fill";
      bar.style.setProperty("--width", `${Math.max(0, Math.min(100, (value / maximum) * 100))}%`);
      track.appendChild(bar);
      const count = document.createElement("strong");
      count.textContent = fmt(value);
      row.append(title, track, count);
      node.appendChild(row);
    }
  }

  function renderLive(live) {
    state.live = live;
    state.liveCheckedAt = number(live && live.checkedAt) || Date.now();
    const pursuit = safe(live && live.pursuit);
    const connectedFeeds = [live && live.pursuit, live && live.openSkiAnalytics, live && live.openSkiLeaderboard]
      .filter(feed => feed && feed.ok === true).length;
    const status = $("liveFeedStatus");
    const topBadge = $("dataStatus");
    topBadge.classList.toggle("demo", state.demo);
    topBadge.classList.toggle("partial", !state.demo && connectedFeeds > 0 && connectedFeeds < 3);
    topBadge.classList.toggle("offline", !state.demo && connectedFeeds === 0);
    topBadge.textContent = state.demo
      ? "DEMO DATA"
      : connectedFeeds === 3 ? "LIVE" : connectedFeeds > 0 ? "PARTIAL" : "OFFLINE";
    renderTimeScopeUi();
    status.classList.toggle("ready", pursuit.ok === true);
    status.classList.toggle("offline", pursuit.ok !== true);
    if (pursuit.ok !== true) {
      state.livePhase = "offline";
      status.textContent = "OFFLINE";
      for (const id of ["liveRunCount", "liveMonths", "liveMedianDistance", "liveFlagAccuracy", "liveFlagCount", "liveAverageFps", "liveFpsCoverage", "liveLunges", "liveLungeDodges", "liveCharges", "liveChargeDodges", "liveBoulders", "liveBoulderReleases"])
        setText(id, "—");
      renderLiveMix({}, true);
      return;
    }
    const data = scopedFeedData(pursuit);
    const runs = number(data.accepted) || 0;
    const attacks = safe(data.attacks);
    state.livePhase = runs ? "ready" : "empty";
    status.textContent = runs ? `LIVE · ${fmt(runs)} ${runs === 1 ? "RUN" : "RUNS"}` : "CONNECTED · AWAITING RUN";
    setText("liveRunCount", fmt(runs));
    setText("liveMonths", liveMonthLabel(data.sourceMonths));
    setText("liveMedianDistance", number(safe(data.distance).median) === null ? "—" : fmt(data.distance.median));
    setText("liveFlagAccuracy", number(safe(data.flags).accuracy) === null ? "—" : percent(data.flags.accuracy));
    setText("liveFlagCount", runs ? `${fmt(data.flags.clean)} clean / ${fmt(data.flags.attempted)} attempted` : "No live flags yet");
    setText("liveAverageFps", number(safe(data.performance).averageFps) === null ? "—" : fmt(data.performance.averageFps, 1));
    setText("liveFpsCoverage", runs ? `${fmt(data.performance.measuredRuns)} of ${fmt(runs)} measured runs` : "No live performance samples");
    setText("liveLunges", fmt(attacks.committedLunges));
    setText("liveLungeDodges", number(attacks.lungeDodgeRate) === null ? "no resolved outcomes" : `${percent(attacks.lungeDodgeRate)}% dodged`);
    setText("liveCharges", fmt(attacks.chargeCommits));
    setText("liveChargeDodges", number(attacks.chargeDodgeRate) === null ? "no resolved outcomes" : `${percent(attacks.chargeDodgeRate)}% dodged`);
    setText("liveBoulders", fmt(safe(attacks.byKind).boulders));
    setText("liveBoulderReleases", `${fmt(attacks.boulderThrowReleases)} boulders released`);
    renderLiveMix(attacks);
  }

  function renderPursuit(summary) {
    const pursuit = safe(summary.pursuit);
    const overview = safe(pursuit.overview);
    const distance = safe(pursuit.distance);
    const flags = safe(pursuit.flags);
    const attacks = safe(pursuit.attacks);
    const performance = safe(pursuit.performance);
    renderCohorts(summary);
    setText("runsRecorded", fmt(overview.recordedRuns));
    setText("playersRecorded", `${fmt(overview.approximatePlayers)} players`);
    setText("medianDistance", fmt(distance.median));
    setText("p90Distance", `${fmt(distance.p90)} m at the 90th percentile`);
    setText("totalDistance", fmt(overview.totalDistance));
    setText("longestDistance", `${fmt(distance.max)} m longest recorded run`);
    setText("flagAccuracy", percent(flags.accuracy));
    setText("flagCount", `${fmt(flags.clean)} clean passes`);
    setText("averageDistance", fmt(distance.mean));
    setText("distanceP90", fmt(distance.p90));
    renderBars(
      "survivalBars",
      (pursuit.survival || []).map((row) => ({ label: `${fmt(row.meters)}m`, value: row.rate, count: row.count })),
      { max: 100, value: (row) => `<strong>${percent(row.value)}%</strong><span> · ${fmt(row.count)}</span>` }
    );
    const accuracy = Math.max(0, Math.min(100, number(flags.accuracy) || 0));
    $("flagGauge").style.setProperty("--accuracy", accuracy);
    $("flagGauge").setAttribute("aria-label", `Flag accuracy ${percent(accuracy)} percent`);
    setText("flagGaugeValue", percent(accuracy));
    setText("cleanFlags", fmt(flags.clean));
    setText("attemptedFlags", fmt(flags.attempted));
    setText("bestCombo", fmt(safe(flags.bestCombo).max));
    donut("deathDonut", "deathLegend", pursuit.deaths);
    setText("committedLunges", fmt(attacks.committedLunges));
    setText("lungesPerRun", `${fmt(attacks.lungesPerRun, 1)} per run`);
    setText("lungeDodgeRate", percent(attacks.lungeDodgeRate));
    setText("lungeOutcomes", `${fmt((number(attacks.lungeDodges) || 0) + (number(attacks.lungeHits) || 0))} resolved lunges`);
    setText("passiveCatches", fmt(attacks.passiveCatches));
    setText("passiveWhiffs", `${fmt(attacks.passiveWhiffs)} passive whiffs`);
    setText("followUpLunges", fmt(attacks.followUpLunges));
    setText("telegraphCount", `${fmt(attacks.telegraphs)} telegraphs`);
    threatBand(pursuit.threatExposure);
    drawTrend(pursuit.monthly || []);
    setText("averageFps", fmt(safe(performance.averageFps).mean, 1));
    setText("minimumFps", fmt(safe(performance.minimumFps).median, 1));
    setText("lowFpsRate", percent(performance.lowFpsRunRate));
    renderBars(
      "deviceBreakdown",
      (safe(pursuit.clients).deviceClass || []).map((row) => ({ label: row.label, value: row.rate })),
      { mini: true, max: 100, value: (row) => `${percent(row.value)}%` }
    );
  }

  function comparisonRow(label, value, maximum, className = "") {
    const available = number(value) !== null;
    const width = available && maximum ? Math.max(0, Math.min(100, (value / maximum) * 100)) : 0;
    return `<div class="comparison-row ${className}"><label>${label}</label><div class="bar-track"><div class="bar-fill" style="--width:${width}%"></div></div><strong>${available ? `${fmt(value)} m` : "—"}</strong></div>`;
  }

  function renderMountainHeatmap(containerId, matrix) {
    const node = $(containerId);
    node.replaceChildren();
    const source = safe(matrix);
    const values = OPEN_DEPTH_BANDS.flatMap(depth =>
      OPEN_LANE_BANDS.map(lane => number(safe(source[depth])[lane]) || 0)
    );
    const maximum = Math.max(0, ...values);
    const corner = document.createElement("span");
    corner.className = "heatmap-corner";
    corner.textContent = "DEPTH";
    node.appendChild(corner);
    for (const lane of OPEN_LANE_BANDS) {
      const label = document.createElement("span");
      label.className = "heatmap-column";
      label.textContent = lane === "FAR_LEFT" ? "FL" : lane === "FAR_RIGHT" ? "FR" : lane[0];
      label.title = OPEN_LANE_LABELS[lane];
      node.appendChild(label);
    }
    for (const depth of OPEN_DEPTH_BANDS) {
      const rowLabel = document.createElement("span");
      rowLabel.className = "heatmap-row";
      rowLabel.textContent = OPEN_DEPTH_LABELS[depth];
      node.appendChild(rowLabel);
      for (const lane of OPEN_LANE_BANDS) {
        const value = number(safe(source[depth])[lane]) || 0;
        const cell = document.createElement("span");
        const intensity = maximum ? value / maximum : 0;
        cell.className = "heatmap-cell";
        cell.style.setProperty("--heat", intensity.toFixed(3));
        cell.textContent = value ? fmt(value) : "";
        cell.title = `${OPEN_DEPTH_LABELS[depth]}, ${OPEN_LANE_LABELS[lane]}: ${fmt(value)}`;
        cell.setAttribute("aria-label", cell.title);
        node.appendChild(cell);
      }
    }
    node.classList.toggle("empty", maximum === 0);
  }

  function renderOpenSki(summary) {
    const leaderboard = safe(state.live && state.live.openSkiLeaderboard);
    const leaderboardOnline = leaderboard.ok === true;
    const open = leaderboardOnline ? safe(leaderboard.data) : {};
    const automatic = safe(state.live && state.live.openSkiAnalytics);
    const automaticOnline = automatic.ok === true;
    const automaticData = scopedFeedData(automatic);
    const overview = safe(automaticData.overview);
    const flags = safe(automaticData.flags);
    const speed = safe(automaticData.speed);
    const steering = safe(automaticData.steering);
    const performance = safe(automaticData.performance);
    const status = $("openLiveStatus");
    const recordedRuns = automaticOnline ? number(automaticData.accepted) || 0 : 0;
    state.openSkiLivePhase = !automaticOnline ? "offline" : recordedRuns ? "ready" : "empty";
    status.classList.toggle("ready", automaticOnline);
    status.classList.toggle("offline", !automaticOnline);
    status.textContent = !automaticOnline
      ? "OFFLINE"
      : recordedRuns ? `LIVE · ${fmt(recordedRuns)} ${recordedRuns === 1 ? "RUN" : "RUNS"}` : "CONNECTED · AWAITING RUN";
    setText("openRecordedRuns", automaticOnline ? fmt(recordedRuns) : "—");
    setText("openLiveMonths", automaticOnline ? liveMonthLabel(automaticData.sourceMonths) : "—");
    setText("openRecordedMedian", automaticOnline && recordedRuns ? fmt(safe(automaticData.distance).median) : "—");
    setText("openRecordedLongest", automaticOnline && recordedRuns ? `${fmt(safe(automaticData.distance).max)} m longest` : "—");
    setText("openRecordedFlags", automaticOnline && recordedRuns && number(flags.accuracy) !== null ? percent(flags.accuracy) : "—");
    setText("openRecordedFlagCount", automaticOnline && recordedRuns ? `${fmt(flags.clean)} clean / ${fmt(flags.attempted)} attempted` : "—");
    setText("openAverageSpeed", automaticOnline && recordedRuns ? fmt(speed.average, 1) : "—");
    setText("openPeakSpeed", automaticOnline && recordedRuns ? `${fmt(speed.peak, 1)} m/s peak` : "—");
    renderBars(
      "openFlagDepthBars",
      OPEN_DEPTH_BANDS.map(depth => {
        const value = safe(safe(flags.byDepth)[depth]);
        return { label: OPEN_DEPTH_LABELS[depth], value: value.accuracy, clean: value.clean, attempted: value.attempted };
      }),
      { max: 100, value: row => number(row.value) === null ? "<strong>—</strong>" : `<strong>${percent(row.value)}%</strong><span> · ${fmt(row.clean)}/${fmt(row.attempted)}</span>` }
    );
    donut("openDeathDonut", "openDeathLegend", automaticData.deaths);
    if (!automaticOnline) setText("openDeathLegend", "—");
    renderMountainHeatmap("openDeathHeatmap", safe(automaticData.spatial).deathZones);
    renderMountainHeatmap("openCollisionHeatmap", safe(automaticData.spatial).collisionZones);
    setText("openDeathHeatTotal", automaticOnline ? `${fmt(recordedRuns)} recorded` : "—");
    setText("openCollisionHeatTotal", automaticOnline ? `${fmt(overview.totalCollisions)} recorded` : "—");
    setText("openCollisionsPerRun", automaticOnline && recordedRuns ? fmt(overview.collisionsPerRun, 1) : "—");
    setText("openReversalsPerRun", automaticOnline && recordedRuns ? fmt(steering.reversalsPerRun, 1) : "—");
    setText("openAverageSteer", automaticOnline && recordedRuns ? fmt(steering.averageAbsoluteSteer, 2) : "—");
    setText("openAverageFps", automaticOnline && recordedRuns && number(performance.averageFps) !== null ? fmt(performance.averageFps, 1) : "—");
    setText("openMinimumFps", automaticOnline && recordedRuns && number(performance.minimumFps) !== null ? fmt(performance.minimumFps, 1) : "—");
    setText("openLowFpsFrames", automaticOnline && recordedRuns ? fmt(performance.lowFpsFrames) : "—");

    const hasOpenRuns = leaderboardOnline && (number(open.submittedRuns) || 0) > 0;
    const leaderboardStatus = $("openLeaderboardStatus");
    leaderboardStatus.classList.toggle("offline", !leaderboardOnline);
    leaderboardStatus.textContent = leaderboardOnline ? "LIVE" : "OFFLINE";
    setText("openSubmittedRuns", leaderboardOnline ? fmt(open.submittedRuns) : "—");
    setText(
      "openSubmitters",
      !leaderboardOnline ? "—" : hasOpenRuns
        ? `${fmt(open.approximateSubmitters)} players`
        : "0 players"
    );
    setText("openLongest", leaderboardOnline && hasOpenRuns ? fmt(safe(open.distance).max) : "—");
    setText("openMedian", leaderboardOnline && hasOpenRuns ? `${fmt(safe(open.distance).median)} m median` : "—");
    setText("openTopScore", leaderboardOnline && hasOpenRuns ? fmt(safe(open.score).max) : "—");
    setText("openFlagAccuracy", leaderboardOnline && hasOpenRuns ? `${percent(safe(open.flags).accuracy)}% flag accuracy` : "—");
  }

  function renderSnapshots() {
    const pursuitLive = safe(state.live && state.live.pursuit);
    const pursuit = scopedFeedData(pursuitLive);
    const pursuitReady = pursuitLive.ok === true && (number(pursuit.accepted) || 0) > 0;
    const pursuitConnected = pursuitLive.ok === true;
    const pursuitAttacks = safe(pursuit.attacks);
    const pursuitKinds = safe(pursuitAttacks.byKind);
    const attackTotal = (number(pursuitKinds.lunges) || 0) +
      (number(pursuitKinds.charges) || 0) + (number(pursuitKinds.boulders) || 0);
    const pursuitStatus = pursuitReady ? "LIVE" : pursuitConnected ? "AWAITING RUNS" : "OFFLINE";
    const pursuitRuns = pursuitReady ? fmt(pursuit.accepted) : pursuitConnected ? "0" : "—";
    const pursuitMedian = pursuitReady && number(safe(pursuit.distance).median) !== null
      ? `${fmt(pursuit.distance.median)} m` : "—";
    const pursuitFlags = pursuitReady && number(safe(pursuit.flags).accuracy) !== null
      ? `${percent(pursuit.flags.accuracy)}%` : "—";
    setText("homePursuitStatus", pursuitStatus);
    setText("homePursuitRuns", pursuitRuns);
    setText("homePursuitMedian", pursuitMedian);
    setText("homePursuitFlags", pursuitFlags);
    setText("pursuitSnapshotRuns", pursuitRuns);
    setText("pursuitSnapshotMonths", pursuitConnected ? liveMonthLabel(pursuit.sourceMonths) : "—");
    setText("pursuitSnapshotMedian", pursuitReady ? fmt(safe(pursuit.distance).median) : "—");
    setText("pursuitSnapshotFlags", pursuitReady && number(safe(pursuit.flags).accuracy) !== null ? percent(pursuit.flags.accuracy) : "—");
    setText("pursuitSnapshotFlagCount", pursuitReady
      ? `${fmt(pursuit.flags.clean)} clean / ${fmt(pursuit.flags.attempted)} attempted`
      : pursuitConnected ? "No current flags yet" : "—");
    setText("pursuitSnapshotAttacks", pursuitReady ? fmt(attackTotal) : "—");
    setText("pursuitSnapshotAttackMix", pursuitReady
      ? `${fmt(pursuitKinds.lunges)} lunge · ${fmt(pursuitKinds.charges)} charge · ${fmt(pursuitKinds.boulders)} boulder`
      : pursuitConnected ? "No current attack mix yet" : "—");
    setText("pursuitFlagModuleLiveAccuracy", pursuitReady && number(safe(pursuit.flags).accuracy) !== null ? percent(pursuit.flags.accuracy) : "—");
    setText("pursuitFlagModuleLiveCount", pursuitReady
      ? `${fmt(pursuit.flags.clean)} clean / ${fmt(pursuit.flags.attempted)} attempted`
      : pursuitConnected ? "No current flags yet" : "—");
    setText("pursuitFlagModuleLiveMedian", pursuitReady ? fmt(safe(pursuit.distance).median) : "—");

    const openLive = safe(state.live && state.live.openSkiAnalytics);
    const open = scopedFeedData(openLive);
    const openReady = openLive.ok === true && (number(open.accepted) || 0) > 0;
    const openConnected = openLive.ok === true;
    setText("homeOpenStatus", openReady ? "LIVE" : openConnected ? "AWAITING RUNS" : "OFFLINE");
    setText("homeOpenRuns", openReady ? fmt(open.accepted) : openConnected ? "0" : "—");
    setText("homeOpenMedian", openReady && number(safe(open.distance).median) !== null ? `${fmt(open.distance.median)} m` : "—");
    setText("homeOpenFlags", openReady && number(safe(open.flags).accuracy) !== null ? `${percent(open.flags.accuracy)}%` : "—");
  }

  const MODULES = Object.freeze({
    pursuit: ["yeti", "survival", "flags", "history"],
    "open-ski": ["course", "flags", "technique", "leaderboard"]
  });
  const LOCATION_LABELS = Object.freeze({
    home: ["MOUNTAIN REPORT", "OVERVIEW"],
    pursuit: ["MOUNTAIN REPORT", "PURSUIT"],
    "pursuit:yeti": ["PURSUIT", "THE YETI"],
    "pursuit:survival": ["PURSUIT", "SURVIVAL & ENDINGS"],
    "pursuit:flags": ["PURSUIT", "FLAGS & SPEED"],
    "pursuit:history": ["PURSUIT", "HISTORY & PERFORMANCE"],
    "open-ski": ["MOUNTAIN REPORT", "OPEN SKI"],
    "open-ski:course": ["OPEN SKI", "MOUNTAIN HOT SPOTS"],
    "open-ski:flags": ["OPEN SKI", "FLAGS BY DEPTH"],
    "open-ski:technique": ["OPEN SKI", "MOVEMENT & PERFORMANCE"],
    "open-ski:leaderboard": ["OPEN SKI", "LEADERBOARD"]
  });

  function normalizedDestination(view, module) {
    const normalizedView = view === "pursuit" || view === "open-ski" ? view : "home";
    const normalizedModule = normalizedView !== "home" && MODULES[normalizedView].includes(module)
      ? module : null;
    return { view: normalizedView, module: normalizedModule };
  }

  function navigationFromUrl() {
    const params = new URLSearchParams(location.search);
    return normalizedDestination(params.get("view"), params.get("module"));
  }

  function navigate(view, module = null, options = {}) {
    const destination = normalizedDestination(view, module);
    state.view = destination.view;
    state.module = destination.module;
    document.querySelectorAll("[data-report-screen]").forEach((screen) => {
      screen.hidden = screen.dataset.reportScreen !== state.view;
    });
    document.querySelectorAll("[data-mode-overview]").forEach((overview) => {
      overview.hidden = overview.dataset.modeOverview !== state.view || state.module !== null;
    });
    document.querySelectorAll("[data-module-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.modulePanel !== `${state.view}:${state.module}`;
    });
    const key = state.module ? `${state.view}:${state.module}` : state.view;
    const labels = LOCATION_LABELS[key] || LOCATION_LABELS.home;
    setText("reportKicker", labels[0]);
    setText("reportLocation", labels[1]);
    $("reportToolbar").hidden = state.view === "home";
    document.querySelectorAll("[data-report-home]").forEach(button => button.hidden = state.view === "home");
    document.querySelectorAll("[data-report-back]").forEach(button => button.hidden = state.module === null);
    if (options.updateUrl !== false) {
      const url = new URL(location.href);
      if (state.view === "home") {
        url.searchParams.delete("view");
        url.searchParams.delete("module");
      } else {
        url.searchParams.set("view", state.view);
        if (state.module) url.searchParams.set("module", state.module);
        else url.searchParams.delete("module");
      }
      history.pushState({ view: state.view, module: state.module }, "", url);
    }
    if (options.scroll !== false)
      window.scrollTo({ top: Math.max(0, $("dashboard").offsetTop - 14), behavior: options.instant ? "auto" : "smooth" });
    if (state.view === "pursuit" && state.module === "history")
      requestAnimationFrame(() => drawTrend(lastChartData));
  }

  function selectView(view, updateUrl = true, scroll = true) {
    navigate(view, null, { updateUrl, scroll });
  }

  function render(summary) {
    if (!summary || summary.schema !== SCHEMA) throw new Error("Unsupported analytics summary schema.");
    state.data = summary;
    setStatus(summary);
    if (summary.status !== "ready") {
      state.phase = "empty";
      showOnly("emptyState");
      return;
    }
    renderPursuit(summary);
    renderOpenSki(summary);
    renderSnapshots();
    state.phase = "ready";
    showOnly("dashboard");
    const requested = navigationFromUrl();
    navigate(requested.view, requested.module, { updateUrl: false, scroll: false });
  }

  function summaryWithLiveOpenSki(baseline, live) {
    const summary = clone(baseline);
    if (live && live.openSkiLeaderboard) {
      const online = live.openSkiLeaderboard.ok === true;
      summary.leaderboards.openSki = online ? clone(live.openSkiLeaderboard.data) : {};
      summary.coverage.openSkiLeaderboard = online ? clone(live.openSkiLeaderboard.data.coverage) : {};
    }
    return summary;
  }

  function renderSelectedTimeScope() {
    renderTimeScopeUi();
    if (state.phase !== "ready" || !state.baseline || !state.live) return;
    const view = state.view;
    const module = state.module;
    render(summaryWithLiveOpenSki(state.baseline, state.live));
    navigate(view, module, { updateUrl: false, scroll: false });
    renderLive(state.live);
    renderSnapshots();
  }

  function setTimeScope(next, updateUrl = true) {
    const normalized = TIME_SCOPES.has(next) ? next : "recent";
    const changed = normalized !== state.timeScope;
    state.timeScope = normalized;
    if (updateUrl && changed) {
      const url = new URL(location.href);
      if (normalized === "recent") url.searchParams.delete("period");
      else url.searchParams.set("period", "all");
      history.pushState({ view: state.view, module: state.module, period: normalized }, "", url);
    }
    renderSelectedTimeScope();
  }

  async function loadLiveSnapshot() {
    if (!window.AnalyticsLiveData) throw new Error("Live analytics module did not load.");
    if (!state.demo) return window.AnalyticsLiveData.load();
    const response = await fetch("./fixtures/live-feed-a4-4.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Live demo request returned ${response.status}.`);
    const fixture = await response.json();
    return window.AnalyticsLiveData.fromTrees(
      fixture.publicAnalyticsRuns,
      fixture.openSkiAnalyticsRuns,
      fixture.openSkiRuns,
      Date.UTC(2026, 7, 2)
    );
  }

  function offlineLive(error) {
    const empty = window.AnalyticsLiveData
      ? window.AnalyticsLiveData.fromTrees(null, null)
      : { checkedAt: Date.now(), pursuit: { data: {} }, openSkiAnalytics: { data: {} }, openSkiLeaderboard: { data: {} } };
    const message = String(error && error.message ? error.message : error || "Live feed unavailable.");
    return {
      ...empty,
      pursuit: { ...empty.pursuit, ok: false, error: message },
      openSkiAnalytics: { ...empty.openSkiAnalytics, ok: false, error: message },
      openSkiLeaderboard: { ...empty.openSkiLeaderboard, ok: false, error: message },
      requests: state.demo ? 0 : 3
    };
  }

  async function refreshLive() {
    if (state.liveRefreshing || !state.baseline) return state.live;
    state.liveRefreshing = true;
    try {
      const live = await loadLiveSnapshot().catch(offlineLive);
      state.live = live;
      const view = state.view;
      const module = state.module;
      render(summaryWithLiveOpenSki(state.baseline, live));
      navigate(view, module, { updateUrl: false, scroll: false });
      renderLive(live);
      renderSnapshots();
      return live;
    } finally {
      state.liveRefreshing = false;
    }
  }

  async function load() {
    state.phase = "loading";
    state.error = "";
    showOnly("loadingState");
    const params = new URLSearchParams(location.search);
    state.demo = params.get("demo") === "1";
    state.timeScope = timeScopeFromUrl();
    const source = state.demo
      ? "./fixtures/community-summary-demo.json"
      : "./data/community-summary-v1.json";
    try {
      const [response, live] = await Promise.all([
        fetch(source, { cache: "no-store" }),
        loadLiveSnapshot().catch(offlineLive)
      ]);
      if (!response.ok) throw new Error(`Summary request returned ${response.status}.`);
      state.baseline = await response.json();
      state.live = live;
      render(summaryWithLiveOpenSki(state.baseline, live));
      renderLive(live);
      renderSnapshots();
      clearInterval(liveRefreshTimer);
      if (!state.demo) liveRefreshTimer = setInterval(refreshLive, LIVE_REFRESH_MS);
    } catch (error) {
      state.phase = "error";
      state.error = String(error && error.message ? error.message : error);
      setText("errorMessage", `${state.error} Serve this folder over HTTP; browsers usually block local file data requests.`);
      showOnly("errorState");
    }
  }

  document.querySelectorAll("[data-open-view]").forEach((button) =>
    button.addEventListener("click", () => navigate(button.dataset.openView))
  );
  document.querySelectorAll("[data-open-module]").forEach((button) =>
    button.addEventListener("click", () => {
      const [view, module] = button.dataset.openModule.split(":");
      navigate(view, module);
    })
  );
  document.querySelectorAll("[data-report-home]").forEach((button) =>
    button.addEventListener("click", () => navigate("home"))
  );
  document.querySelectorAll("[data-report-back]").forEach((button) =>
    button.addEventListener("click", () => navigate(state.view))
  );
  document.querySelectorAll("[data-time-scope]").forEach((button) =>
    button.addEventListener("click", () => setTimeScope(button.dataset.timeScope))
  );
  $("retryLoad").addEventListener("click", load);
  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.phase === "ready" && state.view === "pursuit" && state.module === "history" && drawTrend(lastChartData), 80);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.demo && Date.now() - state.liveCheckedAt >= LIVE_REFRESH_MS)
      refreshLive();
  });
  addEventListener("popstate", () => {
    const nextScope = timeScopeFromUrl();
    if (nextScope !== state.timeScope) {
      state.timeScope = nextScope;
      renderSelectedTimeScope();
    }
    const destination = navigationFromUrl();
    navigate(destination.view, destination.module, { updateUrl: false, scroll: false });
  });
  window.advanceTime = () => state.phase;
  window.render_game_to_text = () => {
    const pursuitLiveData = scopedFeedData(state.live && state.live.pursuit);
    const openSkiLiveData = scopedFeedData(state.live && state.live.openSkiAnalytics);
    return JSON.stringify({
      screen: "analytics",
      phase: state.phase,
      view: state.view,
      module: state.module,
      period: state.timeScope,
      periodLabel: selectedWindowLabel(),
      demo: state.demo,
      source: "historical-archive-plus-scoped-live-current",
      sourceWindow: state.data && state.data.sourceWindow,
      live: state.live
        ? {
            phase: state.livePhase,
            checkedAt: state.liveCheckedAt,
            requestsPerRefresh: state.live.requests,
            pursuitConnected: state.live.pursuit.ok,
            pursuitAccepted: pursuitLiveData.accepted,
            pursuitInvalid: pursuitLiveData.invalid,
            openSkiAnalyticsConnected: state.live.openSkiAnalytics.ok,
            openSkiAnalyticsAccepted: openSkiLiveData.accepted,
            openSkiLeaderboardConnected: state.live.openSkiLeaderboard.ok,
            openSkiLeaderboardAccepted: state.live.openSkiLeaderboard.data.submittedRuns,
            attacks: state.live.pursuit.ok ? {
              committedLunges: safe(pursuitLiveData.attacks).committedLunges,
              chargeCommits: safe(pursuitLiveData.attacks).chargeCommits,
              boulderThrowReleases: safe(pursuitLiveData.attacks).boulderThrowReleases,
              byRange: safe(pursuitLiveData.attacks).byRange,
              byPerformance: safe(pursuitLiveData.attacks).byPerformance
            } : null
          }
        : null,
      pursuit: state.data && state.data.pursuit
        ? {
            recordedRuns: state.data.pursuit.overview.recordedRuns,
            approximatePlayers: state.data.pursuit.overview.approximatePlayers,
            medianDistance: state.data.pursuit.distance.median,
            flagAccuracy: state.data.pursuit.flags.accuracy,
            lungeDodgeRate: state.data.pursuit.attacks.lungeDodgeRate
          }
        : null,
      openSki: state.data && state.data.leaderboards
        ? {
            submittedRuns: safe(state.data.leaderboards.openSki).submittedRuns,
            medianDistance: safe(safe(state.data.leaderboards.openSki).distance).median,
            automaticRecordedRuns: state.live && state.live.openSkiAnalytics ? openSkiLiveData.accepted : 0,
            automaticPhase: state.openSkiLivePhase,
            telemetryIncluded: false,
            pursuitTelemetryIncluded: false
          }
        : null,
      cohorts: state.data && state.data.coverage
        ? {
            currentRelease: state.data.coverage.pursuitTelemetry.cohorts.currentRelease,
            historical: state.data.coverage.pursuitTelemetry.cohorts.historical
          }
        : null,
      error: state.error
    });
  };
  window.AnalyticsDashboard = Object.freeze({ load, refreshLive, selectView, navigate, setTimeScope, state: () => ({ ...state, data: undefined, baseline: undefined }) });
  load();
})();
