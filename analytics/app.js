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
  const $ = (id) => document.getElementById(id);
  const LIVE_REFRESH_MS = 5 * 60 * 1000;
  const state = {
    phase: "loading",
    view: "home",
    module: null,
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
    const window = safe(summary.sourceWindow);
    setText(
      "sourceWindow",
      window.firstDay && window.lastDay
        ? `${dateLabel(window.firstDay)} — ${dateLabel(window.lastDay)}`
        : "NO RECORDED WINDOW"
    );
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
    const minimum = number(current.minimumRuns) || 3;
    setText(
      "cohortAvailabilityNote",
      current.status === "ready"
        ? "Current-release comparisons use only exact v12c.1 / telemetry-engine-v2.8 records; historical runs never enter the current column."
        : `Current-release metrics unlock after ${fmt(minimum)} recorded runs. Overall cards remain available, but historical data never fills the current column.`
    );
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

  function renderLiveMix(attacks) {
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
      empty.textContent = "No committed live attacks yet.";
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
    const status = $("liveFeedStatus");
    const topBadge = $("dataStatus");
    topBadge.classList.toggle("demo", state.demo);
    topBadge.textContent = state.demo
      ? "DEMO DATA"
      : pursuit.ok === true ? "LIVE DATA" : "ARCHIVE DATA";
    const window = safe(state.data && state.data.sourceWindow);
    const baselineWindow = window.firstDay && window.lastDay
      ? `${dateLabel(window.firstDay)} — ${dateLabel(window.lastDay)}`
      : "NO RECORDED WINDOW";
    const checked = new Date(state.liveCheckedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toUpperCase();
    setText("sourceWindow", `${baselineWindow} · LIVE CHECKED ${checked}`);
    status.classList.toggle("ready", pursuit.ok === true);
    status.classList.toggle("offline", pursuit.ok !== true);
    if (pursuit.ok !== true) {
      state.livePhase = "offline";
      status.textContent = "LIVE FEED OFFLINE";
      setText("liveFeedCopy", "The packaged A3 baseline remains available. The live feed will retry automatically when this page is open.");
      for (const id of ["liveRunCount", "liveMonths", "liveMedianDistance", "liveFlagAccuracy", "liveFlagCount", "liveAverageFps", "liveFpsCoverage", "liveLunges", "liveLungeDodges", "liveCharges", "liveChargeDodges", "liveBoulders", "liveBoulderReleases"])
        setText(id, "—");
      renderLiveMix({});
      setText("liveFeedPrivacy", "Live Pursuit data could not be reached; no private telemetry path was requested. Packaged aggregate cards remain valid.");
      return;
    }
    const data = safe(pursuit.data);
    const runs = number(data.accepted) || 0;
    const attacks = safe(data.attacks);
    state.livePhase = runs ? "ready" : "empty";
    status.textContent = runs ? `LIVE · ${fmt(runs)} ${runs === 1 ? "RUN" : "RUNS"}` : "CONNECTED · AWAITING RUN";
    setText(
      "liveFeedCopy",
      runs
        ? "These exact figures include only identifier-free Pursuit runs submitted after the A4.3 deployment. They are shown beside, not blended into, the packaged historical baseline."
        : "The A4.3 public feed is connected. It will populate after the first post-deployment Pursuit run completes."
    );
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
    setText("liveFeedPrivacy", `${fmt(data.invalid)} rejected rows. Pursuit live records contain no player identifiers, report IDs, exact timestamps, traces, comments, or device/session identity.`);
  }

  function renderPursuit(summary) {
    const pursuit = safe(summary.pursuit);
    const overview = safe(pursuit.overview);
    const distance = safe(pursuit.distance);
    const flags = safe(pursuit.flags);
    const attacks = safe(pursuit.attacks);
    const performance = safe(pursuit.performance);
    const telemetryCoverage = safe(safe(summary.coverage).pursuitTelemetry);
    const buildCoverage = Array.isArray(telemetryCoverage.buildVersions)
      ? telemetryCoverage.buildVersions.map((row) => `${row.label} · ${fmt(row.count)} runs`).join(" / ")
      : "";
    setText("pursuitBuildCoverage", buildCoverage ? `Telemetry builds: ${buildCoverage}` : "Telemetry build unavailable");
    renderCohorts(summary);
    setText("runsRecorded", fmt(overview.recordedRuns));
    setText("playersRecorded", `${fmt(overview.approximatePlayers)} approximate anonymous players`);
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
    const optional = safe(attacks.optionalMetricAvailability);
    const missing = Object.values(optional).filter((entry) => !entry.available).length;
    setText(
      "attackAvailabilityNote",
      missing
        ? "Charge and thrown-boulder counters are not present in the current Firebase telemetry wire schema; this dashboard reports them as unavailable, never as zero."
        : "Charge and thrown-boulder counters are available in this dataset."
    );
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
    const boards = safe(summary.leaderboards);
    const open = safe(boards.openSki);
    const automatic = safe(state.live && state.live.openSkiAnalytics);
    const automaticData = safe(automatic.data);
    const overview = safe(automaticData.overview);
    const flags = safe(automaticData.flags);
    const speed = safe(automaticData.speed);
    const steering = safe(automaticData.steering);
    const performance = safe(automaticData.performance);
    const status = $("openLiveStatus");
    const recordedRuns = automatic.ok === true ? number(automaticData.accepted) || 0 : 0;
    state.openSkiLivePhase = automatic.ok !== true ? "offline" : recordedRuns ? "ready" : "empty";
    status.classList.toggle("ready", automatic.ok === true);
    status.classList.toggle("offline", automatic.ok !== true);
    status.textContent = automatic.ok !== true
      ? "LIVE FEED OFFLINE"
      : recordedRuns ? `LIVE · ${fmt(recordedRuns)} ${recordedRuns === 1 ? "RUN" : "RUNS"}` : "CONNECTED · AWAITING RUN";
    setText("openLiveCopy", automatic.ok !== true
      ? "Automatic Open Ski analytics could not be reached. The voluntary leaderboard remains independent and the page will retry automatically."
      : recordedRuns
        ? `Anonymous Open Ski summaries are aggregated live and refreshed every five minutes. ${fmt(automaticData.invalid)} malformed or privacy-unsafe rows were rejected.`
        : "The automatic Open Ski feed is connected and will populate after the first consenting Open Ski run finishes on the A5.2B game build.");
    setText("openRecordedRuns", automatic.ok === true ? fmt(recordedRuns) : "—");
    setText("openLiveMonths", automatic.ok === true ? liveMonthLabel(automaticData.sourceMonths) : "AUTOMATIC FEED UNAVAILABLE");
    setText("openRecordedMedian", recordedRuns ? fmt(safe(automaticData.distance).median) : "—");
    setText("openRecordedLongest", recordedRuns ? `${fmt(safe(automaticData.distance).max)} m longest` : "No recorded descents yet");
    setText("openRecordedFlags", recordedRuns && number(flags.accuracy) !== null ? percent(flags.accuracy) : "—");
    setText("openRecordedFlagCount", recordedRuns ? `${fmt(flags.clean)} clean / ${fmt(flags.attempted)} attempted` : "No recorded flags yet");
    setText("openAverageSpeed", recordedRuns ? fmt(speed.average, 1) : "—");
    setText("openPeakSpeed", recordedRuns ? `${fmt(speed.peak, 1)} m/s peak` : "No speed samples yet");
    renderBars(
      "openFlagDepthBars",
      OPEN_DEPTH_BANDS.map(depth => {
        const value = safe(safe(flags.byDepth)[depth]);
        return { label: OPEN_DEPTH_LABELS[depth], value: value.accuracy, clean: value.clean, attempted: value.attempted };
      }),
      { max: 100, value: row => number(row.value) === null ? "<strong>—</strong>" : `<strong>${percent(row.value)}%</strong><span> · ${fmt(row.clean)}/${fmt(row.attempted)}</span>` }
    );
    donut("openDeathDonut", "openDeathLegend", automaticData.deaths);
    renderMountainHeatmap("openDeathHeatmap", safe(automaticData.spatial).deathZones);
    renderMountainHeatmap("openCollisionHeatmap", safe(automaticData.spatial).collisionZones);
    setText("openDeathHeatTotal", recordedRuns ? `${fmt(recordedRuns)} recorded` : "No data yet");
    setText("openCollisionHeatTotal", recordedRuns ? `${fmt(overview.totalCollisions)} recorded` : "No data yet");
    setText("openCollisionsPerRun", recordedRuns ? fmt(overview.collisionsPerRun, 1) : "—");
    setText("openReversalsPerRun", recordedRuns ? fmt(steering.reversalsPerRun, 1) : "—");
    setText("openAverageSteer", recordedRuns ? fmt(steering.averageAbsoluteSteer, 2) : "—");
    setText("openAverageFps", recordedRuns && number(performance.averageFps) !== null ? fmt(performance.averageFps, 1) : "—");
    setText("openMinimumFps", recordedRuns && number(performance.minimumFps) !== null ? fmt(performance.minimumFps, 1) : "—");
    setText("openLowFpsFrames", recordedRuns ? fmt(performance.lowFpsFrames) : "—");

    const hasOpenRuns = (number(open.submittedRuns) || 0) > 0;
    const liveOpenSki = state.live && state.live.openSkiLeaderboard && state.live.openSkiLeaderboard.ok === true;
    const leaderboardStatus = $("openLeaderboardStatus");
    leaderboardStatus.classList.toggle("offline", !liveOpenSki);
    leaderboardStatus.textContent = liveOpenSki ? "LIVE PUBLIC BOARD" : "PACKAGED FALLBACK";
    setText("openSubmittedRuns", fmt(open.submittedRuns));
    setText(
      "openSubmitters",
      hasOpenRuns
        ? `${fmt(open.approximateSubmitters)} approximate anonymous submitters${liveOpenSki ? " · live public board" : ""}`
        : liveOpenSki ? "No Open Ski submissions on the live public board" : "No Open Ski submissions in the packaged baseline"
    );
    setText("openLongest", hasOpenRuns ? fmt(safe(open.distance).max) : "—");
    setText("openMedian", hasOpenRuns ? `${fmt(safe(open.distance).median)} m median` : "No median yet");
    setText("openTopScore", hasOpenRuns ? fmt(safe(open.score).max) : "—");
    setText("openFlagAccuracy", hasOpenRuns ? `${percent(safe(open.flags).accuracy)}% flag accuracy` : "No flag accuracy yet");
  }

  function renderSnapshots() {
    const pursuitLive = safe(state.live && state.live.pursuit);
    const pursuit = safe(pursuitLive.data);
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
    setText("pursuitSnapshotMonths", pursuitConnected ? liveMonthLabel(pursuit.sourceMonths) : "LIVE FEED UNAVAILABLE");
    setText("pursuitSnapshotMedian", pursuitReady ? fmt(safe(pursuit.distance).median) : "—");
    setText("pursuitSnapshotFlags", pursuitReady && number(safe(pursuit.flags).accuracy) !== null ? percent(pursuit.flags.accuracy) : "—");
    setText("pursuitSnapshotFlagCount", pursuitReady ? `${fmt(pursuit.flags.clean)} clean / ${fmt(pursuit.flags.attempted)} attempted` : "No current flags yet");
    setText("pursuitSnapshotAttacks", pursuitReady ? fmt(attackTotal) : "—");
    setText("pursuitSnapshotAttackMix", pursuitReady
      ? `${fmt(pursuitKinds.lunges)} lunge · ${fmt(pursuitKinds.charges)} charge · ${fmt(pursuitKinds.boulders)} boulder`
      : "No current attack mix yet");
    setText("pursuitOverviewCopy", pursuitReady
      ? "Current community runs, with deeper Yeti and survival modules one tap away."
      : pursuitConnected ? "The live feed is connected and waiting for current Pursuit runs." : "Live Pursuit is temporarily unavailable; the archive remains accessible.");
    setText("pursuitFlagModuleLiveAccuracy", pursuitReady && number(safe(pursuit.flags).accuracy) !== null ? percent(pursuit.flags.accuracy) : "—");
    setText("pursuitFlagModuleLiveCount", pursuitReady ? `${fmt(pursuit.flags.clean)} clean / ${fmt(pursuit.flags.attempted)} attempted` : "No current flags yet");
    setText("pursuitFlagModuleLiveMedian", pursuitReady ? fmt(safe(pursuit.distance).median) : "—");

    const openLive = safe(state.live && state.live.openSkiAnalytics);
    const open = safe(openLive.data);
    const openReady = openLive.ok === true && (number(open.accepted) || 0) > 0;
    const openConnected = openLive.ok === true;
    setText("homeOpenStatus", openReady ? "LIVE" : openConnected ? "AWAITING RUNS" : "OFFLINE");
    setText("homeOpenRuns", openReady ? fmt(open.accepted) : openConnected ? "0" : "—");
    setText("homeOpenMedian", openReady && number(safe(open.distance).median) !== null ? `${fmt(open.distance.median)} m` : "—");
    setText("homeOpenFlags", openReady && number(safe(open.flags).accuracy) !== null ? `${percent(open.flags.accuracy)}%` : "—");
  }

  function renderMethodology(summary) {
    const coverage = safe(summary.coverage);
    const telemetry = safe(coverage.pursuitTelemetry);
    const pursuit = safe(coverage.pursuitLeaderboard);
    const open = safe(coverage.openSkiLeaderboard);
    const livePursuit = state.live && state.live.pursuit && state.live.pursuit.ok
      ? number(state.live.pursuit.data.accepted) || 0
      : null;
    const liveOpen = state.live && state.live.openSkiLeaderboard && state.live.openSkiLeaderboard.ok
      ? number(state.live.openSkiLeaderboard.data.submittedRuns) || 0
      : null;
    const liveOpenAutomatic = state.live && state.live.openSkiAnalytics && state.live.openSkiAnalytics.ok
      ? number(state.live.openSkiAnalytics.data.accepted) || 0
      : null;
    const liveCopy = livePursuit === null
      ? " The live Pursuit feed is temporarily unavailable; the packaged baseline remains visible."
      : ` The separate live panel contains ${fmt(livePursuit)} post-A4.3 Pursuit runs; those exact live-only values are not blended into historical percentiles.`;
    const openCopy = `${liveOpenAutomatic === null
      ? " The automatic Open Ski feed is temporarily unavailable."
      : ` The automatic Open Ski feed contains ${fmt(liveOpenAutomatic)} consenting finished runs.`}${liveOpen === null
      ? ` The leaderboard is using its packaged ${fmt(open.accepted)}-submission fallback.`
      : ` The separate live leaderboard has ${fmt(liveOpen)} voluntary submissions.`}`;
    setText(
      "coverageCopy",
      `Packaged baseline: ${fmt(telemetry.accepted)} Pursuit telemetry summaries and ${fmt(pursuit.accepted)} Pursuit leaderboard submissions.${liveCopy}${openCopy}`
    );
    const list = $("privacyNotes");
    list.replaceChildren();
    for (const note of safe(summary.privacy).notes || []) {
      const item = document.createElement("li");
      item.textContent = note;
      list.appendChild(item);
    }
    const liveNote = document.createElement("li");
    liveNote.textContent = "The page makes three public, read-only Firebase requests per refresh: Pursuit analytics, automatic Open Ski analytics, and the separate Open Ski leaderboard. It never requests a private telemetry branch.";
    list.appendChild(liveNote);
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
    renderMethodology(summary);
    state.phase = "ready";
    showOnly("dashboard");
    const requested = navigationFromUrl();
    navigate(requested.view, requested.module, { updateUrl: false, scroll: false });
  }

  function summaryWithLiveOpenSki(baseline, live) {
    const summary = clone(baseline);
    if (live && live.openSkiLeaderboard && live.openSkiLeaderboard.ok === true) {
      summary.leaderboards.openSki = clone(live.openSkiLeaderboard.data);
      summary.coverage.openSkiLeaderboard = clone(live.openSkiLeaderboard.data.coverage);
    }
    return summary;
  }

  async function loadLiveSnapshot() {
    if (!window.AnalyticsLiveData) throw new Error("Live analytics module did not load.");
    if (!state.demo) return window.AnalyticsLiveData.load();
    const response = await fetch("./fixtures/live-feed-a4-4.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Live demo request returned ${response.status}.`);
    const fixture = await response.json();
    return window.AnalyticsLiveData.fromTrees(fixture.publicAnalyticsRuns, fixture.openSkiAnalyticsRuns, fixture.openSkiRuns);
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
      renderMethodology(state.data);
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
      renderMethodology(state.data);
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
    const destination = navigationFromUrl();
    navigate(destination.view, destination.module, { updateUrl: false, scroll: false });
  });
  window.advanceTime = () => state.phase;
  window.render_game_to_text = () =>
    JSON.stringify({
      screen: "analytics",
      phase: state.phase,
      view: state.view,
      module: state.module,
      demo: state.demo,
      source: "packaged-baseline-plus-live-feed",
      sourceWindow: state.data && state.data.sourceWindow,
      live: state.live
        ? {
            phase: state.livePhase,
            checkedAt: state.liveCheckedAt,
            requestsPerRefresh: state.live.requests,
            pursuitConnected: state.live.pursuit.ok,
            pursuitAccepted: state.live.pursuit.data.accepted,
            pursuitInvalid: state.live.pursuit.data.invalid,
            openSkiAnalyticsConnected: state.live.openSkiAnalytics.ok,
            openSkiAnalyticsAccepted: state.live.openSkiAnalytics.data.accepted,
            openSkiLeaderboardConnected: state.live.openSkiLeaderboard.ok,
            openSkiLeaderboardAccepted: state.live.openSkiLeaderboard.data.submittedRuns,
            attacks: state.live.pursuit.ok ? {
              committedLunges: state.live.pursuit.data.attacks.committedLunges,
              chargeCommits: state.live.pursuit.data.attacks.chargeCommits,
              boulderThrowReleases: state.live.pursuit.data.attacks.boulderThrowReleases,
              byRange: state.live.pursuit.data.attacks.byRange,
              byPerformance: state.live.pursuit.data.attacks.byPerformance
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
            submittedRuns: state.data.leaderboards.openSki.submittedRuns,
            medianDistance: state.data.leaderboards.openSki.distance.median,
            automaticRecordedRuns: state.live && state.live.openSkiAnalytics ? state.live.openSkiAnalytics.data.accepted : 0,
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
  window.AnalyticsDashboard = Object.freeze({ load, refreshLive, selectView, navigate, state: () => ({ ...state, data: undefined, baseline: undefined }) });
  load();
})();
