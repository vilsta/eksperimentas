import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'experiment.db');
export const db = new DatabaseSync(dbPath);


export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'researcher',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hypotheses (
  code TEXT PRIMARY KEY,
  h0 TEXT NOT NULL,
  h1 TEXT NOT NULL,
  dependent_variable TEXT DEFAULT '',
  independent_variable TEXT DEFAULT '',
  recommendation TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recommendation_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hypothesis_code TEXT NOT NULL REFERENCES hypotheses(code) ON DELETE CASCADE,
  recommendation TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(hypothesis_code, version)
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL DEFAULT '',
  variant_a TEXT NOT NULL DEFAULT '',
  variant_b TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  answer_format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Aktyvus',
  chart_type TEXT NOT NULL DEFAULT 'bar',
  image_data TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS question_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS question_hypotheses (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  hypothesis_code TEXT NOT NULL REFERENCES hypotheses(code) ON DELETE CASCADE,
  PRIMARY KEY(question_id, hypothesis_code)
);

CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Juodraštis',
  order_mode TEXT NOT NULL DEFAULT 'Atsitiktinė',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS experiment_questions (
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(experiment_id, question_id)
);

CREATE TABLE IF NOT EXISTS experiment_hypotheses (
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  hypothesis_code TEXT NOT NULL REFERENCES hypotheses(code) ON DELETE RESTRICT,
  PRIMARY KEY(experiment_id, hypothesis_code)
);

CREATE TABLE IF NOT EXISTS participant_sessions (
  id TEXT PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE RESTRICT,
  participant_label TEXT NOT NULL,
  device_type TEXT DEFAULT '',
  experience_level INTEGER,
  status TEXT NOT NULL DEFAULT 'Vykdoma',
  question_order_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  user_agent TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES participant_sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  answer_json TEXT NOT NULL,
  is_correct INTEGER NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  clarity INTEGER NOT NULL,
  appeal INTEGER NOT NULL,
  difficulty INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(session_id, question_id)
);

CREATE TABLE IF NOT EXISTS quality_surveys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE REFERENCES participant_sessions(id) ON DELETE CASCADE,
  answers_json TEXT NOT NULL,
  likes TEXT DEFAULT '',
  improvements TEXT DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_sessions_experiment ON participant_sessions(experiment_id);
`);

function tx(fn) {
  db.exec('BEGIN');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function parseJSON(value, fallback = []) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function seed() {
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (!users) {
    const email = process.env.ADMIN_EMAIL || 'tyrejas@ktu.lt';
    const password = process.env.ADMIN_PASSWORD || 'prototipas';
    db.prepare('INSERT INTO users(email,password_hash,role) VALUES(?,?,?)')
      .run(email, hashPassword(password), 'researcher');
  }

  const hc = db.prepare('SELECT COUNT(*) AS c FROM hypotheses').get().c;
  if (!hc) {
    const hypotheses = [
      ['H1','Diagramos tipas nedaro įtakos darbo našumui laiko eigos užduotyse.','Diagramos tipas daro įtaką darbo našumui laiko eigos užduotyse.','Atsakymo teisingumas, atlikimo laikas','Diagramos tipas (laiko eiga)','Laiko eigos užduotims rekomenduoti linijinę diagramą, jei patvirtinamas tikslumo ir greičio pranašumas.'],
      ['H2a','Diagramos tipas nedaro įtakos atsakymo tikslumui kategorijų palyginimo užduotyse.','Diagramos tipas daro įtaką atsakymo tikslumui kategorijų palyginimo užduotyse.','Atsakymo teisingumas','Diagramos tipas (kategorijos)','Rekomendacija formuluojama pagal tikslumo skirtumą tarp lyginamų tipų.'],
      ['H2b','Diagramos tipas nedaro įtakos atlikimo laikui kategorijų palyginimo užduotyse.','Diagramos tipas daro įtaką atlikimo laikui kategorijų palyginimo užduotyse.','Atlikimo laikas','Diagramos tipas (kategorijos)','Jei tikslumas panašus, greitesnį tipą rekomenduoti greitam palyginimui.'],
      ['H3','Diagramos tipas nedaro įtakos suprantamumui proporcijų vertinimo užduotyse.','Diagramos tipas daro įtaką suprantamumui proporcijų vertinimo užduotyse.','Atsakymo paklaida','Diagramos tipas (proporcijos)','Proporcijų užduotims rekomenduoti tipą, kuris mažina atsakymo paklaidą.'],
      ['H4','Sklaidos diagrama, lyginant su kitais tipais, nedidina suprantamumo ryšio nustatymo užduotyse.','Sklaidos diagrama didina suprantamumą ryšio tarp dviejų kintamųjų nustatymo užduotyse.','Atsakymo teisingumas','Diagramos tipas (ryšys)','Ryšio ir išskirčių nustatymui rekomenduoti sklaidos diagramą.'],
      ['H5a','Pateikimo būdas nedaro įtakos subjektyviam aiškumo vertinimui.','Pateikimo būdas daro įtaką subjektyviam aiškumo vertinimui.','Subjektyvus aiškumas','Pateikimo būdas','Aiškumo rekomendacija priklauso nuo reikšmių žymų, mastelio ir spalvinio pateikimo.'],
      ['H5b','Pateikimo būdas nedaro įtakos estetiniam pasitenkinimui.','Pateikimo būdas daro įtaką estetiniam pasitenkinimui.','Vizualinis pasitenkinimas','Pateikimo būdas','Estetikos gairė formuluojama tik jei subjektyvus skirtumas nuoseklus ir praktiškai reikšmingas.'],
      ['H6','Naudotojo patirties lygis nemoderuoja ryšio tarp diagramos tipo ir darbo našumo.','Naudotojo patirties lygis moderuoja ryšį tarp diagramos tipo ir darbo našumo.','Teisingumas, laikas','Diagramos tipas × patirtis','Jei moderavimas reikšmingas, rekomendacijas atskirti pagal patirties grupes.'],
      ['H7a','Kompiuteriu ir mobiliuoju įrenginiu dirbančių dalyvių atsakymo teisingumas nesiskiria.','Kompiuteriu ir mobiliuoju įrenginiu dirbančių dalyvių atsakymo teisingumas skiriasi.','Atsakymo teisingumas','Įrenginio tipas','Vertinti, ar diagramos tipą reikia adaptuoti mobiliajam ekranui.'],
      ['H7b','Kompiuteriu ir mobiliuoju įrenginiu dirbančių dalyvių atlikimo laikas nesiskiria.','Kompiuteriu ir mobiliuoju įrenginiu dirbančių dalyvių atlikimo laikas skiriasi.','Atlikimo laikas','Įrenginio tipas','Mobiliajame įrenginyje prioritetą teikti greičiau interpretuojamiems sprendimams.'],
      ['H7c','Kompiuteriu ir mobiliuoju įrenginiu dirbančių dalyvių subjektyvūs vertinimai nesiskiria.','Kompiuteriu ir mobiliuoju įrenginiu dirbančių dalyvių subjektyvūs vertinimai skiriasi.','Subjektyvūs vertinimai','Įrenginio tipas','Jei vertinimai skiriasi, pateikimo rekomendacijose nurodyti įrenginio kontekstą.']
    ];
    const ins = db.prepare('INSERT INTO hypotheses(code,h0,h1,dependent_variable,independent_variable,recommendation) VALUES(?,?,?,?,?,?)');
    const ver = db.prepare('INSERT INTO recommendation_versions(hypothesis_code,recommendation,version) VALUES(?,?,1)');
    tx(() => hypotheses.forEach(h => { ins.run(...h); ver.run(h[0], h[5]); }));
  }

  const qc = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c;
  if (!qc) {
    const questions = [
      {id:'U1',hyps:['H2a','H2b'],task:'Reikšmių palyginimas',a:'Stulpelinė',b:'Skritulinė',text:'Kuri kategorija turi didžiausią reikšmę?',format:'Vienas pasirinkimas',options:['A','B','C','D'],correct:['D'],chart:'bar'},
      {id:'U2',hyps:['H2a','H2b'],task:'Reikšmių palyginimas',a:'Stulpelinė',b:'Skritulinė',text:'Kurių dviejų kategorijų reikšmės panašiausios?',format:'Vienas pasirinkimas',options:['A ir B','B ir C','A ir D','C ir D'],correct:['B ir C'],chart:'bar'},
      {id:'U3',hyps:['H1'],task:'Laiko eiga',a:'Linijinė',b:'Stulpelinė',text:'Kuriais metais rodiklis buvo didžiausias?',format:'Vienas pasirinkimas',options:['2019','2020','2021','2022','2023'],correct:['2023'],chart:'line'},
      {id:'U4',hyps:['H1'],task:'Tendencijų nustatymas',a:'Linijinė',b:'Stulpelinė',text:'Kokia bendra tendencija pateiktu laikotarpiu?',format:'Vienas pasirinkimas',options:['Didėjanti','Mažėjanti','Stabili','Ciklinė'],correct:['Didėjanti'],chart:'line'},
      {id:'U5',hyps:['H3'],task:'Proporcijų vertinimas',a:'Skritulinė',b:'Stulpelinė',text:'Kuri kategorija sudaro didžiausią visumos dalį?',format:'Vienas pasirinkimas',options:['A','B','C','D'],correct:['A'],chart:'pie'},
      {id:'U6',hyps:['H3'],task:'Proporcijų vertinimas',a:'Skritulinė',b:'Pareto',text:'Kokią visumos dalį procentais sudaro kategorija B?',format:'Skaitinis atsakymas',options:['25'],correct:['25'],chart:'pie'},
      {id:'U7',hyps:['H4'],task:'Ryšio nustatymas',a:'Sklaidos',b:'Histograma',text:'Ar didėjant X didėja Y?',format:'Taip / Ne',options:['Taip','Ne'],correct:['Taip'],chart:'scatter'},
      {id:'U8',hyps:['H4'],task:'Ryšio nustatymas',a:'Sklaidos',b:'Histograma',text:'Ar diagramoje matomas išskirtinis taškas?',format:'Taip / Ne',options:['Taip','Ne'],correct:['Taip'],chart:'scatter'},
      {id:'U9',hyps:['H5a','H5b'],task:'Pateikimo būdas',a:'Su reikšmių žymomis',b:'Be reikšmių žymų',text:'Kokia kategorijos B reikšmė?',format:'Skaitinis atsakymas',options:['72'],correct:['72'],chart:'barlabels'},
      {id:'U10',hyps:['H5a','H5b'],task:'Pateikimo būdas',a:'Kontrastingos spalvos',b:'Mažesnio kontrasto spalvos',text:'Kurios grupės pažymėtos mažesnio kontrasto spalva?',format:'Keli pasirinkimai',options:['A','B','C','D'],correct:['B','D'],chart:'contrast'}
    ];
    const iq = db.prepare('INSERT INTO questions(id,task_type,variant_a,variant_b,text,answer_format,status,chart_type) VALUES(?,?,?,?,?,?,?,?)');
    const io = db.prepare('INSERT INTO question_options(question_id,option_text,is_correct,position) VALUES(?,?,?,?)');
    const ih = db.prepare('INSERT INTO question_hypotheses(question_id,hypothesis_code) VALUES(?,?)');
    tx(() => questions.forEach(q => {
      iq.run(q.id,q.task,q.a,q.b,q.text,q.format,'Aktyvus',q.chart);
      q.options.forEach((o,i)=>io.run(q.id,o,q.correct.includes(o)?1:0,i));
      q.hyps.forEach(h=>ih.run(q.id,h));
    }));
  }

  const ec = db.prepare('SELECT COUNT(*) AS c FROM experiments').get().c;
  if (!ec) {
    tx(() => {
      const r = db.prepare('INSERT INTO experiments(title,description,status,order_mode) VALUES(?,?,?,?)')
        .run('Diagramos tipo ir užduoties atitikties tyrimas','Pagrindinis tyrimas, apimantis H1-H7 hipotezes ir U1-U10 užduotis.','Aktyvus','Atsitiktinė');
      const eid = Number(r.lastInsertRowid);
      const eq = db.prepare('INSERT INTO experiment_questions(experiment_id,question_id,position) VALUES(?,?,?)');
      for (let i=1;i<=10;i++) eq.run(eid, `U${i}`, i-1);
      const eh = db.prepare('INSERT INTO experiment_hypotheses(experiment_id,hypothesis_code) VALUES(?,?)');
      ['H1','H2a','H2b','H3','H4','H5a','H5b','H6','H7a','H7b','H7c'].forEach(h=>eh.run(eid,h));
    });
  }
}

seed();

export function questionToObject(row, includeCorrect = true) {
  const options = db.prepare('SELECT option_text,is_correct FROM question_options WHERE question_id=? ORDER BY position,id').all(row.id);
  const hyps = db.prepare('SELECT hypothesis_code FROM question_hypotheses WHERE question_id=? ORDER BY hypothesis_code').all(row.id).map(x=>x.hypothesis_code);
  const obj = {
    id: row.id,
    hyp: hyps.join('/'),
    hyps,
    task: row.task_type,
    a: row.variant_a,
    b: row.variant_b,
    text: row.text,
    format: row.answer_format,
    options: options.map(x=>x.option_text),
    status: row.status,
    chart: row.chart_type,
    image: row.image_data || ''
  };
  if (includeCorrect) {
    obj.correct = options.filter(x=>x.is_correct).map(x=>x.option_text);
    obj.answer = obj.correct.join(', ');
  }
  return obj;
}

export function getExperimentObject(row) {
  const questions = db.prepare('SELECT question_id FROM experiment_questions WHERE experiment_id=? ORDER BY position').all(row.id).map(x=>x.question_id);
  const hyps = db.prepare('SELECT hypothesis_code FROM experiment_hypotheses WHERE experiment_id=? ORDER BY hypothesis_code').all(row.id).map(x=>x.hypothesis_code);
  return { id: row.id, title: row.title, desc: row.description, status: row.status, order: row.order_mode, questions, hyps };
}

export function replaceQuestionRelations(questionId, options, correct, hyps) {
  tx(() => {
    db.prepare('DELETE FROM question_options WHERE question_id=?').run(questionId);
    db.prepare('DELETE FROM question_hypotheses WHERE question_id=?').run(questionId);
    const io = db.prepare('INSERT INTO question_options(question_id,option_text,is_correct,position) VALUES(?,?,?,?)');
    options.forEach((o,i)=>io.run(questionId,o,correct.includes(o)?1:0,i));
    const ih = db.prepare('INSERT INTO question_hypotheses(question_id,hypothesis_code) VALUES(?,?)');
    hyps.forEach(h=>ih.run(questionId,h));
  });
}

export function replaceExperimentRelations(experimentId, questions, hyps) {
  tx(() => {
    db.prepare('DELETE FROM experiment_questions WHERE experiment_id=?').run(experimentId);
    db.prepare('DELETE FROM experiment_hypotheses WHERE experiment_id=?').run(experimentId);
    const iq = db.prepare('INSERT INTO experiment_questions(experiment_id,question_id,position) VALUES(?,?,?)');
    questions.forEach((q,i)=>iq.run(experimentId,q,i));
    const ih = db.prepare('INSERT INTO experiment_hypotheses(experiment_id,hypothesis_code) VALUES(?,?)');
    hyps.forEach(h=>ih.run(experimentId,h));
  });
}
