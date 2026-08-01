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
  const $ = (id) => document.getElementById(id);
  const state = { phase: "loading", view: "pursuit", demo: false, data: null, error: "" };
  let lastChartData = [];

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
    badge.textContent = state.demo ? "DEMO DATA" : summary.status === "ready" ? "AGGREGATE READY" : "AWAITING EXPORT";
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

  function renderOpenSki(summary) {
    const boards = safe(summary.leaderboards);
    const open = safe(boards.openSki);
    const pursuit = safe(boards.pursuit);
    const hasOpenRuns = (number(open.submittedRuns) || 0) > 0;
    setText("openSubmittedRuns", fmt(open.submittedRuns));
    setText("openSubmitters", hasOpenRuns ? `${fmt(open.approximateSubmitters)} approximate anonymous submitters` : "No Open Ski submissions in this export");
    setText("openLongest", hasOpenRuns ? fmt(safe(open.distance).max) : "—");
    setText("openMedian", hasOpenRuns ? `${fmt(safe(open.distance).median)} m median` : "No median yet");
    setText("openTopScore", hasOpenRuns ? fmt(safe(open.score).max) : "—");
    setText("openFlagAccuracy", hasOpenRuns ? `${percent(safe(open.flags).accuracy)}% flag accuracy` : "No flag accuracy yet");
    const pursuitDistance = number(safe(pursuit.distance).median) || 0;
    const openDistance = hasOpenRuns ? number(safe(open.distance).median) : null;
    const maximum = Math.max(1, pursuitDistance, openDistance);
    $("modeComparison").innerHTML =
      comparisonRow("Pursuit", pursuitDistance, maximum) +
      comparisonRow("Open Ski", openDistance, maximum, "open");
    donut("openDeathDonut", "openDeathLegend", open.deaths);
  }

  function renderMethodology(summary) {
    const coverage = safe(summary.coverage);
    const telemetry = safe(coverage.pursuitTelemetry);
    const pursuit = safe(coverage.pursuitLeaderboard);
    const open = safe(coverage.openSkiLeaderboard);
    setText(
      "coverageCopy",
      `${fmt(telemetry.accepted)} Pursuit telemetry summaries, ${fmt(pursuit.accepted)} Pursuit leaderboard submissions, and ${fmt(open.accepted)} Open Ski submissions were accepted by the aggregate processor.`
    );
    const list = $("privacyNotes");
    list.replaceChildren();
    for (const note of safe(summary.privacy).notes || []) {
      const item = document.createElement("li");
      item.textContent = note;
      list.appendChild(item);
    }
  }

  function selectView(view, updateUrl = true, scroll = true) {
    state.view = view === "open-ski" ? "open-ski" : "pursuit";
    document.querySelectorAll("[data-view-button]").forEach((button) => {
      const active = button.dataset.viewButton === state.view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.viewPanel !== state.view;
    });
    if (updateUrl) {
      const url = new URL(location.href);
      if (state.view === "open-ski") url.searchParams.set("view", "open-ski");
      else url.searchParams.delete("view");
      history.replaceState(null, "", url);
    }
    if (scroll)
      window.scrollTo({ top: Math.max(0, $("dashboard").offsetTop - 24), behavior: "smooth" });
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
    renderMethodology(summary);
    state.phase = "ready";
    showOnly("dashboard");
    const requested = new URLSearchParams(location.search).get("view");
    selectView(requested === "open-ski" ? "open-ski" : "pursuit", false, false);
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
      const response = await fetch(source, { cache: "no-store" });
      if (!response.ok) throw new Error(`Summary request returned ${response.status}.`);
      render(await response.json());
    } catch (error) {
      state.phase = "error";
      state.error = String(error && error.message ? error.message : error);
      setText("errorMessage", `${state.error} Serve this folder over HTTP; browsers usually block local file data requests.`);
      showOnly("errorState");
    }
  }

  document.querySelectorAll("[data-view-button]").forEach((button) =>
    button.addEventListener("click", () => selectView(button.dataset.viewButton))
  );
  $("retryLoad").addEventListener("click", load);
  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => state.phase === "ready" && state.view === "pursuit" && drawTrend(lastChartData), 80);
  });
  window.advanceTime = () => state.phase;
  window.render_game_to_text = () =>
    JSON.stringify({
      screen: "analytics",
      phase: state.phase,
      view: state.view,
      demo: state.demo,
      sourceWindow: state.data && state.data.sourceWindow,
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
            telemetryIncluded: false
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
  window.AnalyticsDashboard = Object.freeze({ load, selectView, state: () => ({ ...state, data: undefined }) });
  load();
})();
