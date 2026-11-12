import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { TYPES, PARTS, EXERCISES, FOODS, PRESETS, SPLITS } from './data.js';
import { CAFE, CAFE_NAME } from './menus.js';

/* ================= 기본 ================= */
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const SLOTS = [['breakfast', '아침'], ['lunch', '점심'], ['dinner', '저녁'], ['post', '운동 후'], ['snack', '간식']];
const SLOT_LABEL = Object.fromEntries(SLOTS);
const MAIN_PARTS = ['가슴', '어깨', '등', '팔', '하체'];  // 11-11부터 하체 포함 (코어는 균형 계산에서 제외)
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const START_WEIGHT = 79;
const DEFAULT_SETTINGS = {
  targets: { kcal: 2150, p: 150 }, bar: 10, rest: 90, planStart: '2026-11-05', gymOnly: true,
  usual: {
    breakfast: [{ n: '플레인 베이글', k: 260, p: 10, c: 50, f: 2 }, { n: '크림치즈', k: 100, p: 2, c: 2, f: 10 }],
    post: [{ n: '프로틴 1스쿱', k: 120, p: 24, c: 3, f: 1.5 }],
  },
  customEx: [], customFoods: [],
};

const S = {
  user: null, ready: false, tab: 'home', sel: today(), docs: {}, overlay: null,
  foodSlot: autoSlot(), cart: [], fq: '', fOpen: null, manual: false,
  q: '', part: '전체', guide: null, editHealth: null, timer: null, reportWeek: null,
  authMsg: '', token: null, syncing: false, needsRender: false,
};
const pending = loadJSON('mg_pending', {});

/* ================= 유틸 ================= */
function pad(n) { return String(n).padStart(2, '0'); }
function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return dstr(new Date()); }
function parseD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); }
function diffDays(a, b) { return Math.round((parseD(a) - parseD(b)) / 864e5); }
function weekStart(s) { const d = parseD(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dstr(d); }
function fmtDate(s) { const d = parseD(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`; }
function md(s) { const d = parseD(s); return `${d.getMonth() + 1}/${d.getDate()}`; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(v) { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; }
function r1(n) { return Math.round(n * 10) / 10; }
function r0(n) { return Math.round(n); }
function r2(n) { return Math.round(n * 100) / 100; }
function uid() { return Math.random().toString(36).slice(2, 9); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } }
function autoSlot() { const h = new Date().getHours(); return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'post'; }
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); }
const $app = () => document.getElementById('app');

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function choOf(ch) { const c = ch.charCodeAt(0) - 0xAC00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch.toLowerCase(); }
// 검색: 초성/부분일치/별칭. {score, hl:Set} 또는 null
function match(name, extra, q) {
  q = q.trim().toLowerCase(); if (!q) return { score: 0, hl: new Set() };
  const chars = [...name]; const idx = []; chars.forEach((ch, i) => { if (ch !== ' ') idx.push(i); });
  const qs = q.replace(/\s/g, '');
  if (/^[ㄱ-ㅎ]+$/.test(qs)) {
    const cs = idx.map(i => choOf(chars[i])).join(''); const p = cs.indexOf(qs);
    if (p >= 0) return { score: 100 - p, hl: new Set(idx.slice(p, p + qs.length)) };
    const ex = [...(extra || '')].map(choOf).join('').replace(/\s/g, '');
    return ex.includes(qs) ? { score: 10, hl: new Set() } : null;
  }
  const flat = idx.map(i => chars[i]).join('').toLowerCase(); const p = flat.indexOf(qs);
  if (p >= 0) return { score: 200 - p, hl: new Set(idx.slice(p, p + qs.length)) };
  return (extra || '').toLowerCase().includes(q) ? { score: 20, hl: new Set() } : null;
}
function hlName(name, hl) { return [...name].map((ch, i) => hl.has(i) ? `<b class="hl">${esc(ch)}</b>` : esc(ch)).join(''); }

/* ================= 데이터 ================= */
const settings = () => Object.assign(clone(DEFAULT_SETTINGS), S.docs.settings || {});
const getDay = d => S.docs['day:' + d] || { meals: [], ex: [], cardio: [] };
const getHealth = d => S.docs['health:' + d] || {};
function allExercises() { return EXERCISES.concat((settings().customEx || []).map(e => Object.assign({ gym: true, reps: '8-12', g: null }, e))); }
function exInfo(name) { return allExercises().find(e => e.name === name) || { name, part: '기타', type: 'dumbbell', reps: '8-12' }; }

function setDoc(key, data) {
  S.docs[key] = data; pending[key] = data; saveJSON('mg_pending', pending); saveJSON('mg_cache', S.docs); flush();
}
function mutateDay(d, fn) { const x = clone(getDay(d)); x.meals ||= []; x.ex ||= []; x.cardio ||= []; fn(x); setDoc('day:' + d, x); render(); }
function mutateSettings(fn) { const s = settings(); fn(s); setDoc('settings', s); render(); }
let flushing = false;
async function flush() {
  if (flushing || !S.user) return; flushing = true; setSync('saving');
  try {
    for (const key of Object.keys(pending)) {
      const data = pending[key];
      const { error } = await sb.from('docs').upsert({ user_id: S.user.id, key, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' });
      if (error) throw error;
      if (pending[key] === data) delete pending[key];
      saveJSON('mg_pending', pending);
    }
    setSync('ok');
  } catch (e) { console.warn(e); setSync('err'); setTimeout(() => { flushing = false; flush(); }, 8000); return; }
  flushing = false; if (Object.keys(pending).length) flush();
}
async function loadDocs() {
  const { data, error } = await sb.from('docs').select('key,data').limit(5000);
  if (error) { setSync('err'); return; }
  const next = {}; data.forEach(r => next[r.key] = r.data);
  Object.keys(pending).forEach(k => next[k] = pending[k]);
  S.docs = next; saveJSON('mg_cache', S.docs); setSync(Object.keys(pending).length ? 'saving' : 'ok'); requestRender();
}
const SC_NAME = '건강 데이터 서버 동기화';
function setSync(s) { S.syncing = s; const el = document.getElementById('syncdot'); if (el) el.className = 'syncdot ' + s; }
window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.user) { loadDocs(); flush();
  if (S.scWait && Date.now() - S.scWait < 10 * 60e3) { [2500, 6000].forEach(t => setTimeout(loadDocs, t)); setTimeout(() => { S.scWait = null; requestRender(); }, 6500); } } });

/* ================= 계산 ================= */
function sumMeals(day) { const t = { k: 0, p: 0, c: 0, f: 0 }; (day.meals || []).forEach(m => { t.k += +m.k || 0; t.p += +m.p || 0; t.c += +m.c || 0; t.f += +m.f || 0; }); return t; }
function weightOn(d) { return num(getHealth(d).weight); }
function fatOn(d) { return num(getHealth(d).fat); }
function latestFat(upto) { for (let i = 0; i < 30; i++) { const d = addDays(upto, -i); const f = fatOn(d); if (f != null) return { f, d }; } return null; }
function avgWeight(end, days = 7) { const ws = []; for (let i = 0; i < days; i++) { const w = weightOn(addDays(end, -i)); if (w != null) ws.push(w); } return ws.length ? ws.reduce((a, b) => a + b) / ws.length : null; }
function latestWeight(upto) { for (let i = 0; i < 30; i++) { const d = addDays(upto, -i); const w = weightOn(d); if (w != null) return { w, d }; } return null; }
function setsDone(e) { return (e.sets || []).filter(s => s.done || (s.done === undefined && num(s.r))); }
function weekParts(ws) {
  const out = Object.fromEntries(PARTS.map(p => [p, 0]));
  for (let i = 0; i < 7; i++) { (getDay(addDays(ws, i)).ex || []).forEach(e => { const p = exInfo(e.name).part; if (p in out) out[p] += setsDone(e).length; }); }
  return out;
}
function sessions() {
  const out = [];
  Object.keys(S.docs).forEach(k => { if (k.startsWith('day:')) { const d = S.docs[k]; if ((d.ex || []).length) out.push({ date: k.slice(4), ex: d.ex }); } });
  const h = S.docs.history2024; if (h && h.sessions) h.sessions.forEach(s => out.push({ date: s.date, ex: s.ex, old: true }));
  return out.sort((a, b) => a.date < b.date ? 1 : -1);
}
function lastSession(name, before) {
  for (const s of sessions()) { if (s.date >= before) continue; const e = s.ex.find(x => x.name === name); if (e) { const sets = setsDone(e); if (sets.length) return { date: s.date, sets, old: s.old }; } }
  return null;
}
function repRange(name) { const m = String(exInfo(name).reps || '8-12').match(/(\d+)\D+(\d+)/); return m ? [+m[1], +m[2]] : [8, 12]; }
// 다음 세트 추천 {w, r, text, up}
function suggest(name, before) {
  const info = exInfo(name), type = info.type, [lo, hi] = repRange(name), last = lastSession(name, before);
  if (!last || last.old) return { w: null, r: hi >= lo ? lo : null, text: last ? '2024 기록 있음 · 가볍게 시작' : '첫 기록 · 여유 있는 무게로 시작', up: false };
  const sets = last.sets, maxR = Math.max(...sets.map(s => +s.r || 0));
  if (type === 'body') return { w: null, r: maxR, text: `지난번 최고 ${maxR}회 → ${maxR + 1}회 도전`, up: true };
  if (type === 'time') return { w: null, r: maxR, text: `지난번 ${maxR}초 → ${maxR + 5}초 도전`, up: true };
  const top = Math.max(...sets.map(s => +s.w || 0)); const topSets = sets.filter(s => (+s.w || 0) === top);
  const allHit = topSets.length >= Math.min(3, sets.length) && topSets.every(s => (+s.r || 0) >= hi);
  if (type === 'assist') {
    const low = Math.min(...sets.map(s => +s.w || 0)); const lowAll = sets.filter(s => (+s.w || 0) === low).every(s => (+s.r || 0) >= hi);
    return lowAll ? { w: Math.max(0, low - 5), r: lo, text: `지난번 모두 ${hi}회 → 보조 −5kg 추천`, up: true } : { w: low, r: hi, text: `보조 ${low}kg 유지 · 반복 수 늘리기`, up: false };
  }
  if (allHit) { const inc = type === 'dumbbell' ? 1 : type === 'barbell' || type === 'machine' || type === 'cable' ? 5 : 2.5; return { w: top + inc, r: lo, text: `지난번 모두 ${hi}회 달성 → ${fmtW(type, top + inc, barOf(info))} 추천`, up: true }; }
  return { w: top, r: hi, text: `${fmtW(type, top, barOf(info))} 유지 · 모든 세트 ${hi}회 목표`, up: false };
}
function barOf(info) { return info && info.bar != null ? info.bar : settings().bar; }
function fmtW(type, w, bar = settings().bar) { if (w == null) return ''; if (type === 'barbell') return `${r1(w)}kg(한쪽 ${r2((w - bar) / 2)})`; if (type === 'assist') return `보조 ${r1(w)}kg`; return `${r1(w)}kg`; }
function fmtSet(type, s) { const w = +s.w || 0; if (type === 'body' || (!w && type !== 'assist')) return `${s.r ?? '-'}${type === 'time' ? '초' : '회'}`; return `${type === 'assist' ? '보조 ' : ''}${r1(w)}×${s.r ?? '-'}`; }

/* ================= 렌더 ================= */
const ICON = {
  play: '<path d="M7 4.5v15l12-7.5z"/>', pause: '<path d="M8 5v14M16 5v14"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  gym: '<path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/>',
  food: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M9 7.5c0-1.5 1-2 1-3.5M14 7.5c0-1.5 1-2 1-3.5"/>',
  chart: '<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>',
  gear: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const ic = (n, s = 20, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

function requestRender() { const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $app().contains(a)) { S.needsRender = true; return; } render(); }
document.addEventListener('focusout', () => setTimeout(() => { if (S.needsRender) { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { S.needsRender = false; render(); } } }, 400)); // 탭(클릭)이 끝난 뒤에 다시 그리도록 여유

function render() {
  S.needsRender = false;
  if (!S.ready) { $app().innerHTML = `<div class="center muted">불러오는 중…</div>`; return; }
  if (!S.user) { $app().innerHTML = vAuth(); return; }
  const scrollY = window.scrollY;
  let body = '';
  if (S.overlay === 'search') body = vSearch();
  else if (S.overlay === 'settings') body = vSettings();
  else body = ({ home: vHome, gym: vGym, food: vFood, report: vReport })[S.tab]() + vNav();
  const sb = !S.overlay && S.tab === 'gym' ? vSessBar(S.sel) : '';
  body += sb + vTimer() + vGuide();
  $app().innerHTML = body; document.body.classList.toggle('hastimer', !!S.timer); document.body.classList.toggle('hassess', !!sb);
  if (S._keepScroll) window.scrollTo(0, scrollY); S._keepScroll = false;
  lockScroll(!!S.guide);
}
// 바텀시트가 열려 있는 동안 바닥 페이지 스크롤 잠금 (iOS는 overflow:hidden만으로는 안 막혀서 body를 고정)
function lockScroll(on) {
  const b = document.body, locked = b.classList.contains('locked');
  if (on && !locked) { S._lockY = window.scrollY; b.style.top = `-${S._lockY}px`; b.classList.add('locked'); }
  else if (!on && locked) { b.classList.remove('locked'); b.style.top = ''; window.scrollTo(0, S._lockY || 0); }
}
function vNav() {
  const t = [['home', '홈', 'home'], ['gym', '운동', 'gym'], ['food', '식단', 'food'], ['report', '리포트', 'chart']];
  return `<nav class="tabbar">${t.map(([k, l, i]) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${ic(i, 22)}<span>${l}</span></button>`).join('')}</nav>`;
}
function dateBar() {
  const isT = S.sel === today();
  return `<div class="datebar"><button class="iconbtn" data-act="dprev" aria-label="이전 날">${ic('left', 18, 2.4)}</button>
    <button class="datechip" data-act="dtoday">${isT ? '오늘' : md(S.sel) + ' (' + DOW[parseD(S.sel).getDay()] + ')'}</button>
    <button class="iconbtn" data-act="dnext" aria-label="다음 날" ${isT ? 'disabled' : ''}>${ic('right', 18, 2.4)}</button></div>`;
}
function dayN(d) { const n = diffDays(d, settings().planStart) + 1; return n >= 1 && n <= 100 ? `Day ${n}/100` : n > 100 ? '100일 완료' : `D-${1 - n}`; }

/* ---------- 로그인 ---------- */
function vAuth() {
  return `<div class="auth"><div class="brand">Miracle GYM</div><p class="muted">기록을 아이폰과 맥북에서 함께 쓰려면 로그인하세요.</p>
  <form id="authForm" class="card col">
    <label class="field"><span>이메일</span><input name="email" type="email" autocomplete="email" required></label>
    <label class="field"><span>비밀번호 (6자 이상)</span><input name="password" type="password" autocomplete="current-password" minlength="6" required></label>
    ${S.authMsg ? `<div class="warn">${esc(S.authMsg)}</div>` : ''}
    <button class="btn pri" type="submit" data-mode="in">로그인</button>
    <button class="btn" type="submit" data-mode="up">처음이면 가입</button>
  </form></div>`;
}

/* ---------- 홈 ---------- */
function vHome() {
  const d = S.sel, day = getDay(d), h = getHealth(d), st = settings(), t = sumMeals(day);
  const lw = latestWeight(d), avg = avgWeight(d);
  const pPct = Math.min(100, t.p / st.targets.p * 100), remP = st.targets.p - t.p;
  const ws = weekStart(d), parts = weekParts(ws), upper = MAIN_PARTS, maxSet = Math.max(1, ...upper.map(p => parts[p]));
  const weakest = upper.slice().sort((a, b) => parts[a] - parts[b])[0];
  const yday = getDay(addDays(d, -1));
  const rows = SLOTS.filter(([k]) => k !== 'snack' || (day.meals || []).some(m => m.slot === 'snack')).map(([k, l]) => {
    const items = (day.meals || []).filter(m => m.slot === k), s = items.reduce((a, m) => (a.k += +m.k || 0, a.p += +m.p || 0, a), { k: 0, p: 0 });
    const usual = (st.usual || {})[k], yItems = (yday.meals || []).filter(m => m.slot === k);
    return `<div class="mrow">
      ${items.length ? `<span class="dot done">${ic('check', 14, 3)}</span>` : `<span class="dot empty"></span>`}
      <button class="mtext" data-act="openFood" data-v="${k}"><b>${l}</b><span class="${items.length ? 'muted' : 'warnt'}">${items.length ? esc(items.map(m => m.n).join(' + ')).slice(0, 40) + ` · ${r0(s.k)}kcal · P${r0(s.p)}` : '아직 기록 전'}</span></button>
      ${!items.length && usual && usual.length ? `<button class="chipbtn acc" data-act="usual" data-v="${k}">평소대로</button>` : ''}
      ${!items.length && !(usual && usual.length) && yItems.length ? `<button class="chipbtn" data-act="yday" data-v="${k}">어제와 같음</button>` : ''}
      <button class="iconbtn sm" data-act="openFood" data-v="${k}" aria-label="${l} 기록">${ic('plus', 16, 2.4)}</button></div>`;
  }).join('');
  const editW = S.editHealth === 'weight', editS = S.editHealth === 'steps';
  return `<div class="page">
  <header class="hdr"><div><div class="brandsm">Miracle GYM</div><div class="muted sm">${fmtDate(d)} · ${dayN(d)}</div></div>
    <div class="row">${dateBar()}<button class="iconbtn" data-act="openSettings" aria-label="설정">${ic('gear')}</button><span id="syncdot" class="syncdot ${S.syncing || ''}"></span></div></header>
  <div class="grid2">
    <div class="card tap" ${editW ? '' : 'data-act="editHealth" data-v="weight"'}>
      <div class="muted sm">체중${h.weight != null ? (h.src === 'shortcut' ? ' · 자동' : ' · 직접') : (lw ? ` · ${md(lw.d)} 기록` : '')}</div>
      ${editW ? `<input class="bignum" id="hIn" type="number" inputmode="decimal" step="0.05" value="${h.weight ?? ''}" placeholder="${lw ? r1(lw.w) : '77.0'}" data-health="weight">`
      : `<div class="big">${h.weight != null ? r1(h.weight) : (lw ? `<span class="muted">${r1(lw.w)}</span>` : '<span class="muted">–</span>')}<small> kg</small></div>`}
      <div class="sm acc b">${avg != null ? `7일 평균 ${r1(avg)} · 시작 대비 ${r1(avg - START_WEIGHT) > 0 ? '+' : ''}${r1(avg - START_WEIGHT)}` : (lw ? `최근 ${md(lw.d)} ${r1(lw.w)}kg` : '탭해서 입력')}</div>
    </div>
    <div class="card tap" ${editS ? '' : 'data-act="editHealth" data-v="steps"'}>
      <div class="muted sm">걸음${h.steps != null ? (h.src === 'shortcut' ? ' · 자동' : ' · 직접') : ''}</div>
      ${editS ? `<input class="bignum" id="hIn" type="number" inputmode="numeric" value="${h.steps ?? ''}" placeholder="8000" data-health="steps">`
      : `<div class="big">${h.steps != null ? Number(h.steps).toLocaleString() : '<span class="muted">–</span>'}</div>`}
      <div class="bar"><i style="width:${Math.min(100, (h.steps || 0) / 80)}%"></i></div>
    </div>
  </div>
  ${(() => { const editF = S.editHealth === 'fat', lf = latestFat(d), pf = lf && latestFat(addDays(lf.d, -7)); return `<div class="card tap row between" ${editF ? '' : 'data-act="editHealth" data-v="fat"'}>
    <span class="muted sm">체지방률${h.fat != null ? (h.src === 'shortcut' ? ' · 자동' : ' · 직접') : (lf ? ` · ${md(lf.d)} 기록` : '')}</span>
    ${editF ? `<input class="bignum" id="hIn" type="number" inputmode="decimal" step="0.1" value="${h.fat ?? ''}" placeholder="${lf ? r1(lf.f) : '24.4'}" data-health="fat" style="max-width:120px">`
    : `<span class="row g6"><b class="lg">${lf ? `<span class="${h.fat != null ? '' : 'muted'}">${r1(lf.f)}</span>` : '<span class="muted">–</span>'}<small class="muted"> %</small></b>${lf && pf && pf.d !== lf.d ? `<span class="sm b ${lf.f <= pf.f ? 'acc' : 'warnt'}">${lf.f - pf.f > 0 ? '+' : ''}${r1(lf.f - pf.f)}%p</span>` : ''}<span class="muted sm">표준 17~22</span></span>`}
  </div>`; })()}
  ${d === today() ? `<button class="card tap row between syncbtn" data-act="runShortcut"><span class="row g6">${ic('sync', 18, 2.2)}<span class="col"><b>아이폰 건강 데이터 불러오기</b><span class="muted sm">${S.scWait ? '단축어 실행 후 돌아오면 반영돼요' : '체중 · 걸음 · 체지방을 지금 바로 반영'}</span></span></span>${ic('right', 18, 2.2)}</button>` : ''}
  <div class="card col">
    <div class="between"><b>단백질</b><span class="muted sm">열량 ${r0(t.k).toLocaleString()} / ${st.targets.kcal.toLocaleString()}</span></div>
    <div class="huge">${r0(t.p)}<small> / ${st.targets.p}g</small></div>
    <div class="bar lg"><i class="blue" style="width:${pPct}%"></i></div>
    <div class="sm">${remP > 0 ? `${r0(remP)}g 남음${!(day.meals || []).some(m => m.slot === 'post') ? ` · 운동 후 프로틴 1스쿱이면 ${Math.max(0, r0(remP - 24))}g 남아요` : ''}` : '오늘 단백질 목표 달성'}</div>
  </div>
  <div class="card list">${rows}</div>
  <div class="card dark col">
    <div class="between"><b>이번 주 부위별 세트</b><span class="sm soft">부족: ${weakest}</span></div>
    <div class="grid5 sm">${upper.map(p => `<div class="col g4"><span>${p} ${parts[p]}</span><div class="mini"><i class="${p === weakest ? 'warnbg' : ''}" style="width:${Math.max(4, parts[p] / maxSet * 100)}%"></i></div></div>`).join('')}</div>
    <button class="btn go" data-act="tab" data-v="gym">운동 시작</button>
  </div>
  </div>`;
}

/* ---------- 운동 세션 타이머 (자동 시작 · 일시정지 · 종료) ---------- */
function fmtDur(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; }
function sess(d) {
  const day = getDay(d), ts = (day.ex || []).flatMap(e => (e.sets || []).filter(s => s.t).map(s => s.t));
  const tm = day.timer || {}, start = tm.start || (ts.length ? Math.min(...ts) : null);
  if (!start) return null;
  const end = tm.end || (d < today() ? Math.max(...ts, start) : null), pa = tm.pa || null, pt = tm.pt || 0;
  const state = end ? 'done' : pa ? 'paused' : 'run';
  return { start, end, pa, pt, state, sec: ((end || pa || Date.now()) - start - pt) / 1000 };
}
function sessUpdate(fn) { const now = Date.now(), d = today(), s0 = sess(d); if (!s0) return; mutateDay(d, x => { x.timer = { start: s0.start, pt: s0.pt, pa: s0.pa, end: s0.end }; fn(x.timer, now); }); }
function vSessBar(d) {
  const s = d === today() && sess(d); if (!s || s.state === 'done') return '';
  return `<div class="sessbar"><button class="btn" data-act="sessPause">${s.state === 'paused' ? `${ic('play', 16, 2.4)} 계속하기` : `${ic('pause', 16, 2.4)} 일시정지`}</button><button class="btn pri" data-act="sessEnd">${ic('stop', 16, 2.4)} 운동 종료</button></div>`;
}
/* ---------- 3분할 순환 ---------- */
function splitOfEx(exs) {
  const cnt = {}; (exs || []).forEach(e => { const n = setsDone(e).length || (e.sets || []).length; const p = exInfo(e.name).part; cnt[p] = (cnt[p] || 0) + n; });
  let best = null; SPLITS.forEach(sp => { if ((cnt[sp.part] || 0) > 0 && (!best || cnt[sp.part] > cnt[best.part])) best = sp; });
  return best;
}
function splitState(d) {
  const todaySp = splitOfEx(getDay(d).ex);
  let last = null;
  for (const s of sessions()) { if (s.old || s.date >= d) continue; const sp = splitOfEx(s.ex.filter(e => setsDone(e).length)); if (sp && (!last || s.date > last.date)) last = { date: s.date, sp }; }
  const next = last ? SPLITS[(SPLITS.indexOf(last.sp) + 1) % SPLITS.length] : SPLITS[0];
  return { todaySp, last, next };
}
function vSplit(d) {
  const { last, next } = splitState(d);
  return `<div class="card col">
    <div class="between"><b>오늘은 ${next.name} 차례</b><span class="muted sm">${last ? `지난번 ${md(last.date)} ${last.sp.name}` : '3분할 시작'}</span></div>
    <span class="sm">${next.name} ${next.sub}</span>
    <span class="muted sm">${next.ex.join(' · ')}</span>
    <button class="btn pri" data-act="loadSplit" data-v="${next.id}">${next.name} 루틴 불러오기</button>
    <div class="row g6 sm"><span class="muted">다른 날로:</span>${SPLITS.filter(x => x !== next).map(x => `<button class="chipbtn" data-act="loadSplit" data-v="${x.id}">${x.name}</button>`).join('')}</div>
  </div>`;
}
function loadSplit(id) {
  const sp = SPLITS.find(x => x.id === id); if (!sp) return;
  const have = new Set((getDay(S.sel).ex || []).map(e => e.name)), add = sp.ex.filter(n => !have.has(n));
  mutateDay(S.sel, d => add.forEach(name => { const last = lastSession(name, S.sel), sg = suggest(name, S.sel), n = last && !last.old ? Math.max(3, last.sets.length) : 3; d.ex.push({ name, sets: [...Array(n)].map(() => ({ w: sg.w, r: null })) }); }));
  render(); toast(`${sp.name} 루틴 ${add.length}종목 불러옴`);
}
/* ---------- 운동 ---------- */
function vGym() {
  const d = S.sel, day = getDay(d), ex = day.ex || [];
  const ss = sess(d);
  return `<div class="page">
  <header class="hdr"><div><div class="muted sm">${fmtDate(d)} · ${dayN(d)}</div><h1>${ss ? `${({ run: '운동 중', paused: '일시정지', done: '운동 완료' })[ss.state]} <span class="tnum" id="elapsed" data-start="${ss.start}" data-pt="${ss.pt}" data-state="${ss.state}">${fmtDur(ss.sec)}</span>` : '운동'}</h1></div>${dateBar()}</header>
  ${ss && ss.state === 'done' && d === today() ? `<div class="row g6 sm"><span class="muted">운동을 마쳤습니다.</span><button class="chipbtn" data-act="sessResume">이어서 하기</button></div>` : ''}
  ${ex.length ? '' : vSplit(d)}
  ${ex.length ? '' : `<div class="card col"><b>직접 고르려면</b><span class="muted sm">이번 주 부족한 부위: ${(() => { const p = weekParts(weekStart(d)); return MAIN_PARTS.slice().sort((a, b) => p[a] - p[b])[0]; })()}</span></div>`}
  ${ex.map((e, i) => exCard(e, i, d)).join('')}
  <button class="dashed" data-act="openSearch">${ic('search', 18, 2.2)} 종목 검색해서 추가</button>
  ${ex.length ? `<div class="row g6 sm wrap"><span class="muted">루틴에서 빠진 종목 더하기:</span>${SPLITS.map(x => `<button class="chipbtn" data-act="loadSplit" data-v="${x.id}">${x.name}</button>`).join('')}</div>` : ''}
  <div class="card col">
    <b>유산소</b>
    ${(day.cardio || []).map((c, i) => `<div class="between"><span>${esc(c.type)} ${c.min || 0}분${c.km ? ' · ' + c.km + 'km' : ''}</span><button class="iconbtn sm" data-act="cardioDel" data-v="${i}" aria-label="삭제">${ic('trash', 16)}</button></div>`).join('')}
    <div class="row g6"><select id="cType" aria-label="유산소 종류">${['러닝', '걷기', '인터벌', '사이클'].map(x => `<option>${x}</option>`).join('')}</select>
      <input id="cMin" type="number" inputmode="decimal" placeholder="분" aria-label="시간(분)"><input id="cKm" type="number" inputmode="decimal" step="0.1" placeholder="km" aria-label="거리(km)">
      <button class="btn pri sm" data-act="cardioAdd">추가</button></div>
  </div>
  <div style="height:${S.timer ? 150 : 20}px"></div></div>`;
}
function exCard(e, i, d) {
  const info = exInfo(e.name), T = TYPES[info.type] || TYPES.dumbbell, last = lastSession(e.name, d), sg = suggest(e.name, d), bar = barOf(info);
  const doneN = (e.sets || []).filter(s => s.done).length;
  const rows = (e.sets || []).map((s, j) => {
    const prev = last && last.sets[j] ? fmtSet(info.type, last.sets[j]) : '-';
    const shown = info.type === 'barbell' ? (s.w != null ? r2((s.w - bar) / 2) : '') : (s.w ?? '');
    const phW = info.type === 'barbell' ? (sg.w != null ? r2((sg.w - bar) / 2) : '') : (sg.w ?? '');
    return `<div class="setrow ${s.done ? 'done' : ''}">
      <span class="sn">${j + 1}</span><span class="prev">${prev}</span>
      ${T.input ? `<label class="cell"><input type="number" inputmode="decimal" step="0.25" value="${shown}" placeholder="${phW}" data-set="${i}:${j}:w" aria-label="${j + 1}세트 ${T.input} kg">${info.type === 'barbell' ? `<small data-sum="${i}:${j}">${s.w != null ? '합 ' + r1(s.w) : ''}</small>` : ''}</label>` : `<span class="cell na">–</span>`}
      <label class="cell"><input type="number" inputmode="numeric" value="${s.r ?? ''}" placeholder="${sg.r ?? ''}" data-set="${i}:${j}:r" aria-label="${j + 1}세트 ${info.type === 'time' ? '초' : '회'}"></label>
      <button class="chk ${s.done ? 'on' : ''}" data-act="setDone" data-v="${i}:${j}" aria-label="${j + 1}세트 완료">${ic('check', 18, 3)}</button></div>`;
  }).join('');
  return `<div class="card excard">
    <div class="between"><div class="col"><b class="lg">${esc(e.name)}</b><span class="muted sm">${T.label} · ${T.hint}${info.type === 'barbell' ? ` (${bar}kg)` : ''}</span></div>
      <div class="row g4"><span class="pill">${doneN} / ${(e.sets || []).length}</span><button class="iconbtn sm round acc" data-act="guide" data-v="${esc(e.name)}" aria-label="${esc(e.name)} 자세 보기">${ic('info', 18)}</button></div></div>
    <div class="sethead"><span>세트</span><span>지난번</span><span>${T.input || ''}${T.input ? ' kg' : ''}</span><span>${info.type === 'time' ? '초' : '회'}</span><span></span></div>
    ${rows}
    <div class="between"><span class="sm ${sg.up ? 'acc b' : 'muted'}">${esc(sg.text)}</span>
      <div class="row g4"><button class="iconbtn sm" data-act="setDel" data-v="${i}" aria-label="세트 빼기">${ic('minus', 16, 2.4)}</button><button class="iconbtn sm" data-act="setAdd" data-v="${i}" aria-label="세트 추가">${ic('plus', 16, 2.4)}</button><button class="iconbtn sm" data-act="exDel" data-v="${i}" aria-label="종목 삭제">${ic('trash', 16)}</button></div></div>
  </div>`;
}

/* ---------- 종목 검색 ---------- */
function vSearch() {
  const st = settings(), q = S.q, gymOnly = st.gymOnly !== false;
  let list = allExercises().filter(e => (S.part === '전체' || e.part === S.part) && (!gymOnly || e.gym));
  let res = list.map(e => ({ e, m: match(e.name, `${e.en || ''} ${e.alias || ''}`, q) })).filter(x => x.m).sort((a, b) => b.m.score - a.m.score);
  const recent = []; sessions().forEach(s => s.ex.forEach(x => { if (!s.old && !recent.includes(x.name)) recent.push(x.name); }));
  const fallback = !q && S.part === '전체';
  return `<div class="page sheet">
  <div class="searchhead">
    <div class="row g6"><button class="iconbtn" data-act="closeOverlay" aria-label="닫기">${ic('left', 22, 2.2)}</button>
      <label class="search">${ic('search', 18, 2.2)}<input id="exQ" value="${esc(q)}" placeholder="초성·한글·영문 (예: ㅂㅊ, 벤치, bench)" autocomplete="off" aria-label="종목 검색"></label></div>
    <div class="chips scroll">${['전체', ...PARTS].map(p => `<button class="chip ${S.part === p ? 'on' : ''}" data-act="part" data-v="${p}">${p}</button>`).join('')}</div>
    <label class="between toggle"><span>우리 단지 헬스장 기구만</span><input type="checkbox" data-act="gymOnly" ${gymOnly ? 'checked' : ''}></label>
  </div>
  <div id="exRes">${fallback && recent.length ? `<div class="sec">최근 한 종목</div><div class="chips">${recent.slice(0, 8).map(n => `<button class="chip" data-act="addEx" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
  <div class="sec">${q ? `검색 결과 ${res.length}` : S.part === '전체' ? '전체 종목' : S.part}</div>
  <div class="list">${res.map(({ e, m }) => { const ls = lastSession(e.name, today()); return `<button class="lrow" data-act="addEx" data-v="${esc(e.name)}">
      ${e.img ? `<img src="img/${e.img}_0.jpg" alt="" loading="lazy">` : `<span class="ph">${ic('gym', 20)}</span>`}
      <span class="col f1"><span>${hlName(e.name, m.hl)}${e.gym ? '' : ' <span class="tag">헬스장에 없음</span>'}</span><span class="muted sm">${e.part} · ${(TYPES[e.type] || {}).label || ''} · ${ls ? `지난번 ${fmtSet(e.type, ls.sets[0])}` : '처음 하는 종목'}</span></span>
      <span class="acc b sm">추가</span></button>`; }).join('') || `<div class="muted pad">검색 결과가 없습니다.</div>`}</div></div>
  <div class="card col">
    <b>찾는 종목이 없나요?</b>
    <div class="row g6"><input id="newExName" placeholder="종목 이름" value="${esc(q && !/^[ㄱ-ㅎ]+$/.test(q) ? q : '')}" aria-label="새 종목 이름">
      <select id="newExPart" aria-label="부위">${PARTS.map(p => `<option>${p}</option>`).join('')}</select></div>
    <div class="row g6"><select id="newExType" aria-label="기구 유형">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      <button class="btn pri" data-act="newEx">새 종목 만들기</button></div>
  </div><div style="height:40px"></div></div>`;
}

/* ---------- 가이드 ---------- */
function vGuide() {
  if (!S.guide) return '';
  const e = exInfo(S.guide), g = e.g, T = TYPES[e.type] || {};
  return `<div class="modal" data-act="closeGuide"><div class="sheetbox" data-stop>
    <div class="between"><b class="lg">${esc(e.name)}</b><button class="iconbtn" data-act="closeGuide" aria-label="닫기">${ic('x', 20)}</button></div>
    ${e.img ? `<div class="imgs"><img src="img/${e.img}_0.jpg" alt="${esc(e.name)} 시작 자세"><img src="img/${e.img}_1.jpg" alt="${esc(e.name)} 끝 자세"></div>` : ''}
    <div class="muted sm">${esc(T.label || '')} · ${esc(T.hint || '')}</div>
    ${g ? `<div class="sec">타깃</div><div>${esc(g[0])}</div>
    <div class="sec">동작</div><ol>${g[1].map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <div class="sec">자주 하는 실수</div><ul>${g[2].map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="sec">대체 종목</div><div>${esc(g[3])}</div>` : '<div class="muted">직접 만든 종목입니다.</div>'}
    <a class="btn" href="https://www.youtube.com/results?search_query=${encodeURIComponent(e.name + ' 자세')}" target="_blank" rel="noopener">▶ 시범 영상 보기</a>
  </div></div>`;
}

/* ---------- 식단 ---------- */
function cafeMenu(d) { return CAFE[d] || []; }
function cafeFood(m) { const [rc, rp, rf] = m.r; return { n: `${m.c} ${m.n}`, k: m.k, p: r1(m.k * rp / 400), c: r1(m.k * rc / 400), f: r1(m.k * rf / 900), a: `${m.s.join(' ')} 구내식당 ${CAFE_NAME}`, u: '1인분(식단표)', cafe: true }; }
function foodPool() {
  const st = settings(), seen = new Set(), out = [];
  cafeMenu(S.sel).forEach(m => { const f = cafeFood(m); seen.add(f.n); out.push(f); });
  (st.customFoods || []).forEach(f => { if (!seen.has(f.n)) { seen.add(f.n); out.push(Object.assign({ u: '1인분', mine: true }, f)); } });
  FOODS.forEach(f => { if (!seen.has(f.n)) { seen.add(f.n); out.push(f); } });
  return out;
}
function recentFoods() {
  const out = [], seen = new Set();
  for (let i = 0; i < 30; i++) (getDay(addDays(today(), -i)).meals || []).forEach(m => { if (!seen.has(m.n)) { seen.add(m.n); out.push(m); } });
  return out.slice(0, 12);
}
/* ---------- 오늘의 총평 (규칙 기반, AI 아님) ---------- */
const TG = { c: 250, f: 60 };  // 탄수·지방 목표 (g)
const FILLERS = [['프로틴 1스쿱', 24, 120], ['닭가슴살 100g', 23, 110], ['그릭요거트 100g', 10, 100], ['삶은 계란 2개', 13, 150], ['두유 1팩', 8, 130]];
const FRIED = /튀김|까스|가스|커틀릿|치킨|가라아게|탕수|깐풍|강정|부침|전병|파전|김치전|버거|피자|감자튀김|크림|마요|나베/;
function fillPlan(gap, kcalRoom) {
  const out = []; let g = gap, room = Math.max(kcalRoom, 150), got = 0;
  for (const [n, p, k] of FILLERS) { if (g <= 5 || out.length >= 3) break; if (k > room && out.length) continue; out.push(n); g -= p; got += p; room -= k; }
  return { items: out, got };
}
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return w + ((c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28) ? a : b); };
function reviewReady(d, day) {
  const has = sl => (day.meals || []).some(m => m.slot === sl);
  if (has('dinner') || has('post')) return true;
  if (d < today()) return (day.meals || []).length > 0;
  return has('lunch') && new Date().getHours() >= 21;
}
function vReview(d) {
  const day = getDay(d), st = settings(), meals = day.meals || [];
  const has = sl => meals.some(m => m.slot === sl);
  if (!reviewReady(d, day)) {
    if (!meals.length) return '';
    const left = [['breakfast', '아침'], ['lunch', '점심'], ['dinner', '저녁']].filter(([k]) => !has(k)).map(([, l]) => l);
    return `<div class="card sm muted">저녁까지 기록하면 여기에 오늘의 총평이 나옵니다${left.length ? ` · 남은 끼니: ${left.join(', ')}` : ''}</div>`;
  }
  const t = sumMeals(day), T = st.targets, isToday = d === today();
  const gapP = r0(T.p - t.p), dK = r0(t.k - T.kcal), room = T.kcal - t.k;
  const slotP = sl => meals.filter(m => m.slot === sl).reduce((a, m) => a + (+m.p || 0), 0);
  const worked = (day.ex || []).some(e => setsDone(e).length) || (day.cardio || []).length > 0;
  const good = [], fix = [];
  // 단백질
  const pr = t.p / T.p;
  if (pr >= 0.9) good.push(`단백질 ${r0(t.p)}g으로 목표의 ${r0(pr * 100)}%를 채웠습니다.`);
  else {
    const { items, got } = fillPlan(gapP, room), w = items.join(' + ');
    const enough = got >= gapP - 8;
    fix.push(`단백질이 ${gapP}g 부족합니다${worked && !has('post') ? ' (운동 후 단백질 기록 없음)' : ''}. ` + (isToday
      ? (enough ? `지금 ${josa(w, '을', '를')} 드시면 채워집니다 (+${got}g).` : `열량 여유가 적으니 ${josa(w, '만', '만')} 더하고(+${got}g), 나머지는 내일 아침에 단백질 하나를 더해 채우세요.`)
      : `이런 날은 ${josa(w, '으로', '로')} 채우면 됩니다 (+${got}g).`));
  }
  // 끼니별 단백질 약점
  const weak = [['breakfast', '아침'], ['lunch', '점심'], ['dinner', '저녁']].filter(([k]) => has(k) && slotP(k) < 20);
  if (weak.length && pr < 0.9) { const [k, l] = weak[0]; fix.push(`${l} 단백질이 ${r0(slotP(k))}g뿐입니다. ${k === 'breakfast' ? '내일 아침엔 그릭요거트나 계란 2개, 단백질 음료 중 하나를 더하세요.' : `${l}엔 고기·생선·두부 반찬을 손바닥 크기만큼 먼저 드세요.`}`); }
  if (!has('dinner') && has('post')) fix.push('저녁 기록이 없습니다. 드셨다면 기록해 주세요. 거르면 운동 에너지와 단백질이 모두 부족해집니다.');
  // 운동 후
  if (worked && !has('post') && pr >= 0.9 && pr < 0.95) fix.push('운동한 날인데 운동 후 단백질 기록이 없습니다. 운동 직후 프로틴 1스쿱(24g)을 고정하세요.');
  // 열량
  if (dK > 250) {
    const top = [...meals].sort((a, b) => b.k - a.k)[0];
    fix.push(`열량이 목표보다 ${dK}kcal 많습니다. 가장 큰 항목은 ${top.n}(${r0(top.k)}kcal)입니다. ${isToday ? '오늘 남은 시간엔 단백질 외 간식은 쉬세요.' : '비슷한 날엔 밥을 ⅔로 줄이세요.'}`);
  } else if (dK < -500) {
    fix.push(`열량이 목표보다 ${-dK}kcal 적습니다. 너무 적게 먹으면 근손실과 다음 날 과식으로 이어지기 쉽습니다. ${isToday ? '자기 전에 그릭요거트나 바나나 정도는 드세요.' : '저녁을 충분히 드세요.'}`);
  } else good.push(`열량 ${r0(t.k).toLocaleString()}kcal로 목표 범위 안입니다.`);
  // 지방·튀김
  if (t.f > TG.f * 1.3) {
    const fr = meals.filter(m => FRIED.test(m.n)).map(m => m.n.replace(/ ×[\d.]+$/, ''));
    fix.push(`지방이 ${r0(t.f)}g으로 목표(${TG.f}g)를 넘었습니다.${fr.length ? ` ${fr.slice(0, 2).join(', ')} 같은 튀김·기름진 메뉴 영향이 큽니다. 다음엔 구이·조림·국 메뉴를 고르세요.` : ''}`);
  }
  // 운동한 날 탄수
  if (worked && t.c < 150) fix.push(`운동한 날인데 탄수화물이 ${r0(t.c)}g으로 적습니다. 저녁에 밥 1공기 정도는 드셔야 다음 운동 기록이 유지됩니다.`);
  const score = (pr >= 0.9 ? 2 : pr >= 0.7 ? 1 : 0) + (Math.abs(dK) <= 250 ? 1 : 0) + (t.f <= TG.f * 1.3 ? 1 : 0);
  const [gl, gc] = score >= 4 ? ['좋음', 'g'] : score >= 2 ? ['보통', 'y'] : ['아쉬움', 'r'];
  const bar = (l, v, tg, u = '') => `<span><small>${l}</small><b>${r0(v).toLocaleString()}</b><small>/ ${tg.toLocaleString()}${u}</small></span>`;
  return `<div class="card col review">
    <div class="between"><b>${isToday ? '오늘의 총평' : `${md(d)} 총평`}</b><span class="grade ${gc}">${gl}</span></div>
    <div class="rstats">${bar('열량', t.k, T.kcal)}${bar('단백질', t.p, T.p, 'g')}${bar('탄수', t.c, TG.c, 'g')}${bar('지방', t.f, TG.f, 'g')}</div>
    ${good.length ? `<div class="sm">✓ ${good.join(' ')}</div>` : ''}
    ${fix.length ? `<ol class="sm rfix">${fix.slice(0, 3).map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '<div class="sm">오늘은 고칠 점이 없습니다. 이대로 유지하세요.</div>'}
  </div>`;
}
function searchFoods(q) {
  const pool = foodPool(), run = qq => pool.map(f => { const m = match(f.n, f.a || '', qq); if (m && f.cafe) m.score += 50; return { f, m }; }).filter(x => x.m).sort((a, b) => b.m.score - a.m.score);
  let res = run(q);
  // 결과가 없으면 뒤에서부터 한 글자씩 줄여 비슷한 음식 찾기 (예: 콩나물국밥 → 콩나물국 → 콩나물)
  for (let qq = q.trim(); !res.length && qq.length > 2;) { qq = qq.slice(0, -1); res = run(qq).map(x => (x.similar = true, x)); }
  return res.slice(0, 25);
}
// 감량 중 근육 유지 기준 추천 1개: 열량 대비 단백질 비중이 가장 높은 메뉴, 같으면 열량이 낮은 쪽
function cafeRecIdx(menu) {
  let best = -1;
  menu.forEach((m, i) => { if (best < 0 || m.r[1] > menu[best].r[1] || (m.r[1] === menu[best].r[1] && m.k < menu[best].k)) best = i; });
  return best;
}
function vCafe(d) {
  const menu = cafeMenu(d), wd = new Date(d + 'T00:00:00').getDay();
  if (!menu.length) return wd === 0 || wd === 6 ? '' : `<div class="muted sm pad">이 날짜의 ${CAFE_NAME} 식단표가 아직 없어요. 아래 대략값이나 검색으로 기록하세요.</div>`;
  const rec = cafeRecIdx(menu);
  return `<div class="sec">구내식당 메뉴 · ${CAFE_NAME}</div>
  <div class="list card">${menu.map((m, i) => { const f = cafeFood(m); return `<button class="lrow" data-act="cafe" data-v="${i}"><span class="col f1"><span><b>${m.c}</b> ${esc(m.n)}${i === rec ? ' <span class="tag rec">추천</span>' : ''}</span><span class="muted sm">${esc(m.s.join(' · '))}</span><span class="sm">${f.k}kcal · 단백질 ${r0(f.p)}g · 탄수 ${r0(f.c)}g</span></span><span class="acc b sm">담기</span></button>`; }).join('')}</div>
  <div class="muted sm">밥이나 반찬을 남겼다면 담은 뒤 −로 양을 줄이세요 (0.5인분 단위). 영양값은 식단표 기준 추정치입니다.</div>`;
}
function vFood() {
  const d = S.sel, day = getDay(d), slot = S.foodSlot, items = (day.meals || []).filter(m => m.slot === slot), st = settings();
  const t = sumMeals(day), cartT = S.cart.reduce((a, c) => (a.k += c.k * c.q, a.p += c.p * c.q, a), { k: 0, p: 0 });
  const res = S.fq ? searchFoods(S.fq) : [];
  return `<div class="page">
  <header class="hdr"><div><div class="muted sm">${fmtDate(d)}</div><h1>식단</h1></div>${dateBar()}</header>
  ${vReview(d)}
  <div class="seg">${SLOTS.map(([k, l]) => `<button class="${slot === k ? 'on' : ''}" data-act="slot" data-v="${k}">${l}</button>`).join('')}</div>
  <div class="card col">
    <div class="between"><b>${SLOT_LABEL[slot]}</b><span class="muted sm">하루 ${r0(t.k)}kcal · 단백질 ${r0(t.p)}/${st.targets.p}g</span></div>
    ${items.map(m => `<div class="between"><span class="col"><span>${esc(m.n)}</span><span class="muted sm">${r0(m.k)}kcal · P${r1(m.p)}</span></span><button class="iconbtn sm" data-act="mealDel" data-v="${m.id}" aria-label="${esc(m.n)} 삭제">${ic('trash', 16)}</button></div>`).join('') || '<span class="muted sm">아직 기록이 없습니다.</span>'}
    ${items.length ? `<button class="linkbtn" data-act="saveUsual">이 끼니를 '평소대로'로 저장</button>` : ''}
  </div>
  <label class="search">${ic('search', 18, 2.2)}<input id="foodQ" value="${esc(S.fq)}" placeholder="음식 검색 (예: 뼈해장, ㄷㅈㅉㄱ)" autocomplete="off" aria-label="음식 검색"></label>
  <div id="foodRes">${S.fq ? `<div class="list card">${res.map(({ f, m, similar }) => `<button class="lrow" data-act="cartAdd" data-v="${esc(f.n)}"><span class="col f1"><span>${hlName(f.n, m.hl)}${f.mine ? ' <span class="tag">내 음식</span>' : ''}${f.cafe ? ' <span class="tag">오늘 구내식당</span>' : ''}</span><span class="muted sm">${esc(f.u || '')} · ${r0(f.k)}kcal · P${r1(f.p)}${similar ? ' · 비슷한 음식' : ''}</span></span><span class="acc b sm">담기</span></button>`).join('') || '<div class="muted pad">결과가 없어요. 아래 "직접 입력"으로 추가하세요.</div>'}</div>` : `
  ${slot === 'lunch' ? vCafe(d) : ''}
  <div class="sec">${slot === 'lunch' && cafeMenu(d).length ? '메뉴판에 없는 구내식당 한 끼' : '구내식당 한 끼'}</div>
  <div class="grid2">${PRESETS.map((p, i) => `<button class="tile" data-act="preset" data-v="${i}"><b>${esc(p.n.replace('구내식당: ', ''))}</b><span class="muted sm">약 ${p.k}kcal · P${p.p}</span></button>`).join('')}</div>
  ${recentFoods().length ? `<div class="sec">최근 먹은 음식</div><div class="chips">${recentFoods().map(m => `<button class="chip" data-act="cartRecent" data-v="${esc(m.n)}">${esc(m.n)}</button>`).join('')}</div>` : ''}`}</div>
  <button class="linkbtn" data-act="toggleManual">${S.manual ? '직접 입력 닫기' : '+ 직접 입력 (영양성분표 보고)'}</button>
  ${S.manual ? `<div class="card col"><input id="mN" placeholder="음식 이름" aria-label="음식 이름"><div class="grid4">${[['mK', 'kcal'], ['mP', '단백질 g'], ['mC', '탄수 g'], ['mF', '지방 g']].map(([id, l]) => `<label class="field"><span>${l}</span><input id="${id}" type="number" inputmode="decimal"></label>`).join('')}</div><button class="btn" data-act="manualAdd">담기 (내 음식에 저장)</button></div>` : ''}
  <div style="height:${S.cart.length ? 170 : 30}px"></div>
  ${S.cart.length ? `<div class="cartbar"><div class="col f1"><b>담은 음식 ${S.cart.length}</b><span class="sm">${r0(cartT.k)}kcal · 단백질 ${r0(cartT.p)}g</span>
      <div class="chips">${S.cart.map((c, i) => `<span class="qty"><span class="qn">${esc(c.n.replace('구내식당: ', ''))}</span><button data-act="qty" data-v="${i}:-0.5" aria-label="${esc(c.n)} 줄이기">−</button>${c.q}<button data-act="qty" data-v="${i}:0.5" aria-label="${esc(c.n)} 늘리기">+</button></span>`).join('')}</div></div>
    <button class="btn pri" data-act="cartSave">${SLOT_LABEL[slot]}에 기록</button></div>` : ''}
  </div>`;
}

/* ---------- 리포트 ---------- */
function vReport() {
  const st = settings(), ws = S.reportWeek || weekStart(today()), we = addDays(ws, 6);
  const dots = [...Array(7)].map((_, i) => { const dd = addDays(ws, i), day = getDay(dd), meals = day.meals || []; if (!meals.length || dd > today()) return { cls: 'none', d: dd }; const pct = sumMeals(day).p / st.targets.p; return { cls: pct >= 1 ? 'g' : pct >= .7 ? 'y' : pct >= .3 ? 'o' : 'r', d: dd }; });
  const hit = dots.filter(x => x.cls === 'g').length, parts = weekParts(ws), maxP = Math.max(1, ...PARTS.map(p => parts[p]));
  const upper = MAIN_PARTS, top = upper.slice().sort((a, b) => parts[b] - parts[a])[0], low = upper.slice().sort((a, b) => parts[a] - parts[b])[0];
  return `<div class="page">
  <header class="hdr"><h1>리포트</h1><div class="row g4"><button class="iconbtn" data-act="wprev" aria-label="이전 주">${ic('left', 16, 2.4)}</button><b class="sm">${md(ws)} – ${md(we)}</b><button class="iconbtn" data-act="wnext" aria-label="다음 주" ${we >= today() ? 'disabled' : ''}>${ic('right', 16, 2.4)}</button></div></header>
  ${vWeightCard()}
  <div class="card col">
    <div class="between"><b>단백질 ${st.targets.p}g 달성</b><span class="muted sm">${hit} / 7일</span></div>
    <div class="grid7">${dots.map(x => `<div class="col cc g4"><span class="pdot ${x.cls}"></span><span class="sm muted">${DOW[parseD(x.d).getDay()]}</span></div>`).join('')}</div>
    <div class="legend sm"><span><i class="pdot s g"></i>달성</span><span><i class="pdot s y"></i>70% 이상</span><span><i class="pdot s o"></i>30~70%</span><span><i class="pdot s r"></i>30% 미만</span><span><i class="pdot s none"></i>미기록</span></div>
  </div>
  <div class="card col">
    <b>부위별 주간 세트</b>
    <div class="partgrid sm">${PARTS.map(p => `<span>${p}</span><div class="mini light"><i class="${p === low && p !== '코어' ? 'warnbg' : ''}" style="width:${Math.max(3, parts[p] / maxP * 100)}%"></i></div><b class="right">${parts[p]}</b>`).join('')}</div>
    ${parts[top] > 0 && parts[low] < parts[top] / 2 ? `<div class="note">${low} 세트가 ${top}의 절반 이하입니다. 다음 운동은 ${low} 종목부터 시작해 보세요.</div>` : ''}
  </div></div>`;
}
/* ---------- 체중 그래프 (애플 건강 앱 방식: 1일·1주·1개월·6개월·1년) ---------- */
const W_RANGES = [['d', '1일'], ['w', '1주'], ['m', '1개월'], ['6m', '6개월'], ['y', '1년']];
const mdw = d => `${md(d)}(${DOW[parseD(d).getDay()]})`;
const avgOf = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
function ymdLong(d) { const t = parseD(d); return `${t.getFullYear()}년 ${t.getMonth() + 1}월 ${t.getDate()}일`; }
function rangeText(a, b) { if (a === b) return ymdLong(a); const A = parseD(a), B = parseD(b); return `${ymdLong(a)}~${A.getFullYear() !== B.getFullYear() ? ymdLong(b) : A.getMonth() !== B.getMonth() ? `${B.getMonth() + 1}월 ${B.getDate()}일` : `${B.getDate()}일`}`; }
// 범위별 점 목록: {w, label(축), tip(선택 시 표시), tick(축 라벨 표시 여부)}
function wSeries(r, end, val = weightOn) {
  const out = [];
  if (r === 'd') { out.push({ w: val(end), label: mdw(end), tip: ymdLong(end), tick: true }); return { pts: out, start: end }; }
  if (r === 'w' || r === 'm') {
    const n = r === 'w' ? 7 : 30, start = addDays(end, -(n - 1));
    for (let i = 0; i < n; i++) { const d = addDays(start, i); out.push({ w: val(d), label: md(d), sub: DOW[parseD(d).getDay()], tip: ymdLong(d), tick: r === 'w' || (n - 1 - i) % 7 === 0 }); }
    return { pts: out, start };
  }
  if (r === '6m') {
    const start = weekStart(addDays(end, -7 * 25));
    for (let k = 0; k < 26; k++) { const ws = addDays(start, 7 * k), days = [...Array(7)].map((_, i) => addDays(ws, i)).filter(d => d <= end); const prev = k ? parseD(addDays(ws, -7)).getMonth() : -1, m = parseD(ws).getMonth();
      out.push({ w: avgOf(days.map(val)), label: `${m + 1}월`, tip: `${md(ws)}~${md(days[days.length - 1])} 주 평균`, tick: m !== prev }); }
    return { pts: out, start };
  }
  const E = parseD(end), first = new Date(E.getFullYear(), E.getMonth() - 11, 1);
  for (let k = 0; k < 12; k++) { const m0 = new Date(first.getFullYear(), first.getMonth() + k, 1), dim = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate(), vals = [];
    for (let i = 1; i <= dim; i++) { const d = `${m0.getFullYear()}-${pad(m0.getMonth() + 1)}-${pad(i)}`; if (d > end) break; vals.push(val(d)); }
    out.push({ w: avgOf(vals), label: `${m0.getMonth() + 1}월`, tip: `${m0.getFullYear()}년 ${m0.getMonth() + 1}월 평균`, tick: true }); }
  return { pts: out, start: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-01` };
}
function vWeightCard() {
  const r = S.wRange || 'w', end = today(), F = S.wMetric === 'fat', val = F ? fatOn : weightOn, U = F ? '%' : 'kg', { pts, start } = wSeries(r, end, val);
  const vals = pts.map(p => p.w), avg = avgOf(vals), lw = latestWeight(end), lf = latestFat(end);
  // 직전 같은 길이 기간과 비교
  let prev = null, cmpLabel = '';
  if (r === 'd') { const y = F ? latestFat(addDays(end, -1)) : latestWeight(addDays(end, -1)); prev = y ? (F ? y.f : y.w) : null; cmpLabel = '직전 기록 대비'; }
  else { const len = Math.round((parseD(end) - parseD(start)) / 864e5) + 1, pe = addDays(start, -1), ps = addDays(pe, -(len - 1)); const pv = []; for (let d = ps; d <= pe; d = addDays(d, 1)) pv.push(val(d)); prev = avgOf(pv); cmpLabel = `이전 ${W_RANGES.find(x => x[0] === r)[1]} 대비`; }
  const sel = S.wSel != null && pts[S.wSel] && pts[S.wSel].w != null ? pts[S.wSel] : null;
  const big = sel ? sel.w : avg, diff = !sel && avg != null && prev != null ? avg - prev : null;
  const what = r === 'd' ? '오늘' : r === '6m' ? '평균 (점 = 주 평균)' : r === 'y' ? '평균 (점 = 월 평균)' : '평균';
  return `<div class="card col wcard">
    <div class="row g6"><button class="chipbtn ${F ? '' : 'on'}" data-act="wMetric" data-v="w">체중</button><button class="chipbtn ${F ? 'on' : ''}" data-act="wMetric" data-v="fat">체지방률</button></div>
    <div class="seg sm">${W_RANGES.map(([k, l]) => `<button class="${k === r ? 'on' : ''}" data-act="wRange" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="col g2">
      <span class="muted sm">${sel ? '선택한 기록' : what}</span>
      <div class="huge">${big != null ? (r === 'd' || sel ? r2(big) : r1(big)) : '–'}<small> ${U}</small></div>
      <span class="muted sm">${sel ? sel.tip : rangeText(start, end)}</span>
    </div>
    ${wChart(pts, r)}
    <div class="wfoot sm">${diff != null ? `<span class="b ${diff <= 0 ? 'acc' : 'warnt'}">${cmpLabel} ${diff > 0 ? '+' : ''}${r1(diff)}${F ? '%p' : 'kg'}</span>` : `<span class="muted">${cmpLabel}: 비교할 기록 없음</span>`}${F ? (lf ? `<span class="muted">표준 22%까지 ${r1(Math.max(0, lf.f - 22))}%p</span>` : '') : (lw ? `<span class="muted">목표 70kg까지 ${r1(Math.max(0, lw.w - 70))}kg</span>` : '')}</div>
    <span class="muted sm">점을 누르면 그날(그 기간) 값이 위에 표시됩니다.</span>
  </div>`;
}
function niceStep(span) { return [0.5, 1, 2, 5, 10].find(s => span / s <= 4) || 10; }
function wChart(pts, r) {
  const ys = pts.map(p => p.w).filter(v => v != null);
  if (!ys.length) return '<div class="muted sm pad">이 기간에는 기록이 없습니다.</div>';
  let mn = Math.min(...ys), mx = Math.max(...ys); if (mx - mn < 1) { mn -= .6; mx += .6; }
  const step = niceStep(mx - mn), lo = Math.floor(mn / step) * step, hi = Math.ceil(mx / step) * step;
  const W = 340, H = 190, L = 4, R = 36, T = 10, B = r === 'w' || r === 'm' ? 34 : 22, n = pts.length;
  const X = i => n === 1 ? (L + W - R) / 2 : L + 8 + i / (n - 1) * (W - R - L - 16), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const grid = []; for (let v = lo; v <= hi + 1e-9; v += step) grid.push(v);
  const line = pts.map((p, i) => p.w != null ? `${X(i).toFixed(1)},${Y(p.w).toFixed(1)}` : null).filter(Boolean);
  return `<svg viewBox="0 0 ${W} ${H}" class="wchart" role="img" aria-label="체중 그래프">
    ${grid.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${W - R + 6}" y="${Y(v) + 4}" class="yl">${step < 1 ? v.toFixed(1) : v}</text>`).join('')}
    ${pts.map((p, i) => p.tick ? `<line x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${H - B}" class="vl"/><text x="${X(i)}" y="${H - B + 14}" class="xl">${p.label}</text>${p.sub ? `<text x="${X(i)}" y="${H - B + 27}" class="xl">(${p.sub})</text>` : ''}` : '').join('')}
    ${line.length > 1 ? `<polyline points="${line.join(' ')}" class="wl"/>` : ''}
    ${pts.map((p, i) => p.w != null ? `<circle cx="${X(i)}" cy="${Y(p.w)}" r="${S.wSel === i ? 6 : 4.5}" class="wp${S.wSel === i ? ' on' : ''}"/><circle cx="${X(i)}" cy="${Y(p.w)}" r="14" fill="transparent" data-act="wPt" data-v="${i}"/>` : '').join('')}
  </svg>`;
}

/* ---------- 설정 ---------- */
function vSettings() {
  const st = settings(), tok = S.token;
  const body = tok ? `{"p_token":"${tok}","p_weight":"[체중 평균]","p_steps":"[걸음 합계]","p_active":"[활동 에너지 합계]"}` : '';
  return `<div class="page sheet">
  <header class="hdr"><div class="row g6"><button class="iconbtn" data-act="closeOverlay" aria-label="닫기">${ic('left', 22, 2.2)}</button><h1>설정</h1></div></header>
  <div class="card col">
    <b>목표와 기본값</b>
    <div class="grid2">
      <label class="field"><span>열량 kcal</span><input type="number" data-setting="targets.kcal" value="${st.targets.kcal}"></label>
      <label class="field"><span>단백질 g</span><input type="number" data-setting="targets.p" value="${st.targets.p}"></label>
      <label class="field"><span>바벨 바 무게 kg</span><input type="number" data-setting="bar" value="${st.bar}"></label>
      <label class="field"><span>휴식 타이머 초</span><input type="number" data-setting="rest" value="${st.rest}"></label>
      <label class="field"><span>100일 시작일</span><input type="date" data-setting="planStart" value="${st.planStart}"></label>
    </div>
  </div>
  <div class="card col">
    <b>아이폰 건강 데이터 자동 수집</b>
    <label class="field"><span>홈 '불러오기' 버튼이 실행할 단축어 이름 (단축어 앱의 이름과 똑같이)</span><input type="text" data-setting-text="scName" value="${esc(st.scName || SC_NAME)}" autocomplete="off"></label>
    <span class="sm muted">단축어 앱에서 아래 순서로 한 번만 만들어 두면, 매일 자동으로 체중·걸음이 들어옵니다.</span>
    ${tok ? `<ol class="sm guide">
      <li>단축어 → <b>+</b> → 이름 <code>Miracle GYM 보내기</code></li>
      <li><b>건강 샘플 찾기</b>: 체중, 시작일 오늘임, 정렬 시작일 최신순, 제한 1 → <b>통계 계산</b>: 평균</li>
      <li><b>건강 샘플 찾기</b>: 걸음, 시작일 오늘임 → <b>통계 계산</b>: 합계</li>
      <li><b>건강 샘플 찾기</b>: 활동 에너지, 시작일 오늘임 → <b>통계 계산</b>: 합계</li>
      <li><b>URL 내용 가져오기</b>: URL에 아래 주소, 방법 <code>POST</code>, 헤더 <code>apikey</code> = 아래 키, 요청 본문 <code>JSON</code>으로 필드 4개 (모두 텍스트)</li>
      <li>단축어 맨 위 시간 설정: 매일 22:30, 자동화 켬, 알리기 끔</li></ol>
      <div class="kv"><span>URL</span><code>${esc(SUPABASE_URL)}/rest/v1/rpc/ingest_health</code><button class="chipbtn" data-act="copy" data-v="${esc(SUPABASE_URL)}/rest/v1/rpc/ingest_health">복사</button></div>
      <div class="kv"><span>apikey</span><code>${esc(SUPABASE_KEY.slice(0, 18))}…</code><button class="chipbtn" data-act="copy" data-v="${esc(SUPABASE_KEY)}">복사</button></div>
      <div class="kv"><span>p_token</span><code>${esc(tok.slice(0, 8))}…</code><button class="chipbtn" data-act="copy" data-v="${esc(tok)}">복사</button></div>
      <div class="sm muted">본문 필드: p_token(아래 키 붙여넣기) · p_weight(체중 평균) · p_steps(걸음 합계) · p_active(활동 에너지 합계). 체중을 안 잰 날은 체중만 건너뜁니다.</div>
      <button class="chipbtn" data-act="copy" data-v='${esc(body)}'>본문 예시 복사</button>` : `<button class="btn" data-act="makeToken">연동 키 만들기</button>`}
  </div>
  <div class="card col">
    <b>'평소대로' 끼니</b>
    ${SLOTS.map(([k, l]) => { const u = (st.usual || {})[k]; return u && u.length ? `<div class="between"><span class="sm">${l}: ${esc(u.map(x => x.n).join(' + '))}</span><button class="iconbtn sm" data-act="usualDel" data-v="${k}" aria-label="${l} 평소 끼니 삭제">${ic('trash', 16)}</button></div>` : ''; }).join('') || '<span class="muted sm">식단 탭에서 끼니를 기록한 뒤 저장할 수 있어요.</span>'}
  </div>
  <div class="card col">
    <b>계정</b><span class="muted sm">${esc(S.user.email)}</span>
    <div class="row g6"><button class="btn" data-act="exportData">백업 복사(JSON)</button><button class="btn" data-act="logout">로그아웃</button></div>
    <div class="muted sm">앱 버전 v23 (11/12 건강 데이터 불러오기 버튼)</div>
  </div><div style="height:40px"></div></div>`;
}

/* ---------- 휴식 타이머 ---------- */
function vTimer() {
  if (!S.timer) return '';
  const left = Math.max(0, Math.ceil((S.timer.end - Date.now()) / 1000)), pct = 100 - left / S.timer.dur * 100;
  return `<div class="timer" id="timerbar"><div class="between"><span class="sm soft">휴식</span><b class="tnum lg" id="timerTxt">${Math.floor(left / 60)}:${pad(left % 60)}</b></div>
  <div class="mini dk"><i id="timerFill" style="width:${pct}%"></i></div>
  <div class="grid3"><button data-act="tAdj" data-v="-15">−15초</button><button data-act="tAdj" data-v="15">+15초</button><button class="go" data-act="tStop">건너뛰기</button></div></div>`;
}
let audioCtx = null;
function beep() { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); [0, .25, .5].forEach(t => { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination); g.gain.setValueAtTime(.2, audioCtx.currentTime + t); o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + .15); }); } catch { } }
function startTimer(sec) { S.timer = { end: Date.now() + sec * 1000, dur: sec }; try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { } render(); }
setInterval(() => {
  const el = document.getElementById('elapsed'); if (el && el.dataset.state === 'run') el.textContent = fmtDur((Date.now() - +el.dataset.start - +el.dataset.pt) / 1000);
  if (S.timer) {
    const left = Math.max(0, Math.ceil((S.timer.end - Date.now()) / 1000));
    const t = document.getElementById('timerTxt'), f = document.getElementById('timerFill');
    if (t) t.textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`; if (f) f.style.width = (100 - left / S.timer.dur * 100) + '%';
    if (left <= 0) { S.timer = null; beep(); toast('휴식 끝 · 다음 세트'); requestRender(); }
  }
}, 250);

/* ================= 이벤트 ================= */
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'authForm') return; ev.preventDefault();
  const fd = new FormData(ev.target), email = fd.get('email'), password = fd.get('password'), mode = ev.submitter?.dataset.mode;
  S.authMsg = '처리 중…'; render();
  const r = mode === 'up' ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }) : await sb.auth.signInWithPassword({ email, password });
  if (r.error) { S.authMsg = r.error.message.includes('Invalid login') ? '이메일 또는 비밀번호가 맞지 않습니다.' : r.error.message; render(); return; }
  if (mode === 'up' && !r.data.session) { S.authMsg = '가입 확인 메일을 확인한 뒤 로그인하세요.'; render(); }
});

document.addEventListener('click', async ev => {
  const modal = ev.target.closest('[data-stop]'); const el = ev.target.closest('[data-act]');
  if (!el) return;
  if (el.classList.contains('modal') && modal) return;
  const act = el.dataset.act, v = el.dataset.v;
  switch (act) {
    case 'tab': S.tab = v; S.overlay = null; render(); window.scrollTo(0, 0); break;
    case 'dprev': S.sel = addDays(S.sel, -1); S.editHealth = null; render(); break;
    case 'dnext': if (S.sel < today()) { S.sel = addDays(S.sel, 1); render(); } break;
    case 'dtoday': S.sel = today(); render(); break;
    case 'openSettings': S.overlay = 'settings'; loadToken(); render(); window.scrollTo(0, 0); break;
    case 'closeOverlay': S.overlay = null; render(); break;
    case 'editHealth': S.editHealth = v; render(); setTimeout(() => { const i = document.getElementById('hIn'); i && i.focus(); }, 30); break;
    case 'openFood': S.foodSlot = v; S.tab = 'food'; S.cart = []; S.fq = ''; render(); window.scrollTo(0, 0); break;
    case 'usual': { const u = settings().usual[v] || []; mutateDay(S.sel, d => u.forEach(m => d.meals.push(Object.assign({}, m, { id: uid(), slot: v })))); toast(`${SLOT_LABEL[v]} 기록 완료`); break; }
    case 'yday': { const y = (getDay(addDays(S.sel, -1)).meals || []).filter(m => m.slot === v); mutateDay(S.sel, d => y.forEach(m => d.meals.push(Object.assign({}, m, { id: uid() })))); toast('어제와 같게 기록했어요'); break; }
    case 'slot': S.foodSlot = v; render(); break;
    case 'mealDel': mutateDay(S.sel, d => { d.meals = d.meals.filter(m => m.id !== v); }); break;
    case 'saveUsual': { const items = (getDay(S.sel).meals || []).filter(m => m.slot === S.foodSlot).map(({ n, k, p, c, f }) => ({ n, k, p, c, f })); mutateSettings(s => { s.usual = s.usual || {}; s.usual[S.foodSlot] = items; }); toast(`${SLOT_LABEL[S.foodSlot]} '평소대로' 저장`); break; }
    case 'usualDel': mutateSettings(s => { delete s.usual[v]; }); break;
    case 'cartAdd': { const f = foodPool().find(x => x.n === v); if (f) addCart(f); break; }
    case 'cartRecent': { const m = recentFoods().find(x => x.n === v); if (m) addCart(m); break; }
    case 'preset': addCart(PRESETS[+v]); break;
    case 'loadSplit': loadSplit(v); break;
    case 'wRange': S.wRange = v; S.wSel = null; render(); break;
    case 'runShortcut': { const n = (settings().scName || '').trim() || SC_NAME; S.scWait = Date.now(); location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(n); setTimeout(requestRender, 300); break; }
    case 'wMetric': S.wMetric = v; S.wSel = null; render(); break;
    case 'wPt': S.wSel = S.wSel === +v ? null : +v; S._keepScroll = true; render(); break;
    case 'sessPause': sessUpdate((t, now) => { if (t.pa) { t.pt = (t.pt || 0) + (now - t.pa); t.pa = null; } else t.pa = now; }); break;
    case 'sessEnd': S.timer = null; sessUpdate((t, now) => { const ts = (getDay(today()).ex || []).flatMap(e => (e.sets || []).filter(x => x.t).map(x => x.t)), last = ts.length ? Math.max(...ts) : now; let end = t.pa || now; if (end - last > 10 * 60000) end = last + 3 * 60000; /* 종료를 늦게 눌렀으면 마지막 세트 3분 뒤로 */ t.end = end; t.pa = null; }); toast('운동 종료 · 수고하셨습니다'); break;
    case 'sessResume': sessUpdate((t, now) => { if (t.end) { t.pt = (t.pt || 0) + (now - t.end); t.end = null; } }); break;
    case 'cafe': { const m = cafeMenu(S.sel)[+v]; if (m) addCart(cafeFood(m)); break; }
    case 'qty': { const [i, dlt] = v.split(':'); const c = S.cart[+i]; c.q = Math.round((c.q + +dlt) * 2) / 2; if (c.q <= 0) S.cart.splice(+i, 1); S._keepScroll = true; render(); break; }
    case 'cartSave': { const slot = S.foodSlot, items = S.cart.map(c => ({ id: uid(), slot, n: c.q !== 1 ? `${c.n} ×${c.q}` : c.n, k: r1(c.k * c.q), p: r1(c.p * c.q), c: r1((c.c || 0) * c.q), f: r1((c.f || 0) * c.q) })); S.cart = []; S.fq = ''; mutateDay(S.sel, d => d.meals.push(...items)); toast(`${SLOT_LABEL[slot]}에 ${items.length}개 기록`); window.scrollTo(0, 0); break; }
    case 'toggleManual': S.manual = !S.manual; S._keepScroll = true; render(); break;
    case 'manualAdd': {
      const n = document.getElementById('mN').value.trim(), f = { n, k: num(document.getElementById('mK').value) || 0, p: num(document.getElementById('mP').value) || 0, c: num(document.getElementById('mC').value) || 0, f: num(document.getElementById('mF').value) || 0 };
      if (!n) { toast('음식 이름을 입력하세요'); break; }
      S.manual = false; mutateSettings(s => { s.customFoods = (s.customFoods || []).filter(x => x.n !== n).concat([f]); }); addCart(f); break;
    }
    case 'openSearch': S.overlay = 'search'; S.q = ''; render(); window.scrollTo(0, 0); setTimeout(() => document.getElementById('exQ')?.focus(), 50); break;
    case 'part': S.part = v; S._keepScroll = true; render(); break;
    case 'addEx': addExercise(v); break;
    case 'newEx': {
      const name = document.getElementById('newExName').value.trim(); if (!name) { toast('종목 이름을 입력하세요'); break; }
      const ex = { name, part: document.getElementById('newExPart').value, type: document.getElementById('newExType').value, mine: true };
      mutateSettings(s => { s.customEx = (s.customEx || []).filter(x => x.name !== name).concat([ex]); }); addExercise(name); break;
    }
    case 'guide': S.guide = v; render(); break;
    case 'closeGuide': S.guide = null; render(); break;
    case 'setDone': {
      const [i, j] = v.split(':').map(Number); let started = false;
      mutateDay(S.sel, d => { const e = d.ex[i], s = e.sets[j], sg = suggest(e.name, S.sel); s.done = !s.done; if (s.done) { if (s.r == null) s.r = sg.r; if (s.w == null && sg.w != null) s.w = sg.w; s.t = Date.now(); started = true; } });
      if (started && S.sel === today()) startTimer(settings().rest); break;
    }
    case 'setAdd': mutateDay(S.sel, d => { const e = d.ex[+v], l = e.sets[e.sets.length - 1]; e.sets.push({ w: l ? l.w : null, r: null }); }); break;
    case 'setDel': mutateDay(S.sel, d => { const e = d.ex[+v]; if (e.sets.length > 1) e.sets.pop(); }); break;
    case 'exDel': if (confirmBox(el, '이 종목을 삭제할까요?')) mutateDay(S.sel, d => { d.ex.splice(+v, 1); }); break;
    case 'cardioAdd': { const min = num(document.getElementById('cMin').value), km = num(document.getElementById('cKm').value); if (!min && !km) { toast('시간이나 거리를 입력하세요'); break; } mutateDay(S.sel, d => d.cardio.push({ type: document.getElementById('cType').value, min, km })); break; }
    case 'cardioDel': mutateDay(S.sel, d => d.cardio.splice(+v, 1)); break;
    case 'tAdj': if (S.timer) { S.timer.end += +v * 1000; S.timer.dur = Math.max(S.timer.dur, Math.ceil((S.timer.end - Date.now()) / 1000)); } break;
    case 'tStop': S.timer = null; render(); break;
    case 'wprev': S.reportWeek = addDays(S.reportWeek || weekStart(today()), -7); render(); break;
    case 'wnext': S.reportWeek = addDays(S.reportWeek || weekStart(today()), 7); render(); break;
    case 'makeToken': await makeToken(); break;
    case 'copy': try { await navigator.clipboard.writeText(v); toast('복사했어요'); } catch { toast('복사가 막혀 있어요'); } break;
    case 'exportData': try { await navigator.clipboard.writeText(JSON.stringify(S.docs)); toast('전체 백업을 복사했어요'); } catch { toast('복사가 막혀 있어요'); } break;
    case 'logout': await sb.auth.signOut(); S.docs = {}; localStorage.removeItem('mg_cache'); S.overlay = null; render(); break;
  }
});
function confirmBox(el, msg) { if (el.dataset.armed) return true; el.dataset.armed = '1'; toast(msg + ' 한 번 더 누르면 삭제'); setTimeout(() => delete el.dataset.armed, 2500); return false; }

function addCart(f) { const ex = S.cart.find(c => c.n === f.n); if (ex) ex.q += 1; else S.cart.push({ n: f.n, k: +f.k || 0, p: +f.p || 0, c: +f.c || 0, f: +f.f || 0, q: 1 }); S.fq = ''; S._keepScroll = true; render(); toast(`${f.n} 담음`); }
function addExercise(name) {
  const last = lastSession(name, S.sel), sg = suggest(name, S.sel), n = last && !last.old ? Math.max(3, last.sets.length) : 3;
  mutateDay(S.sel, d => d.ex.push({ name, sets: [...Array(n)].map(() => ({ w: sg.w, r: null })) }));
  S.overlay = null; S.tab = 'gym'; render(); toast(`${name} 추가`);
  setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 50);
}

// 입력창은 그대로 두고 결과 영역만 바꿈 (한글 조합이 끊기지 않도록)
function patch(id, view) {
  const cur = document.getElementById(id); if (!cur) return render();
  const t = document.createElement('template'); t.innerHTML = view();
  const nx = t.content.getElementById(id); if (nx) cur.innerHTML = nx.innerHTML;
}
document.addEventListener('input', ev => {
  const el = ev.target;
  if (el.id === 'exQ') { S.q = el.value; patch('exRes', vSearch); }
  if (el.id === 'foodQ') { S.fq = el.value; patch('foodRes', vFood); }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset.act === 'gymOnly') { mutateSettings(s => { s.gymOnly = el.checked; }); return; }
  if (el.dataset.set) {
    const [i, j, k] = el.dataset.set.split(':'); let val = num(el.value);
    const d0 = getDay(S.sel), info = exInfo(d0.ex[+i].name);
    if (k === 'w' && val != null && info.type === 'barbell') { val = r2(barOf(info) + val * 2); const sm = document.querySelector(`[data-sum="${i}:${j}"]`); if (sm) sm.textContent = '합 ' + r1(val); }
    mutateDayQuiet(S.sel, d => { const e = d.ex[+i]; e.sets[+j][k] = val; if (k === 'w' && val != null) e.sets.forEach((s, x) => { if (x > +j && s.w == null && !s.done) s.w = val; }); });
    return;
  }
  if (el.dataset.health) { const f = el.dataset.health, val = num(el.value); const h = Object.assign({}, getHealth(S.sel)); h[f] = val; h.src = 'manual'; S.editHealth = null; setDoc('health:' + S.sel, h); render(); return; }
  if (el.dataset.settingText) { const k = el.dataset.settingText, v = el.value.trim(); mutateSettings(s => { s[k] = v; }); toast('저장했어요'); return; }
  if (el.dataset.setting) {
    const path = el.dataset.setting.split('.'), val = el.type === 'date' ? el.value : num(el.value); if (val == null || val === '') return;
    mutateSettings(s => { let o = s; path.slice(0, -1).forEach(p => o = o[p] = o[p] || {}); o[path[path.length - 1]] = val; }); toast('저장했어요');
  }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.dataset && ev.target.dataset.health) ev.target.blur(); });
function mutateDayQuiet(d, fn) { const x = clone(getDay(d)); x.meals ||= []; x.ex ||= []; x.cardio ||= []; fn(x); setDoc('day:' + d, x); S.needsRender = true; }

/* ================= 토큰 ================= */
async function loadToken() { const { data } = await sb.from('ingest_tokens').select('token').maybeSingle(); S.token = data ? data.token : null; requestRender(); }
async function makeToken() { const { data, error } = await sb.from('ingest_tokens').insert({}).select('token').single(); if (error) { toast('키 생성 실패: ' + error.message); return; } S.token = data.token; render(); }

/* ================= 시작 ================= */
S.docs = loadJSON('mg_cache', {});
sb.auth.onAuthStateChange((_e, session) => {
  const was = S.user?.id; S.user = session?.user || null; S.ready = true;
  if (S.user && S.user.id !== was) { S.authMsg = ''; loadDocs(); flush(); }
  render();
});
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
