import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, parseJSON, questionToObject, getExperimentObject, replaceQuestionRelations, replaceExperimentRelations, verifyPassword } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8000);
const authSessions = new Map();

const text = v => String(v ?? '').trim();
const arr = v => Array.isArray(v) ? v.map(x=>String(x).trim()).filter(Boolean) : [];
const nowIso = () => new Date().toISOString();
function shuffle(a){ const x=[...a]; for(let i=x.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [x[i],x[j]]=[x[j],x[i]]; } return x; }
function normalizedAnswer(a){ return (Array.isArray(a)?a:[a]).map(v=>String(v).trim()).filter(Boolean).sort(); }
function isCorrectAnswer(q, answer){
  const expected=q.correct||[], got=normalizedAnswer(answer);
  if(q.format==='Skaitinis atsakymas'){
    const a=Number(got[0]), b=Number(expected[0]);
    return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-9;
  }
  const exp=[...expected].map(String).sort();
  return got.length===exp.length&&got.every((v,i)=>v===exp[i]);
}
function publicQuestion(q){ const {correct,answer,...safe}=q; return safe; }

function cookies(req){
  return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [decodeURIComponent(x.slice(0,i)),decodeURIComponent(x.slice(i+1))]}));
}
function currentUser(req){
  const sid=cookies(req).sid, entry=sid&&authSessions.get(sid);
  if(!entry) return null;
  if(entry.expires<Date.now()){authSessions.delete(sid);return null;}
  entry.expires=Date.now()+8*60*60*1000;
  return entry.user;
}
function requireAdmin(req){ const u=currentUser(req); if(!u) throw httpError(401,'Neautorizuota'); return u; }
function httpError(status,message){ const e=new Error(message); e.status=status; return e; }

function json(res,status,data,headers={}){
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),...headers});res.end(body);
}
function sendText(res,status,body,type='text/plain; charset=utf-8',headers={}){
  res.writeHead(status,{'Content-Type':type,'Content-Length':Buffer.byteLength(body),...headers});res.end(body);
}
async function bodyJson(req){
  const chunks=[]; let size=0; const limit=16*1024*1024;
  for await (const chunk of req){ size+=chunk.length; if(size>limit) throw httpError(413,'Užklausa per didelė.'); chunks.push(chunk); }
  if(!chunks.length) return {};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw httpError(400,'Neteisingas JSON formatas.');}
}
function match(pathname,pattern){
  const names=[];
  const regex=new RegExp('^'+pattern.replace(/:[^/]+/g,m=>{names.push(m.slice(1));return '([^/]+)'})+'$');
  const m=pathname.match(regex); if(!m)return null;
  return Object.fromEntries(names.map((n,i)=>[n,decodeURIComponent(m[i+1])]));
}

async function api(req,res,pathname){
  const method=req.method||'GET';
  let params;

  if(pathname==='/api/login'&&method==='POST'){
    const b=await bodyJson(req), email=text(b.email).toLowerCase(), password=String(b.password||'');
    const user=db.prepare('SELECT * FROM users WHERE lower(email)=?').get(email);
    if(!user||!verifyPassword(password,user.password_hash)) throw httpError(401,'Neteisingas el. paštas arba slaptažodis.');
    const sid=crypto.randomBytes(32).toString('hex'), publicUser={id:user.id,email:user.email,role:user.role};
    authSessions.set(sid,{user:publicUser,expires:Date.now()+8*60*60*1000});
    return json(res,200,{user:publicUser},{'Set-Cookie':`sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`});
  }
  if(pathname==='/api/logout'&&method==='POST'){
    const sid=cookies(req).sid;if(sid)authSessions.delete(sid);
    return json(res,200,{ok:true},{'Set-Cookie':'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'});
  }
  if(pathname==='/api/me'&&method==='GET'){
    const user=requireAdmin(req);return json(res,200,{user});
  }
  if(pathname==='/api/recover'&&method==='POST') return json(res,200,{ok:true,message:'Prototipe el. laiškas nesiunčiamas. Kreipkitės į sistemos administratorių.'});

  if(pathname==='/api/admin/dashboard'&&method==='GET'){
    requireAdmin(req);
    const active=db.prepare("SELECT COUNT(*) c FROM experiments WHERE status='Aktyvus'").get().c;
    const sessions=db.prepare('SELECT COUNT(*) c FROM participant_sessions').get().c;
    const completed=db.prepare("SELECT COUNT(*) c FROM participant_sessions WHERE status='Užbaigta'").get().c;
    const questions=db.prepare('SELECT COUNT(*) c FROM questions').get().c;
    const ans=db.prepare('SELECT COUNT(*) n, COALESCE(SUM(is_correct),0) correct FROM answers').get();
    return json(res,200,{activeExperiments:active,sessions,completedSessions:completed,questions,accuracy:ans.n?Math.round(ans.correct*100/ans.n):0});
  }

  if(pathname==='/api/admin/questions'&&method==='GET'){
    requireAdmin(req);return json(res,200,db.prepare('SELECT * FROM questions ORDER BY id').all().map(r=>questionToObject(r,true)));
  }
  if(pathname==='/api/admin/questions'&&method==='POST'){
    requireAdmin(req);const q=await bodyJson(req);const id=text(q.id),questionText=text(q.text),format=text(q.format),options=arr(q.options),correct=arr(q.correct),hyps=arr(q.hyps?.length?q.hyps:(q.hyp?String(q.hyp).split('/'):[]));
    if(!id||!questionText||!format)throw httpError(400,'Trūksta privalomų klausimo laukų.');
    if(format!=='Skaitinis atsakymas'&&options.length<2)throw httpError(400,'Reikia bent dviejų atsakymo variantų.');
    if(!correct.length)throw httpError(400,'Pažymėkite teisingą atsakymą.');
    if(format==='Vienas pasirinkimas'&&correct.length!==1)throw httpError(400,'Vienam pasirinkimui turi būti vienas teisingas atsakymas.');
    try{
      db.prepare('INSERT INTO questions(id,task_type,variant_a,variant_b,text,answer_format,status,chart_type,image_data) VALUES(?,?,?,?,?,?,?,?,?)').run(id,text(q.task),text(q.a),text(q.b),questionText,format,text(q.status)||'Aktyvus',text(q.chart)||'bar',String(q.image||''));
      replaceQuestionRelations(id,format==='Skaitinis atsakymas'?correct:options,correct,hyps);
    }catch(e){throw httpError(400,e.message.includes('UNIQUE')?'Toks klausimo kodas jau egzistuoja.':e.message)}
    return json(res,201,questionToObject(db.prepare('SELECT * FROM questions WHERE id=?').get(id),true));
  }
  if((params=match(pathname,'/api/admin/questions/:id'))&&method==='PUT'){
    requireAdmin(req);const q=await bodyJson(req),id=params.id,format=text(q.format),options=arr(q.options),correct=arr(q.correct),hyps=arr(q.hyps?.length?q.hyps:(q.hyp?String(q.hyp).split('/'):[]));
    if(!text(q.text)||!format||!correct.length)throw httpError(400,'Trūksta privalomų laukų.');
    db.prepare('UPDATE questions SET task_type=?,variant_a=?,variant_b=?,text=?,answer_format=?,status=?,chart_type=?,image_data=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(text(q.task),text(q.a),text(q.b),text(q.text),format,text(q.status)||'Aktyvus',text(q.chart)||'bar',String(q.image||''),id);
    replaceQuestionRelations(id,format==='Skaitinis atsakymas'?correct:options,correct,hyps);
    return json(res,200,questionToObject(db.prepare('SELECT * FROM questions WHERE id=?').get(id),true));
  }
  if((params=match(pathname,'/api/admin/questions/:id'))&&method==='DELETE'){
    requireAdmin(req);try{db.prepare('DELETE FROM questions WHERE id=?').run(params.id)}catch{throw httpError(409,'Klausimas jau naudojamas eksperimente arba sesijose, todėl jo šalinti negalima. Pakeiskite būseną į „Neaktyvus“.')}return json(res,200,{ok:true});
  }

  if(pathname==='/api/admin/hypotheses'&&method==='GET'){
    requireAdmin(req);const rows=db.prepare('SELECT * FROM hypotheses ORDER BY code').all();return json(res,200,rows.map(h=>({code:h.code,h0:h.h0,h1:h.h1,dep:h.dependent_variable,ind:h.independent_variable,rec:h.recommendation})));
  }
  if(pathname==='/api/admin/hypotheses'&&method==='POST'){
    requireAdmin(req);const h=await bodyJson(req),code=text(h.code);if(!code||!text(h.h0)||!text(h.h1))throw httpError(400,'Nurodykite kodą, H0 ir H1.');
    try{db.prepare('INSERT INTO hypotheses(code,h0,h1,dependent_variable,independent_variable,recommendation) VALUES(?,?,?,?,?,?)').run(code,text(h.h0),text(h.h1),text(h.dep),text(h.ind),text(h.rec));if(text(h.rec))db.prepare('INSERT INTO recommendation_versions(hypothesis_code,recommendation,version) VALUES(?,?,1)').run(code,text(h.rec));}catch(e){throw httpError(400,e.message.includes('UNIQUE')?'Toks hipotezės kodas jau egzistuoja.':e.message)}return json(res,201,{ok:true});
  }
  if((params=match(pathname,'/api/admin/hypotheses/:code/history'))&&method==='GET'){
    requireAdmin(req);return json(res,200,db.prepare('SELECT version,recommendation,created_at FROM recommendation_versions WHERE hypothesis_code=? ORDER BY version DESC').all(params.code));
  }
  if((params=match(pathname,'/api/admin/hypotheses/:code'))&&method==='PUT'){
    requireAdmin(req);const h=await bodyJson(req),old=db.prepare('SELECT * FROM hypotheses WHERE code=?').get(params.code);if(!old)throw httpError(404,'Hipotezė nerasta.');const rec=text(h.rec);
    db.prepare('UPDATE hypotheses SET h0=?,h1=?,dependent_variable=?,independent_variable=?,recommendation=?,updated_at=CURRENT_TIMESTAMP WHERE code=?').run(text(h.h0),text(h.h1),text(h.dep),text(h.ind),rec,params.code);
    if(rec&&rec!==old.recommendation){const v=db.prepare('SELECT COALESCE(MAX(version),0)+1 v FROM recommendation_versions WHERE hypothesis_code=?').get(params.code).v;db.prepare('INSERT INTO recommendation_versions(hypothesis_code,recommendation,version) VALUES(?,?,?)').run(params.code,rec,v)}return json(res,200,{ok:true});
  }

  if(pathname==='/api/admin/experiments'&&method==='GET'){
    requireAdmin(req);return json(res,200,db.prepare('SELECT * FROM experiments ORDER BY id DESC').all().map(getExperimentObject));
  }
  if(pathname==='/api/admin/experiments'&&method==='POST'){
    requireAdmin(req);const x=await bodyJson(req);if(!text(x.title))throw httpError(400,'Nurodykite eksperimento pavadinimą.');if(text(x.status)==='Aktyvus')db.prepare("UPDATE experiments SET status='Sustabdytas' WHERE status='Aktyvus'").run();const r=db.prepare('INSERT INTO experiments(title,description,status,order_mode) VALUES(?,?,?,?)').run(text(x.title),text(x.desc),text(x.status)||'Juodraštis',text(x.order)||'Atsitiktinė');const id=Number(r.lastInsertRowid);replaceExperimentRelations(id,arr(x.questions),arr(x.hyps));return json(res,201,getExperimentObject(db.prepare('SELECT * FROM experiments WHERE id=?').get(id)));
  }
  if((params=match(pathname,'/api/admin/experiments/:id/status'))&&method==='PATCH'){
    requireAdmin(req);const b=await bodyJson(req),id=Number(params.id),status=text(b.status);if(status==='Aktyvus')db.prepare("UPDATE experiments SET status='Sustabdytas' WHERE status='Aktyvus' AND id<>?").run(id);db.prepare('UPDATE experiments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,id);return json(res,200,{ok:true});
  }
  if((params=match(pathname,'/api/admin/experiments/:id'))&&method==='PUT'){
    requireAdmin(req);const x=await bodyJson(req),id=Number(params.id);if(!text(x.title))throw httpError(400,'Nurodykite eksperimento pavadinimą.');if(text(x.status)==='Aktyvus')db.prepare("UPDATE experiments SET status='Sustabdytas' WHERE status='Aktyvus' AND id<>?").run(id);db.prepare('UPDATE experiments SET title=?,description=?,status=?,order_mode=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(text(x.title),text(x.desc),text(x.status)||'Juodraštis',text(x.order)||'Atsitiktinė',id);replaceExperimentRelations(id,arr(x.questions),arr(x.hyps));return json(res,200,getExperimentObject(db.prepare('SELECT * FROM experiments WHERE id=?').get(id)));
  }

  if(pathname==='/api/admin/sessions'&&method==='GET'){
    requireAdmin(req);const rows=db.prepare(`SELECT s.*,e.title experiment_title,(SELECT COUNT(*) FROM answers a WHERE a.session_id=s.id) answered,(SELECT COALESCE(SUM(is_correct),0) FROM answers a WHERE a.session_id=s.id) correct,(SELECT COALESCE(AVG(elapsed_seconds),0) FROM answers a WHERE a.session_id=s.id) avg_time FROM participant_sessions s JOIN experiments e ON e.id=s.experiment_id ORDER BY s.started_at DESC`).all();return json(res,200,rows.map(r=>({...r,accuracy:r.answered?Math.round(r.correct*100/r.answered):0,avg_time:Number(r.avg_time||0).toFixed(1)})));
  }
  if((params=match(pathname,'/api/admin/sessions/:id'))&&method==='GET'){
    requireAdmin(req);const s=db.prepare('SELECT s.*,e.title experiment_title FROM participant_sessions s JOIN experiments e ON e.id=s.experiment_id WHERE s.id=?').get(params.id);if(!s)throw httpError(404,'Sesija nerasta.');const order=parseJSON(s.question_order_json,[]),answers=db.prepare('SELECT * FROM answers WHERE session_id=?').all(s.id),amap=new Map(answers.map(a=>[a.question_id,a]));const questions=order.map(id=>{const row=db.prepare('SELECT * FROM questions WHERE id=?').get(id);if(!row)return null;const q=questionToObject(row,true),a=amap.get(id);return {...q,response:a?{answer:parseJSON(a.answer_json,[]),isCorrect:!!a.is_correct,elapsedSeconds:a.elapsed_seconds,clarity:a.clarity,appeal:a.appeal,difficulty:a.difficulty}:null}}).filter(Boolean);const survey=db.prepare('SELECT * FROM quality_surveys WHERE session_id=?').get(s.id);return json(res,200,{session:s,questions,survey:survey?{...survey,answers:parseJSON(survey.answers_json,{})}:null});
  }

  if(pathname==='/api/admin/results/summary'&&method==='GET'){
    requireAdmin(req);const a=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(is_correct),0) correct,COALESCE(AVG(elapsed_seconds),0) avg_time,COALESCE(AVG(clarity),0) clarity,COALESCE(AVG(appeal),0) appeal,COALESCE(AVG(difficulty),0) difficulty FROM answers').get();const byTask=db.prepare('SELECT q.task_type task,COUNT(*) n,ROUND(100.0*SUM(a.is_correct)/COUNT(*),1) accuracy,ROUND(AVG(a.elapsed_seconds),1) avg_time FROM answers a JOIN questions q ON q.id=a.question_id GROUP BY q.task_type ORDER BY q.task_type').all();const byDevice=db.prepare('SELECT s.device_type device,COUNT(*) n,ROUND(AVG(a.elapsed_seconds),1) avg_time,ROUND(100.0*SUM(a.is_correct)/COUNT(*),1) accuracy FROM answers a JOIN participant_sessions s ON s.id=a.session_id GROUP BY s.device_type').all();return json(res,200,{accuracy:a.n?Math.round(a.correct*100/a.n):0,avgTime:Number(a.avg_time||0).toFixed(1),clarity:Number(a.clarity||0).toFixed(1),appeal:Number(a.appeal||0).toFixed(1),difficulty:Number(a.difficulty||0).toFixed(1),byTask,byDevice});
  }
  if(pathname==='/api/admin/export.csv'&&method==='GET'){
    requireAdmin(req);const rows=db.prepare('SELECT s.participant_label participant,s.id session_id,s.device_type,s.age_group,s.gender,s.education_level,s.professional_field,s.experience_level,s.chart_frequency,s.data_analysis_experience,q.id question_id,q.task_type,q.answer_format,a.answer_json,a.is_correct,a.elapsed_seconds,a.clarity,a.appeal,a.difficulty,a.submitted_at FROM answers a JOIN participant_sessions s ON s.id=a.session_id JOIN questions q ON q.id=a.question_id ORDER BY s.started_at,q.id').all();const headers=['participant','session_id','device_type','age_group','gender','education_level','professional_field','experience_level','chart_frequency','data_analysis_experience','question_id','task_type','answer_format','answer','is_correct','elapsed_seconds','clarity','appeal','difficulty','submitted_at'];const csvEsc=v=>'"'+String(v??'').replaceAll('"','""')+'"';const csv='\ufeff'+[headers.map(csvEsc).join(','),...rows.map(r=>headers.map(h=>csvEsc(h==='answer'?parseJSON(r.answer_json,[]).join(' | '):r[h])).join(','))].join('\n');return sendText(res,200,csv,'text/csv; charset=utf-8',{'Content-Disposition':'attachment; filename="eksperimento_rezultatai.csv"'});
  }

  if(pathname==='/api/public/start'&&method==='POST'){
    const b=await bodyJson(req),exp=db.prepare("SELECT * FROM experiments WHERE status='Aktyvus' ORDER BY id DESC LIMIT 1").get();if(!exp)throw httpError(404,'Šiuo metu nėra aktyvaus eksperimento.');
    let ids=db.prepare("SELECT q.id FROM experiment_questions eq JOIN questions q ON q.id=eq.question_id WHERE eq.experiment_id=? AND q.status='Aktyvus' ORDER BY eq.position").all(exp.id).map(x=>x.id);if(exp.order_mode==='Atsitiktinė')ids=shuffle(ids);
    const ageGroup=text(b.ageGroup),gender=text(b.gender),educationLevel=text(b.educationLevel),professionalField=text(b.professionalField),chartFrequency=text(b.chartFrequency),experience=Number(b.experience),dataAnalysisExperience=Number(b.dataAnalysisExperience);
    if(!ageGroup||!gender||!educationLevel||!professionalField||!chartFrequency)throw httpError(400,'Atsakykite į visus klausimus apie save.');
    if(![experience,dataAnalysisExperience].every(v=>Number.isInteger(v)&&v>=1&&v<=5))throw httpError(400,'Patirties vertinimai turi būti nuo 1 iki 5.');
    const id=crypto.randomUUID(),n=db.prepare('SELECT COUNT(*) c FROM participant_sessions').get().c+1,label=`Dalyvis #${n}`,ua=req.headers['user-agent']||'',device=text(b.device)||(/Mobi|Android|iPhone|iPad/i.test(ua)?'Mobilusis':'Kompiuteris');
    db.prepare('INSERT INTO participant_sessions(id,experiment_id,participant_label,device_type,age_group,gender,education_level,professional_field,experience_level,chart_frequency,data_analysis_experience,status,question_order_json,started_at,user_agent) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,exp.id,label,device,ageGroup,gender,educationLevel,professionalField,experience,chartFrequency,dataAnalysisExperience,'Vykdoma',JSON.stringify(ids),nowIso(),ua);
    const questions=ids.map(qid=>publicQuestion(questionToObject(db.prepare('SELECT * FROM questions WHERE id=?').get(qid),true)));return json(res,201,{sessionId:id,participantLabel:label,experiment:{id:exp.id,title:exp.title,description:exp.description},questions});
  }
  if((params=match(pathname,'/api/public/sessions/:id/answer'))&&method==='POST'){
    const b=await bodyJson(req),s=db.prepare('SELECT * FROM participant_sessions WHERE id=?').get(params.id);if(!s)throw httpError(404,'Sesija nerasta.');if(s.status==='Užbaigta')throw httpError(409,'Sesija jau užbaigta.');const qid=text(b.questionId);if(!parseJSON(s.question_order_json,[]).includes(qid))throw httpError(400,'Klausimas nepriklauso šiai sesijai.');const row=db.prepare('SELECT * FROM questions WHERE id=?').get(qid),q=questionToObject(row,true),elapsed=Math.max(1,Math.round(Number(b.elapsedSeconds)||1)),clarity=Number(b.clarity),appeal=Number(b.appeal),difficulty=Number(b.difficulty);if(![clarity,appeal,difficulty].every(v=>Number.isInteger(v)&&v>=1&&v<=5))throw httpError(400,'Visi trys vertinimai turi būti nuo 1 iki 5.');const correct=isCorrectAnswer(q,b.answer)?1:0;db.prepare('INSERT INTO answers(session_id,question_id,answer_json,is_correct,elapsed_seconds,clarity,appeal,difficulty) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(session_id,question_id) DO UPDATE SET answer_json=excluded.answer_json,is_correct=excluded.is_correct,elapsed_seconds=excluded.elapsed_seconds,clarity=excluded.clarity,appeal=excluded.appeal,difficulty=excluded.difficulty,submitted_at=CURRENT_TIMESTAMP').run(s.id,qid,JSON.stringify(normalizedAnswer(b.answer)),correct,elapsed,clarity,appeal,difficulty);return json(res,200,{ok:true});
  }
  if((params=match(pathname,'/api/public/sessions/:id/complete'))&&method==='POST'){
    const s=db.prepare('SELECT * FROM participant_sessions WHERE id=?').get(params.id);if(!s)throw httpError(404,'Sesija nerasta.');const expected=parseJSON(s.question_order_json,[]).length,answered=db.prepare('SELECT COUNT(*) c FROM answers WHERE session_id=?').get(s.id).c;if(answered<expected)throw httpError(400,`Atsakyta ${answered} iš ${expected} klausimų.`);db.prepare("UPDATE participant_sessions SET status='Užbaigta',finished_at=? WHERE id=?").run(nowIso(),s.id);return json(res,200,{ok:true});
  }
  if((params=match(pathname,'/api/public/sessions/:id/survey'))&&method==='POST'){
    const b=await bodyJson(req),s=db.prepare('SELECT * FROM participant_sessions WHERE id=?').get(params.id);if(!s)throw httpError(404,'Sesija nerasta.');const answers=b.answers||{};if(Object.keys(answers).length<10)throw httpError(400,'Atsakykite į visus apklausos klausimus.');db.prepare('INSERT INTO quality_surveys(session_id,answers_json,likes,improvements) VALUES(?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET answers_json=excluded.answers_json,likes=excluded.likes,improvements=excluded.improvements,submitted_at=CURRENT_TIMESTAMP').run(s.id,JSON.stringify(answers),text(b.likes),text(b.improvements));return json(res,200,{ok:true});
  }

  throw httpError(404,'API maršrutas nerastas.');
}

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'};
function staticFile(res,pathname){
  let requested=pathname==='/'?'index.html':pathname==='/admin'?'admin.html':pathname.replace(/^\//,'');
  const file=path.resolve(publicDir,requested);if(!file.startsWith(path.resolve(publicDir)+path.sep)&&file!==path.resolve(publicDir,'index.html'))throw httpError(403,'Draudžiama.');
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())throw httpError(404,'Failas nerastas.');
  const data=fs.readFileSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()]||'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-store'});res.end(data);
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),pathname=decodeURIComponent(url.pathname);
    if(pathname.startsWith('/api/')) return await api(req,res,pathname);
    return staticFile(res,pathname);
  }catch(e){
    console.error(e.status>=500||!e.status?e:'');
    if((req.url||'').startsWith('/api/'))return json(res,e.status||500,{error:e.status?e.message:'Serverio klaida.'});
    return sendText(res,e.status||500,e.status?e.message:'Serverio klaida.');
  }
});
server.listen(PORT,'0.0.0.0',()=>{
  console.log(`\nSistema paleista:`);
  console.log(`Dalyvio portalas: http://localhost:${PORT}`);
  console.log(`Tyrėjo portalas:  http://localhost:${PORT}/admin`);
  console.log(`Duomenų bazė:     data/experiment.db`);
  console.log(`\nSustabdyti: Ctrl + C\n`);
});
