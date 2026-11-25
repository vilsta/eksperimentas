// Rezultatų analizė: kiekvienam dalyviui apskaičiuojami rodikliai (teisingi atsakymai, laikas, vertinimai),
// A ir B grupės lyginamos t-testu, dalyvių savybės – t-testu / ANOVA, poveikio sąlygos – regresija.
import { db, parseJSON } from './db.js';
import { getSettings, sessionProfile, optionLabel } from './settings.js';
import { chiSquare, fisherExact, welchTTest, anova, ols, nestedF, mean } from './stats.js';

const ALPHA = 0.05;
const GROUPS = ['A', 'B'];
const LEVELS = ['Lengvas', 'Vidutinis', 'Sunkus'];
const LEVEL_TITLES = { Lengvas: 'Lengvi klausimai', Vidutinis: 'Vidutiniai klausimai', Sunkus: 'Sunkūs klausimai' };
const MAIN_HYPOTHESIS = { E1: 'H1', E2: 'H2–H3', E3: 'H4', E4: 'H5' };
// Senosios versijos eksperimentų kodai turi priesagą (E1-v1), todėl hipotezė parenkama pagal pradžią.
const mainHypothesis = code => MAIN_HYPOTHESIS[String(code || '').split('-')[0]] || 'H1–H5';
const isArchived = code => /-v\d+$/.test(String(code || ''));
const statusOf = p => (p == null ? 'insufficient' : p < ALPHA ? 'significant' : 'ns');
const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('lt-LT', { minimumFractionDigits: d, maximumFractionDigits: d }));

// ---------------------------------------------------------------- Dalyvių savybės
const roleQuestion = (settings, role) => settings.profileQuestions.find(q => q.role === role) || null;

function characteristics(settings) {
  const fromRole = (role, key, title, hyp) => {
    const q = roleQuestion(settings, role);
    if (!q) return null;
    if (role === 'experience' && q.type === 'scale') {
      const levels = ['Maža (1–2)', 'Vidutinė (3)', 'Didelė (4–5)'];
      return { key, title, hyp, levels, value: s => { const n = Number(sessionProfile(s)[q.key]); return n >= 1 && n <= 2 ? levels[0] : n === 3 ? levels[1] : n >= 4 && n <= 5 ? levels[2] : null; } };
    }
    return { key, title, hyp, levels: q.options.map(o => optionLabel(q, o.value)), value: s => { const v = sessionProfile(s)[q.key]; return v ? optionLabel(q, v) : null; } };
  };
  return [
    fromRole('gender', 'gender', 'Lytis', 'H9'),
    fromRole('age', 'age', 'Amžius', 'H8'),
    fromRole('field', 'field', 'Išsilavinimo / darbo sritis', 'H10'),
    fromRole('experience', 'experience', 'Patirtis', 'H6'),
    { key: 'device', title: 'Įrenginys', hyp: 'H7', levels: ['Kompiuteris', 'Mobilusis'], value: s => s.device_type || null }
  ].filter(Boolean);
}

// ---------------------------------------------------------------- Rodikliai
// Laikas testuose logaritmuojamas (ilgi atsakymai turi mažesnę įtaką), bet rodomas sekundėmis.
function metricsFor(settings) {
  return [
    { key: 'correct', label: 'Teisingi atsakymai', kind: 'correct', value: p => p.correct, test: p => p.correct },
    { key: 'time', label: 'Atlikimo laikas', kind: 'time', value: p => p.time, test: p => p.logTime },
    ...settings.ratingQuestions.map(q => ({ key: 'rating_' + q.key, label: q.label, kind: 'rating', value: p => p.ratings[q.key], test: p => p.ratings[q.key] }))
  ];
}

function differenceText(metric, d) {
  if (d == null || !Number.isFinite(d)) return '';
  const a = fmt(Math.abs(d));
  if (Math.abs(d) < 0.05) return 'Vidurkiai praktiškai nesiskiria';
  if (metric.kind === 'correct') return `A grupė vidutiniškai teisingai atsakė į ${a} klausimo ${d > 0 ? 'daugiau' : 'mažiau'}`;
  if (metric.kind === 'time') return `A grupė vidutiniškai ${a} s ${d < 0 ? 'greičiau' : 'lėčiau'}`;
  return `${metric.label} A grupėje vidutiniškai ${a} balo ${d > 0 ? 'aukštesnis' : 'žemesnis'}`;
}

function compareGroups(metric, participants) {
  const [a, b] = GROUPS.map(g => participants.filter(p => p.group === g));
  const shown = list => list.map(metric.value).filter(v => v != null);
  const tested = list => list.map(metric.test).filter(v => v != null);
  const mA = mean(shown(a)), mB = mean(shown(b));
  const res = welchTTest(tested(a), tested(b));
  const diff = mA != null && mB != null ? mA - mB : null;
  return {
    key: metric.key, label: metric.label, kind: metric.kind,
    A: { mean: mA, n: shown(a).length }, B: { mean: mB, n: shown(b).length },
    diff, p: res?.p ?? null, status: statusOf(res?.p ?? null), text: res ? differenceText(metric, diff) : ''
  };
}

// ---------------------------------------------------------------- Duomenys
function experimentQuestions(experimentId) {
  const rows = db.prepare(`SELECT q.id,q.text,q.level,q.variant FROM experiment_questions eq JOIN questions q ON q.id=eq.question_id
    WHERE eq.experiment_id=? ORDER BY eq.position`).all(experimentId);
  const bases = [], byId = new Map();
  for (const r of rows) {
    const base = r.variant ? r.id.replace(/-?[AB]$/, '') : r.id;
    let item = bases.find(b => b.base === base);
    if (!item) { item = { base, nr: bases.length + 1, text: r.text, level: r.level || '' }; bases.push(item); }
    byId.set(r.id, item);
  }
  // Jei sunkumas nenurodytas: 1–3 lengvi, 4–7 vidutiniai, 8–10 sunkūs.
  bases.forEach(b => { if (!LEVELS.includes(b.level)) b.level = b.nr <= 3 ? 'Lengvas' : b.nr <= 7 ? 'Vidutinis' : 'Sunkus'; });
  return { bases, byId };
}

// Vertinimai: nauji – iš eksperimento pabaigos (ratings_json); seni – dalyvio užduočių vertinimų vidurkis.
function sessionRatings(s, answers) {
  const stored = parseJSON(s.ratings_json, null);
  if (stored && typeof stored === 'object' && Object.keys(stored).length) return stored;
  const legacy = {};
  for (const key of ['clarity', 'appeal', 'difficulty']) {
    const values = answers.map(a => a[key]).filter(v => v >= 1 && v <= 5);
    if (values.length) legacy[key] = Math.round(mean(values));
  }
  return legacy;
}

// Įtraukiamos tik užbaigtos sesijos, kuriose atsakyta į visus klausimus ir užpildytas vertinimas.
function participantsFor(experimentId, settings, chars) {
  const sessions = db.prepare("SELECT * FROM participant_sessions WHERE experiment_id=? AND group_label IN ('A','B') ORDER BY started_at").all(experimentId);
  const answers = db.prepare('SELECT a.* FROM answers a JOIN participant_sessions s ON s.id=a.session_id WHERE s.experiment_id=?').all(experimentId);
  const bySession = new Map(sessions.map(s => [s.id, []]));
  answers.forEach(a => bySession.get(a.session_id)?.push(a));
  const { bases, byId } = experimentQuestions(experimentId);
  const code = db.prepare('SELECT code FROM experiments WHERE id=?').get(experimentId)?.code || '';
  const ratingKeys = settings.ratingQuestions.map(q => q.key);
  const participants = [];
  let incomplete = 0;
  for (const s of sessions) {
    const list = bySession.get(s.id) || [], expected = parseJSON(s.question_order_json, []);
    const ratings = sessionRatings(s, list);
    const done = s.status === 'Užbaigta' && expected.length > 0 && expected.every(id => list.some(a => a.question_id === id))
      && ratingKeys.every(k => ratings[k] >= 1 && ratings[k] <= 5);
    if (!done) { incomplete++; continue; }
    const times = list.map(a => Math.max(Number(a.elapsed_seconds) || 0, 0.05));
    const byLevel = Object.fromEntries(LEVELS.map(l => [l, 0]));
    const correctByBase = {};
    for (const a of list) {
      const q = byId.get(a.question_id);
      if (q) { correctByBase[q.base] = a.is_correct ? 1 : 0; if (a.is_correct) byLevel[q.level]++; }
    }
    participants.push({
      id: s.id, group: s.group_label, experiment: code, language: String(s.language || 'lt').toUpperCase(), correct: list.filter(a => a.is_correct).length,
      time: mean(times), logTime: mean(times.map(Math.log)), ratings, byLevel, correctByBase,
      chars: Object.fromEntries(chars.map(c => [c.key, c.value(s)]))
    });
  }
  return { participants, incomplete, bases };
}

// ---------------------------------------------------------------- Palyginimai
function contingencyP(counts) {
  const rows = counts.filter(r => r.some(v => v > 0));
  const cols = rows[0]?.map((_, j) => j).filter(j => rows.some(r => r[j] > 0)) || [];
  if (rows.length < 2) return null;
  if (cols.length < 2) return 1;
  const table = rows.map(r => cols.map(j => r[j]));
  const chi = chiSquare(table);
  return table.length === 2 && table[0].length === 2 && chi.minExpected < 5 ? fisherExact(table) : chi.p;
}

function balance(participants, chars) {
  return chars.map(c => {
    const levels = [...c.levels, ...new Set(participants.map(p => p.chars[c.key]).filter(v => v && !c.levels.includes(v)))];
    const counts = GROUPS.map(g => levels.map(l => participants.filter(p => p.group === g && p.chars[c.key] === l).length));
    const present = levels.map((l, j) => ({ level: l, A: counts[0][j], B: counts[1][j] })).filter(r => r.A + r.B > 0);
    const p = GROUPS.every((_, i) => counts[i].some(v => v > 0)) ? contingencyP(counts) : null;
    return { key: c.key, title: c.title, rows: present, p, status: p == null ? 'insufficient' : p < ALPHA ? 'differs' : 'similar' };
  });
}

function questionComparison(participants, bases) {
  return bases.map(b => {
    const stats = GROUPS.map(g => {
      const list = participants.filter(p => p.group === g && p.correctByBase[b.base] != null);
      const correct = list.filter(p => p.correctByBase[b.base]).length;
      return { n: list.length, correct, pct: list.length ? (100 * correct) / list.length : null };
    });
    const p = stats.every(s => s.n > 0) ? contingencyP(stats.map(s => [s.correct, s.n - s.correct])) : null;
    return { nr: b.nr, text: b.text, level: b.level, A: stats[0], B: stats[1], p, status: statusOf(p) };
  });
}

function levelComparison(participants, bases) {
  return LEVELS.filter(l => bases.some(b => b.level === l)).map(l => {
    const max = bases.filter(b => b.level === l).length;
    const metric = { key: l, label: LEVEL_TITLES[l], kind: 'correct', value: p => p.byLevel[l], test: p => p.byLevel[l] };
    return { ...compareGroups(metric, participants), level: l, max };
  });
}

// Regresijos projektavimo matrica: konstanta, grupė (A = 1) ir kategoriniai kintamieji (atskaitos lygis – pirmasis).
function categoryColumns(values, levels) {
  const present = levels.filter(l => values.includes(l));
  return present.slice(1).map(l => values.map(v => (v === l ? 1 : 0)));
}
function fit(rows, columns, y) {
  return ols(rows.map((_, i) => [1, ...columns.map(c => c[i])]), y);
}

// H6, H7: ar A ir B skirtumas vienodas visiems (sąveika grupė × savybė).
function moderation(participants, metrics, char) {
  return metrics.map(m => {
    const rows = participants.filter(p => p.chars[char.key] != null && m.test(p) != null);
    const base = { key: m.key, label: m.label, kind: m.kind, p: null, status: 'insufficient', subgroups: [] };
    const values = rows.map(p => p.chars[char.key]);
    const levels = char.levels.filter(l => values.includes(l));
    if (levels.length < 2 || GROUPS.some(g => !rows.some(p => p.group === g))) return base;
    const y = rows.map(m.test), group = rows.map(p => (p.group === 'A' ? 1 : 0));
    const dummies = categoryColumns(values, char.levels);
    // Sąveika įvertinama tik tiems lygiams, kuriuose yra abiejų grupių dalyvių.
    const interactions = dummies.map(d => d.map((v, i) => v * group[i])).filter((c, k) => c.some(v => v) && dummies[k].some((v, i) => v && !group[i]));
    if (!interactions.length) return base;
    const reduced = fit(rows, [group, ...dummies], y), full = fit(rows, [group, ...dummies, ...interactions], y);
    const test = nestedF(full, reduced);
    if (!test || full.df < 2) return base;
    const subgroups = levels.map(l => {
      const sub = rows.filter(p => p.chars[char.key] === l);
      const [a, b] = GROUPS.map(g => sub.filter(p => p.group === g).map(m.value).filter(v => v != null));
      return { level: l, A: { mean: mean(a), n: a.length }, B: { mean: mean(b), n: b.length } };
    });
    return { ...base, p: test.p, status: statusOf(test.p), subgroups };
  });
}

// H11: A ir B skirtumas įvertinus amžių, lytį, sritį, patirtį ir įrenginį.
function adjusted(participants, metrics, chars, raw) {
  return metrics.map(m => {
    const rows = participants.filter(p => m.test(p) != null);
    const rawCmp = raw.find(r => r.key === m.key);
    const result = { key: m.key, label: m.label, kind: m.kind, rawDiff: rawCmp?.diff ?? null, diff: null, p: null, status: 'insufficient' };
    if (GROUPS.some(g => !rows.some(p => p.group === g))) return result;
    const group = rows.map(p => (p.group === 'A' ? 1 : 0)), columns = [group];
    for (const c of chars) {
      // Retos reikšmės (mažiau nei 3 dalyviai) sujungiamos, kad modelį būtų galima įvertinti.
      const original = rows.map(p => p.chars[c.key] ?? 'Nenurodyta');
      const counts = original.reduce((o, v) => ({ ...o, [v]: (o[v] || 0) + 1 }), {});
      const values = original.map(v => (counts[v] >= 3 ? v : 'Kita'));
      const levels = [...new Set([...c.levels, 'Nenurodyta', 'Kita'])].filter(l => values.includes(l));
      if (levels.length >= 2) columns.push(...categoryColumns(values, levels));
    }
    const model = fit(rows, columns, rows.map(m.test));
    if (!model || model.df < 2 || model.p[1] == null) return result;
    const b = model.beta[1];
    // Laikui (logaritmuotam) skirtumas pateikiamas procentais.
    return { ...result, diff: m.kind === 'time' ? (Math.exp(b) - 1) * 100 : b, p: model.p[1], status: statusOf(model.p[1]) };
  });
}

// ---------------------------------------------------------------- Viešos funkcijos
export function analysisExperiments() {
  return db.prepare(`SELECT e.id,e.code,e.title,e.status,
      (SELECT COUNT(*) FROM participant_sessions s WHERE s.experiment_id=e.id AND s.group_label IN ('A','B')) sessions
    FROM experiments e
    WHERE EXISTS (SELECT 1 FROM experiment_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.experiment_id=e.id AND q.variant<>'')
    ORDER BY COALESCE(NULLIF(e.code,''),'~'),e.id`).all().map(e => ({ ...e, archived: isArchived(e.code) }));
}

export function analyzeExperiment(experimentId) {
  const exp = db.prepare('SELECT * FROM experiments WHERE id=?').get(experimentId);
  if (!exp) return null;
  const settings = getSettings(), chars = characteristics(settings), metrics = metricsFor(settings);
  const { participants, incomplete, bases } = participantsFor(exp.id, settings, chars);
  const variants = db.prepare(`SELECT DISTINCT q.variant_a a,q.variant_b b FROM experiment_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.experiment_id=? AND q.variant<>''`).all(exp.id);
  const main = metrics.map(m => compareGroups(m, participants));
  return {
    experiment: { id: exp.id, code: exp.code || '', title: exp.title, hypothesis: mainHypothesis(exp.code) },
    variants: { A: [...new Set(variants.map(v => v.a))], B: [...new Set(variants.map(v => v.b))] },
    data: { A: participants.filter(p => p.group === 'A').length, B: participants.filter(p => p.group === 'B').length, incomplete, questions: bases.length },
    balance: balance(participants, chars),
    main,
    questions: questionComparison(participants, bases),
    levels: levelComparison(participants, bases),
    moderation: chars.filter(c => c.key === 'experience' || c.key === 'device').map(c => ({ key: c.key, title: c.title, hyp: c.hyp, results: moderation(participants, metrics, c) })),
    adjusted: adjusted(participants, metrics, chars, main)
  };
}

// H6–H10: visų (dabartinių) eksperimentų dalyviai kartu.
export function analyzeOverall() {
  const settings = getSettings(), chars = characteristics(settings), metrics = metricsFor(settings);
  const participants = analysisExperiments().filter(e => !e.archived).flatMap(e => participantsFor(e.id, settings, chars).participants);
  const results = chars.map(c => {
    const two = c.key === 'gender' || c.key === 'device';
    let levels = c.levels.map(l => ({ level: l, n: participants.filter(p => p.chars[c.key] === l).length })).filter(l => l.n >= 2);
    // Lytis ir įrenginys lyginami t-testu: imamos dvi pirmosios (pagal sąrašą) reikšmės, pvz., Moteris ir Vyras.
    if (two) levels = levels.slice(0, 2);
    const names = levels.map(l => l.level);
    return {
      key: c.key, title: c.title, hyp: c.hyp, levels: names,
      metrics: metrics.map(m => {
        const groups = names.map(l => participants.filter(p => p.chars[c.key] === l));
        const shown = groups.map(g => g.map(m.value).filter(v => v != null)), tested = groups.map(g => g.map(m.test).filter(v => v != null));
        const out = { key: m.key, label: m.label, kind: m.kind, groups: names.map((l, i) => ({ level: l, mean: mean(shown[i]), n: shown[i].length })), p: null, status: 'insufficient' };
        if (names.length < 2 || tested.some(t => t.length < 2)) return out;
        if (names.length === 2) {
          const r = welchTTest(tested[0], tested[1]), res = { ...out, p: r?.p ?? null, status: statusOf(r?.p ?? null) };
          if (res.status === 'significant') { const [a, b] = [...res.groups].sort((x, y) => y.mean - x.mean); res.highest = a; res.lowest = b; }
          return res;
        }
        const r = anova(tested);
        if (!r) return out;
        const result = { ...out, p: r.p, status: statusOf(r.p) };
        // Reikšmingo skirtumo atveju nurodoma grupė su didžiausiu ir mažiausiu vidurkiu.
        if (r.p < ALPHA) {
          const sorted = result.groups.filter(g => g.mean != null).sort((a, b) => b.mean - a.mean);
          result.highest = sorted[0]; result.lowest = sorted[sorted.length - 1];
        }
        return result;
      })
    };
  });
  return { participants: participants.length, alpha: ALPHA, characteristics: results };
}

// Viena suvestinė Rezultatų puslapiui: dabartiniai eksperimentai ir dalyvių savybių įtaka.
export function analysisSummary() {
  const experiments = analysisExperiments().filter(e => !e.archived).map(e => analyzeExperiment(e.id));
  return { experiments, overall: analyzeOverall() };
}

