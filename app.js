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
function renderPlan() {
  $('#today-date').textContent = todayStr();
  $('#daily-target').value = state.settings.dailyTarget;
  $('#start-level').value = state.settings.startLevel;
  $$('.weekdays input').forEach(cb => {
    cb.checked = state.settings.weekdays.includes(+cb.value);
  });
  $('#today-list').innerHTML = renderTodayList();
  renderNextStage();
}

function renderTodayList() {
  const dow = new Date().getDay();
  if (!state.settings.weekdays.includes(dow)) {
    return '<div style="color:var(--text-3);padding:10px 0">今天不是精读日 🎉</div>';
  }
  const target = +state.settings.dailyTarget || 3;
  const recommendations = recommendBooks(target);
  if (recommendations.length === 0) {
    return '<div style="color:var(--text-3);padding:10px 0">所有书都已完成 🎉</div>';
  }
  return recommendations.map(b => {
    const p = state.progress[b.id] || {};
    const status = p.status || 'unread';
    return `
      <a class="today-item" href="book.html?id=${encodeURIComponent(b.id)}">
        <div class="today-info">
          <span class="badge">${b.level}</span>
          <span class="book-title" style="font-size:14px">${escapeHtml(b.title)}</span>
        </div>
        <span class="status-text status ${status}">${statusLabel(status)}</span>
      </a>
    `;
  }).join('');
}

function recommendBooks(n) {
  const startIdx = LEVELS.indexOf(state.settings.startLevel);
  const candidates = [];
  for (let i = startIdx; i < LEVELS.length; i++) {
    const lvl = LEVELS[i];
    const books = state.books.filter(b => b.level === lvl);
    for (const b of books) {
      const status = state.progress[b.id]?.status || 'unread';
      if (status === 'unread' || status === 'reading') {
        candidates.push({ ...b, _priority: status === 'reading' ? 0 : 1 });
      }
    }
  }
  candidates.sort((a, b) => {
    if (a._priority !== b._priority) return a._priority - b._priority;
    return (a.seq||0) - (b.seq||0);
  });
  return candidates.slice(0, n);
}

function renderNextStage() {
  const cur = state.progress;
  const levelsStats = {};
  for (const b of state.books) {
    const l = b.level;
    if (!levelsStats[l]) levelsStats[l] = { total: 0, done: 0 };
    levelsStats[l].total++;
    if (cur[b.id]?.status === 'done') levelsStats[l].done++;
  }
  let nextLevel = null;
  for (const l of LEVELS) {
    if (!levelsStats[l]) continue;
    if (levelsStats[l].done < levelsStats[l].total) {
      nextLevel = l;
      break;
    }
  }
  if (!nextLevel) {
    $('#next-stage').innerHTML = '<div style="color:var(--success);padding:10px 0">🎉 所有书都完成了！</div>';
    return;
  }
  const stat = levelsStats[nextLevel];
  const remaining = stat.total - stat.done;
  const daily = +state.settings.dailyTarget || 3;
  const days = Math.ceil(remaining / Math.max(state.settings.weekdays.length, 1));
  $('#next-stage').innerHTML = `
    <div style="padding:10px 0">
      <div style="margin-bottom:10px">
        <span style="font-size:18px;font-weight:600">等级 ${nextLevel}</span>
        <span style="color:var(--text-3);margin-left:10px">已完成 ${stat.done}/${stat.total}</span>
      </div>
      <div class="progress-bar" style="margin-bottom:12px"><div class="fill" style="width:${(stat.done/stat.total*100).toFixed(1)}%"></div></div>
      <div style="color:var(--text-2);font-size:13px">
        剩余 <strong>${remaining}</strong> 本 ·
        按每天 ${daily} 本（每周 ${state.settings.weekdays.length} 天）精读，
        预计 <strong>${days}</strong> 天完成
      </div>
    </div>
  `;
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