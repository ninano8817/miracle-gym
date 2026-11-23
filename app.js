import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { TYPES, PARTS, EXERCISES, FOODS, PRESETS, SPLITS, ABS, AB_SETS } from './data.js';
import { CAFE, CAFE_NAME } from './menus.js';

/* ================= 기본 ================= */
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
const SLOTS = [['breakfast', '아침'], ['lunch', '점심'], ['dinner', '저녁'], ['post', '운동 후'], ['snack', '간식']];
const SLOT_LABEL = Object.fromEntries(SLOTS);
const MAIN_PARTS = ['가슴', '어깨', '등', '팔', '하체'];  // 11-11부터 하체 포함 (코어는 균형 계산에서 제외)
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const START_WEIGHT = 79;
const DEFAULT_SETTINGS = {
  targets: { kcal: 2150, p: 150 }, bar: 10, rest: 90, restBig: 150, restSmall: 75, planStart: '2026-11-05', gymOnly: true, goalW: 70, rate: 0.6, goalFat: 16,
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
/* ---------- 운동 카드 끌어서 순서 바꾸기 ---------- */
let DRAG = null;
document.addEventListener('pointerdown', ev => {
  const g = ev.target.closest && ev.target.closest('.grip'); if (!g) return;
  const card = g.closest('.excard'), cards = [...document.querySelectorAll('.excard')]; if (cards.length < 2) return;
  ev.preventDefault(); try { g.setPointerCapture(ev.pointerId); } catch { }
  const sy = window.scrollY, rects = cards.map(c => c.getBoundingClientRect()), from = cards.indexOf(card);
  const gap = cards.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 12;
  DRAG = { g, card, cards, from, to: from, y0: ev.clientY, cy: ev.clientY, sy, mids: rects.map(r => r.top + sy + r.height / 2), step: rects[from].height + gap, pend: false };
  card.classList.add('dragging'); document.body.classList.add('dragmode');
  DRAG.raf = requestAnimationFrame(dragTick);
}, { passive: false });
function dragLayout() {
  const D = DRAG, dy = D.cy - D.y0 + (window.scrollY - D.sy), c = D.mids[D.from] + dy; let to = D.from;
  D.mids.forEach((m, k) => { if (k > D.from && c > m) to = Math.max(to, k); if (k < D.from && c < m) to = Math.min(to, k); });
  D.to = to; D.card.style.transform = `translateY(${dy}px)`;
  D.cards.forEach((el, k) => { if (k === D.from) return; const sh = k > D.from && k <= to ? -D.step : k < D.from && k >= to ? D.step : 0; el.style.transform = sh ? `translateY(${sh}px)` : ''; });
}
function dragTick() {
  if (!DRAG) return; const H = window.innerHeight, edge = 90;
  if (DRAG.cy > H - edge - 70) window.scrollBy(0, Math.min(14, (DRAG.cy - (H - edge - 70)) / 5)); else if (DRAG.cy < edge) window.scrollBy(0, -Math.min(14, (edge - DRAG.cy) / 5));
  dragLayout(); DRAG.raf = requestAnimationFrame(dragTick);
}
document.addEventListener('pointermove', ev => { if (!DRAG) return; ev.preventDefault(); DRAG.cy = ev.clientY; }, { passive: false });
function dragEnd() {
  if (!DRAG) return; const D = DRAG; DRAG = null; cancelAnimationFrame(D.raf);
  D.cards.forEach(el => { el.style.transform = ''; }); D.card.classList.remove('dragging'); document.body.classList.remove('dragmode');
  if (D.to !== D.from) { mutateDay(S.sel, d => { const [m] = d.ex.splice(D.from, 1); d.ex.splice(D.to, 0, m); }); toast('순서를 바꿨어요'); }
  else if (D.pend) render();
}
document.addEventListener('pointerup', dragEnd); document.addEventListener('pointercancel', dragEnd);
// 코치에게 보낼 기록 요약 (채팅 붙여넣기용 텍스트)
function coachLog(n) {
  const st = settings(), out = [`Miracle GYM 기록 · 최근 ${n}일 (목표 ${st.targets.kcal}kcal / 단백질 ${st.targets.p}g)`];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today(), -i), day = getDay(d), h = getHealth(d), t = sumMeals(day), L = [];
    if (h.weight != null) L.push(`체중 ${r1(h.weight)}`); if (h.fat != null) L.push(`체지방 ${r1(h.fat)}%`); if (h.steps != null) L.push(`걸음 ${h.steps}`); if (h.active != null) L.push(`활동 ${r0(h.active)}kcal`);
    if ((day.meals || []).length) L.push(`식단 ${r0(t.k)}kcal P${r0(t.p)} C${r0(t.c)} F${r0(t.f)} (${day.meals.map(m => m.n).join(', ')})`);
    (day.ex || []).forEach(e => { const info = exInfo(e.name), ss = setsDone(e); if (ss.length) L.push(`${e.name} ${ss.map(x => fmtSet(info.type, x)).join(' / ')}`); });
    (day.cardio || []).forEach(c => L.push(`${c.type} ${c.min ? c.min + '분' : ''}${c.km ? ' ' + c.km + 'km' : ''}`));
    out.push(`${d}(${DOW[parseD(d).getDay()]}) ` + (L.length ? L.join(' | ') : '기록 없음'));
  }
  return out.join('\n');
}
const SC_NAME = '건강 데이터 서버 동기화';
function setSync(s) { S.syncing = s; const el = document.getElementById('syncdot'); if (el) el.className = 'syncdot ' + s; }
window.addEventListener('online', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.user) { loadDocs(); flush();
  if (S.scWait && Date.now() - S.scWait < 10 * 60e3) { [2500, 6000].forEach(t => setTimeout(loadDocs, t)); setTimeout(() => { S.scWait = null; requestRender(); }, 6500); } } });

/* ================= 계산 ================= */
function sumMeals(day) { const t = { k: 0, p: 0, c: 0, f: 0 }; (day.meals || []).forEach(m => { t.k += +m.k || 0; t.p += +m.p || 0; t.c += +m.c || 0; t.f += +m.f || 0; }); return t; }
function weightOn(d) { return num(getHealth(d).weight); }
function fatRaw(d) { return num(getHealth(d).fat); }
// 체지방률 튐 제거: 앞뒤 7일 다른 측정값의 중앙값과 2%p 넘게 차이 나면 측정 오류로 보고 제외
function fatOn(d) {
  const v = fatRaw(d); if (v == null) return null;
  const nb = []; for (let i = -7; i <= 7; i++) { if (!i) continue; const x = fatRaw(addDays(d, i)); if (x != null) nb.push(x); }
  if (nb.length < 2) return v; nb.sort((a, b) => a - b); const m = nb.length % 2 ? nb[(nb.length - 1) / 2] : (nb[nb.length / 2 - 1] + nb[nb.length / 2]) / 2;
  return Math.abs(v - m) > 2 ? null : v;
}
function latestFat(upto) { for (let i = 0; i < 30; i++) { const d = addDays(upto, -i); const f = fatOn(d); if (f != null) return { f, d }; } return null; }
function avgWeight(end, days = 7) { const ws = []; for (let i = 0; i < days; i++) { const w = weightOn(addDays(end, -i)); if (w != null) ws.push(w); } return ws.length ? ws.reduce((a, b) => a + b) / ws.length : null; }
function latestWeight(upto) { for (let i = 0; i < 30; i++) { const d = addDays(upto, -i); const w = weightOn(d); if (w != null) return { w, d }; } return null; }
function setsDone(e) { return (e.sets || []).filter(s => !s.wu && (s.done || (s.done === undefined && num(s.r)))); }
// 부위별 주간 목표 세트 (근비대 일반 권장 범위)
const PART_TGT = { '가슴': [10, 20], '등': [10, 20], '하체': [10, 20], '어깨': [8, 16], '팔': [6, 12], '코어': [6, 18] };
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
  const rirs = topSets.map(s => s.rir).filter(x => x != null), easy = rirs.length >= Math.min(2, topSets.length) && avgOf(rirs) >= 3, hard = rirs.length && Math.max(...rirs) === 0 && topSets.some(s => (+s.r || 0) < lo);
  if (!allHit && easy) { const inc = type === 'dumbbell' ? 1 : type === 'barbell' || type === 'machine' || type === 'cable' ? 5 : 2.5; return { w: top + inc, r: lo, text: `지난번 여유 3회 이상 → ${fmtW(type, top + inc, barOf(info))} 추천`, up: true }; }
  if (hard) return { w: top, r: lo, text: `지난번 한계까지 했어요 · ${fmtW(type, top, barOf(info))} 유지, ${lo}회부터 채우기`, up: false };
  if (allHit) { const inc = type === 'dumbbell' ? 1 : type === 'barbell' || type === 'machine' || type === 'cable' ? 5 : 2.5; return { w: top + inc, r: lo, text: `지난번 모두 ${hi}회 달성 → ${fmtW(type, top + inc, barOf(info))} 추천`, up: true }; }
  return { w: top, r: hi, text: `${fmtW(type, top, barOf(info))} 유지 · 모든 세트 ${hi}회 목표`, up: false };
}
// 복합 종목(여러 관절·큰 근육) = 긴 휴식, 고립 종목 = 짧은 휴식
const COMPOUND = new Set(['벤치프레스', '인클라인 벤치프레스', '인클라인 덤벨 프레스', '덤벨 벤치프레스', '어시스트 딥스', '백스쿼트', '루마니안 데드리프트', '데드리프트', '불가리안 스플릿 스쿼트', '레그프레스', '워킹 런지', '바벨 로우', '원암 덤벨 로우', '시티드 케이블 로우', '랫풀다운', '어시스트 풀업', '풀업', '밀리터리 프레스', '스미스 숄더프레스', '덤벨 숄더프레스', '오버헤드프레스', '힙 쓰러스트', '스미스 스쿼트']);
function isCompound(name) { const i = exInfo(name); return COMPOUND.has(name) || i.type === 'barbell' || i.type === 'smith'; }
function restOf(name) { const st = settings(); return isCompound(name) ? (+st.restBig || 150) : (+st.restSmall || 75); }
const fmtRest = s => s >= 60 ? `${Math.floor(s / 60)}:${pad(s % 60)}` : `${s}초`;
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
  grip: '<path d="M5 9h14M5 15h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const ic = (n, s = 20, w = 2) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

function requestRender() { const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $app().contains(a)) { S.needsRender = true; return; } render(); }
document.addEventListener('focusout', () => setTimeout(() => { if (S.needsRender) { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { S.needsRender = false; render(); } } }, 400)); // 탭(클릭)이 끝난 뒤에 다시 그리도록 여유

function render() {
  if (DRAG) { DRAG.pend = true; return; }
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
  ${vGoalCard(d)}
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
  const cnt = {}; (exs || []).filter(e => !e.wu).forEach(e => { const n = setsDone(e).length || (e.sets || []).length; const p = exInfo(e.name).part; cnt[p] = (cnt[p] || 0) + n; });
  let best = null; SPLITS.forEach(sp => { if ((cnt[sp.part] || 0) > 0 && (!best || cnt[sp.part] > cnt[best.part])) best = sp; });
  return best;
}
function splitState(d) {
  const todaySp = splitOfEx(getDay(d).ex), legs = SPLITS.find(x => x.id === 'legs'), ws = weekStart(d);
  let last = null, lastOther = null, lastLeg = null, legWeek = 0;
  for (const s of sessions()) {
    if (s.old || s.date >= d) continue; const done = s.ex.filter(e => setsDone(e).length), sp = splitOfEx(done); if (!sp) continue;
    if (!last || s.date > last.date) last = { date: s.date, sp };
    if (sp !== legs && (!lastOther || s.date > lastOther.date)) lastOther = { date: s.date, sp };
    const legSets = done.reduce((a, e) => a + (exInfo(e.name).part === '하체' ? setsDone(e).length : 0), 0);
    if (legSets >= 6) { if (!lastLeg || s.date > lastLeg) lastLeg = s.date; if (s.date >= ws) legWeek++; }
  }
  const gap = lastLeg ? Math.round((parseD(d) - parseD(lastLeg)) / 864e5) : 99;
  // 하체 주 2회: 이번 주 2회 미만이고 마지막 하체 후 3일 이상 지났으면 하체, 아니면 가슴·등 번갈아
  const legDue = legWeek < 2 && gap >= 3 && !(last && last.sp === legs);
  const next = legDue ? legs : lastOther && lastOther.sp.id === 'chest' ? SPLITS.find(x => x.id === 'back') : SPLITS.find(x => x.id === 'chest');
  return { todaySp, last, next, legWeek };
}
function vSplit(d) {
  const { last, next, legWeek } = splitState(d);
  return `<div class="card col">
    <div class="between"><b>오늘은 ${next.name} 차례</b><span class="muted sm">${last ? `지난번 ${md(last.date)} ${last.sp.name}` : '3분할 시작'} · 이번 주 하체 ${legWeek}/2</span></div>
    <span class="sm">${next.name} ${next.sub}</span>
    <span class="muted sm">${splitList(next, d).map(n => `${n} ${setsFor(next, n)}`).join(' · ')} <b class="acc">· 본 운동 ${splitList(next, d).reduce((a, n) => a + setsFor(next, n), 0)}세트</b></span>
    <button class="btn pri" data-act="loadSplit" data-v="${next.id}">${next.name} 루틴 불러오기</button>
    <div class="row g6 sm"><span class="muted">다른 날로:</span>${SPLITS.filter(x => x !== next).map(x => `<button class="chipbtn" data-act="loadSplit" data-v="${x.id}">${x.name}</button>`).join('')}</div>
  </div>`;
}
// 오늘 할 복근: 마지막으로 한 복근 종목의 반대 (기록 없으면 첫 번째)
function nextAb(before) { let lastD = '', lastN = null; for (const se of sessions()) { if (se.old || se.date >= before) continue; for (const e of se.ex) if (ABS.includes(e.name) && setsDone(e).length && se.date > lastD) { lastD = se.date; lastN = e.name; } } return lastN ? ABS[(ABS.indexOf(lastN) + 1) % ABS.length] : ABS[0]; }
function splitList(sp, d) { return sp.ex.concat([nextAb(d)]); }
function setsFor(sp, name) { return ABS.includes(name) ? AB_SETS : (sp.sets && sp.sets[name]) || 3; }
// 워밍업 2세트: 본 무게의 약 40%×12, 60%×8 (보조 머신은 보조 +20/+10kg)
function warmups(name, w) {
  const info = exInfo(name), t = info.type, rnd = x => t === 'dumbbell' ? Math.max(1, Math.round(x)) : Math.round(x / 2.5) * 2.5;
  if (w == null) return [{ wu: true, w: null, r: 12 }, { wu: true, w: null, r: 8 }];
  if (t === 'assist') return [{ wu: true, w: w + 20, r: 10 }, { wu: true, w: w + 10, r: 6 }];
  if (t === 'body' || t === 'time') return [{ wu: true, w: null, r: 10 }];
  const min = t === 'barbell' ? barOf(info) : 0;
  return [{ wu: true, w: Math.max(min, rnd(w * 0.4)), r: 12 }, { wu: true, w: Math.max(min, rnd(w * 0.6)), r: 8 }];
}
function vWarmTip(name, sg, info) {
  const W = warmups(name, sg.w), fw = x => x.w == null ? '' : info.type === 'barbell' ? (x.w <= barOf(info) ? `빈 바(${x.w}kg) ` : `${fmtW(info.type, x.w, barOf(info))} `) : `${fmtW(info.type, x.w, barOf(info))} `;
  const body = sg.w == null ? '본 세트 무게의 40%로 12회 → 60%로 8회' : W.map(x => `${fw(x)}× ${x.r}회`).join(' → ');
  return `<div class="wutip sm"><b>제안 · ${W.length}세트</b><span>${body}</span><span class="muted">세트 사이 1분 · 주간 세트와 무게 추천 계산에는 들어가지 않아요</span></div>`;
}
function loadSplit(id) {
  const sp = SPLITS.find(x => x.id === id); if (!sp) return;
  const day = getDay(S.sel), have = new Set((day.ex || []).filter(e => !e.wu).map(e => e.name)), add = splitList(sp, S.sel).filter(n => !have.has(n));
  mutateDay(S.sel, d => add.forEach(name => { const sg = suggest(name, S.sel), n = setsFor(sp, name); d.ex.push({ name, sets: [...Array(n)].map(() => ({ w: sg.w, r: null })) }); }));
  render(); toast(`${sp.name} 루틴 ${add.length}종목 불러옴`);
}
/* ---------- 운동 ---------- */
function vGym() {
  const d = S.sel, day = getDay(d), ex = day.ex || [];
  const ss = sess(d);
  return `<div class="page">
  <header class="hdr"><div><div class="muted sm">${fmtDate(d)} · ${dayN(d)}</div><h1>${ss ? `${({ run: '운동 중', paused: '일시정지', done: '운동 완료' })[ss.state]} <span class="tnum" id="elapsed" data-start="${ss.start}" data-pt="${ss.pt}" data-state="${ss.state}">${fmtDur(ss.sec)}</span>` : '운동'}</h1></div>${dateBar()}</header>
  ${ss && ss.state === 'done' && d === today() ? `<div class="row g6 sm"><span class="muted">운동을 마쳤습니다.</span><button class="chipbtn" data-act="sessResume">이어서 하기</button></div>` : ''}
  ${ex.some(e => !e.wu) ? '' : vSplit(d)}
  ${ex.some(e => !e.wu) ? '' : `<div class="card col"><b>직접 고르려면</b><span class="muted sm">이번 주 부족한 부위: ${(() => { const p = weekParts(weekStart(d)); return MAIN_PARTS.slice().sort((a, b) => p[a] - p[b])[0]; })()}</span></div>`}
  ${ex.map((e, i) => exCard(e, i, d)).join('')}
  <div class="grid2 g6"><button class="dashed" data-act="openSearch" data-v="wu">${ic('search', 18, 2.2)} 워밍업 추가</button><button class="dashed" data-act="openSearch">${ic('search', 18, 2.2)} 종목 추가</button></div>
  ${ex.some(e => !e.wu) ? `<div class="row g6 sm wrap"><span class="muted">루틴에서 빠진 종목 더하기:</span>${SPLITS.map(x => `<button class="chipbtn" data-act="loadSplit" data-v="${x.id}">${x.name}</button>`).join('')}</div>` : ''}
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
  const doneN = (e.sets || []).filter(s => s.done && (e.wu || !s.wu)).length, workN = (e.sets || []).filter(s => e.wu || !s.wu).length;
  let wk = 0; const rows = (e.sets || []).map((s, j) => {
    const k = s.wu ? -1 : wk++, prev = s.wu ? '워밍업' : last && last.sets[k] ? fmtSet(info.type, last.sets[k]) : '-';
    const shown = info.type === 'barbell' ? (s.w != null ? r2((s.w - bar) / 2) : '') : (s.w ?? '');
    const phW = info.type === 'barbell' ? (sg.w != null ? r2((sg.w - bar) / 2) : '') : (sg.w ?? '');
    return `<div class="setrow ${s.done ? 'done' : ''} ${s.wu ? 'wu' : ''}">
      <span class="sn">${s.wu ? 'W' : k + 1}${s.done && s.rir != null ? `<button class="rirtag" data-act="rirClr" data-v="${i}:${j}" aria-label="여유 횟수 다시 선택">여유${s.rir >= 3 ? '3+' : s.rir}</button>` : ''}</span><span class="prev">${prev}</span>
      ${T.input ? `<label class="cell"><input type="number" inputmode="decimal" step="0.25" value="${shown}" placeholder="${phW}" data-set="${i}:${j}:w" aria-label="${j + 1}세트 ${T.input} kg">${info.type === 'barbell' ? `<small data-sum="${i}:${j}">${s.w != null ? '합 ' + r1(s.w) : ''}</small>` : ''}</label>` : `<span class="cell na">–</span>`}
      <label class="cell"><input type="number" inputmode="numeric" value="${s.r ?? ''}" placeholder="${sg.r ?? ''}" data-set="${i}:${j}:r" aria-label="${j + 1}세트 ${info.type === 'time' ? '초' : '회'}"></label>
      <button class="chk ${s.done ? 'on' : ''}" data-act="setDone" data-v="${i}:${j}" aria-label="${j + 1}세트 완료">${ic('check', 18, 3)}</button></div>${s.done && s.rir == null && T.input && !s.wu ? `<div class="rirrow"><span class="sm muted">몇 회 더 할 수 있었나요?</span>${[0, 1, 2, 3].map(n => `<button class="chipbtn sm" data-act="rir" data-v="${i}:${j}:${n}">${n === 3 ? '3+' : n}</button>`).join('')}</div>` : ''}`;
  }).join('');
  return `<div class="card excard" data-ex="${i}">
    <div class="between"><div class="row g6 grow"><button class="grip" aria-label="${esc(e.name)} 순서 옮기기 (끌기)">${ic('grip', 20, 2.4)}</button><div class="col"><b class="lg">${e.wu ? '<span class="wubadge">워밍업</span>' : ''}${esc(e.name)}</b><span class="muted sm">${T.label} · ${T.hint}${info.type === 'barbell' ? ` (${bar}kg)` : ''} · 휴식 ${fmtRest(restOf(e.name))}</span></div></div>
      <div class="row g4"><span class="pill">${doneN} / ${workN}</span><button class="iconbtn sm round acc" data-act="guide" data-v="${esc(e.name)}" aria-label="${esc(e.name)} 자세 보기">${ic('info', 18)}</button></div></div>
    ${e.wu ? vWarmTip(e.name, sg, info) : ''}
    <div class="sethead"><span>세트</span><span>지난번</span><span>${T.input || ''}${T.input ? ' kg' : ''}</span><span>${info.type === 'time' ? '초' : '회'}</span><span></span></div>
    ${rows}
    <div class="between"><span class="sm ${sg.up && !e.wu ? 'acc b' : 'muted'}">${e.wu ? '가볍게 근육과 관절을 깨우는 세트' : esc(sg.text)}</span>
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
    <div class="seg">${[['main', '본 운동으로 추가'], ['wu', '워밍업으로 추가']].map(([k, l]) => `<button class="${(k === 'wu') === !!S.searchWu ? 'on' : ''}" data-act="searchMode" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="chips scroll">${['전체', ...PARTS].map(p => `<button class="chip ${S.part === p ? 'on' : ''}" data-act="part" data-v="${p}">${p}</button>`).join('')}</div>
    <label class="between toggle"><span>우리 단지 헬스장 기구만</span><input type="checkbox" data-act="gymOnly" ${gymOnly ? 'checked' : ''}></label>
  </div>
  <div id="exRes">${fallback && recent.length ? `<div class="sec">최근 한 종목</div><div class="chips">${recent.slice(0, 8).map(n => `<button class="chip" data-act="addEx" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}
  <div class="sec">${q ? `검색 결과 ${res.length}` : S.part === '전체' ? '전체 종목' : S.part}</div>
  <div class="list">${res.map(({ e, m }) => { const ls = lastSession(e.name, today()); return `<div class="lrow">
      <button class="thumb" data-act="guide" data-v="${esc(e.name)}" aria-label="${esc(e.name)} 설명 보기">${e.img ? `<img src="img/${e.img}_0.jpg" alt="" loading="lazy">` : `<span class="ph">${ic('gym', 20)}</span>`}<i>${ic('info', 12, 2.6)}</i></button>
      <button class="lmain" data-act="addEx" data-v="${esc(e.name)}"><span class="col f1"><span>${hlName(e.name, m.hl)}${e.gym ? '' : ' <span class="tag">헬스장에 없음</span>'}</span><span class="muted sm">${e.part} · ${(TYPES[e.type] || {}).label || ''} · ${ls ? `지난번 ${fmtSet(e.type, ls.sets[0])}` : '처음 하는 종목'}</span></span>
      <span class="acc b sm">${S.searchWu ? '워밍업' : '추가'}</span></button></div>`; }).join('') || `<div class="muted pad">검색 결과가 없습니다.</div>`}</div></div>
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
    ${(() => { const u = (st.usual || {})[slot] || [], same = u.length && items.length === u.length && u.every((x, i) => items[i] && items[i].n === x.n);
      return `${u.length && !same ? `<button class="usualbtn" data-act="usual" data-v="${slot}"><span class="col"><b>${items.length ? '평소대로 더하기' : '평소대로 불러오기'}</b><span class="muted sm">${esc(u.map(x => x.n).join(' + '))} · ${r0(u.reduce((a, x) => a + (+x.k || 0), 0))}kcal · P${r0(u.reduce((a, x) => a + (+x.p || 0), 0))}</span></span>${ic('right', 18, 2.2)}</button>` : ''}
      ${items.length && !same ? `<button class="linkbtn" data-act="saveUsual">이 끼니를 '평소대로'로 저장${u.length ? ' (기존 것 바꾸기)' : ''}</button>` : same ? `<span class="muted sm">'평소대로' 저장된 구성과 같아요</span>` : ''}`; })()}
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
/* ---------- 목표 계획 (예상 체중·체지방률) ---------- */
// 시작 체중 = 시작일부터 7일 안의 첫 체중(없으면 79). 주 rate kg씩 goalW까지 직선 감량.
// 체지방률 = 첫 기록 → 체중 목표 도달일에 goalFat%까지 직선.
// 과거 감량 기록(2023) — 과거 시작일을 올해 시작일에 맞춰 같은 'Day'끼리 비교
function past() {
  const h = S.docs.past2023; if (!h || !h.w) return null; const st = settings(), ps = st.pastStart || h.start, off = diffDays(st.planStart, ps);
  const at = (d, F) => { const v = (F ? h.f : h.w)[addDays(d, -off)]; return v == null ? null : +v; };
  const near = (d, F, n = 3) => { const v = []; for (let i = -n; i <= n; i++) { const x = at(addDays(d, i), F); if (x != null) v.push(x); } return avgOf(v); };
  const first = F => { const o = F ? h.f : h.w, k = Object.keys(o).sort().find(x => x >= ps); return k ? { d: k, v: +o[k] } : null; };
  return { h, ps, off, at, near, first, label: h.label || '과거', pdate: d => addDays(d, -off) };
}
function plan() {
  const st = settings(), s0 = st.planStart, rate = Math.max(0.1, +st.rate || 0.6), goal = +st.goalW || 70;
  let w0 = null; for (let i = 0; i < 7 && w0 == null; i++) w0 = weightOn(addDays(s0, i)); if (w0 == null) w0 = START_WEIGHT;
  const days = Math.max(0, Math.ceil((w0 - goal) / rate * 7)), goalDate = addDays(s0, days);
  let f0 = null; for (let i = 0; i < 120 && !f0; i++) { const d = addDays(s0, i); if (d > today()) break; const f = fatOn(d); if (f != null) f0 = { d, f }; }
  const gf = +st.goalFat || 16;
  const w = d => d < s0 ? null : Math.max(goal, w0 - rate * diffDays(d, s0) / 7);
  const f = d => !f0 || d < f0.d ? null : d >= goalDate ? gf : f0.f + (gf - f0.f) * diffDays(d, f0.d) / Math.max(1, diffDays(goalDate, f0.d));
  return { s0, w0, goal, rate, goalDate, gf, f0, w, f };
}
// 주차는 월~일 기준. 1주 차 = 시작일이 속한 주(시작일 이전 날은 제외)
const planWeek = (P, d) => Math.floor(diffDays(weekStart(d), weekStart(P.s0)) / 7) + 1;
// 주차 k의 [시작, 끝] 날짜
const planWeekRange = (P, k) => { const a = addDays(weekStart(P.s0), (k - 1) * 7); return [a < P.s0 ? P.s0 : a, addDays(a, 6)]; };
// 실제 vs 계획: 기록이 있는 날만 비교
function planCompare(P, a, b, metric = 'w') {
  const val = metric === 'w' ? weightOn : fatOn, pf = metric === 'w' ? P.w : P.f, A = [], B = [];
  for (let d = a; d <= b && d <= today(); d = addDays(d, 1)) { const v = val(d), q = pf(d); if (v != null && q != null) { A.push(v); B.push(q); } }
  if (!A.length) return null; const act = avgOf(A), pl = avgOf(B); return { act, pl, diff: act - pl, n: A.length };
}
function planStatus(diff, metric = 'w') { const tol = metric === 'w' ? 0.3 : 0.5; return diff == null ? null : diff <= -tol ? { t: '계획보다 빠름', c: 'acc' } : diff <= tol ? { t: '계획대로', c: 'acc' } : { t: '계획보다 느림', c: 'warnt' }; }
// 최근 14일 실제 속도(kg/주)로 목표 도달 예상일
function actualEta(P) {
  const a = planCompare(P, addDays(today(), -13), addDays(today(), -7)), b = planCompare(P, addDays(today(), -6), today());
  let r = null; if (a && b) r = a.act - b.act; else { const c = planCompare(P, P.s0, today()); if (c) { const wk = Math.max(1, diffDays(today(), P.s0) / 7); r = (P.w0 - c.act) / wk; } }
  const cur = b ? b.act : (latestWeight(today()) || {}).w;
  if (r == null || cur == null || r < 0.05) return { r, eta: null };
  return { r, eta: addDays(today(), Math.ceil((cur - P.goal) / r * 7)) };
}
function vGoalCard(d) {
  const P = plan(); if (d < P.s0) return '';
  const k = planWeek(P, d), [a, b] = planWeekRange(P, k), tgtW = P.w(b), tgtF = P.f(b), cw0 = planCompare(P, a, b), roll = !cw0 || cw0.n < 3, cw = roll ? planCompare(P, addDays(d, -6), d) : cw0, st = planStatus(cw && cw.diff), E = actualEta(P);
  const fv = []; for (let i = 0; i < 7; i++) { const f = fatOn(addDays(d, -i)); if (f != null) fv.push(f); } const lfb = latestFat(d), curF = fv.length ? avgOf(fv) : lfb ? lfb.f : null, curW = cw ? cw.act : null;
  const day = x => `${md(x)}(${DOW[parseD(x).getDay()]})`, ymd = x => { const t = parseD(x); return `${t.getFullYear()}년 ${t.getMonth() + 1}월 ${t.getDate()}일`; };
  const gapCell = (cur, tgt, u, unitTxt) => cur == null || tgt == null ? '<b class="gc muted">–</b>' : cur - tgt <= 0.05 ? '<b class="gc acc">달성</b>' : `<b class="gc warnt">−${r1(cur - tgt)}${unitTxt}</b>`;
  const tot = P.w0 - P.goal, lost = curW != null ? Math.max(0, P.w0 - curW) : 0, planLost = Math.max(0, P.w0 - P.w(d < P.goalDate ? d : P.goalDate));
  const pct = x => Math.max(0, Math.min(100, x / tot * 100));
  return `<div class="card col goalcard">
    <div class="between"><div class="col g2"><b>${k}주 차 · ${day(a)}~${day(b)}</b><span class="muted sm">이번 주 일요일까지의 목표</span></div>${st ? `<span class="pill ${st.c === 'acc' ? '' : 'warnpill'}">${st.t}</span>` : ''}</div>
    <div class="gtab">
      <span></span><span class="muted sm">현재 (${roll ? '7일' : '이번 주'} 평균)</span><span class="muted sm">이번 주 목표</span><span class="muted sm r">남은 차이</span>
      <span class="muted">체중</span><b class="gv">${curW != null ? r1(curW) : '–'}<small> kg</small></b><b class="gv acc">${r1(tgtW)}<small> kg</small></b>${gapCell(curW, tgtW, 'kg', 'kg')}
      <span class="muted">체지방률</span><b class="gv">${curF != null ? r1(curF) : '–'}<small> %</small></b><b class="gv acc">${tgtF != null ? r1(tgtF) : '–'}<small> %</small></b>${gapCell(curF, tgtF, '%', '%p')}
    </div>
    <div class="col g4 gprog">
      <div class="between sm"><span>${P.goal}kg까지 감량 진행</span><span class="muted">${r1(lost)} / ${r1(tot)}kg</span></div>
      <div class="gbar"><i style="width:${pct(lost)}%"></i><em style="left:${pct(planLost)}%"></em></div>
      <div class="between sm muted"><span>실제 ${Math.round(pct(lost))}%</span><span>│ 계획대로면 지금 ${Math.round(pct(planLost))}%</span></div>
    </div>
    <span class="sm muted">${P.goal}kg 도달: 계획 ${ymd(P.goalDate)}${E.eta ? ` · 지금 속도(주 ${r1(E.r)}kg)면 ${ymd(E.eta)}` : ''}</span>
  </div>`;
}
function vPlanTable() {
  const P = plan(), cur = planWeek(P, today()), last = Math.max(cur, planWeek(P, P.goalDate));
  const rows = []; for (let k = 1; k <= last; k++) { const [a, b] = planWeekRange(P, k), c = k <= cur ? planCompare(P, a, b) : null, st = c && planStatus(c.diff), ft = P.f(b);
    rows.push(`<tr class="${k === cur ? 'cur' : ''}"><td>${k}주<small>${md(a)}~</small></td><td>${r1(P.w(b))}</td><td>${ft != null ? r1(ft) : '–'}</td><td>${c ? r1(c.act) : '–'}</td><td class="${st ? st.c : 'muted'}">${st ? (Math.abs(c.diff) < 0.05 ? '±0' : (c.diff > 0 ? '+' : '') + r1(c.diff)) + (k === cur && c.n < 7 ? `<small>${c.n}일</small>` : '') : k > cur ? '예정' : '–'}</td></tr>`); }
  return `<div class="card col">
    <div class="between"><b>주차별 목표 (예상)</b><span class="muted sm">주 ${P.rate}kg 감량 기준</span></div>
    <div class="ptable"><table><thead><tr><th>주차</th><th>목표 kg</th><th>목표 %</th><th>실제 평균</th><th>차이</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <span class="muted sm">목표는 각 주 마지막 날 기준입니다. 실제 평균은 그 주에 잰 날의 평균과 같은 날의 계획값을 비교합니다. 체지방률은 첫 측정(${P.f0 ? md(P.f0.d) + ' ' + r1(P.f0.f) + '%' : '없음'})에서 ${md(P.goalDate)} ${P.gf}%까지 직선으로 잡았습니다.</span>
  </div>`;
}
function vReport() {
  const st = settings(), ws = S.reportWeek || weekStart(today()), we = addDays(ws, 6);
  const dots = [...Array(7)].map((_, i) => { const dd = addDays(ws, i), day = getDay(dd), meals = day.meals || []; if (!meals.length || dd > today()) return { cls: 'none', d: dd }; const pct = sumMeals(day).p / st.targets.p; return { cls: pct >= 1 ? 'g' : pct >= .7 ? 'y' : pct >= .3 ? 'o' : 'r', d: dd }; });
  const hit = dots.filter(x => x.cls === 'g').length, parts = weekParts(ws), maxP = Math.max(1, ...PARTS.map(p => parts[p]));
  const upper = MAIN_PARTS, top = upper.slice().sort((a, b) => parts[b] - parts[a])[0], low = upper.slice().sort((a, b) => parts[a] - parts[b])[0];
  return `<div class="page">
  <header class="hdr"><h1>리포트</h1><div class="row g4"><button class="iconbtn" data-act="wprev" aria-label="이전 주">${ic('left', 16, 2.4)}</button><b class="sm">${md(ws)} – ${md(we)}</b><button class="iconbtn" data-act="wnext" aria-label="다음 주" ${we >= today() ? 'disabled' : ''}>${ic('right', 16, 2.4)}</button></div></header>
  <button class="card tap row between syncbtn" data-act="copyLog" data-v="14"><span class="col"><b>코치에게 보낼 기록 복사</b><span class="muted sm">최근 14일 체중·식단·운동을 텍스트로 복사 → 채팅에 붙여넣기</span></span>${ic('right', 18, 2.2)}</button>
  ${vWeightCard()}
  ${vPlanTable()}
  <div class="card col">
    <div class="between"><b>단백질 ${st.targets.p}g 달성</b><span class="muted sm">${hit} / 7일</span></div>
    <div class="grid7">${dots.map(x => `<div class="col cc g4"><span class="pdot ${x.cls}"></span><span class="sm muted">${DOW[parseD(x.d).getDay()]}</span></div>`).join('')}</div>
    <div class="legend sm"><span><i class="pdot s g"></i>달성</span><span><i class="pdot s y"></i>70% 이상</span><span><i class="pdot s o"></i>30~70%</span><span><i class="pdot s r"></i>30% 미만</span><span><i class="pdot s none"></i>미기록</span></div>
  </div>
  <div class="card col">
    <div class="between"><b>부위별 주간 세트</b><span class="muted sm">회색 칸 = 목표 범위</span></div>
    <div class="partgrid sm">${PARTS.map(p => { const [a, b] = PART_TGT[p] || [10, 20], v = parts[p], M = 24, cls = v < a ? 'warnbg' : v > b ? 'overbg' : '';
      return `<span>${p}</span><div class="mini light tgt"><em style="left:${a / M * 100}%;width:${(b - a) / M * 100}%"></em><i class="${cls}" style="width:${Math.max(3, Math.min(100, v / M * 100))}%"></i></div><b class="right ${v < a ? 'warnt' : v > b ? 'overt' : 'acc'}">${v}<small class="muted">/${a}~${b}</small></b>`; }).join('')}</div>
    ${(() => { const lack = PARTS.filter(p => parts[p] < PART_TGT[p][0]), over = PARTS.filter(p => parts[p] > PART_TGT[p][1]); if (!lack.length && !over.length) return '<div class="note ok">모든 부위가 목표 범위 안입니다.</div>';
      const cur = ws === weekStart(today()); return `<div class="note">${lack.length ? `${cur ? '이번 주 남은 목표' : '부족'}: ${lack.map(p => `${p} ${PART_TGT[p][0] - parts[p]}세트`).join(', ')}. ` : ''}${over.length ? `많음: ${over.join(', ')} — 세트를 줄이고 부족한 부위로 옮기세요.` : ''}</div>`; })()}
  </div></div>`;
}
/* ---------- 체중 그래프 (애플 건강 앱 방식: 1일·1주·1개월·6개월·1년) ---------- */
const W_RANGES = [['d', '1일'], ['w', '1주'], ['m', '1개월'], ['6m', '6개월'], ['y', '1년'], ['plan', '목표까지']];
const mdw = d => `${md(d)}(${DOW[parseD(d).getDay()]})`;
const avgOf = a => { const v = a.filter(x => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
function ymdLong(d) { const t = parseD(d); return `${t.getFullYear()}년 ${t.getMonth() + 1}월 ${t.getDate()}일`; }
function rangeText(a, b) { if (a === b) return ymdLong(a); const A = parseD(a), B = parseD(b); return `${ymdLong(a)}~${A.getFullYear() !== B.getFullYear() ? ymdLong(b) : A.getMonth() !== B.getMonth() ? `${B.getMonth() + 1}월 ${B.getDate()}일` : `${B.getDate()}일`}`; }
// 범위별 점 목록: {w, label(축), tip(선택 시 표시), tick(축 라벨 표시 여부)}
function wSeries(r, end, val = weightOn, pv = () => null, ph = () => null) {
  const out = [];
  if (r === 'plan') { // 시작 주부터 목표 도달 주까지 주 단위: 실제 = 주 평균, 목표 = 주 마지막 날 계획값
    const P = plan(), last = Math.max(planWeek(P, end), planWeek(P, P.goalDate) + 1);
    for (let k = 1; k <= last; k++) { const [a, b] = planWeekRange(P, k), days = []; for (let d = a; d <= b && d <= end; d = addDays(d, 1)) days.push(d);
      out.push({ w: avgOf(days.map(val)), pl: pv(b), ph: avgOf([...Array(7)].map((_, i) => ph(addDays(a, i)))), label: `${k}주`, sub: md(a), tip: `${k}주 차 (${md(a)}~${md(b)}) 평균 · 목표 ${pv(b) != null ? r1(pv(b)) : '–'}`, tick: k === 1 || k === last || (k % 3 === 1 && last - k >= 2) }); }
    return { pts: out, start: P.s0 };
  }
  if (r === 'd') { out.push({ w: val(end), pl: pv(end), ph: ph(end), label: mdw(end), tip: ymdLong(end), tick: true }); return { pts: out, start: end }; }
  if (r === 'w' || r === 'm') {
    const n = r === 'w' ? 7 : 30, start = addDays(end, -(n - 1));
    for (let i = 0; i < n; i++) { const d = addDays(start, i); out.push({ w: val(d), pl: pv(d), ph: ph(d), label: md(d), sub: DOW[parseD(d).getDay()], tip: ymdLong(d), tick: r === 'w' || (n - 1 - i) % 7 === 0 }); }
    return { pts: out, start };
  }
  if (r === '6m') {
    const start = weekStart(addDays(end, -7 * 25));
    for (let k = 0; k < 26; k++) { const ws = addDays(start, 7 * k), days = [...Array(7)].map((_, i) => addDays(ws, i)).filter(d => d <= end); const prev = k ? parseD(addDays(ws, -7)).getMonth() : -1, m = parseD(ws).getMonth();
      out.push({ w: avgOf(days.map(val)), pl: avgOf(days.map(pv)), ph: avgOf([...Array(7)].map((_, i) => ph(addDays(ws, i)))), label: `${m + 1}월`, tip: `${md(ws)}~${md(days[days.length - 1])} 주 평균`, tick: m !== prev }); }
    return { pts: out, start };
  }
  const E = parseD(end), first = new Date(E.getFullYear(), E.getMonth() - 11, 1);
  for (let k = 0; k < 12; k++) { const m0 = new Date(first.getFullYear(), first.getMonth() + k, 1), dim = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate(), vals = [];
    const pls = [], phs = []; for (let i = 1; i <= dim; i++) { const d = `${m0.getFullYear()}-${pad(m0.getMonth() + 1)}-${pad(i)}`; pls.push(pv(d)); phs.push(ph(d)); if (d > end) continue; vals.push(val(d)); }
    out.push({ w: avgOf(vals), pl: avgOf(pls), ph: avgOf(phs), label: `${m0.getMonth() + 1}월`, tip: `${m0.getFullYear()}년 ${m0.getMonth() + 1}월 평균`, tick: true }); }
  return { pts: out, start: `${first.getFullYear()}-${pad(first.getMonth() + 1)}-01` };
}
function vWeightCard() {
  const r = S.wRange || 'w', F = S.wMetric === 'fat', val = F ? fatOn : weightOn, U = F ? '%' : 'kg', P = plan(), pv = F ? P.f : P.w, H = past(), showH = H && S.cmpPast !== false, ph = showH ? (d => H.at(d, F)) : () => null;
  // 1개월 이상은 목표일까지 미래 구간도 보여 줌 (예상선)
  const end = today();
  const { pts, start } = wSeries(r, end, val, pv, ph);
  const cmpP = planCompare(P, addDays(today(), -6), today(), F ? 'f' : 'w'), stP = planStatus(cmpP && cmpP.diff, F ? 'f' : 'w');
  const vals = pts.map(p => p.w), avg = avgOf(vals), lw = latestWeight(end), lf = latestFat(end);
  // 직전 같은 길이 기간과 비교
  let prev = null, cmpLabel = '';
  if (r === 'plan') { prev = F ? (P.f0 ? P.f0.f : null) : P.w0; cmpLabel = '시작 대비 (최근 주)'; }
  else if (r === 'd') { const y = F ? latestFat(addDays(end, -1)) : latestWeight(addDays(end, -1)); prev = y ? (F ? y.f : y.w) : null; cmpLabel = '직전 기록 대비'; }
  else { const len = Math.round((parseD(end) - parseD(start)) / 864e5) + 1, pe = addDays(start, -1), ps = addDays(pe, -(len - 1)); const pv = []; for (let d = ps; d <= pe; d = addDays(d, 1)) pv.push(val(d)); prev = avgOf(pv); cmpLabel = `이전 ${W_RANGES.find(x => x[0] === r)[1]} 대비`; }
  const sel = S.wSel != null && pts[S.wSel] && pts[S.wSel].w != null ? pts[S.wSel] : null;
  const lastV = [...vals].reverse().find(v => v != null), base = r === 'plan' ? lastV : avg;
  const big = sel ? sel.w : avg, diff = !sel && base != null && prev != null ? base - prev : null;
  const what = r === 'plan' ? '평균 (점 = 주 평균)' : r === 'd' ? '오늘' : r === '6m' ? '평균 (점 = 주 평균)' : r === 'y' ? '평균 (점 = 월 평균)' : '평균';
  return `<div class="card col wcard">
    <div class="between"><div class="row g6"><button class="chipbtn ${F ? '' : 'on'}" data-act="wMetric" data-v="w">체중</button><button class="chipbtn ${F ? 'on' : ''}" data-act="wMetric" data-v="fat">체지방률</button></div>${H ? `<button class="chipbtn ${showH ? 'on past' : ''}" data-act="cmpPast">${esc(H.label)} 비교</button>` : ''}</div>
    <div class="seg sm">${W_RANGES.map(([k, l]) => `<button class="${k === r ? 'on' : ''}" data-act="wRange" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="col g2">
      <span class="muted sm">${sel ? '선택한 기록' : what}</span>
      <div class="huge">${big != null ? (r === 'd' || sel ? r2(big) : r1(big)) : '–'}<small> ${U}</small></div>
      <span class="muted sm">${sel ? sel.tip + (sel.ph != null ? ` · ${esc(H.label)} ${r1(sel.ph)}${U}` : '') : rangeText(start, end)}</span>
    </div>
    ${(() => { const td = pv(today()), tv = val(today()), lv = (F ? latestFat(today()) : latestWeight(today())); if (td == null || r === 'plan') return '';
      const cur = tv != null ? tv : lv ? (F ? lv.f : lv.w) : null, tol = F ? 0.5 : 0.3, wk = cmpP;
      return `<div class="plansum sm"><div><span class="muted">오늘 목표</span><b>${r1(td)}${U}</b><span class="muted">허용 ${r1(td - tol)}~${r1(td + tol)}</span></div><div><span class="muted">${tv != null ? '오늘 측정' : '최근 측정'}</span><b>${cur != null ? r1(cur) + U : '–'}</b>${cur != null ? `<span class="${cur - td > tol ? 'warnt' : 'acc'}">${cur - td > 0 ? '+' : ''}${r1(cur - td)}</span>` : ''}</div><div><span class="muted">7일 평균 판정</span><b class="${wk ? stP.c : ''}">${wk ? stP.t : '–'}</b>${wk ? `<span class="muted">목표 대비 ${Math.abs(wk.diff) < 0.05 ? '±0' : (wk.diff > 0 ? '+' : '') + r1(wk.diff)}</span>` : ''}</div></div>`; })()}
    ${wChart(pts, r, F ? 0.5 : 0.3, U)}
    <div class="legend sm"><span><i class="lg-act"></i>실제</span><span><i class="lg-plan"></i>목표(예상)</span><span><i class="lg-band"></i>목표 범위 ±${F ? '0.5%p' : '0.3kg'}</span>${showH ? `<span><i class="lg-past"></i>${esc(H.label)} (같은 Day)</span>` : ''}</div>
    ${showH ? vPastCmp(P, H, F) : ''}
    <span class="muted sm">하루 체중은 수분·식사로 ±0.5kg 출렁여요. 하루 값보다 <b>7일 평균이 회색 범위 안</b>에 있는지로 판단하세요.</span>
    <div class="wfoot sm">${diff != null ? `<span class="b ${diff <= 0 ? 'acc' : 'warnt'}">${cmpLabel} ${diff > 0 ? '+' : ''}${r1(diff)}${F ? '%p' : 'kg'}</span>` : `<span class="muted">${cmpLabel}: 비교할 기록 없음</span>`}${F ? (lf ? `<span class="muted">표준 22%까지 ${r1(Math.max(0, lf.f - 22))}%p</span>` : '') : (lw ? `<span class="muted">목표 70kg까지 ${r1(Math.max(0, lw.w - 70))}kg</span>` : '')}</div>
    <span class="muted sm">점을 누르면 그날(그 기간) 값이 위에 표시됩니다.</span>
  </div>`;
}
function vPastCmp(P, H, F) {
  const t = today(), n = diffDays(t, P.s0) + 1, U = F ? '%p' : 'kg';
  const nowAvg = avgOf([...Array(7)].map((_, i) => (F ? fatOn : weightOn)(addDays(t, -i)))), now0 = F ? (P.f0 && P.f0.f) : P.w0;
  const p0 = H.first(F), pNow = H.near(addDays(t, -3), F, 3);
  if (nowAvg == null || now0 == null || !p0 || pNow == null) return '';
  const dNow = nowAvg - now0, dPast = pNow - p0.v, gap = dNow - dPast;
  const p100 = H.near(addDays(P.s0, 99), F, 3);
  return `<div class="pastcmp sm"><div class="between"><b>Day ${n} 비교</b><span class="muted">${esc(H.label)} 같은 시점: ${md(H.pdate(t))}</span></div>
    <div class="grid2 g6"><div class="col"><span class="muted">올해 시작 대비 (7일 평균)</span><b>${dNow > 0 ? '+' : ''}${r1(dNow)}${U}</b></div><div class="col"><span class="muted">${esc(H.label)} 시작 대비</span><b class="pastt">${dPast > 0 ? '+' : ''}${r1(dPast)}${U}</b></div></div>
    <span class="${gap <= 0.05 ? 'acc' : 'warnt'} b">${Math.abs(gap) < 0.1 ? `${esc(H.label)}와 같은 속도입니다` : gap < 0 ? `${esc(H.label)}보다 ${r1(-gap)}${U} 더 빠릅니다` : `${esc(H.label)}보다 ${r1(gap)}${U} 덜 빠졌습니다`}</span>
    ${p100 != null ? `<span class="muted">${esc(H.label)}엔 Day 100 무렵 ${r1(p100)}${F ? '%' : 'kg'}(시작 대비 ${r1(p100 - p0.v)}${U})까지 갔습니다.</span>` : ''}</div>`;
}
function niceStep(span) { return [0.5, 1, 2, 5, 10].find(s => span / s <= 4) || 10; }
function wChart(pts, r, tol = 0.3, unit = 'kg') {
  const ys = pts.map(p => p.w).filter(v => v != null), ps = pts.map(p => p.pl).filter(v => v != null), hs = pts.map(p => p.ph).filter(v => v != null);
  if (!ys.length && !ps.length) return '<div class="muted sm pad">이 기간에는 기록이 없습니다.</div>';
  let mn = Math.min(...ys, ...hs, ...ps.map(v => v - tol)), mx = Math.max(...ys, ...hs, ...ps.map(v => v + tol)); if (mx - mn < 1) { mn -= .6; mx += .6; }
  const step = niceStep(mx - mn), lo = Math.floor(mn / step) * step, hi = Math.ceil(mx / step) * step;
  const W = 340, H = 190, L = 4, R = 36, T = 10, B = r === 'w' || r === 'm' || r === 'plan' ? 34 : 22, n = pts.length;
  const X = i => n === 1 ? (L + W - R) / 2 : L + 8 + i / (n - 1) * (W - R - L - 16), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const grid = []; for (let v = lo; v <= hi + 1e-9; v += step) grid.push(v);
  const bi = pts.map((p, i) => p.pl != null ? i : null).filter(i => i != null);
  const band = bi.length > 1 ? `<polygon points="${bi.map(i => `${X(i).toFixed(1)},${Y(pts[i].pl + tol).toFixed(1)}`).join(' ')} ${bi.slice().reverse().map(i => `${X(i).toFixed(1)},${Y(pts[i].pl - tol).toFixed(1)}`).join(' ')}" class="pband"/>` : '';
  const li = bi.length ? bi[bi.length - 1] : null, lt = li != null && r !== 'plan' ? `<text x="${X(li) - 4}" y="${Y(pts[li].pl) + (pts[li].w != null && pts[li].w < pts[li].pl ? -10 : 16)}" class="pltxt" text-anchor="end">목표 ${r1(pts[li].pl)}</text>` : '';
  const hline = pts.map((p, i) => p.ph != null ? `${X(i).toFixed(1)},${Y(p.ph).toFixed(1)}` : null).filter(Boolean);
  const pline = pts.map((p, i) => p.pl != null ? `${X(i).toFixed(1)},${Y(p.pl).toFixed(1)}` : null).filter(Boolean);
  const line = pts.map((p, i) => p.w != null ? `${X(i).toFixed(1)},${Y(p.w).toFixed(1)}` : null).filter(Boolean);
  return `<svg viewBox="0 0 ${W} ${H}" class="wchart" role="img" aria-label="체중 그래프">
    ${grid.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${W - R + 6}" y="${Y(v) + 4}" class="yl">${step < 1 ? v.toFixed(1) : v}</text>`).join('')}
    ${pts.map((p, i) => p.tick ? `<line x1="${X(i)}" x2="${X(i)}" y1="${T}" y2="${H - B}" class="vl"/><text x="${X(i)}" y="${H - B + 14}" class="xl">${p.label}</text>${p.sub ? `<text x="${X(i)}" y="${H - B + 27}" class="xl">(${p.sub})</text>` : ''}` : '').join('')}
    ${band}
    ${hline.length > 1 ? `<polyline points="${hline.join(' ')}" class="hl"/>` : ''}${pts.map((p, i) => p.ph != null ? `<circle cx="${X(i)}" cy="${Y(p.ph)}" r="2.6" class="hp"/>` : '').join('')}
    ${pline.length > 1 ? `<polyline points="${pline.join(' ')}" class="pll"/>` : pline.length === 1 ? `<circle cx="${pline[0].split(',')[0]}" cy="${pline[0].split(',')[1]}" r="3" class="plp"/>` : ''}
    ${line.length > 1 ? `<polyline points="${line.join(' ')}" class="wl"/>` : ''}
    ${lt}
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
      <label class="field"><span>휴식 · 복합 종목 초</span><input type="number" data-setting="restBig" value="${st.restBig}"></label>
      <label class="field"><span>휴식 · 고립 종목 초</span><input type="number" data-setting="restSmall" value="${st.restSmall}"></label>
      <label class="field"><span>100일 시작일</span><input type="date" data-setting="planStart" value="${st.planStart}"></label>
      <label class="field"><span>목표 체중 kg</span><input type="number" step="0.5" data-setting="goalW" value="${st.goalW}"></label>
      <label class="field"><span>주당 감량 목표 kg</span><input type="number" step="0.1" data-setting="rate" value="${st.rate}"></label>
      <label class="field"><span>목표 체지방률 %</span><input type="number" step="0.5" data-setting="goalFat" value="${st.goalFat}"></label>
      ${S.docs.past2023 ? `<label class="field"><span>과거 비교 시작일 (= 올해 시작일)</span><input type="date" data-setting-text="pastStart" value="${st.pastStart || S.docs.past2023.start}"></label>` : ''}
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
    <div class="muted sm">앱 버전 v41 (11/23 홈 목표 카드 개편)</div>
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
    case 'cmpPast': S.cmpPast = S.cmpPast === false; render(); break;
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
    case 'openSearch': S.overlay = 'search'; S.searchWu = v === 'wu'; S.q = ''; render(); window.scrollTo(0, 0); setTimeout(() => document.getElementById('exQ')?.focus(), 50); break;
    case 'part': S.part = v; S._keepScroll = true; render(); break;
    case 'addEx': if (S.searchWu) addWarmup(v); else addExercise(v); break;
    case 'searchMode': S.searchWu = v === 'wu'; patch('exRes', vSearch); document.querySelectorAll('[data-act=searchMode]').forEach(b => b.classList.toggle('on', (b.dataset.v === 'wu') === S.searchWu)); break;
    case 'newEx': {
      const name = document.getElementById('newExName').value.trim(); if (!name) { toast('종목 이름을 입력하세요'); break; }
      const ex = { name, part: document.getElementById('newExPart').value, type: document.getElementById('newExType').value, mine: true };
      mutateSettings(s => { s.customEx = (s.customEx || []).filter(x => x.name !== name).concat([ex]); }); addExercise(name); break;
    }
    case 'guide': S.guide = v; render(); break;
    case 'closeGuide': S.guide = null; render(); break;
    case 'setDone': {
      const [i, j] = v.split(':').map(Number); let started = false;
      mutateDay(S.sel, d => { const e = d.ex[i], s = e.sets[j], sg = suggest(e.name, S.sel); s.done = !s.done; if (s.done) { if (s.r == null) s.r = sg.r; if (s.w == null && sg.w != null && !s.wu) s.w = sg.w; s.t = Date.now(); started = true; } });
      if (started && S.sel === today()) { const e = getDay(S.sel).ex[i]; startTimer(e.sets[j].wu ? 60 : restOf(e.name)); } break;
    }
    case 'rir': { const [i, j, n] = v.split(':').map(Number); mutateDay(S.sel, d => { d.ex[i].sets[j].rir = n; }); break; }
    case 'rirClr': { const [i, j] = v.split(':').map(Number); mutateDay(S.sel, d => { delete d.ex[i].sets[j].rir; }); break; }
    case 'setAdd': mutateDay(S.sel, d => { const e = d.ex[+v], l = e.sets[e.sets.length - 1]; e.sets.push(e.wu ? { wu: true, w: l ? l.w : null, r: l ? l.r : null } : { w: l ? l.w : null, r: null }); }); break;
    case 'setDel': mutateDay(S.sel, d => { const e = d.ex[+v]; if (e.sets.length > 1) e.sets.pop(); }); break;
    case 'exDel': if (confirmBox(el, '이 종목을 삭제할까요?')) mutateDay(S.sel, d => { d.ex.splice(+v, 1); }); break;
    case 'cardioAdd': { const min = num(document.getElementById('cMin').value), km = num(document.getElementById('cKm').value); if (!min && !km) { toast('시간이나 거리를 입력하세요'); break; } mutateDay(S.sel, d => d.cardio.push({ type: document.getElementById('cType').value, min, km })); break; }
    case 'cardioDel': mutateDay(S.sel, d => d.cardio.splice(+v, 1)); break;
    case 'tAdj': if (S.timer) { S.timer.end += +v * 1000; S.timer.dur = Math.max(S.timer.dur, Math.ceil((S.timer.end - Date.now()) / 1000)); } break;
    case 'tStop': S.timer = null; render(); break;
    case 'wprev': S.reportWeek = addDays(S.reportWeek || weekStart(today()), -7); render(); break;
    case 'wnext': S.reportWeek = addDays(S.reportWeek || weekStart(today()), 7); render(); break;
    case 'makeToken': await makeToken(); break;
    case 'copyLog': try { await navigator.clipboard.writeText(coachLog(+v || 14)); toast('최근 ' + (+v || 14) + '일 기록을 복사했어요. 채팅에 붙여넣으세요'); } catch { toast('복사가 막혀 있어요'); } break;
    case 'copy': try { await navigator.clipboard.writeText(v); toast('복사했어요'); } catch { toast('복사가 막혀 있어요'); } break;
    case 'exportData': try { await navigator.clipboard.writeText(JSON.stringify(S.docs)); toast('전체 백업을 복사했어요'); } catch { toast('복사가 막혀 있어요'); } break;
    case 'logout': await sb.auth.signOut(); S.docs = {}; localStorage.removeItem('mg_cache'); S.overlay = null; render(); break;
  }
});
function confirmBox(el, msg) { if (el.dataset.armed) return true; el.dataset.armed = '1'; toast(msg + ' 한 번 더 누르면 삭제'); setTimeout(() => delete el.dataset.armed, 2500); return false; }

function addCart(f) { const ex = S.cart.find(c => c.n === f.n); if (ex) ex.q += 1; else S.cart.push({ n: f.n, k: +f.k || 0, p: +f.p || 0, c: +f.c || 0, f: +f.f || 0, q: 1 }); S.fq = ''; S._keepScroll = true; render(); toast(`${f.n} 담음`); }
// 워밍업: 사용자가 고른 종목을 맨 위 워밍업 묶음 끝에 추가 (본 운동과 같은 종목도 가능)
function addWarmup(name) {
  const sg = suggest(name, S.sel), sets = warmups(name, sg.w).map(x => Object.assign({}, x, { wu: true }));
  if (sets.length < 2) sets.push(Object.assign({}, sets[0]));
  mutateDay(S.sel, d => { const at = d.ex.findIndex(e => !e.wu); d.ex.splice(at < 0 ? d.ex.length : at, 0, { name, wu: true, sets }); });
  S.overlay = null; S.searchWu = false; S.tab = 'gym'; render(); toast(`워밍업 ${name} 추가`); window.scrollTo(0, 0);
}
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
