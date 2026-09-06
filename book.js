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
  p.status = R.normalizeProgress(p).status;

  renderStatusField(p.status === 'done');
  if (p.status !== 'done') {
    $('#book-status').value = p.status || 'unread';
  }
  $('#book-plays').textContent = (p.plays || 0) + ' 次';
  $('#book-mastery').value = p.mastery ?? '';
  $('#book-start').value = p.startDate || '';
  $('#book-notes').value = p.notes || '';

  renderCompletionInfo();
  setStars(p.rating || 0);
  renderLogs(p.logs || []);
  renderInteractions();
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

// ===== 点赞 / 转发 / 评论 =====
function renderInteractions() {
  if (!$('#btn-like')) return;
  const p = getProgress(currentBook.id);
  const liked = !!p.liked;
  const forwards = p.forwards || 0;

  $('#btn-like').classList.toggle('active', liked);
  $('#like-label').textContent = liked ? '已赞' : '点赞';
  $('#like-count').textContent = liked ? 1 : 0;
  $('#forward-count').textContent = forwards;

  const list = $('#comment-list');
  const comments = p.comments || [];
  if (!comments.length) {
    list.innerHTML = '<div class="comment-empty">暂无评论，快来抢沙发～</div>';
    return;
  }
  list.innerHTML = comments.map((c, i) => `
    <div class="comment-item">
      <div class="comment-head">
        <span class="comment-date">${escapeHtml(c.date)}</span>
        <button title="删除" data-i="${i}" class="comment-del">✕</button>
      </div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
    </div>
  `).join('');
  list.querySelectorAll('.comment-del').forEach(btn => {
    btn.onclick = () => {
      const i = +btn.dataset.i;
      const p = getProgress(currentBook.id);
      p.comments.splice(i, 1);
      saveProgress();
      renderInteractions();
    };
  });
}

function addComment() {
  const input = $('#comment-input');
  const text = input.value.trim();
  if (!text) { flash('评论不能为空'); return; }
  const p = getProgress(currentBook.id);
  p.comments = p.comments || [];
  const now = new Date();
  const stamp = `${todayStr()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  p.comments.unshift({ date: stamp, text });
  saveProgress();
  input.value = '';
  renderInteractions();
  flash('评论已发表');
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
  p.plays = (p.plays || 0) + 1;    // 完整播放次数 +1
  if (!p.startDate) p.startDate = today;
  p.updatedAt = today;

  p.logs = p.logs || [];
  p.logs.unshift({
    date: today,
    type: 'auto',
    note: wasDone ? `再次完整观看（第 ${p.plays} 次）` : '视频播放完整，自动标记完成',
  });

  saveProgress();
  renderForm();
  flash(wasDone ? `🎉 已记录观看（共 ${p.plays} 次）` : '🎉 已自动标记为完成！');
}

// ===== 表单事件 =====
function bindFormEvents() {
  // 状态变更（未读/进行中，人工不能设 done）
  $('#book-status').addEventListener('change', e => {
    const v = e.target.value;
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

  // 掌握度（人工评级）
  $('#book-mastery').addEventListener('change', e => {
    const p = getProgress(currentBook.id);
    p.mastery = e.target.value || '';
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

  // 点赞 / 转发 / 评论
  $('#btn-like').addEventListener('click', () => {
    const p = getProgress(currentBook.id);
    p.liked = !p.liked;
    saveProgress();
    renderInteractions();
    flash(p.liked ? '👍 已点赞' : '已取消点赞');
  });

  $('#btn-forward').addEventListener('click', () => {
    const p = getProgress(currentBook.id);
    p.forwards = (p.forwards || 0) + 1;
    saveProgress();
    renderInteractions();
    flash('🔁 已转发');
  });

  $('#comment-add').addEventListener('click', addComment);
  $('#comment-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addComment();
  });

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