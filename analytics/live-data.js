(() => {
  "use strict";

  const DATABASE = "https://endless-powder-default-rtdb.firebaseio.com";
  const PATHS = Object.freeze({
    pursuit: "/endless_powder/public_analytics_runs.json",
    openSkiAnalytics: "/endless_powder/public_open_ski_analytics_runs.json",
    openSkiLeaderboard: "/endless_powder/modes/open_ski/leaderboard_runs.json"
  });
  const PUBLIC_SCHEMA = "public-analytics-run-v1";
  const OPEN_SKI_PUBLIC_SCHEMA = "public-open-ski-run-v1";
  const PROHIBITED = new Set([
    "uid", "initials", "timestamp", "reportId", "runId", "traceRunId",
    "session", "client", "inputType", "deviceClass", "browserFamily", "trace",
    "samples", "events", "errors", "comments", "feedback", "courseSeed",
    "deathX", "deathDepth", "deathTheta"
  ]);
  const PERFORMANCE = Object.freeze(["STRUGGLING", "STABLE", "FAST", "HOT"]);
  const RANGES = Object.freeze(["SHORT", "MID", "LONG"]);
  const KINDS = Object.freeze(["lunges", "charges", "boulders"]);
  const DEATHS = Object.freeze(["caught", "tree", "boulder", "edge"]);
  const OPEN_SKI_DEATHS = Object.freeze(["tree", "boulder", "edge"]);
  const DEPTH_BANDS = Object.freeze([
    "D0_249", "D250_499", "D500_999", "D1000_1999", "D2000_3999", "D4000_PLUS"
  ]);
  const LANE_BANDS = Object.freeze(["FAR_LEFT", "LEFT", "CENTER", "RIGHT", "FAR_RIGHT"]);
  const RECENT_MONTH_COUNT = 2;

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

  function exactKeys(value, keys) {
    const source = object(value);
    const actual = Object.keys(source).sort();
    const expected = keys.slice().sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  }

  function nonnegativeInteger(value) {
    return finite(value) !== null && Number.isInteger(Number(value)) && Number(value) >= 0;
  }

  function blankZoneMatrix() {
    return Object.fromEntries(DEPTH_BANDS.map(depth => [
      depth,
      Object.fromEntries(LANE_BANDS.map(lane => [lane, 0]))
    ]));
  }

  function validHistogram(histogram) {
    return exactKeys(histogram, DEPTH_BANDS) &&
      DEPTH_BANDS.every(key => nonnegativeInteger(object(histogram)[key]));
  }

  function validZoneMatrix(matrix) {
    return exactKeys(matrix, DEPTH_BANDS) && DEPTH_BANDS.every(depth =>
      exactKeys(object(matrix)[depth], LANE_BANDS) &&
      LANE_BANDS.every(lane => nonnegativeInteger(object(object(matrix)[depth])[lane]))
    );
  }

  function histogramTotal(histogram) {
    return sum(DEPTH_BANDS.map(key => object(histogram)[key]));
  }

  function matrixTotal(matrix) {
    return sum(DEPTH_BANDS.flatMap(depth =>
      LANE_BANDS.map(lane => object(object(matrix)[depth])[lane])
    ));
  }

  function validOpenSkiAnalyticsRow(value) {
    const row = object(value);
    const build = object(row.build);
    const course = object(row.course);
    const run = object(row.run);
    const steering = object(row.steering);
    const flags = object(row.flags);
    const spatial = object(row.spatial);
    const death = object(spatial.death);
    const performance = object(row.performance);
    const clean = finite(flags.clean);
    const attempted = finite(flags.attempted);
    const bestCombo = finite(flags.bestCombo);
    const collisions = finite(run.collisions);
    return row.schema === OPEN_SKI_PUBLIC_SCHEMA &&
      !containsProhibited(row) &&
      exactKeys(row, ["schema", "build", "course", "run", "steering", "flags", "spatial", "performance"]) &&
      exactKeys(build, ["version", "worldVersion", "analyticsVersion"]) &&
      Object.values(build).every(value => typeof value === "string" && value.length > 0) &&
      exactKeys(course, ["version", "seedId"]) && typeof course.version === "string" &&
      nonnegativeInteger(course.seedId) &&
      exactKeys(run, ["distance", "score", "durationSec", "averageSpeed", "maximumSpeed", "collisions", "deathCause"]) &&
      [run.distance, run.score, run.durationSec, run.averageSpeed, run.maximumSpeed].every(value => finite(value) !== null && Number(value) >= 0) &&
      nonnegativeInteger(collisions) && OPEN_SKI_DEATHS.includes(run.deathCause) &&
      exactKeys(steering, ["averageAbsoluteSteer", "hardCarveSec", "directionReversals"]) &&
      finite(steering.averageAbsoluteSteer) !== null && Number(steering.averageAbsoluteSteer) >= 0 && Number(steering.averageAbsoluteSteer) <= 1 &&
      finite(steering.hardCarveSec) !== null && Number(steering.hardCarveSec) >= 0 &&
      nonnegativeInteger(steering.directionReversals) &&
      exactKeys(flags, ["clean", "attempted", "bestCombo", "cleanByDepthBand", "missByDepthBand"]) &&
      nonnegativeInteger(clean) && nonnegativeInteger(attempted) && nonnegativeInteger(bestCombo) &&
      clean <= attempted && bestCombo <= clean &&
      validHistogram(flags.cleanByDepthBand) && validHistogram(flags.missByDepthBand) &&
      histogramTotal(flags.cleanByDepthBand) === clean &&
      histogramTotal(flags.missByDepthBand) === attempted - clean &&
      exactKeys(spatial, ["death", "collisionsByZone"]) &&
      exactKeys(death, ["depthBand", "laneBand"]) &&
      DEPTH_BANDS.includes(death.depthBand) && LANE_BANDS.includes(death.laneBand) &&
      validZoneMatrix(spatial.collisionsByZone) && matrixTotal(spatial.collisionsByZone) === collisions &&
      exactKeys(performance, ["averageFps", "minimumFps", "lowFpsFrames"]) &&
      finite(performance.averageFps) !== null && Number(performance.averageFps) >= 0 &&
      finite(performance.minimumFps) !== null && Number(performance.minimumFps) >= 0 &&
      nonnegativeInteger(performance.lowFpsFrames);
  }

  function collectOpenSkiAnalyticsRows(tree) {
    const rows = [];
    let candidates = 0;
    let invalid = 0;
    for (const [month, records] of Object.entries(object(tree))) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) continue;
      for (const row of Object.values(object(records))) {
        candidates++;
        if (!validOpenSkiAnalyticsRow(row)) {
          invalid++;
          continue;
        }
        rows.push({ month, row });
      }
    }
    return { rows, candidates, invalid };
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

  function aggregateOpenSkiAnalytics(tree) {
    const collected = collectOpenSkiAnalyticsRows(tree);
    const rows = collected.rows;
    const distances = rows.map(({ row }) => nonnegative(row.run.distance));
    const scores = rows.map(({ row }) => nonnegative(row.run.score));
    const durations = rows.map(({ row }) => nonnegative(row.run.durationSec));
    const averageSpeeds = rows.map(({ row }) => nonnegative(row.run.averageSpeed));
    const maximumSpeeds = rows.map(({ row }) => nonnegative(row.run.maximumSpeed));
    const clean = sum(rows.map(({ row }) => row.flags.clean));
    const attempted = sum(rows.map(({ row }) => row.flags.attempted));
    const collisions = sum(rows.map(({ row }) => row.run.collisions));
    const deaths = Object.fromEntries(OPEN_SKI_DEATHS.map(cause => [cause, 0]));
    const deathZones = blankZoneMatrix();
    const collisionZones = blankZoneMatrix();
    const cleanByDepth = Object.fromEntries(DEPTH_BANDS.map(depth => [depth, 0]));
    const missByDepth = Object.fromEntries(DEPTH_BANDS.map(depth => [depth, 0]));
    const months = {};
    for (const { month, row } of rows) {
      months[month] = (months[month] || 0) + 1;
      deaths[row.run.deathCause]++;
      deathZones[row.spatial.death.depthBand][row.spatial.death.laneBand]++;
      for (const depth of DEPTH_BANDS) {
        cleanByDepth[depth] += integer(row.flags.cleanByDepthBand[depth]);
        missByDepth[depth] += integer(row.flags.missByDepthBand[depth]);
        for (const lane of LANE_BANDS)
          collisionZones[depth][lane] += integer(row.spatial.collisionsByZone[depth][lane]);
      }
    }
    const fps = rows.map(({ row }) => finite(row.performance.averageFps)).filter(value => value !== null);
    const minimumFps = rows.map(({ row }) => finite(row.performance.minimumFps)).filter(value => value !== null);
    const steering = rows.map(({ row }) => row.steering);
    return Object.freeze({
      schema: "endless-powder-live-open-ski-v1",
      status: rows.length ? "ready" : "empty",
      candidates: collected.candidates,
      accepted: rows.length,
      invalid: collected.invalid,
      sourceMonths: Object.entries(months).sort(([a], [b]) => a.localeCompare(b))
        .map(([month, runs]) => ({ month, runs })),
      overview: {
        recordedRuns: rows.length,
        totalDistance: Math.round(sum(distances)),
        totalDurationSec: round(sum(durations), 2),
        totalCollisions: Math.round(collisions),
        collisionsPerRun: rows.length ? round(collisions / rows.length, 2) : null
      },
      distance: stat(distances),
      score: stat(scores),
      speed: {
        average: mean(averageSpeeds),
        medianMaximum: percentile(maximumSpeeds, 0.5),
        peak: maximumSpeeds.length ? Math.max(...maximumSpeeds) : null
      },
      flags: {
        clean: Math.round(clean),
        attempted: Math.round(attempted),
        accuracy: attempted > 0 ? rate(clean, attempted) : null,
        bestCombo: stat(rows.map(({ row }) => row.flags.bestCombo)),
        byDepth: Object.fromEntries(DEPTH_BANDS.map(depth => {
          const depthClean = cleanByDepth[depth];
          const depthMiss = missByDepth[depth];
          const depthAttempted = depthClean + depthMiss;
          return [depth, {
            clean: depthClean,
            miss: depthMiss,
            attempted: depthAttempted,
            accuracy: depthAttempted ? rate(depthClean, depthAttempted) : null
          }];
        }))
      },
      steering: {
        averageAbsoluteSteer: mean(steering.map(value => value.averageAbsoluteSteer)),
        hardCarveSec: round(sum(steering.map(value => value.hardCarveSec)), 2),
        directionReversals: Math.round(sum(steering.map(value => value.directionReversals))),
        reversalsPerRun: rows.length ? round(sum(steering.map(value => value.directionReversals)) / rows.length, 2) : null
      },
      deaths: Object.fromEntries(OPEN_SKI_DEATHS.map(cause => [cause, {
        count: deaths[cause],
        rate: rate(deaths[cause], rows.length)
      }])),
      spatial: { deathZones, collisionZones },
      performance: {
        averageFps: mean(fps),
        minimumFps: percentile(minimumFps, 0.5),
        measuredRuns: fps.length,
        lowFpsFrames: Math.round(sum(rows.map(({ row }) => row.performance.lowFpsFrames)))
      }
    });
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

  function monthKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function recentMonthKeys(now = Date.now()) {
    const parsed = new Date(now);
    const date = Number.isFinite(parsed.getTime()) ? parsed : new Date();
    return Object.freeze(Array.from({ length: RECENT_MONTH_COUNT }, (_, index) =>
      monthKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - index, 1)))
    ).sort());
  }

  function filterMonthlyTree(tree, months) {
    const source = object(tree);
    const allowed = new Set(Array.isArray(months) ? months : []);
    return Object.fromEntries(Object.entries(source).filter(([month]) => allowed.has(month)));
  }

  function scopedMonthlyFeed(tree, aggregate, now, ok = true, error = "") {
    const source = ok ? tree : null;
    const recentMonths = recentMonthKeys(now);
    const all = aggregate(source);
    const recent = aggregate(filterMonthlyTree(source, recentMonths));
    return Object.freeze({
      ok,
      data: all,
      scopes: Object.freeze({ recent, all }),
      error
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

  function fromTrees(publicTree, openSkiAnalyticsTree, openSkiLeaderboardTree, now = Date.now()) {
    return Object.freeze({
      schema: "endless-powder-live-analytics-v3",
      checkedAt: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
      timeWindows: Object.freeze({ recentMonths: recentMonthKeys(now) }),
      pursuit: scopedMonthlyFeed(publicTree, aggregatePublic, now),
      openSkiAnalytics: scopedMonthlyFeed(openSkiAnalyticsTree, aggregateOpenSkiAnalytics, now),
      openSkiLeaderboard: { ok: true, data: aggregateOpenSki(openSkiLeaderboardTree), error: "" },
      requests: 0
    });
  }

  async function load(fetchImpl = fetch, now = Date.now()) {
    const urls = {
      pursuit: `${DATABASE}${PATHS.pursuit}`,
      openSkiAnalytics: `${DATABASE}${PATHS.openSkiAnalytics}`,
      openSkiLeaderboard: `${DATABASE}${PATHS.openSkiLeaderboard}`
    };
    const settled = await Promise.allSettled([
      requestJson(urls.pursuit, fetchImpl),
      requestJson(urls.openSkiAnalytics, fetchImpl),
      requestJson(urls.openSkiLeaderboard, fetchImpl)
    ]);
    return Object.freeze({
      schema: "endless-powder-live-analytics-v3",
      checkedAt: Number.isFinite(Number(now)) ? Number(now) : Date.now(),
      timeWindows: Object.freeze({ recentMonths: recentMonthKeys(now) }),
      pursuit: settled[0].status === "fulfilled"
        ? scopedMonthlyFeed(settled[0].value, aggregatePublic, now)
        : scopedMonthlyFeed(null, aggregatePublic, now, false, String(settled[0].reason?.message || settled[0].reason)),
      openSkiAnalytics: settled[1].status === "fulfilled"
        ? scopedMonthlyFeed(settled[1].value, aggregateOpenSkiAnalytics, now)
        : scopedMonthlyFeed(null, aggregateOpenSkiAnalytics, now, false, String(settled[1].reason?.message || settled[1].reason)),
      openSkiLeaderboard: settled[2].status === "fulfilled"
        ? { ok: true, data: aggregateOpenSki(settled[2].value), error: "" }
        : { ok: false, data: aggregateOpenSki(null), error: String(settled[2].reason?.message || settled[2].reason) },
      requests: 3
    });
  }

  window.AnalyticsLiveData = Object.freeze({
    database: DATABASE,
    paths: PATHS,
    publicSchema: PUBLIC_SCHEMA,
    openSkiPublicSchema: OPEN_SKI_PUBLIC_SCHEMA,
    depthBands: DEPTH_BANDS,
    laneBands: LANE_BANDS,
    recentMonthCount: RECENT_MONTH_COUNT,
    recentMonthKeys,
    filterMonthlyTree,
    aggregatePublic,
    aggregateOpenSkiAnalytics,
    aggregateOpenSki,
    fromTrees,
    load
  });
})();
