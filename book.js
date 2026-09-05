/* ===== RAZ 精读记录 - 书页面逻辑 ===== */
(function() {
'use strict';

const R = window.RAZ;
const { state, $, $$, saveProgress, savePositions, todayStr, escapeHtml, statusLabel, guessVideoUrl, flash } = R;

let currentBook = null;
let video = null;
let savePosTimer = null;
let videoDuration = null;

function getBookIdFromUrl() {
  const params = new URLSearchParams(location.search);
  return params.get('id');
}

function getProgress(id) {
  if (!state.progress[id]) state.progress[id] = {};
  return state.progress[id];
}

function renderHeader() {
  $('#book-title').textContent = currentBook.title;
  $('#book-level').textContent = currentBook.level;
  $('#book-code').textContent = currentBook.code || '';
}

function renderForm() {
  const p = getProgress(currentBook.id);

  renderStatusField(p.status === 'done');
  if (p.status !== 'done') {
    $('#book-status').value = p.status || 'unread';
  }
  $('#book-passes').value = p.passes ?? 3;
  $('#book-mastery').value = p.mastery ?? 0;
  $('#mastery-val').textContent = (p.mastery ?? 0) + '%';
  $('#book-start').value = p.startDate || '';
  $('#book-notes').value = p.notes || '';

  renderCompletionInfo();
  setStars(p.rating || 0);
  renderLogs(p.logs || []);
}

function renderStatusField(isDone) {
  const wrap = $('#status-wrap');
  const label = $('#status-done-label');
  if (isDone) {
    wrap.style.display = 'none';
    label.style.display = 'inline-block';
  } else {
    wrap.style.display = 'block';
    label.style.display = 'none';
  }
}

function renderCompletionInfo() {
  const p = getProgress(currentBook.id);
  const el = $('#completion-info');
  if (p.status === 'done' && p.doneDate) {
    el.innerHTML = `
      <div class="completion-banner success">
        <span class="completion-icon">✅</span>
        <div class="completion-text">
          <strong>已自动标记为完成</strong>
          <div class="completion-date">完成时间：${p.doneDate}${p.doneAt ? ' ' + p.doneAt : ''}</div>
        </div>
      </div>
    `;
  } else {
    el.innerHTML = `
      <div class="completion-banner pending">
        <span class="completion-icon">🔒</span>
        <div class="completion-text">
          <strong>未完成</strong>
          <div class="completion-date">完成需通过视频播放完整自动标记</div>
        </div>
      </div>
    `;
  }
}

function setStars(n) {
  $$('#book-stars span').forEach((el, i) => el.classList.toggle('active', i < n));
}

function renderLogs(logs) {
  const c = $('#book-logs');
  if (!logs.length) { c.innerHTML = '<div class="empty">暂无记录</div>'; return; }
  c.innerHTML = logs.map((l, i) => `
    <div class="book-log">
      <span class="date">${l.date}</span>
      <span class="type ${l.type}">${l.type==='read'?'精读':l.type==='review'?'复习':l.type==='test'?'测试':l.type==='auto'?'自动':l.type}</span>
      <span class="note">${escapeHtml(l.note||'')}</span>
      <button data-i="${i}" title="删除">✕</button>
    </div>
  `).join('');
  c.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      const i = +btn.dataset.i;
      const p = getProgress(currentBook.id);
      p.logs.splice(i, 1);
      saveProgress();
      renderLogs(p.logs);
    };
  });
}

function setupVideo() {
  video = $('#video-player');
  if (!video) return;

  const url = guessVideoUrl(currentBook);
  if (!url) {
    $('#video-wrap').innerHTML = `
      <div class="video-error">
        <div style="font-size:48px">📹</div>
        <p>无法定位视频文件</p>
        <p style="font-size:12px;color:var(--text-3)">等级 ${currentBook.level} 尚未扫描或解压</p>
      </div>
    `;
    return;
  }

  video.src = url;
  video.preload = 'metadata';

  // 恢复上次播放位置
  video.addEventListener('loadedmetadata', () => {
    videoDuration = video.duration;
    const pos = state.positions[currentBook.id];
    if (pos && pos > 5 && pos < videoDuration - 5) {
      video.currentTime = pos;
      flash(`▶ 已从上次位置 ${formatTime(pos)} 继续`);
    }
  });

  // 自动完成 - 视频播放完整后
  video.addEventListener('ended', () => {
    autoMarkComplete();
  });

  // 定期保存播放位置（debounced）
  video.addEventListener('timeupdate', () => {
    if (savePosTimer) clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
      if (video && !video.paused) {
        state.positions[currentBook.id] = video.currentTime;
        savePositions();
      }
    }, 1500);
  });

  // 离开页面前保存位置
  window.addEventListener('beforeunload', () => {
    if (video && video.currentTime > 0) {
      state.positions[currentBook.id] = video.currentTime;
      savePositions();
    }
  });

  // 首次播放时，如果状态是 unread，自动切到 reading
  video.addEventListener('play', () => {
    const p = getProgress(currentBook.id);
    if (!p.status || p.status === 'unread') {
      p.status = 'reading';
      if (!p.startDate) p.startDate = todayStr();
      saveProgress();
      $('#book-status').value = 'reading';
    }
  }, { once: true });
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function autoMarkComplete() {
  const p = getProgress(currentBook.id);
  const wasDone = p.status === 'done';
  const today = todayStr();
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  p.status = 'done';
  p.doneDate = today;
  p.doneAt = time;
  if (!p.startDate) p.startDate = today;
  p.updatedAt = today;

  p.logs = p.logs || [];
  if (!wasDone) {
    p.logs.unshift({
      date: today,
      type: 'auto',
      note: '视频播放完整，自动标记完成',
    });
  } else {
    p.logs.unshift({
      date: today,
      type: 'auto',
      note: '再次完整观看',
    });
  }

  saveProgress();
  renderForm();
  flash(wasDone ? '🎉 已记录再次观看' : '🎉 已自动标记为完成！');
}

// ===== 表单事件 =====
function bindFormEvents() {
  // 状态变更（人工不能设 done）
  $('#book-status').addEventListener('change', e => {
    let v = e.target.value;
    if (v === 'done') {
      flash('完成需通过视频播放完整自动标记');
      e.target.value = getProgress(currentBook.id).status === 'done' ? 'review' : 'reading';
      return;
    }
    const p = getProgress(currentBook.id);
    p.status = v;
    if (v === 'reading' && !p.startDate) p.startDate = todayStr();
    saveProgress();
  });

  // 评分
  $$('#book-stars span').forEach((s, i) => {
    s.addEventListener('click', () => {
      setStars(i + 1);
      const p = getProgress(currentBook.id);
      p.rating = i + 1;
      saveProgress();
    });
    s.addEventListener('mouseenter', () => {
      $$('#book-stars span').forEach((el, j) => el.style.color = j <= i ? 'var(--warning)' : '');
    });
  });
  $('#book-stars').addEventListener('mouseleave', () => {
    $$('#book-stars span').forEach(el => el.style.color = '');
  });

  // 精读次数
  $('#book-passes').addEventListener('change', e => {
    const p = getProgress(currentBook.id);
    p.passes = +e.target.value;
    saveProgress();
  });

  // 掌握度
  $('#book-mastery').addEventListener('input', e => {
    $('#mastery-val').textContent = e.target.value + '%';
  });
  $('#book-mastery').addEventListener('change', e => {
    const p = getProgress(currentBook.id);
    p.mastery = +e.target.value;
    saveProgress();
  });

  // 开始日期
  $('#book-start').addEventListener('change', e => {
    const p = getProgress(currentBook.id);
    p.startDate = e.target.value;
    saveProgress();
  });

  // 笔记（debounced）
  let noteTimer = null;
  $('#book-notes').addEventListener('input', e => {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const p = getProgress(currentBook.id);
      p.notes = e.target.value;
      saveProgress();
    }, 800);
  });

  // 添加日志
  $('#log-add').addEventListener('click', () => {
    const date = $('#log-date').value || todayStr();
    const type = $('#log-status').value;
    const note = $('#log-note').value.trim();
    const p = getProgress(currentBook.id);
    p.logs = p.logs || [];
    p.logs.unshift({ date, type, note });
    saveProgress();
    renderLogs(p.logs);
    $('#log-note').value = '';
    $('#log-date').value = '';
  });
  $('#log-date').value = todayStr();

  // 全屏按钮（备用，controls 已经自带，但显式提供以提升可见性）
  $('#btn-fullscreen')?.addEventListener('click', () => {
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      video.requestFullscreen?.();
    }
  });
}

function init() {
  const id = getBookIdFromUrl();
  if (!id) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center">缺少书籍 ID，<a href="index.html">返回书库</a></div>';
    return;
  }
  currentBook = state.books.find(b => b.id === id);
  if (!currentBook) {
    document.body.innerHTML = `<div style="padding:40px;text-align:center">找不到这本书（id: <code>${escapeHtml(id)}</code>），<a href="index.html">返回书库</a></div>`;
    return;
  }

  renderHeader();
  renderForm();
  setupVideo();
  bindFormEvents();
}

document.addEventListener('DOMContentLoaded', async () => {
  R.loadProgress();
  R.loadPositions();
  await R.loadBooks();
  init();
});
})();