// Tyrimo nustatymai: visi dalyviui rodomi tekstai (LT ir EN) ir profilio klausimai.
// Saugomi DB lentelėje settings; trūkstamos reikšmės papildomos numatytosiomis.
import { db, parseJSON } from './db.js';

export const LANGUAGES = ['lt', 'en'];

// Tekstų laukai tyrėjo „Nustatymų“ skilčiai: grupė, pavadinimas, ar kelių eilučių.
export const TEXT_FIELDS = [
  ['Bendra', 'brand', 'Tyrimo pavadinimas (antraštė)'],
  ['Bendra', 'languagePrompt', 'Kalbos pasirinkimo užrašas'],
  ['Pasisveikinimas', 'introTitle', 'Pasisveikinimo antraštė'],
  ['Pasisveikinimas', 'introBody', 'Pasisveikinimo tekstas (pastraipas skirkite tuščia eilute)', true],
  ['Pasisveikinimas', 'startButton', 'Mygtukas „Pradėti“'],
  ['Profilio klausimai', 'profileTitle', 'Antraštė'],
  ['Profilio klausimai', 'profileIntro', 'Įžanginis tekstas', true],
  ['Profilio klausimai', 'selectPlaceholder', 'Išskleidžiamojo sąrašo tekstas'],
  ['Profilio klausimai', 'profileStartButton', 'Mygtukas „Pradėti eksperimentą“'],
  ['Užduotis', 'progressHeading', 'Eksperimento progreso antraštė'],
  ['Užduotis', 'chartFallbackTitle', 'Diagramos antraštė, kai klausimas be paveikslėlio'],
  ['Užduotis', 'hintMultiple', 'Užuomina: keli pasirinkimai'],
  ['Užduotis', 'hintNumeric', 'Užuomina: skaitinis atsakymas'],
  ['Užduotis', 'numericPlaceholder', 'Skaitinio atsakymo lauko tekstas'],
  ['Užduotis', 'zoomHint', 'Užuomina apie diagramos padidinimą'],
  ['Užduotis', 'zoomBar', 'Padidintos diagramos užrašas'],
  ['Užduotis', 'zoomOpen', 'Diagramos padidinimo mygtuko aprašas (ekrano skaitytuvams)'],
  ['Užduotis', 'zoomClose', 'Uždarymo mygtuko aprašas (ekrano skaitytuvams)'],
  ['Užduotis', 'nextButton', 'Mygtukas „Toliau“'],
  ['Subjektyvūs vertinimai', 'ratingsScreenTitle', 'Vertinimų lango antraštė'],
  ['Subjektyvūs vertinimai', 'ratingsScreenIntro', 'Vertinimų lango įžanga', true],
  ['Subjektyvūs vertinimai', 'ratingsSubmit', 'Mygtukas „Pateikti“'],
  ['Atsisveikinimas', 'finishTitle', 'Atsisveikinimo antraštė'],
  ['Atsisveikinimas', 'finishBody', 'Atsisveikinimo tekstas', true],
  ['Atsisveikinimas', 'anotherQuestion', 'Kvietimas dalyvauti dar viename eksperimente'],
  ['Atsisveikinimas', 'anotherButton', 'Kvietimo mygtukas'],
  ['Kontaktai', 'contactText', 'Kontaktų tekstas'],
  ['Kontaktai', 'contactLinkLabel', 'Nuorodos pavadinimas'],
  ['Kontaktai', 'contactUrl', 'Nuorodos adresas (palikite tuščią, jei nuorodos nereikia)'],
  ['Pranešimai', 'starting', 'Pradedama'],
  ['Pranešimai', 'saving', 'Išsaugoma'],
  ['Pranešimai', 'answerMissing', 'Neatsakyta į užduoties klausimą'],
  ['Pranešimai', 'requiredMissing', 'Neatsakyta į privalomus klausimus (profilis, vertinimai)'],
  ['Pranešimai', 'startFailed', 'Nepavyko pradėti'],
  ['Pranešimai', 'saveFailed', 'Nepavyko išsaugoti atsakymo'],
  ['Pranešimai', 'noQuestions', 'Eksperimente nėra klausimų'],
  ['Pranešimai', 'noActiveExperiment', 'Nėra aktyvaus eksperimento']
].map(([group, key, label, multiline]) => ({ group, key, label, multiline: !!multiline }));

// Šių grupių tekstai tyrėjo „Nustatymuose“ nerodomi (naudojamos išsaugotos arba numatytosios reikšmės).
const HIDDEN_GROUPS = ['Bendra', 'Užduotis', 'Pranešimai'];
export const EDITABLE_TEXT_FIELDS = TEXT_FIELDS.filter(f => !HIDDEN_GROUPS.includes(f.group));

const DEFAULT_TEXTS = {
  lt: {
    brand: 'Diagramos tipo parinkimo tyrimas',
    languagePrompt: 'Pasirinkite kalbą',
    introTitle: 'Sveiki!',
    introBody: 'Esu Viltė Stankutė, Kauno technologijos universiteto magistrantūros studijų programos „Veiklos skaitmeninimas ir sistemų architektūros“ studentė. Savo magistro baigiamajame darbe „Diagramos tipo parinkimo kuriant duomenų vizualizacijas rekomendacijų paieška ir eksperimentiniai tyrimai“ nagrinėju, kaip suvokiamos duomenų vizualizacijos.\n\nKviečiu Jus dalyvauti trumpame eksperimente, kuris truks apie 10 minučių. Jums bus pateiktos įvairios diagramos ir klausimai apie jose pateiktą informaciją. Dalyvavimas yra anoniminis, o atsakymai bus naudojami tik apibendrintai analizei.',
    startButton: 'Pradėti',
    profileTitle: 'Trumpai apie jus',
    profileIntro: 'Prieš pradėdami eksperimentą atsakykite į kelis klausimus. Atsakymai anonimiški ir naudojami tik apibendrintai rezultatų analizei.',
    selectPlaceholder: 'Pasirinkite...',
    profileStartButton: 'Pradėti eksperimentą',
    progressHeading: 'Eksperimento progresas',
    chartFallbackTitle: 'Duomenų vizualizacijos užduotis',
    hintMultiple: 'Galite pažymėti daugiau nei vieną atsakymą.',
    hintNumeric: 'Įrašykite skaitinį atsakymą.',
    numericPlaceholder: 'Įrašykite skaičių',
    zoomHint: 'Paspauskite diagramą, kad padidintumėte',
    zoomBar: 'Slinkite, jei diagrama netelpa ekrane',
    zoomOpen: 'Padidinti diagramą',
    zoomClose: 'Uždaryti',
    nextButton: 'Toliau',
    ratingsScreenTitle: 'Diagramų vertinimas',
    ratingsScreenIntro: 'Įvertinkite šiame eksperimente matytas diagramas ir užduotis. Pažymėkite po vieną atsakymą kiekvienoje skalėje.',
    ratingsSubmit: 'Pateikti',
    finishTitle: 'Ačiū už dalyvavimą!',
    finishBody: 'Atsakėte į visus eksperimento klausimus, dėkoju už skirtą laiką!',
    anotherQuestion: 'Ar norite dalyvauti dar viename eksperimente?',
    anotherButton: 'Taip',
    contactText: 'Kilus klausimams, galime bendrauti čia:',
    contactLinkLabel: 'LinkedIn',
    contactUrl: 'https://www.linkedin.com/in/vilt%C4%97-stankut%C4%97-094b0a268',
    starting: 'Pradedama...',
    saving: 'Išsaugoma...',
    answerMissing: 'Pateikite atsakymą į klausimą.',
    requiredMissing: 'Būtina atsakyti į visus pateiktus klausimus.',
    startFailed: 'Nepavyko pradėti eksperimento.',
    saveFailed: 'Nepavyko išsaugoti atsakymo.',
    noQuestions: 'Eksperimente nėra aktyvių klausimų.',
    noActiveExperiment: 'Šiuo metu nėra aktyvaus eksperimento.'
  },
  en: {
    brand: 'Chart type selection study',
    languagePrompt: 'Choose your language',
    introTitle: 'Welcome!',
    introBody: 'I am Viltė Stankutė, a master’s student in the Business Digitalisation and Systems Architectures programme at Kaunas University of Technology. In my master’s thesis, “Search for recommendations and experimental research on chart type selection when creating data visualizations”, I study how data visualizations are perceived.\n\nI invite you to take part in a short experiment that will take about 10 minutes. You will be shown various charts and asked questions about the information they present. Participation is anonymous, and the answers will be used only in aggregated analysis.',
    startButton: 'Start',
    profileTitle: 'About you',
    profileIntro: 'Before starting the experiment, please answer a few questions. The answers are anonymous and used only for aggregated analysis of the results.',
    selectPlaceholder: 'Select...',
    profileStartButton: 'Start the experiment',
    progressHeading: 'Experiment progress',
    chartFallbackTitle: 'Data visualization task',
    hintMultiple: 'You may select more than one answer.',
    hintNumeric: 'Enter a numeric answer.',
    numericPlaceholder: 'Enter a number',
    zoomHint: 'Tap the chart to enlarge it',
    zoomBar: 'Scroll if the chart does not fit on the screen',
    zoomOpen: 'Enlarge chart',
    zoomClose: 'Close',
    nextButton: 'Next',
    ratingsScreenTitle: 'Rating the charts',
    ratingsScreenIntro: 'Please rate the charts and tasks you saw in this experiment. Select one answer on each scale.',
    ratingsSubmit: 'Submit',
    finishTitle: 'Thank you for participating!',
    finishBody: 'You have answered all the questions of the experiment. Thank you for your time!',
    anotherQuestion: 'Would you like to take part in another experiment?',
    anotherButton: 'Yes',
    contactText: 'If you have any questions, you can reach me here:',
    contactLinkLabel: 'LinkedIn',
    contactUrl: 'https://www.linkedin.com/in/vilt%C4%97-stankut%C4%97-094b0a268',
    starting: 'Starting...',
    saving: 'Saving...',
    answerMissing: 'Please answer the question.',
    requiredMissing: 'Please answer all the questions.',
    startFailed: 'Could not start the experiment.',
    saveFailed: 'Could not save the answer.',
    noQuestions: 'The experiment has no active questions.',
    noActiveExperiment: 'There is no active experiment at the moment.'
  }
};

// Analizės vaidmenys: kuriam hipotezės kintamajam naudojamas klausimas.
export const PROFILE_ROLES = [
  { value: '', label: 'Nenaudojamas hipotezėms' },
  { value: 'experience', label: 'Patirtis (H6)' },
  { value: 'age', label: 'Amžius (H8)' },
  { value: 'gender', label: 'Lytis (H9)' },
  { value: 'field', label: 'Išsilavinimo / darbo sritis (H10)' }
];

const opt = (lt, en) => ({ value: lt, lt, en });
const SCALE_OPTIONS = ['1', '2', '3', '4', '5'].map(v => ({ value: v, lt: v, en: v }));
const DEFAULT_PROFILE_QUESTIONS = [
  { key: 'gender', type: 'select', role: 'gender', title: { lt: 'Lytis', en: 'Gender' },
    options: [opt('Moteris', 'Female'), opt('Vyras', 'Male'), opt('Kita', 'Other'), opt('Nenoriu nurodyti', 'Prefer not to say')] },
  { key: 'ageGroup', type: 'select', role: 'age', title: { lt: 'Amžiaus grupė', en: 'Age group' },
    options: [opt('Iki 18 m.', 'Under 18'), opt('18–24 m.', '18–24'), opt('25–34 m.', '25–34'), opt('35–44 m.', '35–44'), opt('45–54 m.', '45–54'), opt('55–64 m.', '55–64'), opt('65 m. ir daugiau', '65 or older')] },
  { key: 'field', type: 'select', role: 'field', title: { lt: 'Išsilavinimo arba darbo sritis', en: 'Field of education or work' },
    options: [opt('Informacinės technologijos', 'Information technology'), opt('Duomenų analitika / statistika', 'Data analytics / statistics'), opt('Inžinerija / technologijos', 'Engineering / technology'), opt('Ekonomika / verslas / finansai', 'Economics / business / finance'), opt('Vadyba / administravimas', 'Management / administration'), opt('Socialiniai mokslai', 'Social sciences'), opt('Humanitariniai mokslai / menai', 'Humanities / arts'), opt('Gamtos mokslai / medicina', 'Natural sciences / medicine'), opt('Švietimas', 'Education'), opt('Kita', 'Other')] },
  { key: 'vizFrequency', type: 'scale', role: '', title: { lt: 'Kaip dažnai dirbate su duomenų vizualizacijomis?', en: 'How often do you work with data visualizations?' },
    options: SCALE_OPTIONS, scaleMin: { lt: 'Niekada', en: 'Never' }, scaleMax: { lt: 'Labai dažnai', en: 'Very often' } },
  { key: 'analysisExperience', type: 'scale', role: 'experience', title: { lt: 'Duomenų analizės patirtis', en: 'Data analysis experience' },
    options: SCALE_OPTIONS, scaleMin: { lt: 'Neturiu patirties', en: 'No experience' }, scaleMax: { lt: 'Labai didelė patirtis', en: 'Very extensive experience' } }
];

// Subjektyvūs vertinimai (skalė 1–5), užduodami vieną kartą eksperimento pabaigoje.
// label – trumpas pavadinimas rezultatų analizei.
const DEFAULT_RATING_QUESTIONS = [
  { key: 'clarity', label: 'Aiškumas', title: { lt: 'Ar diagramos buvo aiškios?', en: 'Were the charts clear?' },
    min: { lt: 'Visiškai neaiškios', en: 'Not clear at all' }, max: { lt: 'Labai aiškios', en: 'Very clear' } },
  { key: 'appeal', label: 'Patrauklumas', title: { lt: 'Ar diagramos jums buvo vizualiai patrauklios?', en: 'Were the charts visually appealing to you?' },
    min: { lt: 'Visiškai nepatrauklios', en: 'Not appealing at all' }, max: { lt: 'Labai patrauklios', en: 'Very appealing' } },
  { key: 'difficulty', label: 'Sudėtingumas', title: { lt: 'Ar užduotys pareikalavo daug protinių pastangų?', en: 'Did the tasks require a lot of mental effort?' },
    min: { lt: 'Visiškai nesudėtingos', en: 'Not demanding at all' }, max: { lt: 'Labai sudėtingos', en: 'Very demanding' } }
];

db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');

const clone = v => JSON.parse(JSON.stringify(v));
const str = (v, max = 5000) => String(v ?? '').slice(0, max);
const bilingual = (v, max = 500) => ({ lt: str(v?.lt, max).trim(), en: str(v?.en, max).trim() });

export function getSettings() {
  const stored = parseJSON(db.prepare("SELECT value FROM settings WHERE key='study'").get()?.value, {}) || {};
  const texts = {};
  for (const lang of LANGUAGES) texts[lang] = { ...DEFAULT_TEXTS[lang], ...(stored.texts?.[lang] || {}) };
  const profileQuestions = Array.isArray(stored.profileQuestions) ? stored.profileQuestions : clone(DEFAULT_PROFILE_QUESTIONS);
  const ratingQuestions = Array.isArray(stored.ratingQuestions) && stored.ratingQuestions.length ? stored.ratingQuestions : clone(DEFAULT_RATING_QUESTIONS);
  return { texts, profileQuestions, ratingQuestions };
}

function slug(text) {
  const s = String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (/^[A-Za-z]/.test(s) ? s : 'q_' + s).slice(0, 40) || 'q';
}

// Patikrina ir sutvarko tyrėjo pateiktus nustatymus; klaidos atveju meta Error su pranešimu.
export function normalizeSettings(input) {
  const texts = {};
  for (const lang of LANGUAGES) {
    texts[lang] = {};
    for (const f of TEXT_FIELDS) texts[lang][f.key] = str(input?.texts?.[lang]?.[f.key] ?? DEFAULT_TEXTS[lang][f.key]);
  }
  for (const lang of LANGUAGES) {
    const url = texts[lang].contactUrl.trim();
    if (url && !/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) throw new Error('Kontaktų nuoroda turi prasidėti http://, https:// arba mailto:.');
  }
  const list = Array.isArray(input?.profileQuestions) ? input.profileQuestions : [];
  if (list.length > 20) throw new Error('Profilio klausimų gali būti ne daugiau nei 20.');
  const keys = new Set(), roles = new Set();
  const profileQuestions = list.map((q, i) => {
    const title = bilingual(q.title);
    if (!title.lt) throw new Error(`${i + 1}-am profilio klausimui nurodykite pavadinimą lietuviškai.`);
    const type = q.type === 'scale' ? 'scale' : 'select';
    const role = PROFILE_ROLES.some(r => r.value === q.role) ? q.role : '';
    if (role && roles.has(role)) throw new Error(`Analizės vaidmuo „${PROFILE_ROLES.find(r => r.value === role).label}“ priskirtas keliems klausimams.`);
    if (role) roles.add(role);
    let key = /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(String(q.key || '')) ? q.key : slug(title.lt);
    while (keys.has(key)) key = `${key}_${i + 1}`;
    keys.add(key);
    const out = { key, type, role, title };
    if (type === 'scale') {
      out.options = clone(SCALE_OPTIONS);
      out.scaleMin = bilingual(q.scaleMin, 200);
      out.scaleMax = bilingual(q.scaleMax, 200);
    } else {
      const values = new Set();
      out.options = (Array.isArray(q.options) ? q.options : []).map(o => ({ value: str(o?.value, 200).trim(), lt: str(o?.lt, 200).trim(), en: str(o?.en, 200).trim() }))
        .filter(o => o.lt)
        .map(o => {
          let value = o.value || o.lt;
          while (values.has(value)) value += '*';
          values.add(value);
          return { ...o, value };
        });
      if (out.options.length < 2) throw new Error(`Klausimui „${title.lt}“ reikia bent dviejų atsakymo variantų.`);
    }
    return out;
  });
  const ratingList = Array.isArray(input?.ratingQuestions) ? input.ratingQuestions : [];
  if (!ratingList.length) throw new Error('Reikia bent vieno subjektyvaus vertinimo klausimo.');
  if (ratingList.length > 10) throw new Error('Vertinimo klausimų gali būti ne daugiau nei 10.');
  const ratingKeys = new Set();
  const ratingQuestions = ratingList.map((q, i) => {
    const title = bilingual(q.title);
    if (!title.lt) throw new Error(`${i + 1}-am vertinimo klausimui nurodykite tekstą lietuviškai.`);
    let key = /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(String(q.key || '')) ? q.key : slug(str(q.label, 100) || title.lt);
    while (ratingKeys.has(key)) key = `${key}_${i + 1}`;
    ratingKeys.add(key);
    return { key, label: str(q.label, 100).trim() || title.lt, title, min: bilingual(q.min, 200), max: bilingual(q.max, 200) };
  });
  return { texts, profileQuestions, ratingQuestions };
}

export function saveSettings(input) {
  const settings = normalizeSettings(input);
  db.prepare("INSERT INTO settings(key,value) VALUES('study',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP").run(JSON.stringify(settings));
  return getSettings();
}

// Dalyviui: tik pasirinktos kalbos tekstai ir klausimai (trūkstamas vertimas – lietuviškas tekstas).
export function publicSettings() {
  const s = getSettings();
  const pick = (v, lang) => (v?.[lang] || v?.lt || '');
  const result = { languages: LANGUAGES, texts: {}, profileQuestions: {}, ratingQuestions: {} };
  for (const lang of LANGUAGES) {
    result.texts[lang] = Object.fromEntries(Object.entries(s.texts[lang]).map(([k, v]) => [k, v || s.texts.lt[k] || '']));
    result.profileQuestions[lang] = s.profileQuestions.map(q => ({
      key: q.key, type: q.type, title: pick(q.title, lang),
      options: q.options.map(o => ({ value: o.value, label: pick(o, lang) })),
      ...(q.type === 'scale' ? { scaleMin: pick(q.scaleMin, lang), scaleMax: pick(q.scaleMax, lang) } : {})
    }));
    result.ratingQuestions[lang] = s.ratingQuestions.map(q => ({ key: q.key, title: pick(q.title, lang), min: pick(q.min, lang), max: pick(q.max, lang) }));
  }
  return result;
}

export function optionLabel(question, value, lang = 'lt') {
  const o = question?.options?.find(x => x.value === value);
  return o ? (o[lang] || o.lt || o.value) : value;
}

// Seniems įrašams (iki nustatymų): profilio atsakymai buvo atskiruose stulpeliuose.
const LEGACY_COLUMNS = { gender: 'gender', ageGroup: 'age_group', field: 'field_area', vizFrequency: 'viz_frequency', analysisExperience: 'analysis_experience' };
export function sessionProfile(session) {
  const stored = parseJSON(session?.profile_json, null);
  if (stored && typeof stored === 'object') return stored;
  const profile = {};
  for (const [key, column] of Object.entries(LEGACY_COLUMNS)) if (session?.[column]) profile[key] = session[column];
  return profile;
}
