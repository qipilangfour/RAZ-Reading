/* ===== RAZ 精读记录 - 主逻辑（共享 + 库页面） ===== */
(function() {
'use strict';

const STORE_KEY = 'raz-tracker-v1';
const SETTINGS_KEY = 'raz-tracker-settings-v1';
const POSITION_KEY = 'raz-tracker-positions-v1';
const LEVELS = ["AA","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","Z1","Z2"];

const state = {
  books: [],
  progress: {},
  positions: {},     // {bookId: seconds}  - 独立存储，避免污染 progress
  settings: {
    dailyTarget: 3,
    dailyReviewTarget: 2,
    reviewIntervals: [2, 7, 30],
    weekdays: [1,2,3,4,5],
    startLevel: 'AA',
    childName: '',
    startDate: '',
  },
  filter: { level: 'all', status: 'all', search: '', mode: 'grid' },
  currentBook: null,
};

// ===== 工具 =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      state.progress = JSON.parse(raw);
      for (const id in state.progress) state.progress[id] = normalizeProgress(state.progress[id]);
    }
  } catch(e) { console.warn('loadProgress failed', e); }
}
function saveProgress() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state.progress));
}
function loadPositions() {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw) state.positions = JSON.parse(raw);
  } catch(e) {}
}
function savePositions() {
  localStorage.setItem(POSITION_KEY, JSON.stringify(state.positions));
}
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) state.settings = { ...state.settings, ...JSON.parse(raw) };
  } catch(e) {}
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m||1) - 1, d||1);
}
function addDaysStr(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
function parseIntervals(s) {
  return String(s || '').split(/[\s,，]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
}
function formatDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return s;
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function statusLabel(s) {
  return { unread:'未读', reading:'进行中', done:'已完成' }[s] || s;
}

// 迁移旧状态（review/skipped -> unread），三态：unread/reading/done
function normalizeProgress(p) {
  if (!p) return p;
  if (p.status === 'review' || p.status === 'skipped') p.status = 'unread';
  return p;
}

// ===== 书单加载 =====
async function loadBooks() {
  try {
    const res = await fetch('data/books.json');
    if (res.ok) {
      const data = await res.json();
      state.books = data.books || [];
      return true;
    }
  } catch(e) { console.warn('loadBooks fetch failed', e); }
  state.books = [];
  return false;
}

// ===== 视频路径 =====
const DIR_MAP = {
  AA: 'AA级视频（97本）', B: 'B级视频（97本）', C: 'C级视频（95本）',
  D: 'D级视频（89本）', E: 'E级视频（87本）', F: 'F级视频（86本）',
  G: 'G级视频（85本）', H: 'H级-视频（80本）', I: 'I',
};

// AA 级和 A 级使用同名目录时会有冲突，A 级单独处理
const A_DIR = 'A级视频（97本）';

function guessVideoUrl(book) {
  if (!book.file) return null;
  // 优先用 book.file（扫描时记录的原始文件名），最准确
  const dir = book.level === 'A' ? A_DIR : DIR_MAP[book.level];
  if (!dir) return null;

  const base = location.pathname.replace(/\/raz-tracker\/.*$/, '/');
  return base + encodeURIComponent(dir) + '/' + encodeURIComponent(book.file);
}

// ===== 掌握度等级 =====
const MASTERY_LABELS = { 1:'生疏', 2:'一般', 3:'熟练', 4:'精通' };

// ===== 渲染：书库 =====
function getFilteredBooks() {
  return state.books.filter(b => {
    if (state.filter.level !== 'all' && b.level !== state.filter.level) return false;
    if (state.filter.status !== 'all') {
      const p = state.progress[b.id];
      const s = p ? p.status : 'unread';
      if (s !== state.filter.status) return false;
    }
    if (state.filter.search) {
      const q = state.filter.search.toLowerCase();
      if (!b.title.toLowerCase().includes(q) && !(b.code||'').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function renderBookList() {
  const container = $('#book-list');
  container.className = 'book-grid' + (state.filter.mode === 'list' ? ' list' : '');
  const filtered = getFilteredBooks();

  if (filtered.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-3)">未找到符合条件的书</div>`;
    return;
  }

  container.innerHTML = filtered.map(b => {
    const p = state.progress[b.id] || {};
    const status = p.status || 'unread';
    const stars = p.rating ? '★'.repeat(p.rating) + '☆'.repeat(5-p.rating) : '';
    const masteryLabel = p.mastery ? (MASTERY_LABELS[p.mastery] || '') : '';
    return `
      <a class="book-card ${status}" href="book.html?id=${encodeURIComponent(b.id)}">
        <span class="book-level">${b.level}</span>
        <div class="book-title">${escapeHtml(b.title)}</div>
        <div class="book-meta">
          <span class="status-text status ${status}">${statusLabel(status)}</span>
          ${stars ? `<span class="stars">${stars}</span>` : ''}
        </div>
        ${masteryLabel ? `<div class="book-meta" style="margin-top:4px"><span style="font-size:11px;color:var(--text-2)">掌握 · ${masteryLabel}</span></div>` : ''}
      </a>
    `;
  }).join('');
}

// ===== 计划页 =====
const DAY_CN = ['日','一','二','三','四','五','六'];

function autoPlayDates(p) {
  return (p && p.logs ? p.logs : [])
    .filter(l => l.type === 'auto')
    .map(l => l.date)
    .sort();
}

function dayAutoCount(ds) {
  let n = 0;
  for (const id in state.progress) {
    if ((state.progress[id].logs || []).some(l => l.date === ds && l.type === 'auto')) n++;
  }
  return n;
}

// 到期未复习的书：intervals[k] 表示第 k+1 次复习应在第 k+1 次播放后的第 N 天
function dueReviews(today) {
  const intervals = (state.settings.reviewIntervals || []).length
    ? state.settings.reviewIntervals : [2, 7, 30];
  const out = [];
  for (const b of state.books) {
    const p = state.progress[b.id];
    if (!p || (p.plays || 0) < 1) continue;
    const events = autoPlayDates(p);
    for (let k = 0; k < intervals.length; k++) {
      const prev = events[k] || events[0];
      const due = addDaysStr(prev, intervals[k]);
      if (events[k + 1]) continue;               // 这次复习已完成
      if (today.localeCompare(due) >= 0) {       // 到期且未复习
        out.push({ book: b, due });
        break;
      }
    }
  }
  return out;
}

// 当前应推进的等级：从起始等级起，第一个还有未读完书的等级
function currentLevel() {
  const startIdx = LEVELS.indexOf(state.settings.startLevel);
  for (let i = startIdx; i < LEVELS.length; i++) {
    const lvl = LEVELS[i];
    const has = state.books.some(b => {
      if (b.level !== lvl) return false;
      const s = state.progress[b.id]?.status || 'unread';
      return s === 'unread' || s === 'reading';
    });
    if (has) return lvl;
  }
  return null;
}

// 新书阅读队列：只从当前等级取（进行中优先，按顺序），读完本等级再进下一等级
function recommendBooks(n) {
  const curLvl = currentLevel();
  if (!curLvl) return [];
  const candidates = state.books.filter(b => b.level === curLvl).map(b => {
    const status = state.progress[b.id]?.status || 'unread';
    return { ...b, _priority: status === 'reading' ? 0 : 1 };
  }).filter(c => c._priority === 0 || c._priority === 1);
  candidates.sort((a, b) => {
    if (a._priority !== b._priority) return a._priority - b._priority;
    return (a.seq||0) - (b.seq||0);
  });
  return candidates.slice(0, n);
}

// 今日任务（自动判定：今天有 auto 日志=完成）
function todayTasks() {
  const today = todayStr();
  const t = {
    restDay: false,
    newTarget: 0, reviewTarget: 0,
    newDone: [], newPending: [],
    reviewDone: [], reviewPending: [],
  };
  if (!state.settings.weekdays.includes(new Date().getDay())) { t.restDay = true; return t; }
  t.newTarget = +state.settings.dailyTarget || 3;
  t.reviewTarget = +state.settings.dailyReviewTarget || 0;

  // 今天完整播放过的书（所有书，不依赖推荐队列，避免已 done 的书被漏统计）
  const doneTodayId = new Set();
  for (const id in state.progress) {
    if ((state.progress[id].logs || []).some(l => l.date === today && l.type === 'auto')) doneTodayId.add(id);
  }
  for (const id of doneTodayId) {
    const b = state.books.find(x => x.id === id);
    if (!b) continue;
    const p = state.progress[id];
    const firstTime = (p.plays || 0) === 1;   // 第一次完整读完 = 新书；否则 = 复习
    if (firstTime) t.newDone.push(b);
    else t.reviewDone.push(b);
  }

  // 到期未复习的书
  for (const item of dueReviews(today)) {
    if (!t.reviewDone.some(x => x.id === item.book.id)) t.reviewPending.push(item.book);
  }
  // 当前等级待读新书
  for (const b of recommendBooks(Infinity)) {
    if (t.newDone.some(x => x.id === b.id)) continue;
    t.newPending.push(b);
  }
  return t;
}

function renderToday() {
  const t = todayTasks();
  if (t.restDay) {
    $('#today-summary').innerHTML = '<div class="today-rest">今天不是阅读日 🎉 好好休息，明天继续！</div>';
    $('#today-list').innerHTML = '';
    return;
  }
  $('#today-summary').innerHTML = `
    <div class="today-summary">
      <div class="ts-item ${t.newDone.length >= t.newTarget ? 'ok' : ''}">
        <span class="ts-name">📖 新书精读</span>
        <span class="ts-count">${t.newDone.length}/${t.newTarget}</span>
      </div>
      <div class="ts-item ${t.reviewTarget && t.reviewDone.length >= t.reviewTarget ? 'ok' : ''}">
        <span class="ts-name">🔄 间隔复习</span>
        <span class="ts-count">${t.reviewDone.length}/${t.reviewTarget}</span>
      </div>
    </div>
  `;

  // 达到今日目标后不再继续列待读；未达标则列出剩余待读
  const newSlots = Math.max(t.newTarget - t.newDone.length, 0);
  const reviewSlots = t.reviewTarget ? Math.max(t.reviewTarget - t.reviewDone.length, 0) : 0;
  const newPending = t.newDone.length >= t.newTarget ? [] : t.newPending.slice(0, newSlots);
  const reviewPending = t.reviewDone.length >= t.reviewTarget ? [] : t.reviewPending.slice(0, reviewSlots);

  const curLvl = currentLevel();
  let html = `<div class="today-tip">当前等级 <strong>${curLvl || '—'}</strong> · 每天最多 ${t.newTarget} 本新书 + ${t.reviewTarget} 本复习，没读完不补，明天的任务自动顺延。</div>`;
  html += renderTaskGroup('📖 新书精读', newPending, t.newDone, newEmptyMsg(t, true));
  if (t.reviewTarget > 0 || t.reviewDone.length) {
    html += renderTaskGroup('🔄 间隔复习', reviewPending, t.reviewDone);
  }
  if (!html.includes('task-group')) {
    html = '<div class="today-done">🎉 今天的任务都完成了！</div>';
  }
  $('#today-list').innerHTML = html;
}

function newEmptyMsg(t, isNew) {
  if (isNew && !t.newDone.length && !t.newPending.length) return '🎉 全部读完，太棒了';
  if (isNew && t.newDone.length >= t.newTarget) return '🎉 已达成今日新书目标';
  return '暂无任务';
}

function renderTaskGroup(title, pending, done, emptyMsg) {
  const rows = [];
  for (const b of done.slice(0, 6)) {
    rows.push(`
      <a class="task-item done" href="book.html?id=${encodeURIComponent(b.id)}">
        <span class="badge">${b.level}</span>
        <span class="task-title">${escapeHtml(b.title)}</span>
        <span class="task-check">已完成 ✓</span>
      </a>`);
  }
  if (pending.length) {
    for (const b of pending) {
      rows.push(`
        <a class="task-item todo" href="book.html?id=${encodeURIComponent(b.id)}">
          <span class="badge">${b.level}</span>
          <span class="task-title">${escapeHtml(b.title)}</span>
          <span class="task-go">去学习 →</span>
        </a>`);
    }
  } else if (rows.length === 0) {
    rows.push(`<div class="tg-empty">${emptyMsg || '暂无任务'}</div>`);
  }
  return `<div class="task-group">
    <div class="task-group-head">${title}<span class="tg-count">待做 ${pending.length}</span></div>
    ${rows.join('')}
  </div>`;
}

// ===== 学习日历 =====
let _calView = null;

function renderCalendar() {
  const el = $('#calendar');
  if (!el) return;
  if (!_calView) { const now = new Date(); _calView = { y: now.getFullYear(), m: now.getMonth() }; }
  const v = _calView, y = v.y, m = v.m;
  const firstDow = new Date(y, m, 1).getDay();
  const today = todayStr();
  const startDs = addDaysStr(`${y}-${String(m+1).padStart(2,'0')}-01`, -firstDow);
  const targetAll = (+state.settings.dailyTarget || 3) + (+state.settings.dailyReviewTarget || 2);

  const cells = [];
  let metCount = 0;
  for (let i = 0; i < 42; i++) {
    const ds = addDaysStr(startDs, i);
    const d = parseDate(ds);
    const inMonth = d.getMonth() === m;
    const cnt = dayAutoCount(ds);
    const isReadingDay = state.settings.weekdays.includes(d.getDay());
    const met = inMonth && isReadingDay && cnt >= targetAll;
    if (met) metCount++;
    cells.push({ ds, dom: d.getDate(), inMonth, cnt, met, isToday: ds === today });
  }

  let html = `
    <div class="cal-head">
      <button class="cal-nav" id="cal-prev">‹</button>
      <span class="cal-title">${y}年${m+1}月</span>
      <button class="cal-nav" id="cal-next">›</button>
      <span class="cal-met">达标 ${metCount} 天</span>
    </div>
    <div class="cal-grid">
      ${DAY_CN.map(d => `<div class="cal-dow">${d}</div>`).join('')}`;
  for (const c of cells) {
    const cls = ['cal-cell'];
    if (!c.inMonth) cls.push('dim');
    if (c.cnt > 0) cls.push('read');
    if (c.met) cls.push('met');
    if (c.isToday) cls.push('today');
    html += `<div class="${cls.join(' ')}" data-d="${c.ds}">
      <span class="cal-day">${c.dom}</span>
      ${c.cnt > 0 ? `<span class="cal-count">${c.met ? '✓' : c.cnt}</span>` : ''}
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;

  $('#cal-prev').onclick = () => { v.m--; if (v.m < 0) { v.m = 11; v.y--; } renderCalendar(); $('#cal-detail').innerHTML = ''; };
  $('#cal-next').onclick = () => { v.m++; if (v.m > 11) { v.m = 0; v.y++; } renderCalendar(); $('#cal-detail').innerHTML = ''; };
  el.querySelectorAll('.cal-cell[data-d]').forEach(c => {
    c.onclick = () => renderCalDetail(c.dataset.d);
  });
}

function renderCalDetail(ds) {
  const el = $('#cal-detail');
  if (!el) return;
  if (!ds) { el.innerHTML = ''; return; }
  const booksDone = [];
  for (const id in state.progress) {
    if ((state.progress[id].logs || []).some(l => l.date === ds && l.type === 'auto')) {
      const b = state.books.find(x => x.id === id);
      if (b) booksDone.push(b);
    }
  }
  if (!booksDone.length) {
    el.innerHTML = `<div class="cal-detail">📅 ${ds}：当天没有完成记录</div>`;
    return;
  }
  el.innerHTML = `<div class="cal-detail">
    <div class="cal-detail-head">📅 ${ds} · 完成 ${booksDone.length} 本</div>
    ${booksDone.map(b => `
      <a class="cal-book" href="book.html?id=${encodeURIComponent(b.id)}">
        <span class="badge">${b.level}</span> ${escapeHtml(b.title)}
      </a>`).join('')}
  </div>`;
}

// ===== 里程碑（按实际节奏推算） =====
function levelStatsMap() {
  const stats = {};
  for (const l of LEVELS) stats[l] = { total: 0, done: 0 };
  for (const b of state.books) {
    stats[b.level].total++;
    if (state.progress[b.id]?.status === 'done') stats[b.level].done++;
  }
  return stats;
}

function renderMilestone() {
  const el = $('#next-stage');
  if (!el) return;
  const today = todayStr();
  const stats = levelStatsMap();
  const totalBooks = state.books.length;
  let totalDone = 0;
  for (const id in state.progress) if (state.progress[id].status === 'done') totalDone++;

  // 近14天：实际阅读日的平均完成量
  let sum = 0, activeDays = 0;
  for (let i = 0; i < 14; i++) {
    const ds = addDaysStr(today, -i);
    if (!state.settings.weekdays.includes(parseDate(ds).getDay())) continue;
    const cnt = dayAutoCount(ds);
    if (cnt > 0) { sum += cnt; activeDays++; }
  }
  const rate = activeDays ? sum / activeDays : 0;

  let curLevel = currentLevel();
  if (!curLevel && totalDone >= totalBooks) {
    el.innerHTML = '<div class="milestone"><div style="color:var(--success);font-size:16px">🎉 所有书都完成了！</div></div>';
    return;
  }

  const goal = (+state.settings.dailyTarget || 3) + (+state.settings.dailyReviewTarget || 2);
  let html = `<div class="milestone">`;

  if (curLevel) {
    const st = stats[curLevel];
    const remaining = st.total - st.done;
    const expDays = rate > 0 ? Math.ceil(remaining / rate) : null;
    const expDate = expDays ? formatDate(addDaysStr(today, expDays)) : null;
    html += `
      <div class="ms-block">
        <div class="ms-row">
          <span class="ms-name">当前等级 <strong>${curLevel}</strong></span>
          <span class="ms-count">${st.done}/${st.total}</span>
        </div>
        <div class="progress-bar"><div class="fill" style="width:${(st.done/st.total*100).toFixed(1)}%"></div></div>
        <div class="ms-sub">剩余 <strong>${remaining}</strong> 本${expDate ? ` · 按当前节奏预计 <strong>${expDate}</strong> 完成` : ''}</div>
      </div>`;
  }

  const rateStr = rate > 0 ? rate.toFixed(1) : '—';
  html += `
    <div class="ms-block">
      <div class="ms-row">
        <span class="ms-name">📚 总进度</span>
        <span class="ms-count">${totalDone}/${totalBooks}</span>
      </div>
      <div class="progress-bar"><div class="fill ${totalDone>=totalBooks?'done':''}" style="width:${(totalBooks?totalDone/totalBooks*100:0).toFixed(1)}%"></div></div>
      <div class="ms-sub">完成率 ${(totalBooks?totalDone/totalBooks*100:0).toFixed(1)}%</div>
    </div>
    <div class="ms-block ms-rate">
      <div class="ms-row">
        <span class="ms-name">📈 实际节奏</span>
      </div>
      <div class="ms-sub">近 14 天平均每个阅读日 <strong>${rateStr}</strong> 本，建议每天 ${goal} 本（新书 ${state.settings.dailyTarget||3} + 复习 ${state.settings.dailyReviewTarget||0}）</div>
    </div>`;
  html += '</div>';
  el.innerHTML = html;
}

function renderPlan() {
  if (!$('#today-date')) return;
  $('#today-date').textContent = todayStr();
  $('#daily-target').value = state.settings.dailyTarget;
  $('#daily-review').value = state.settings.dailyReviewTarget;
  $('#review-intervals').value = (state.settings.reviewIntervals || []).join(' ');
  $('#start-level').value = state.settings.startLevel;
  $$('.weekdays input').forEach(cb => {
    cb.checked = state.settings.weekdays.includes(+cb.value);
  });
  renderToday();
  renderCalendar();
  $('#cal-detail').innerHTML = '';
  renderMilestone();
}

// ===== 统计 =====
function renderStats() {
  const total = state.books.length;
  const progress = state.progress;
  let done = 0;
  for (const id in progress) if (progress[id].status === 'done') done++;
  const rate = total ? (done/total*100).toFixed(1) : '0.0';

  $('#stat-total').textContent = total;
  $('#stat-done').textContent = done;
  $('#stat-rate').textContent = rate + '%';

  let streak = 0;
  const d = new Date();
  while (true) {
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    let has = false;
    for (const id in progress) {
      const p = progress[id];
      if ((p.logs || []).some(l => l.date === ds)) { has = true; break; }
    }
    if (!has) {
      if (ds === todayStr()) { d.setDate(d.getDate() - 1); continue; }
      break;
    }
    streak++;
    d.setDate(d.getDate() - 1);
    if (streak > 365) break;
  }
  $('#stat-streak').textContent = streak;

  const stats = {};
  for (const l of LEVELS) stats[l] = { total: 0, done: 0 };
  for (const b of state.books) {
    stats[b.level].total++;
    if (progress[b.id]?.status === 'done') stats[b.level].done++;
  }
  $('#level-progress').innerHTML = LEVELS.filter(l => stats[l].total > 0).map(l => {
    const s = stats[l];
    const pct = s.total ? (s.done/s.total*100) : 0;
    return `
      <div class="level-row">
        <span class="name">${l}</span>
        <div class="progress-bar"><div class="fill ${pct===100?'done':''}" style="width:${pct.toFixed(1)}%"></div></div>
        <span class="count">${s.done}/${s.total}</span>
      </div>
    `;
  }).join('');

  const activities = [];
  for (const id in progress) {
    const p = progress[id];
    (p.logs || []).forEach(l => activities.push({ date: l.date, type: l.type, id, note: l.note }));
  }
  activities.sort((a, b) => b.date.localeCompare(a.date));
  const recent = activities.slice(0, 20);
  if (recent.length === 0) {
    $('#recent-activity').innerHTML = '<div style="color:var(--text-3);padding:10px 0">暂无活动记录</div>';
  } else {
    $('#recent-activity').innerHTML = recent.map(a => {
      const b = state.books.find(x => x.id === a.id);
      const title = b ? b.title : '(已删除)';
      const typeMap = { read: '📖 精读', review: '🔄 复习', test: '✅ 测试' };
      return `
        <div class="book-log">
          <span class="date">${a.date}</span>
          <span class="type ${a.type}">${typeMap[a.type] || a.type}</span>
          <span class="note">${escapeHtml(title)}${a.note?' · '+escapeHtml(a.note):''}</span>
        </div>
      `;
    }).join('');
  }
}

// ===== 设置页 =====
function renderSettings() {
  $('#book-count').textContent = state.books.length;
  $('#child-name').value = state.settings.childName || '';
  $('#start-date').value = state.settings.startDate || todayStr();
  $('#daily-target').value = state.settings.dailyTarget;
  $('#daily-review').value = state.settings.dailyReviewTarget;
  $('#review-intervals').value = (state.settings.reviewIntervals || []).join(' ');
  $('#start-level').value = state.settings.startLevel;
  $$('.weekdays input').forEach(cb => {
    cb.checked = state.settings.weekdays.includes(+cb.value);
  });
}

// ===== 视图切换 =====
function switchTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  if (tab === 'plan') renderPlan();
  if (tab === 'stats') renderStats();
  if (tab === 'settings') renderSettings();
}

// ===== 工具提示 =====
function flash(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--text);color:white;padding:10px 18px;border-radius:8px;z-index:9999;font-size:13px;box-shadow:var(--shadow-lg)';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ===== 库页面绑定 =====
function bindLibraryEvents() {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#filter-level').addEventListener('change', e => { state.filter.level = e.target.value; renderBookList(); });
  $('#filter-status').addEventListener('change', e => { state.filter.status = e.target.value; renderBookList(); });
  $('#search').addEventListener('input', e => { state.filter.search = e.target.value; renderBookList(); });

  $$('.mode-btn').forEach(b => {
    b.addEventListener('click', () => {
      $$('.mode-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.filter.mode = b.dataset.mode;
      renderBookList();
    });
  });

  $('#save-plan').addEventListener('click', () => {
    state.settings.dailyTarget = +$('#daily-target').value;
    state.settings.dailyReviewTarget = +$('#daily-review').value || 0;
    state.settings.reviewIntervals = parseIntervals($('#review-intervals').value);
    state.settings.startLevel = $('#start-level').value;
    state.settings.weekdays = Array.from($$('.weekdays input:checked')).map(c => +c.value);
    saveSettings();
    renderPlan();
    flash('计划已保存');
  });

  $('#export-data').addEventListener('click', () => {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      progress: state.progress,
      positions: state.positions,
      settings: state.settings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `raz-progress-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#import-data').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.progress) {
          if (confirm('导入将覆盖当前进度，是否继续？')) {
            state.progress = data.progress;
            saveProgress();
            if (data.positions) { state.positions = data.positions; savePositions(); }
            if (data.settings) {
              state.settings = { ...state.settings, ...data.settings };
              saveSettings();
            }
            renderBookList();
            flash('导入成功');
          }
        }
      } catch(err) { alert('导入失败：' + err.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('#reset-data').addEventListener('click', () => {
    if (confirm('确定要清除所有进度数据吗？此操作不可撤销！')) {
      if (confirm('再次确认：真的要重置吗？')) {
        state.progress = {};
        state.positions = {};
        saveProgress();
        savePositions();
        renderBookList();
        flash('已重置');
      }
    }
  });

  $('#rescan-books').addEventListener('click', () => {
    alert('请在终端运行：\ncd "/Users/dingke/小竹学习/通用/英语/A1014-RAZ精读视频" && python3 raz-tracker/scan_books.py\n\n然后刷新本页面。');
  });

  $('#reload-books').addEventListener('click', async () => {
    const ok = await loadBooks();
    if (ok) {
      renderBookList();
      $('#book-count').textContent = state.books.length;
      flash(`已加载 ${state.books.length} 本书`);
    } else {
      alert('无法读取 data/books.json，请用本地 HTTP 服务器打开页面（见 README）');
    }
  });

  $('#save-child').addEventListener('click', () => {
    state.settings.childName = $('#child-name').value.trim();
    state.settings.startDate = $('#start-date').value;
    saveSettings();
    flash('已保存');
  });
}

// ===== 库页面初始化 =====
async function initLibrary() {
  loadProgress();
  loadPositions();
  loadSettings();
  await loadBooks();
  bindLibraryEvents();

  const levelSel = $('#filter-level');
  const startSel = $('#start-level');
  LEVELS.forEach(l => {
    if (state.books.some(b => b.level === l)) {
      levelSel.insertAdjacentHTML('beforeend', `<option value="${l}">${l}</option>`);
    }
    startSel.insertAdjacentHTML('beforeend', `<option value="${l}">${l}</option>`);
  });

  renderBookList();
  document.body.dataset.initialized = 'library';

  if (!state.books.length) {
    $('#book-list').innerHTML = `
      <div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-2)">
        <div style="font-size:48px;margin-bottom:16px">📂</div>
        <h3 style="margin-bottom:8px">无法自动加载书单</h3>
        <p style="margin-bottom:16px;font-size:13px">
          直接用 <code>file://</code> 打开的页面无法读取本地 JSON 文件。<br>
          请用本地服务器打开，或在「设置」页上传 books.json。
        </p>
      </div>
    `;
  }
}

// ===== 暴露给书页面 =====
window.RAZ = {
  state, $, $$, loadProgress, saveProgress, loadPositions, savePositions,
  loadSettings, saveSettings, loadBooks, todayStr, formatDate, escapeHtml,
  statusLabel, guessVideoUrl, flash, LEVELS, normalizeProgress,
  MASTERY_LABELS,
  initLibrary, bindLibraryEvents, renderBookList,
};
})();