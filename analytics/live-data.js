(() => {
  "use strict";

  const DATABASE = "https://endless-powder-default-rtdb.firebaseio.com";
  const PATHS = Object.freeze({
    pursuit: "/endless_powder/public_analytics_runs.json",
    openSki: "/endless_powder/modes/open_ski/leaderboard_runs.json"
  });
  const PUBLIC_SCHEMA = "public-analytics-run-v1";
  const PROHIBITED = new Set([
    "uid", "initials", "timestamp", "reportId", "session", "client", "trace",
    "samples", "events", "errors", "comments", "feedback", "courseSeed"
  ]);
  const PERFORMANCE = Object.freeze(["STRUGGLING", "STABLE", "FAST", "HOT"]);
  const RANGES = Object.freeze(["SHORT", "MID", "LONG"]);
  const KINDS = Object.freeze(["lunges", "charges", "boulders"]);
  const DEATHS = Object.freeze(["caught", "tree", "boulder", "edge"]);

  const object = value => value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const finite = value => value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  const nonnegative = value => Math.max(0, finite(value) || 0);
  const integer = value => Math.floor(nonnegative(value));
  const round = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round((finite(value) || 0) * scale) / scale;
  };
  const sum = values => values.reduce((total, value) => total + nonnegative(value), 0);
  const mean = values => values.length ? round(sum(values) / values.length, 2) : null;
  const percentile = (values, fraction) => {
    const sorted = values.map(finite).filter(value => value !== null).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const point = (sorted.length - 1) * fraction;
    const lower = Math.floor(point);
    const upper = Math.ceil(point);
    return round(sorted[lower] + (sorted[upper] - sorted[lower]) * (point - lower), 2);
  };
  const rate = (part, total) => total > 0 ? round((part / total) * 100, 1) : 0;

  function containsProhibited(value) {
    if (!value || typeof value !== "object") return false;
    for (const [key, child] of Object.entries(value)) {
      if (PROHIBITED.has(key) || containsProhibited(child)) return true;
    }
    return false;
  }

  function validPublicRow(row) {
    row = object(row);
    return row.schema === PUBLIC_SCHEMA &&
      !containsProhibited(row) &&
      Object.keys(object(row.build)).length > 0 &&
      finite(object(row.run).distance) !== null &&
      finite(object(row.run).score) !== null &&
      typeof object(row.run).deathCause === "string" &&
      Object.keys(object(row.flags)).length > 0 &&
      Object.keys(object(row.attacks).core).length > 0 &&
      Object.keys(object(row.attacks).extended).length > 0;
  }

  function collectPublicRows(tree) {
    const rows = [];
    let candidates = 0;
    let invalid = 0;
    for (const [month, records] of Object.entries(object(tree))) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
      for (const row of Object.values(object(records))) {
        candidates++;
        if (!validPublicRow(row)) {
          invalid++;
          continue;
        }
        rows.push({ month, row });
      }
    }
    return { rows, candidates, invalid };
  }

  function blankMatrix() {
    return Object.fromEntries(PERFORMANCE.map(performance => [
      performance,
      Object.fromEntries(RANGES.map(range => [
        range,
        Object.fromEntries(KINDS.map(kind => [kind, 0]))
      ]))
    ]));
  }

  function aggregatePublic(tree) {
    const collected = collectPublicRows(tree);
    const rows = collected.rows;
    const distances = rows.map(({ row }) => nonnegative(row.run.distance));
    const fps = rows.map(({ row }) => finite(object(row.performance).averageFps))
      .filter(value => value !== null);
    const clean = sum(rows.map(({ row }) => object(row.flags).cleanEvents));
    const attempted = clean + sum(rows.map(({ row }) => object(row.flags).missEvents));
    const deaths = Object.fromEntries(DEATHS.map(cause => [cause, 0]));
    const threat = Object.fromEntries(["CONTROLLED", "HUNTING", "PREDATORY", "CRITICAL"].map(key => [key, 0]));
    const matrix = blankMatrix();
    const attacks = {
      telegraphs: 0,
      committedLunges: 0,
      lungeDodges: 0,
      lungeHits: 0,
      passiveCatches: 0,
      followUpLunges: 0,
      chargeCommits: 0,
      chargeHits: 0,
      chargeDodges: 0,
      boulderThrowReleases: 0,
      boulderThrowDodges: 0,
      boulderThrowPlayerDeaths: 0
    };
    const months = {};
    for (const { month, row } of rows) {
      months[month] = (months[month] || 0) + 1;
      if (DEATHS.includes(row.run.deathCause)) deaths[row.run.deathCause]++;
      const core = object(row.attacks.core);
      const extended = object(row.attacks.extended);
      attacks.telegraphs += integer(core.telegraphStarts ?? core.telegraphs);
      attacks.committedLunges += integer(core.committedLunges ?? core.lunges);
      attacks.lungeDodges += integer(core.lungeDodges ?? core.dodges);
      attacks.lungeHits += integer(core.lungeHits);
      attacks.passiveCatches += integer(core.passiveCatches);
      attacks.followUpLunges += integer(core.followUpLunges);
      attacks.chargeCommits += integer(extended.chargeCommits);
      attacks.chargeHits += integer(extended.chargeHits);
      attacks.chargeDodges += integer(extended.chargeDodges);
      attacks.boulderThrowReleases += integer(extended.boulderThrowReleases);
      attacks.boulderThrowDodges += integer(extended.boulderThrowDodges);
      attacks.boulderThrowPlayerDeaths += integer(extended.boulderThrowPlayerDeaths);
      const exposure = object(core.threatExposureSec);
      for (const key of Object.keys(threat)) threat[key] += nonnegative(exposure[key]);
      const sourceMatrix = object(extended.attackMix);
      for (const performance of PERFORMANCE)
        for (const range of RANGES)
          for (const kind of KINDS)
            matrix[performance][range][kind] += integer(
              object(object(sourceMatrix[performance])[range])[kind]
            );
    }
    const byPerformance = Object.fromEntries(PERFORMANCE.map(performance => [
      performance,
      RANGES.reduce((total, range) => total + KINDS.reduce(
        (subtotal, kind) => subtotal + matrix[performance][range][kind], 0
      ), 0)
    ]));
    const byRange = Object.fromEntries(RANGES.map(range => [
      range,
      PERFORMANCE.reduce((total, performance) => total + KINDS.reduce(
        (subtotal, kind) => subtotal + matrix[performance][range][kind], 0
      ), 0)
    ]));
    const byKind = Object.fromEntries(KINDS.map(kind => [
      kind,
      PERFORMANCE.reduce((total, performance) => total + RANGES.reduce(
        (subtotal, range) => subtotal + matrix[performance][range][kind], 0
      ), 0)
    ]));
    const threatTotal = sum(Object.values(threat));
    return Object.freeze({
      schema: "endless-powder-live-pursuit-v1",
      status: rows.length ? "ready" : "empty",
      candidates: collected.candidates,
      accepted: rows.length,
      invalid: collected.invalid,
      sourceMonths: Object.entries(months).sort(([a], [b]) => a.localeCompare(b))
        .map(([month, runs]) => ({ month, runs })),
      overview: { recordedRuns: rows.length, totalDistance: Math.round(sum(distances)) },
      distance: {
        mean: mean(distances),
        median: percentile(distances, 0.5),
        p90: percentile(distances, 0.9),
        max: distances.length ? Math.max(...distances) : null
      },
      flags: {
        clean: Math.round(clean),
        attempted: Math.round(attempted),
        accuracy: attempted > 0 ? rate(clean, attempted) : null
      },
      deaths: Object.fromEntries(DEATHS.map(cause => [cause, {
        count: deaths[cause],
        rate: rate(deaths[cause], rows.length)
      }])),
      performance: { averageFps: mean(fps), measuredRuns: fps.length },
      attacks: {
        ...attacks,
        lungeDodgeRate: attacks.lungeDodges + attacks.lungeHits > 0
          ? rate(attacks.lungeDodges, attacks.lungeDodges + attacks.lungeHits)
          : null,
        chargeDodgeRate: attacks.chargeDodges + attacks.chargeHits > 0
          ? rate(attacks.chargeDodges, attacks.chargeDodges + attacks.chargeHits)
          : null,
        matrix,
        byPerformance,
        byRange,
        byKind
      },
      threatExposure: Object.fromEntries(Object.entries(threat).map(([key, seconds]) => [key, {
        seconds: round(seconds, 2),
        rate: rate(seconds, threatTotal)
      }]))
    });
  }

  function validOpenSkiRun(run) {
    run = object(run);
    return run.rulesetVersion === "open-ski-v1" &&
      finite(run.score) !== null && finite(run.distance) !== null &&
      finite(run.cleanFlags) !== null && finite(run.attemptedFlags) !== null &&
      typeof run.deathCause === "string";
  }

  function stat(values) {
    const normalized = values.map(finite).filter(value => value !== null);
    return {
      count: normalized.length,
      mean: mean(normalized),
      median: percentile(normalized, 0.5),
      p75: percentile(normalized, 0.75),
      p90: percentile(normalized, 0.9),
      max: normalized.length ? Math.max(...normalized) : null
    };
  }

  function aggregateOpenSki(tree) {
    const candidates = Object.values(object(tree));
    const runs = candidates.filter(validOpenSkiRun);
    const submitters = new Set(runs.map(run => String(run.uid || "")).filter(Boolean));
    const clean = sum(runs.map(run => run.cleanFlags));
    const attempted = sum(runs.map(run => run.attemptedFlags));
    const deaths = Object.fromEntries(DEATHS.map(cause => {
      const count = runs.filter(run => run.deathCause === cause).length;
      return [cause, { count, rate: rate(count, runs.length) }];
    }));
    return Object.freeze({
      submittedRuns: runs.length,
      approximateSubmitters: submitters.size,
      score: stat(runs.map(run => run.score)),
      distance: stat(runs.map(run => run.distance)),
      flags: {
        clean: Math.round(clean),
        attempted: Math.round(attempted),
        accuracy: attempted > 0 ? rate(clean, attempted) : null,
        bestCombo: stat(runs.map(run => run.bestCombo))
      },
      deaths,
      coverage: {
        candidates: candidates.length,
        accepted: runs.length,
        invalid: candidates.length - runs.length
      }
    });
  }

  async function requestJson(url, fetchImpl) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 6500) : 0;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller ? controller.signal : undefined
      });
      if (!response.ok) throw new Error(`Firebase read returned ${response.status}.`);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function fromTrees(publicTree, openSkiTree) {
    return Object.freeze({
      schema: "endless-powder-live-analytics-v1",
      checkedAt: Date.now(),
      pursuit: { ok: true, data: aggregatePublic(publicTree), error: "" },
      openSki: { ok: true, data: aggregateOpenSki(openSkiTree), error: "" },
      requests: 0
    });
  }

  async function load(fetchImpl = fetch) {
    const urls = {
      pursuit: `${DATABASE}${PATHS.pursuit}`,
      openSki: `${DATABASE}${PATHS.openSki}`
    };
    const settled = await Promise.allSettled([
      requestJson(urls.pursuit, fetchImpl),
      requestJson(urls.openSki, fetchImpl)
    ]);
    return Object.freeze({
      schema: "endless-powder-live-analytics-v1",
      checkedAt: Date.now(),
      pursuit: settled[0].status === "fulfilled"
        ? { ok: true, data: aggregatePublic(settled[0].value), error: "" }
        : { ok: false, data: aggregatePublic(null), error: String(settled[0].reason?.message || settled[0].reason) },
      openSki: settled[1].status === "fulfilled"
        ? { ok: true, data: aggregateOpenSki(settled[1].value), error: "" }
        : { ok: false, data: aggregateOpenSki(null), error: String(settled[1].reason?.message || settled[1].reason) },
      requests: 2
    });
  }

  window.AnalyticsLiveData = Object.freeze({
    database: DATABASE,
    paths: PATHS,
    publicSchema: PUBLIC_SCHEMA,
    aggregatePublic,
    aggregateOpenSki,
    fromTrees,
    load
  });
})();
