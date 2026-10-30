// Interactive demos: FWI calculator, a synthetic fire season, and data
// quality checks on a synthetic fire weather station feed.

const $ = (sel) => document.querySelector(sel);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(d));

// Seeded PRNG so a season can be reproduced from its seed.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ---------- Small canvas chart ----------

function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// series: [{ values: [number|null], color, width }]; marks: [{ i, v }]
function drawChart(canvas, { series, yMax, yMin = 0, bands = [], marks = [], xLabels = [], yLabel = '', hover = null }) {
  const { ctx, w, h } = setupCanvas(canvas);
  const pad = { l: 40, r: 10, t: 12, b: 26 };
  const pw = w - pad.l - pad.r;
  const ph = h - pad.t - pad.b;
  const n = series[0].values.length;
  const x = (i) => pad.l + (i / (n - 1)) * pw;
  const y = (v) => pad.t + ph - ((v - yMin) / (yMax - yMin)) * ph;

  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px system-ui, sans-serif';

  for (const b of bands) {
    const top = y(Math.min(b.to, yMax));
    const bottom = y(Math.max(b.from, yMin));
    if (bottom <= pad.t) continue;
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.13;
    ctx.fillRect(pad.l, top, pw, bottom - top);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = css('--grid');
  ctx.fillStyle = css('--muted');
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) {
    const v = yMin + ((yMax - yMin) * k) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(w - pad.r, y(v)); ctx.stroke();
    ctx.fillText(Math.round(v), pad.l - 6, y(v));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const { i, label } of xLabels) ctx.fillText(label, x(i), h - pad.b + 7);
  if (yLabel) {
    ctx.save(); ctx.translate(10, pad.t + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle'; ctx.fillText(yLabel, 0, 0); ctx.restore();
  }

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      const py = y(clamp(v, yMin, yMax));
      if (pen) ctx.lineTo(x(i), py); else ctx.moveTo(x(i), py);
      pen = true;
    });
    ctx.stroke();
  }

  for (const m of marks) {
    ctx.beginPath();
    ctx.arc(x(m.i), y(clamp(m.v, yMin, yMax)), 4.5, 0, 2 * Math.PI);
    ctx.fillStyle = css('--surface');
    ctx.fill();
    ctx.strokeStyle = css('--flag');
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (hover != null) {
    ctx.strokeStyle = css('--muted');
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x(hover), pad.t); ctx.lineTo(x(hover), pad.t + ph); ctx.stroke();
    ctx.setLineDash([]);
  }

  return { indexAt: (px) => clamp(Math.round(((px - pad.l) / pw) * (n - 1)), 0, n - 1) };
}

// ---------- Demo 1: single-day FWI calculator ----------

function initCalculator() {
  const form = $('#fwi-form');
  const out = $('#fwi-out');
  const run = () => {
    const v = (id) => parseFloat(form.elements[id].value);
    const prev = { ffmc: v('pffmc'), dmc: v('pdmc'), dc: v('pdc') };
    const obs = { temp: v('temp'), rh: clamp(v('rh'), 0, 100), wind: Math.max(v('wind'), 0), rain: Math.max(v('rain'), 0), month: v('month') };
    if (Object.values({ ...prev, ...obs }).some(Number.isNaN)) return;
    const r = FWI.day(prev, obs);
    const cls = FWI.dangerClass(r.fwi);
    out.innerHTML = ['ffmc', 'dmc', 'dc', 'isi', 'bui', 'fwi']
      .map((k) => `<div class="code${k === 'fwi' ? ' code-main' : ''}"><span>${k.toUpperCase()}</span><b>${fmt(r[k])}</b></div>`)
      .join('') + `<div class="class-pill" style="--pill:${cls.color}">${cls.name}</div>`;
  };
  form.addEventListener('input', run);
  run();
}

// ---------- Demo 2: a synthetic fire season ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function makeSeason(seed, dryness) {
  const rand = mulberry32(seed);
  const start = new Date(2026, 3, 1); // April 1
  const days = [];
  let prev = { ...FWI.STARTUP };
  for (let i = 0; i < 183; i++) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const seasonal = Math.sin((Math.PI * (i + 12)) / 200);
    const wet = rand() < 0.34 * (1 - 0.65 * dryness);
    const rain = wet ? -Math.log(rand() || 1e-9) * 7 * (1 - 0.4 * dryness) : 0;
    const temp = 7 + 18 * seasonal + 3.5 * gauss(rand) + 3 * dryness;
    const rh = clamp(72 - 1.3 * (temp - 10) + 10 * gauss(rand) + (wet ? 18 : 0) - 10 * dryness, 15, 100);
    const wind = clamp(12 + 7 * gauss(rand), 0, 45);
    const obs = { temp, rh, wind, rain, month: date.getMonth() + 1 };
    prev = FWI.day(prev, obs);
    days.push({ date, ...obs, ...prev });
  }
  return days;
}

function initSeason() {
  const canvas = $('#season-chart');
  const tip = $('#season-tip');
  const summary = $('#season-summary');
  const dry = $('#season-dry');
  let seed = 2026;
  let days = [];
  let hover = null;
  let chart;

  const bands = () => {
    let from = 0;
    return FWI.CLASSES.map((c) => {
      const b = { from, to: c.max === Infinity ? 999 : c.max, color: css(c.color.slice(4, -1)) };
      from = c.max; return b;
    });
  };

  const render = () => {
    const xLabels = [];
    days.forEach((d, i) => { if (d.date.getDate() === 1) xLabels.push({ i, label: MONTHS[d.date.getMonth()] }); });
    const yMax = Math.max(40, Math.ceil(Math.max(...days.map((d) => d.fwi)) / 10) * 10);
    chart = drawChart(canvas, {
      series: [{ values: days.map((d) => d.fwi), color: css('--accent'), width: 2 }],
      yMax, bands: bands(), xLabels, yLabel: 'FWI', hover,
    });
  };

  const regenerate = () => {
    days = makeSeason(seed, parseFloat(dry.value));
    const counts = FWI.CLASSES.map((c) => ({ c, n: days.filter((d) => FWI.dangerClass(d.fwi) === c).length }));
    const peak = days.reduce((a, b) => (b.fwi > a.fwi ? b : a));
    summary.innerHTML = `<p>Peak FWI <b>${fmt(peak.fwi)}</b> on ${peak.date.toLocaleDateString('en-CA', { month: 'long', day: 'numeric' })} · season-end DC <b>${fmt(days.at(-1).dc, 0)}</b></p>`
      + '<ul class="class-counts">' + counts.map(({ c, n }) => `<li><i style="background:${c.color}"></i>${c.name}<b>${n}</b></li>`).join('') + '</ul>';
    render();
  };

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    hover = chart.indexAt(e.clientX - rect.left);
    const d = days[hover];
    tip.hidden = false;
    tip.innerHTML = `<b>${d.date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</b> · ${fmt(d.temp)}°C, ${fmt(d.rh, 0)}% RH, ${fmt(d.wind, 0)} km/h, ${fmt(d.rain)} mm<br>`
      + `FFMC ${fmt(d.ffmc)} · DMC ${fmt(d.dmc)} · DC ${fmt(d.dc, 0)} · ISI ${fmt(d.isi)} · BUI ${fmt(d.bui)} · <b>FWI ${fmt(d.fwi)}</b>`;
    render();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; render(); });
  dry.addEventListener('input', regenerate);
  $('#season-new').addEventListener('click', () => { seed = Math.floor(Math.random() * 1e9); regenerate(); });
  window.addEventListener('resize', render);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  regenerate();
}

// ---------- Demo 3: data quality checks on a fire weather station feed ----------

function makeStationFeed(seed) {
  const rand = mulberry32(seed);
  const hours = 21 * 24;
  const pick = (lo, hi) => lo + Math.floor(rand() * (hi - lo));
  // Faults are placed at random so each feed is different.
  const stuckAt = pick(5, 8) * 24 + 6;
  const spikeAt = pick(10, 13) * 24 + 14;
  const gapAt = pick(14, 16) * 24 + 3;
  const badRhAt = pick(1, 4) * 24 + 15;
  const driftFrom = 17 * 24;
  const temp = [];
  const rh = [];
  let noiseT = 0;
  for (let h = 0; h < hours; h++) {
    const hourOfDay = h % 24;
    const diurnal = Math.sin((2 * Math.PI * (hourOfDay - 9)) / 24);
    noiseT = 0.8 * noiseT + 0.6 * gauss(rand);
    let t = 17 + 7 * diurnal + noiseT;
    let r = clamp(62 - 18 * diurnal + 4 * gauss(rand), 18, 99);
    if (h >= driftFrom) t += 0.1 * (h - driftFrom);
    if (h === spikeAt) t += 26;
    if (h >= stuckAt && h < stuckAt + 30) r = 64.0;
    if (h === badRhAt) r = 107;
    if (h >= gapAt && h < gapAt + 9) { t = null; r = null; }
    temp.push(t == null ? null : Math.round(t * 10) / 10);
    rh.push(r == null ? null : Math.round(r * 10) / 10);
  }
  return { temp, rh, hours };
}

function runChecks({ temp, rh, hours }) {
  const flags = { temp: new Set(), rh: new Set() };
  const results = [];
  const add = (rule, field, desc, failed) => {
    failed.forEach((i) => flags[field].add(i));
    results.push({ rule, field, desc, failed: failed.length });
  };
  const idx = (arr, fn) => arr.flatMap((v, i) => (fn(v, i) ? [i] : []));

  // Completeness: every hour should report.
  add('Completeness', 'temp', 'Hourly observation present', idx(temp, (v) => v == null));

  // Validity: physically plausible ranges.
  add('Validity', 'temp', 'Temperature between −45 and 45 °C', idx(temp, (v) => v != null && (v < -45 || v > 45)));
  add('Validity', 'rh', 'Relative humidity between 0 and 100 %', idx(rh, (v) => v != null && (v < 0 || v > 100)));

  // Stuck sensor: identical reading for 6 or more consecutive hours.
  const stuck = (arr) => {
    const out = [];
    let run = [0];
    for (let i = 1; i <= arr.length; i++) {
      if (i < arr.length && arr[i] != null && arr[i] === arr[i - 1]) { run.push(i); continue; }
      if (run.length >= 6) out.push(...run);
      run = [i];
    }
    return out;
  };
  add('Consistency', 'rh', 'No flat-lined readings (6+ hours unchanged)', stuck(rh));

  // Spike: departure from the median of the surrounding 6 hours.
  add('Consistency', 'temp', 'No spikes > 8 °C from neighbouring hours', idx(temp, (v, i) => {
    if (v == null) return false;
    const near = [-3, -2, -1, 1, 2, 3].map((k) => temp[i + k]).filter((x) => x != null).sort((a, b) => a - b);
    return near.length >= 4 && Math.abs(v - near[Math.floor(near.length / 2)]) > 8;
  }));

  // Drift: daily mean z-score against the previous 7 days.
  const dailyMean = [];
  for (let d = 0; d < hours / 24; d++) {
    const vals = temp.slice(d * 24, d * 24 + 24).filter((v) => v != null);
    vals.sort((a, b) => a - b);
    // A day with a gap would give a biased median, so it is left out of the baseline.
    dailyMean.push(vals.length >= 20 ? vals[Math.floor(vals.length / 2)] : null);
  }
  const driftDays = [];
  dailyMean.forEach((m, d) => {
    const base = dailyMean.slice(Math.max(0, d - 7), d).filter((v) => v != null);
    if (base.length < 5 || m == null) return;
    const mu = base.reduce((a, b) => a + b, 0) / base.length;
    // A floor on σ stops a run of unusually steady days from flagging normal weather.
    const sd = Math.max(Math.sqrt(base.reduce((a, b) => a + (b - mu) ** 2, 0) / (base.length - 1)), 1);
    if (Math.abs((m - mu) / sd) >= 3) driftDays.push(d);
  });
  // Counted per day rather than per hour, and charted on the daily median.
  results.push({ rule: 'Drift', field: 'temp', desc: 'Daily median within 3σ of prior 7-day baseline', failed: driftDays.length, unit: 'days' });

  return { results, flags, driftDays, dailyMean };
}

function initQuality() {
  const tbody = $('#qc-table tbody');
  const tChart = $('#qc-temp');
  const rChart = $('#qc-rh');
  const score = $('#qc-score');
  let feed;
  let checked;

  const render = () => {
    const xLabels = [];
    for (let d = 0; d < feed.hours / 24; d += 3) xLabels.push({ i: d * 24, label: `Day ${d + 1}` });
    const mark = (field, arr) => [...checked.flags[field]].filter((i) => arr[i] != null).map((i) => ({ i, v: arr[i] }));
    const tMarks = mark('temp', feed.temp);
    // Mark drift on the day's median, which is what the rule tested.
    checked.driftDays.forEach((d) => tMarks.push({ i: d * 24 + 12, v: checked.dailyMean[d] }));
    drawChart(tChart, {
      series: [{ values: feed.temp, color: css('--accent'), width: 1.5 }],
      yMin: 0, yMax: 50, xLabels, yLabel: '°C', marks: tMarks.filter((m) => m.v != null),
    });
    drawChart(rChart, {
      series: [{ values: feed.rh, color: css('--accent-2'), width: 1.5 }],
      yMin: 0, yMax: 110, xLabels, yLabel: '% RH', marks: mark('rh', feed.rh),
    });
  };

  const regenerate = (seed) => {
    feed = makeStationFeed(seed);
    checked = runChecks(feed);
    const n = feed.hours;
    tbody.innerHTML = checked.results.map((r) => `<tr>
      <td>${r.rule}</td><td>${r.desc}</td>
      <td class="num">${r.failed} ${r.unit || 'hrs'}</td>
      <td><span class="status ${r.failed ? 'fail' : 'pass'}">${r.failed ? 'Flagged' : 'Pass'}</span></td></tr>`).join('');
    const bad = new Set([...checked.flags.temp, ...checked.flags.rh]).size;
    score.innerHTML = `<b>${fmt(100 * (1 - bad / n))}%</b> of ${n} hourly records passed the record-level checks`
      + (checked.driftDays.length ? ` · drift detected on day ${checked.driftDays.map((d) => d + 1).join(', ')}` : '');
    render();
  };

  $('#qc-new').addEventListener('click', () => regenerate(Math.floor(Math.random() * 1e9)));
  window.addEventListener('resize', render);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  regenerate(41);
}

initCalculator();
initSeason();
initQuality();
