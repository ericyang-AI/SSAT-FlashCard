// SSAT Vocab Cards - Core logic (English UI + charts + PWA)
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const KEYS = {
  PROG: 'ssat_prog_v1',
  STATS: 'ssat_stats_v1',
  BOOK: 'ssat_book_v1'
};

let WORDS = [];
let idx = 0, flipped = false;
let progress = {}; // id -> { status, wrong, right, lastSeen, lastType, typeAcc:{syn,cloze,ant} }
let stats = {
  dailyStats: {}, // yyyy-mm-dd -> {attempted, correct, newMastered, spark:[]}
  overall: { mastered: 0, learning: 0, goal: 300, deadline: null },
  typeAcc: { syn: { c: 0, a: 0 }, cloze: { c: 0, a: 0 }, ant: { c: 0, a: 0 } }
};
let bookmarks = new Set();
const today = () => new Date().toISOString().slice(0, 10);

async function init() {
  try { WORDS = await (await fetch('words.json')).json(); } catch { WORDS = []; }
  progress = JSON.parse(localStorage.getItem(KEYS.PROG) || '{}');
  const st = JSON.parse(localStorage.getItem(KEYS.STATS) || 'null');
  if (st) stats = st;
  const b = JSON.parse(localStorage.getItem(KEYS.BOOK) || '[]'); bookmarks = new Set(b);
  recalcCounts();
  bindUI();
  renderCard();
  updateStatus();
  updateDashboard();
  registerSW();
}

/* ---------- UI Bindings ---------- */
function bindUI() {
  // Tabs
  $('#tabCards').onclick = () => show('Cards');
  $('#tabQuiz').onclick = () => { show('Quiz'); newQuestionFor(currentWord()); };
  $('#tabStats').onclick = () => { show('Stats'); updateDashboard(); };
  $('#tabSettings').onclick = () => show('Settings');

  // Cards
  $('#btnFlip').onclick = flip;
  $('#btnPrev').onclick = () => { idx = (idx - 1 + WORDS.length) % WORDS.length; flipped = false; renderCard(); };
  $('#btnNext').onclick = () => { idx = (idx + 1) % WORDS.length; flipped = false; renderCard(); };
  $('#btnIDK').onclick = () => markUnknown(currentWord().id);
  $('#btnBookmark').onclick = () => toggleBookmark(currentWord().id);
  $('#btnStartQuiz').onclick = () => { show('Quiz'); newQuestionFor(currentWord()); };
  $('#vocabCard').onclick = flip;
  document.addEventListener('keydown', e => {
    if (e.key === ' ') { e.preventDefault(); flip(); }
    if (e.key === 'ArrowRight') $('#btnNext').click();
    if (e.key === 'ArrowLeft') $('#btnPrev').click();
  });

  // Quiz
  $('#btnSkip').onclick = () => grade(null, true);
  $('#btnReveal').onclick = reveal();
  $('#btnNextQ').onclick = nextQuestion;
  $('#btnSubmit').onclick = submitInput;

  // Settings/Data
  $('#btnSaveGoal').onclick = saveGoal;
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').addEventListener('change', importData);
  $('#btnReset').onclick = resetAll;
}

function show(name) {
  $$('.view').forEach(v => v.classList.remove('visible'));
  $('#view' + name).classList.add('visible');
  $$('nav button').forEach(b => b.classList.remove('active'));
  $('#tab' + name).classList.add('active');
}

/* ---------- Cards ---------- */
function currentWord() { return WORDS[idx] || { word: '—', pos: '', definitions: [], examples: [] }; }
function renderCard() {
  const w = currentWord();
  $('#cardWord').textContent = w.word || '—';
  $('#cardPos').textContent = w.pos || '';
  $('#cardDefs').innerHTML = (w.definitions || []).map(d => `<div>• ${d}</div>`).join('');
  $('#cardExample').textContent = (w.examples && w.examples[0]) ? w.examples[0] : '';
  const c = $('#vocabCard'); if (flipped) c.classList.add('flipped'); else c.classList.remove('flipped');
}
function flip() { flipped = !flipped; renderCard(); }
function markUnknown(id) {
  progress[id] = progress[id] || { status: 'learning', wrong: 0, right: 0, typeAcc: { syn: { c: 0, a: 0 }, cloze: { c: 0, a: 0 }, ant: { c: 0, a: 0 } } };
  progress[id].status = 'learning';
  progress[id].wrong++;
  progress[id].lastSeen = Date.now();
  saveProgress();
  updateStatus();
}
function toggleBookmark(id) {
  if (bookmarks.has(id)) bookmarks.delete(id); else bookmarks.add(id);
  localStorage.setItem(KEYS.BOOK, JSON.stringify([...bookmarks]));
}

/* ---------- Quiz Engine ---------- */
let q = null;
function newQuestionFor(w) {
  const types = ['syn', 'cloze', 'ant'];
  const last = (progress[w.id] && progress[w.id].lastType) || null;
  let pool = types.filter(t => t !== last); if (pool.length === 0) pool = types;
  const type = pool[Math.floor(Math.random() * pool.length)];
  q = buildQuestion(type, w);
  renderQuestion(q);
}
function nextQuestion() {
  const learningIds = WORDS.filter(w => !progress[w.id] || progress[w.id].status !== 'mastered').map(w => w.id);
  let nextId = learningIds.length ? learningIds[Math.floor(Math.random() * learningIds.length)]
                                  : WORDS[Math.floor(Math.random() * WORDS.length)].id;
  const w = WORDS.find(x => x.id === nextId) || currentWord();
  newQuestionFor(w);
}
function buildQuestion(type, w) {
  const all = WORDS;
  let stem = '', correct = '', choiceText = [];
  if (type === 'syn') {
    stem = `Choose the best synonym for “${w.word}”.`;
    correct = (w.synonyms && w.synonyms[0]) || (w.definitions && w.definitions[0]) || w.word;
    while (choiceText.length < 3) {
      const pick = all[Math.floor(Math.random() * all.length)];
      if (pick.id === w.id) continue;
      const cand = (pick.synonyms && pick.synonyms[0]) || (pick.definitions && pick.definitions[0]);
      if (cand && !choiceText.includes(cand) && cand !== correct) choiceText.push(cand);
    }
    choiceText.push(correct);
  } else if (type === 'ant') {
    stem = `Choose the best antonym for “${w.word}”.`;
    correct = (w.antonyms && w.antonyms[0]) || '—';
    while (choiceText.length < 3) {
      const pick = all[Math.floor(Math.random() * all.length)];
      if (pick.id === w.id) continue;
      const cand = (pick.synonyms && pick.synonyms[0]) || (pick.definitions && pick.definitions[0]);
      if (cand && !choiceText.includes(cand) && cand !== correct) choiceText.push(cand);
    }
    choiceText.push(correct);
  } else { // cloze
    const ex = (w.examples && w.examples[0]) || `I will use the word ${w.word}.`;
    stem = ex.replace(new RegExp(w.word, 'i'), '____');
    correct = w.word;
    while (choiceText.length < 3) {
      const pick = all[Math.floor(Math.random() * all.length)];
      if (pick.id === w.id) continue;
      const cand = pick.word;
      if (cand && !choiceText.includes(cand) && cand !== correct) choiceText.push(cand);
    }
    choiceText.push(correct);
  }
  // shuffle
  for (let i = choiceText.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [choiceText[i], choiceText[j]] = [choiceText[j], choiceText[i]];
  }
  return { type, word: w, stem, choices: choiceText, correct };
}
function renderQuestion(q) {
  $('#quizStem').textContent = q.stem;
  $('#quizFeedback').textContent = '';
  $('#inputArea').style.display = 'none';
  const box = $('#choices'); box.innerHTML = '';
  q.choices.forEach(ch => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.textContent = ch;
    btn.onclick = () => grade(ch, false);
    box.appendChild(btn);
  });
}
function grade(answer, skipped) {
  const tKey = today();
  stats.dailyStats[tKey] = stats.dailyStats[tKey] || { attempted: 0, correct: 0, newMastered: 0, spark: [] };
  stats.dailyStats[tKey].attempted++;
  stats.dailyStats[tKey].spark.push(1);

  const isCorrect = !skipped && answer === q.correct;
  if (isCorrect) stats.dailyStats[tKey].correct++;

  // per-type accuracy
  stats.typeAcc[q.type] = stats.typeAcc[q.type] || { c: 0, a: 0 };
  stats.typeAcc[q.type].a++;
  if (isCorrect) stats.typeAcc[q.type].c++;

  const id = q.word.id;
  progress[id] = progress[id] || { status: 'learning', wrong: 0, right: 0, typeAcc: { syn: { c: 0, a: 0 }, cloze: { c: 0, a: 0 }, ant: { c: 0, a: 0 } } };
  progress[id].lastSeen = Date.now();
  progress[id].lastType = q.type;

  if (isCorrect) {
    const wasLearning = progress[id].status !== 'mastered';
    progress[id].right++;
    progress[id].status = 'mastered';
    if (wasLearning) stats.dailyStats[tKey].newMastered++; // count first time it becomes mastered
  } else if (!skipped) {
    progress[id].wrong++;
    progress[id].status = 'learning';
  }

  saveProgress();
  recalcCounts();
  updateStatus();
  giveFeedback(isCorrect);
}
function giveFeedback(ok) {
  $('#quizFeedback').textContent = ok ? 'Correct! 🎉' : `Not quite. Correct answer: ${q.correct}`;
  $$('#choices .choice').forEach(btn => {
    if (btn.textContent === q.correct) btn.classList.add('correct');
    else btn.classList.add('wrong');
  });
}
function reveal() { return () => { $('#quizFeedback').textContent = `Answer: ${q.correct}`; }; }
function submitInput() {
  const val = ($('#freeInput').value || '').trim();
  grade(val, false);
}

/* ---------- Stats & Charts ---------- */
function recalcCounts() {
  let mastered = 0, learning = 0;
  WORDS.forEach(w => {
    const st = progress[w.id]?.status || 'learning';
    if (st === 'mastered') mastered++; else learning++;
  });
  stats.overall.mastered = mastered;
  stats.overall.learning = learning;
  saveStats();
}
function updateStatus() {
  $('#statLearning').textContent = `Learning: ${stats.overall.learning}`;
  $('#statMastered').textContent = `Mastered: ${stats.overall.mastered}`;
}
function updateDashboard() {
  const t = stats.dailyStats[today()] || { attempted: 0, correct: 0, newMastered: 0, spark: [] };
  // KPI
  $('#kpiAttempts').textContent = t.attempted;
  const acc = t.attempted ? Math.round(100 * t.correct / t.attempted) : 0;
  $('#kpiAccuracy').textContent = acc + '%';
  $('#kpiNewMastered').textContent = t.newMastered;

  // Donut for accuracy
  drawDonut($('#chartDonut'), acc);

  // Sparkline (dummy smooth line based on count — simple visual cue)
  const spark = t.spark.length ? t.spark.map((_, i) => (Math.sin(i / 2) + 1) / 2) : [0];
  drawSpark($('#chartSpark'), spark);

  // Stacked bar for learning vs mastered
  drawStack($('#chartStack'), stats.overall.learning, stats.overall.mastered);

  // 7-day trend (accuracy)
  const keys = [...Object.keys(stats.dailyStats)].sort().slice(-7);
  const series = keys.map(k => {
    const d = stats.dailyStats[k]; return d.attempted ? (100 * d.correct / d.attempted) : 0;
  });
  drawLine($('#chartLine'), series);

  // Goal
  if (stats.overall.goal && stats.overall.goal > 0) {
    const pct = Math.min(100, Math.round(100 * stats.overall.mastered / stats.overall.goal));
    $('#goalProgress').style.width = pct + '%';
    $('#goalLabel').textContent = `Goal: ${stats.overall.mastered} / ${stats.overall.goal}`;
    if (stats.overall.deadline) {
      const remaining = Math.max(1, Math.ceil((new Date(stats.overall.deadline) - new Date()) / 86400000));
      const need = Math.max(0, stats.overall.goal - stats.overall.mastered);
      const daily = Math.ceil(need / remaining);
      $('#goalAdvice').textContent = `Daily target: ${daily}`;
    } else {
      $('#goalAdvice').textContent = `Set a deadline to get a daily target.`;
    }
  } else {
    $('#goalLabel').textContent = `Set a goal in Settings.`;
    $('#goalAdvice').textContent = `—`;
  }

  // Type accuracy bars
  drawBars($('#chartBars'), [
    { label: 'Synonym', acc: accOf(stats.typeAcc.syn) },
    { label: 'Cloze', acc: accOf(stats.typeAcc.cloze) },
    { label: 'Antonym', acc: accOf(stats.typeAcc.ant) },
  ]);

  // Hotlist (top 5 wrong)
  const errs = Object.entries(progress).map(([id, st]) => ({ id, wrong: st.wrong || 0 }))
    .sort((a, b) => b.wrong - a.wrong).slice(0, 5);
  const ol = $('#hotlist'); ol.innerHTML = '';
  errs.forEach(e => {
    const w = WORDS.find(x => x.id === e.id);
    if (!w) return;
    const li = document.createElement('li');
    li.textContent = `${w.word} — wrong ${e.wrong}×`;
    ol.appendChild(li);
  });
}
function accOf(obj) { const a = obj?.a || 0, c = obj?.c || 0; return a ? Math.round(100 * c / a) : 0; }

/* Canvas helpers: pure canvas, no external libs */
function drawDonut(canvas, percent) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 10, thick = 26;
  // background
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.lineWidth = thick; ctx.strokeStyle = '#1e2a3c'; ctx.stroke();
  // arc
  const end = -Math.PI / 2 + Math.PI * 2 * (percent / 100);
  ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, end); ctx.lineWidth = thick; ctx.lineCap = 'round'; ctx.strokeStyle = '#0a84ff'; ctx.stroke();
  // text
  ctx.fillStyle = '#e7ecf3'; ctx.font = 'bold 28px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(percent + '%', cx, cy);
}
function drawSpark(canvas, arr) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (arr.length < 2) arr = [0, 0];
  const max = 1, min = 0, pad = 10;
  ctx.beginPath(); ctx.moveTo(pad, h - pad - (arr[0] - min) / (max - min) * (h - 2 * pad));
  for (let i = 1; i < arr.length; i++) {
    const x = pad + i * (w - 2 * pad) / (arr.length - 1);
    const y = h - pad - (arr[i] - min) / (max - min) * (h - 2 * pad);
    ctx.lineTo(x, y);
  }
  ctx.lineWidth = 2; ctx.strokeStyle = '#34c759'; ctx.stroke();
}
function drawStack(canvas, learning, mastered) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const total = Math.max(1, learning + mastered);
  const lw = Math.round(w * (learning / total));
  ctx.fillStyle = '#5a6ea0'; ctx.fillRect(0, 0, lw, h);
  ctx.fillStyle = '#2ebd85'; ctx.fillRect(lw, 0, w - lw, h);
  ctx.fillStyle = '#e7ecf3'; ctx.font = 'bold 16px system-ui';
  ctx.fillText(`Learning: ${learning}`, 10, 22);
  ctx.fillText(`Mastered: ${mastered}`, w - 10 - ctx.measureText(`Mastered: ${mastered}`).width, 22);
}
function drawLine(canvas, arr) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (arr.length < 2) arr = [0, 0];
  const max = 100, min = 0, pad = 24;
  ctx.strokeStyle = '#1e2a3c'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) { const y = pad + i * (h - 2 * pad) / 5; ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke(); }
  ctx.beginPath();
  arr.forEach((v, i) => {
    const x = pad + i * (w - 2 * pad) / (arr.length - 1);
    const y = h - pad - (v - min) / (max - min) * (h - 2 * pad);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineWidth = 2; ctx.strokeStyle = '#0a84ff'; ctx.stroke();
}
function drawBars(canvas, items) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const barW = Math.min(80, Math.floor((w - 40) / items.length) - 20);
  items.forEach((it, i) => {
    const x = 30 + i * (barW + 30);
    const y = h - 30;
    const bh = Math.round((it.acc / 100) * (h - 60));
    ctx.fillStyle = '#1e2a3c'; ctx.fillRect(x, y - (h - 60), barW, (h - 60));
    ctx.fillStyle = '#0a84ff'; ctx.fillRect(x, y - bh, barW, bh);
    ctx.fillStyle = '#e7ecf3'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(it.label, x + barW / 2, h - 12);
    ctx.fillText(it.acc + '%', x + barW / 2, y - bh - 6);
  });
}

/* ---------- Save/Load ---------- */
function saveProgress() { localStorage.setItem(KEYS.PROG, JSON.stringify(progress)); }
function saveStats() { localStorage.setItem(KEYS.STATS, JSON.stringify(stats)); }

/* ---------- Settings & Data ---------- */
function saveGoal() {
  const g = parseInt($('#inpGoal').value || '0', 10);
  const d = $('#inpDeadline').value || null;
  if (g > 0) { stats.overall.goal = g; }
  stats.overall.deadline = d;
  saveStats(); updateDashboard();
}
function exportData() {
  const data = { progress, stats };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'ssat_progress.json'; a.click();
  URL.revokeObjectURL(url);
}
function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const obj = JSON.parse(reader.result);
      progress = obj.progress || progress;
      stats = obj.stats || stats;
      saveProgress(); saveStats();
      recalcCounts(); updateStatus(); updateDashboard();
      alert('Imported!');
    } catch (err) { alert('Invalid file'); }
  };
  reader.readAsText(file);
}
function resetAll() {
  if (confirm('Reset all data?')) {
    progress = {};
    stats = { dailyStats: {}, overall: { mastered: 0, learning: 0, goal: 300, deadline: null }, typeAcc: { syn: { c: 0, a: 0 }, cloze: { c: 0, a: 0 }, ant: { c: 0, a: 0 } } };
    saveProgress(); saveStats();
    recalcCounts(); updateStatus(); updateDashboard();
  }
}

/* ---------- PWA ---------- */
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch { /* ignore */ }
  }
}

window.addEventListener('load', init);
