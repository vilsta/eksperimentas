// Rezultatų analizė pagal 2.6 skyriaus principus: duomenų paruošimas, aprašomoji statistika,
// grupavimas, hipotezių tikrinimas, Holmo–Bonferronio korekcija ir interpretavimas.
import { db, parseJSON } from './db.js';
import { getSettings, sessionProfile, optionLabel } from './settings.js';
import { chiSquare, fisherExact, mannWhitney, cmh, holm, mean, median, quantile } from './stats.js';

const ALPHA = 0.05;
const GROUPS = ['A', 'B'];
// Senosios versijos eksperimentų kodai turi priesagą (E1-v1), todėl hipotezė parenkama pagal pradžią.
const mainHypothesis = code => MAIN_HYPOTHESIS[String(code || '').split('-')[0]] || 'H1–H5';
const MAIN_HYPOTHESIS = { E1: 'H1', E2: 'H2–H3', E3: 'H4', E4: 'H5' };

const RATING_LEVELS = ['Žemas (1–2)', 'Vidutinis (3)', 'Aukštas (4–5)'];
const ratingLevel = v => (v <= 2 ? RATING_LEVELS[0] : v === 3 ? RATING_LEVELS[1] : RATING_LEVELS[2]);
// Profilio klausimas pagal analizės vaidmenį (nustatymuose) ir jo reikšmės lietuviška etikete.
const roleQuestion = (settings, role) => settings.profileQuestions.find(q => q.role === role) || null;
const levelsOf = q => (q ? q.options.map(o => optionLabel(q, o.value)) : []);
// Patirtis: 1–5 skalėje 1–2 – mažesnė, 3–5 – didesnė; sąraše – pirmoji variantų pusė mažesnė.
function experienceLevels(q) {
  if (!q) return { levels: [], level: () => null };
  if (q.type === 'scale') return { levels: ['Mažesnė (1–2)', 'Didesnė (3–5)'], level: v => { const n = Number(v); return n >= 1 && n <= 2 ? 'Mažesnė (1–2)' : n >= 3 && n <= 5 ? 'Didesnė (3–5)' : null; } };
  const half = Math.floor(q.options.length / 2), low = q.options.slice(0, half).map(o => o.value);
  return { levels: ['Mažesnė', 'Didesnė'], level: v => (!v ? null : low.includes(v) ? 'Mažesnė' : q.options.some(o => o.value === v) ? 'Didesnė' : null) };
}

export function strength(v) {
  if (v == null) return '';
  if (v < 0.1) return 'labai silpna';
  if (v < 0.3) return 'silpna';
  if (v < 0.5) return 'vidutinė';
  return 'stipri';
}

export function analysisExperiments() {
  return db.prepare(`SELECT e.id,e.code,e.title,e.status,
      (SELECT COUNT(*) FROM participant_sessions s WHERE s.experiment_id=e.id AND s.group_label IN ('A','B')) sessions
    FROM experiments e
    WHERE EXISTS (SELECT 1 FROM experiment_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.experiment_id=e.id AND q.variant<>'')
    ORDER BY COALESCE(NULLIF(e.code,''),'~'),e.id`).all();
}

// ---------------------------------------------------------------- 1. Duomenų paruošimas
function prepare(experimentId, settings) {
  const roles = Object.fromEntries(['gender', 'age', 'field'].map(r => [r, roleQuestion(settings, r)]));
  const experience = experienceLevels(roleQuestion(settings, 'experience'));
  const sessions = db.prepare("SELECT * FROM participant_sessions WHERE experiment_id=? AND group_label IN ('A','B') ORDER BY started_at").all(experimentId);
  const answers = db.prepare(`SELECT a.*,q.task_type,q.answer_format,q.variant,q.variant_a,q.variant_b,q.tolerance
      FROM answers a JOIN questions q ON q.id=a.question_id JOIN participant_sessions s ON s.id=a.session_id
      WHERE s.experiment_id=?`).all(experimentId);
  const correctValue = db.prepare('SELECT option_text FROM question_options WHERE question_id=? AND is_correct=1 ORDER BY position LIMIT 1');
  const bySession = new Map(sessions.map(s => [s.id, []]));
  answers.forEach(a => bySession.get(a.session_id)?.push(a));

  const prep = { sessionsTotal: sessions.length, incomplete: 0, fastSessions: 0, sameRatingSessions: 0, incompleteTrials: 0, shortTrials: 0, includedSessions: 0, includedTrials: 0 };
  const participants = [], trials = [];
  for (const s of sessions) {
    const list = bySession.get(s.id) || [];
    if (s.status !== 'Užbaigta') { prep.incomplete++; continue; }
    if (list.length && list.filter(a => a.elapsed_seconds < 2).length > list.length / 2) { prep.fastSessions++; continue; }
    const ratings = new Set(list.flatMap(a => [a.clarity, a.appeal, a.difficulty]));
    if (list.length && ratings.size === 1) { prep.sameRatingSessions++; continue; }
    prep.includedSessions++;
    participants.push(s);
    const profile = sessionProfile(s);
    for (const a of list) {
      const complete = s.group_label && a.task_type !== null && a.answer_json && a.is_correct !== null && a.elapsed_seconds !== null && a.clarity && a.appeal && a.difficulty;
      if (!complete) { prep.incompleteTrials++; continue; }
      if (a.elapsed_seconds < 1) { prep.shortTrials++; continue; }
      let error = null;
      if (a.answer_format === 'Skaitinis atsakymas') {
        const toNum = v => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
        const got = toNum(parseJSON(a.answer_json, [])[0]), exp = toNum(correctValue.get(a.question_id)?.option_text);
        if (Number.isFinite(got) && Number.isFinite(exp) && exp !== 0) error = Math.abs(got - exp) / Math.abs(exp) * 100;
      }
      trials.push({
        session: s.id, group: s.group_label, task: a.task_type, correct: a.is_correct ? 1 : 0, time: a.elapsed_seconds,
        clarity: a.clarity, appeal: a.appeal, difficulty: a.difficulty, error,
        ...Object.fromEntries(Object.entries(roles).map(([r, q]) => [r, q && profile[q.key] ? optionLabel(q, profile[q.key]) : null])),
        experience: experience.level(profile[roleQuestion(settings, 'experience')?.key]), device: s.device_type || null
      });
    }
  }
  prep.includedTrials = trials.length;
  return { prep, participants, trials };
}

// ---------------------------------------------------------------- 2. Aprašomoji statistika
function describe(participants, trials, settings) {
  const variables = [
    ...settings.profileQuestions.map(q => ({ title: q.title.lt + (q.type === 'scale' ? ' (1–5)' : ''), order: levelsOf(q), value: p => { const v = sessionProfile(p)[q.key]; return v ? optionLabel(q, v) : null; } })),
    { title: 'Įrenginys', order: ['Kompiuteris', 'Mobilusis'], value: p => p.device_type || null },
    { title: 'Kalba', order: ['LT', 'EN'], value: p => String(p.language || 'lt').toUpperCase() }
  ];
  const demographic = variables.map(({ title, order, value }) => {
    const values = [...new Set([...order, ...participants.map(p => value(p) || 'Nenurodyta')])];
    const rows = values.map(v => ({ value: v, A: 0, B: 0 }));
    participants.forEach(p => { const row = rows.find(r => r.value === (value(p) || 'Nenurodyta')); row[p.group_label]++; });
    return { title, rows: rows.filter(r => r.A + r.B > 0) };
  });
  const indicators = GROUPS.map(g => {
    const t = trials.filter(x => x.group === g), times = t.map(x => x.time);
    const scale = key => ({ mean: mean(t.map(x => x[key])), counts: [1, 2, 3, 4, 5].map(v => t.filter(x => x[key] === v).length) });
    const errors = t.filter(x => x.error != null).map(x => x.error);
    return {
      group: g, participants: participants.filter(p => p.group_label === g).length, trials: t.length,
      accuracy: t.length ? (100 * t.filter(x => x.correct).length) / t.length : null,
      meanTime: mean(times), medianTime: median(times),
      clarity: scale('clarity'), appeal: scale('appeal'), difficulty: scale('difficulty'),
      medianError: errors.length ? median(errors) : null, errorCount: errors.length
    };
  });
  return { demographic, indicators };
}

// ---------------------------------------------------------------- 3. Grupavimas
function grouping(participants, trials) {
  const k = participants.length >= 40 ? 4 : 3;
  const labels = k === 4 ? ['Labai greitas', 'Greitas', 'Lėtas', 'Labai lėtas'] : ['Greitas', 'Vidutinis', 'Lėtas'];
  const times = trials.map(t => t.time);
  const cuts = Array.from({ length: k - 1 }, (_, i) => quantile(times, (i + 1) / k));
  const timeLevel = v => labels[cuts.filter(c => v > c).length];
  const indicators = [
    { key: 'correct', label: 'Teisingumas', levels: ['Teisingas', 'Neteisingas'], value: t => (t.correct ? 'Teisingas' : 'Neteisingas') },
    { key: 'time', label: 'Atlikimo laikas', levels: labels, value: t => timeLevel(t.time) },
    { key: 'clarity', label: 'Aiškumas', levels: RATING_LEVELS, value: t => ratingLevel(t.clarity) },
    { key: 'appeal', label: 'Patrauklumas', levels: RATING_LEVELS, value: t => ratingLevel(t.appeal) },
    { key: 'difficulty', label: 'Sudėtingumas', levels: RATING_LEVELS, value: t => ratingLevel(t.difficulty) }
  ];
  return { k, cuts, labels, indicators };
}

// ---------------------------------------------------------------- 4. Hipotezių tikrinimas
function crossTab(trials, rowFn, rowLevels, colFn, colLevels) {
  const rows = rowLevels.filter(r => trials.some(t => rowFn(t) === r));
  const cols = colLevels.filter(c => trials.some(t => colFn(t) === c));
  const counts = rows.map(r => cols.map(c => trials.filter(t => rowFn(t) === r && colFn(t) === c).length));
  return { rows, cols, counts };
}

function directionText(tab, residuals, rowName) {
  let best = null;
  tab.rows.forEach((r, i) => tab.cols.forEach((c, j) => { if (!best || residuals[i][j] > best.res) best = { r, c, res: residuals[i][j] }; }));
  return best && best.res > 0 ? `${rowName(best.r)}: „${best.c}“ dažniau nei tikėtasi` : '';
}

const groupName = g => `${g} grupėje`;

function associationTest(base, trials, rowVar, indicator) {
  const tab = crossTab(trials, rowVar.fn, rowVar.levels, indicator.value, indicator.levels);
  const result = { ...base, method: 'χ²', n: tab.counts.flat().reduce((a, b) => a + b, 0), table: tab };
  if (tab.rows.length < 2 || tab.cols.length < 2) return { ...result, insufficient: true, note: 'Nepakanka duomenų (lentelėje mažiau nei 2 eilutės arba stulpeliai).' };
  const chi = chiSquare(tab.counts);
  Object.assign(result, { stat: chi.chi2, statName: 'χ²', df: chi.df, p: chi.p, effect: chi.v, effectName: 'V', expected: chi.expected });
  if (tab.rows.length === 2 && tab.cols.length === 2 && chi.minExpected < 5) {
    result.method = 'Fisher'; result.p = fisherExact(tab.counts);
    result.note = 'Tikėtinas dažnis < 5, todėl p apskaičiuota Fišerio tiksliuoju testu.';
  } else if (chi.lowExpectedShare > 0.2) {
    result.note = 'Daugiau nei 20 % tikėtinų dažnių < 5 – χ² rezultatas gali būti netikslus.';
  }
  result.direction = directionText(tab, chi.residuals, rowVar.name);
  return result;
}

function cmhTest(base, trials, stratumVar, indicator) {
  const groupVar = { fn: t => t.group, levels: GROUPS };
  const strata = stratumVar.levels.map(level => ({ level, trials: trials.filter(t => stratumVar.fn(t) === level) }))
    .filter(s => GROUPS.every(g => s.trials.some(t => t.group === g)));
  const pooled = crossTab(strata.flatMap(s => s.trials), groupVar.fn, GROUPS, indicator.value, indicator.levels);
  const result = { ...base, method: 'CMH', n: pooled.counts.flat().reduce((a, b) => a + b, 0), table: pooled };
  result.strata = strata.map(s => {
    const tab = crossTab(s.trials, groupVar.fn, GROUPS, indicator.value, pooled.cols);
    return { level: s.level, table: tab };
  });
  if (pooled.rows.length < 2 || pooled.cols.length < 2 || !strata.length) return { ...result, insufficient: true, note: 'Nepakanka duomenų: nė viename sluoksnyje nėra abiejų grupių.' };
  const full = s => GROUPS.map(g => pooled.cols.map(c => s.trials.filter(t => t.group === g && indicator.value(t) === c).length));
  const res = cmh(strata.map(full));
  if (!res) return { ...result, insufficient: true, note: 'Nepakanka duomenų CMH testui.' };
  const chi = chiSquare(pooled.counts);
  Object.assign(result, { stat: res.stat, statName: 'CMH χ²', df: res.df, p: res.p, effect: chi.v, effectName: 'V',
    note: `Sluoksniai: ${strata.map(s => s.level).join(', ')}. Efekto dydis – sujungtos lentelės Kramerio V.`,
    direction: directionText(pooled, chi.residuals, groupName) });
  return result;
}

function mannWhitneyTest(base, trials, valueFn, unit) {
  const [a, b] = GROUPS.map(g => trials.filter(t => t.group === g).map(valueFn).filter(v => v != null));
  const res = mannWhitney(a, b);
  const result = { ...base, method: 'Mann–Whitney U', n: a.length + b.length, medians: { A: median(a), B: median(b) }, unit };
  if (!res || a.length < 2 || b.length < 2) return { ...result, insufficient: true, note: 'Nepakanka duomenų.' };
  const fmt = v => (v == null ? '—' : v.toFixed(2).replace('.', ','));
  const [mA, mB] = [median(a), median(b)];
  return { ...result, stat: res.u, statName: 'U', p: res.p, effect: res.r, effectName: 'r', z: res.z,
    note: `Mediana: A – ${fmt(mA)} ${unit}, B – ${fmt(mB)} ${unit}.`,
    direction: mA === mB ? '' : `${mA < mB ? 'A' : 'B'} grupės mediana mažesnė (${fmt(Math.min(mA, mB))} ${unit} prieš ${fmt(Math.max(mA, mB))} ${unit})` };
}

function hypothesisTests(code, trials, grouping, settings) {
  const experienceQ = roleQuestion(settings, 'experience');
  const tests = [];
  const ind = grouping.indicators;
  const group = { fn: t => t.group, levels: GROUPS, name: groupName };
  const mainCode = mainHypothesis(code);

  // H1–H5: ar rezultatai priklauso nuo grupės.
  ind.forEach(i => tests.push(associationTest({ hyp: mainCode, family: 'main', title: `Grupė × ${i.label.toLowerCase()}` }, trials, group, i)));
  tests.push(mannWhitneyTest({ hyp: mainCode, family: 'main', title: 'Atlikimo laikas (tikslios reikšmės), A ir B' }, trials, t => t.time, 's'));
  if (trials.some(t => t.error != null)) {
    tests.push(mannWhitneyTest({ hyp: mainCode, family: 'main', title: 'Skaitinio atsakymo paklaida (%), A ir B' }, trials.filter(t => t.error != null), t => t.error, '%'));
  }

  // H6, H7: patirtis ir įrenginys.
  // Hipotezė praleidžiama, jei nustatymuose nėra klausimo su atitinkamu analizės vaidmeniu.
  const moderators = [
    ...(experienceQ ? [['H6', 'Patirtis', { fn: t => t.experience, levels: experienceLevels(experienceQ).levels, name: v => `${v} patirtis` }]] : []),
    ['H7', 'Įrenginys', { fn: t => t.device, levels: ['Kompiuteris', 'Mobilusis'], name: v => v }]
  ];
  for (const [hyp, label, variable] of moderators) {
    ind.forEach(i => tests.push(associationTest({ hyp, family: hyp, title: `${label} × ${i.label.toLowerCase()}` }, trials, variable, i)));
    for (const level of variable.levels) {
      const subset = trials.filter(t => variable.fn(t) === level);
      ind.forEach(i => tests.push(associationTest({ hyp, family: hyp, title: `Grupė × ${i.label.toLowerCase()} (${variable.name(level)})`, subgroup: true }, subset, group, i)));
    }
    ind.forEach(i => tests.push(cmhTest({ hyp, family: hyp, title: `Grupė × ${i.label.toLowerCase()}, kontroliuojant: ${label.toLowerCase()}` }, trials, variable, i)));
  }

  // H8–H10: amžius, lytis, išsilavinimo sritis (A ir B kartu).
  const demographics = [['H8', 'age'], ['H9', 'gender'], ['H10', 'field']]
    .map(([hyp, role]) => [hyp, roleQuestion(settings, role)?.title.lt, { fn: t => t[role], levels: levelsOf(roleQuestion(settings, role)), name: v => v }])
    .filter(([, label]) => label);
  for (const [hyp, label, variable] of demographics) {
    ind.forEach(i => tests.push(associationTest({ hyp, family: hyp, title: `${label} × ${i.label.toLowerCase()}` }, trials, variable, i)));
  }

  // H11: grupės poveikis kontroliuojant demografinius veiksnius (CMH).
  for (const [, label, variable] of demographics) {
    ind.forEach(i => tests.push(cmhTest({ hyp: 'H11', family: 'H11', title: `Grupė × ${i.label.toLowerCase()}, kontroliuojant: ${label.toLowerCase()}` }, trials, variable, i)));
  }

  // 5. Daugkartinių palyginimų korekcija: visam eksperimentui ir kiekvienai hipotezei atskirai.
  const testable = tests.filter(t => !t.insufficient);
  holm(testable.map(t => t.p)).forEach((p, i) => { testable[i].pHolmExperiment = p; });
  for (const family of new Set(testable.map(t => t.family))) {
    const inFamily = testable.filter(t => t.family === family);
    holm(inFamily.map(t => t.p)).forEach((p, i) => { inFamily[i].pHolmHypothesis = p; });
  }
  tests.forEach((t, i) => { t.id = i; t.strength = t.effectName === 'V' ? strength(t.effect) : ''; });
  return tests;
}

// ---------------------------------------------------------------- Visa analizė
export function analyzeExperiment(experimentId) {
  const exp = db.prepare('SELECT * FROM experiments WHERE id=?').get(experimentId);
  if (!exp) return null;
  const settings = getSettings();
  const { prep, participants, trials } = prepare(exp.id, settings);
  const variants = db.prepare(`SELECT DISTINCT q.variant_a a,q.variant_b b FROM experiment_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.experiment_id=? AND q.variant<>''`).all(exp.id);
  const g = grouping(participants, trials);
  return {
    experiment: { id: exp.id, code: exp.code || '', title: exp.title, mainHypothesis: mainHypothesis(exp.code) },
    variants: { A: [...new Set(variants.map(v => v.a))], B: [...new Set(variants.map(v => v.b))] },
    alpha: ALPHA,
    preparation: prep,
    descriptive: describe(participants, trials, settings),
    grouping: { k: g.k, cuts: g.cuts, timeLabels: g.labels, ratingLevels: RATING_LEVELS, experienceLevels: experienceLevels(roleQuestion(settings, 'experience')).levels, experienceTitle: roleQuestion(settings, 'experience')?.title.lt || '' },
    tests: hypothesisTests(exp.code, trials, g, settings)
  };
}
