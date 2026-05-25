/* ═══════════════════════════════════════════════════════════
   TaskFlow — script.js
   All task state lives in MongoDB; this file is purely UI +
   REST API calls against /api/tasks (server.js → routes/tasks.js)
═══════════════════════════════════════════════════════════ */

/* ── State ── */
let activeFilter   = 'all';
let activePriority = null;
let activeCategory = null;
let searchQuery    = '';
let sortValue      = '-createdAt';
let searchTimer    = null;

/* ── DOM refs ── */
const taskGrid      = document.getElementById('task-grid');
const emptyState    = document.getElementById('empty-state');
const modalOverlay  = document.getElementById('modal-overlay');
const confirmOverlay= document.getElementById('confirm-overlay');
const searchInput   = document.getElementById('search-input');
const sortSelect    = document.getElementById('sort-select');

/* ════════════════════════════════════════
   API LAYER
════════════════════════════════════════ */
async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Server error');
  return json;
}

/* ════════════════════════════════════════
   LOAD & RENDER TASKS
════════════════════════════════════════ */
async function loadTasks() {
  try {
    const params = new URLSearchParams();
    if (activeFilter   !== 'all') params.set('status',   activeFilter);
    if (activePriority)           params.set('priority', activePriority);
    if (activeCategory)           params.set('category', activeCategory);
    if (searchQuery)              params.set('search',   searchQuery);
    params.set('sort', sortValue);

    const res = await api('GET', `/tasks?${params}`);
    renderTasks(res.data);
    await refreshStats();
    await refreshCategories();
    checkHealth();
  } catch (err) {
    showToast('Failed to load tasks: ' + err.message, true);
    document.getElementById('db-banner').style.display = 'block';
  }
}

function renderTasks(tasks) {
  taskGrid.innerHTML = '';

  if (!tasks.length) {
    emptyState.style.display = 'flex';
    document.getElementById('page-subtitle').textContent = '0 tasks';
    return;
  }
  emptyState.style.display = 'none';
  document.getElementById('page-subtitle').textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;

  tasks.forEach((task, i) => {
    const card = document.createElement('div');
    card.className = `task-card${task.status === 'done' ? ' is-done' : ''}`;
    card.style.animationDelay = `${Math.min(i * 0.035, 0.3)}s`;

    const descHtml = task.description
      ? `<p class="task-desc">${escHtml(task.description)}</p>` : '';

    const tagsHtml = task.tags && task.tags.length
      ? `<div class="task-tags">${task.tags.map(t => `<span class="task-tag">#${escHtml(t)}</span>`).join('')}</div>` : '';

    const dueHtml = task.dueDate ? (() => {
      const due = new Date(task.dueDate);
      const overdue = task.status !== 'done' && due < new Date();
      return `<span class="task-due${overdue ? ' overdue' : ''}" title="Due date">${formatDate(due)}</span>`;
    })() : '';

    card.innerHTML = `
      <div class="task-card-top">
        <span class="task-title">${escHtml(task.title)}</span>
        <span class="task-priority priority-${task.priority}">${task.priority}</span>
      </div>
      ${descHtml}
      <div class="task-card-meta">
        <span class="task-category">${escHtml(task.category || 'General')}</span>
        ${dueHtml}
        <span class="task-status status-${task.status}" style="margin-left:auto">${labelStatus(task.status)}</span>
      </div>
      ${tagsHtml}
      <div class="task-card-actions">
        <button class="btn-action btn-edit"   data-id="${task._id}">Edit</button>
        <button class="btn-action btn-done"   data-id="${task._id}">${task.status === 'done' ? 'Undo' : '✓ Done'}</button>
        <button class="btn-action btn-delete" data-id="${task._id}">Delete</button>
      </div>
    `;
    taskGrid.appendChild(card);
  });
}

async function refreshStats() {
  try {
    const { data } = await api('GET', '/tasks/stats');
    const { total, byStatus, byPriority } = data;

    document.getElementById('stat-total').textContent      = total;
    document.getElementById('stat-todo').textContent        = byStatus['todo']        || 0;
    document.getElementById('stat-inprogress').textContent  = byStatus['in-progress'] || 0;
    document.getElementById('stat-done').textContent        = byStatus['done']        || 0;

    document.getElementById('count-all').textContent        = total;
    document.getElementById('count-todo').textContent       = byStatus['todo']        || 0;
    document.getElementById('count-inprogress').textContent = byStatus['in-progress'] || 0;
    document.getElementById('count-done').textContent       = byStatus['done']        || 0;
    document.getElementById('count-high').textContent       = byPriority['high']      || 0;
    document.getElementById('count-medium').textContent     = byPriority['medium']    || 0;
    document.getElementById('count-low').textContent        = byPriority['low']       || 0;

    const pct = total > 0 ? Math.round(((byStatus['done'] || 0) / total) * 100) : 0;
    document.getElementById('progress-fill').style.width  = pct + '%';
    document.getElementById('progress-label').textContent = `${pct}% complete`;
  } catch (_) {}
}

async function refreshCategories() {
  try {
    const { data } = await api('GET', '/tasks/stats');
    const catNav = document.getElementById('category-nav');
    catNav.innerHTML = '';
    const cats = Object.entries(data.byCategory || {}).sort((a, b) => b[1] - a[1]);
    cats.forEach(([cat, count]) => {
      const btn = document.createElement('button');
      btn.className = `nav-item${activeCategory === cat ? ' active' : ''}`;
      btn.dataset.category = cat;
      btn.innerHTML = `<span class="nav-icon">◇</span> ${escHtml(cat)} <span class="nav-count">${count}</span>`;
      catNav.appendChild(btn);
    });
  } catch (_) {}
}

async function checkHealth() {
  try {
    const h = await api('GET', '/health');
    document.getElementById('db-banner').style.display =
      h.db === 'connected' ? 'none' : 'block';
  } catch (_) {}
}

/* ════════════════════════════════════════
   SIDEBAR FILTERS
════════════════════════════════════════ */
function setActiveNav(btn) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

document.getElementById('status-nav').addEventListener('click', e => {
  const btn = e.target.closest('.nav-item[data-filter]');
  if (!btn) return;
  setActiveNav(btn);
  activeFilter   = btn.dataset.filter;
  activePriority = null;
  activeCategory = null;
  document.getElementById('page-title').textContent = btn.textContent.replace(/\d+/g, '').trim();
  loadTasks();
});

document.querySelectorAll('.nav-item[data-priority]').forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveNav(btn);
    activePriority = btn.dataset.priority;
    activeFilter   = 'all';
    activeCategory = null;
    document.getElementById('page-title').textContent = capitalize(btn.dataset.priority) + ' Priority';
    loadTasks();
  });
});

document.getElementById('category-nav').addEventListener('click', e => {
  const btn = e.target.closest('.nav-item[data-category]');
  if (!btn) return;
  setActiveNav(btn);
  activeCategory = btn.dataset.category;
  activeFilter   = 'all';
  activePriority = null;
  document.getElementById('page-title').textContent = btn.dataset.category;
  loadTasks();
});

/* ── Search ── */
searchInput.addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTasks, 280); // debounce
});

/* ── Sort ── */
sortSelect.addEventListener('change', e => {
  sortValue = e.target.value;
  loadTasks();
});

/* ════════════════════════════════════════
   TASK ACTIONS (event delegation)
════════════════════════════════════════ */
taskGrid.addEventListener('click', async e => {
  const btn = e.target.closest('.btn-action');
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.classList.contains('btn-edit')) {
    const { data } = await api('GET', `/tasks/${id}`);
    openModal(data);
  }

  if (btn.classList.contains('btn-done')) {
    // Determine current status from the card
    const card = btn.closest('.task-card');
    const isDone = card.classList.contains('is-done');
    const newStatus = isDone ? 'todo' : 'done';
    try {
      await api('PUT', `/tasks/${id}`, { status: newStatus });
      showToast(newStatus === 'done' ? '✓ Marked as done' : 'Moved back to To Do');
      loadTasks();
    } catch (err) { showToast(err.message, true); }
  }

  if (btn.classList.contains('btn-delete')) {
    openConfirm('Delete task?', 'This action cannot be undone.', async () => {
      try {
        await api('DELETE', `/tasks/${id}`);
        showToast('Task deleted');
        loadTasks();
      } catch (err) { showToast(err.message, true); }
    });
  }
});

/* ── Clear done tasks ── */
document.getElementById('btn-clear-done').addEventListener('click', () => {
  openConfirm('Clear all done tasks?', 'All completed tasks will be permanently deleted.', async () => {
    try {
      const { deleted } = await api('DELETE', '/tasks?status=done');
      showToast(`Cleared ${deleted} completed task${deleted !== 1 ? 's' : ''}`);
      loadTasks();
    } catch (err) { showToast(err.message, true); }
  });
});

/* ════════════════════════════════════════
   TASK MODAL
════════════════════════════════════════ */
document.getElementById('btn-open-modal').addEventListener('click', () => openModal());
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

function openModal(task = null) {
  document.getElementById('modal-title').textContent    = task ? 'Edit Task' : 'New Task';
  document.getElementById('task-id').value              = task ? task._id : '';
  document.getElementById('task-title').value           = task ? task.title : '';
  document.getElementById('task-desc').value            = task ? (task.description || '') : '';
  document.getElementById('task-priority').value        = task ? task.priority : 'medium';
  document.getElementById('task-status').value          = task ? task.status   : 'todo';
  document.getElementById('task-category').value        = task ? (task.category || '') : '';
  document.getElementById('task-tags').value            = task && task.tags ? task.tags.join(', ') : '';
  document.getElementById('task-due').value             = task && task.dueDate
    ? new Date(task.dueDate).toISOString().split('T')[0] : '';
  modalOverlay.classList.add('open');
  setTimeout(() => document.getElementById('task-title').focus(), 80);
}

function closeModal() { modalOverlay.classList.remove('open'); }

document.getElementById('btn-save').addEventListener('click', async () => {
  const id          = document.getElementById('task-id').value;
  const title       = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-desc').value.trim();
  const priority    = document.getElementById('task-priority').value;
  const status      = document.getElementById('task-status').value;
  const category    = document.getElementById('task-category').value.trim() || 'General';
  const tagsRaw     = document.getElementById('task-tags').value;
  const dueRaw      = document.getElementById('task-due').value;

  if (!title) {
    highlightError('task-title');
    return;
  }

  const tags    = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const dueDate = dueRaw ? new Date(dueRaw).toISOString() : null;
  const payload = { title, description, priority, status, category, tags, dueDate };

  try {
    if (id) {
      await api('PUT', `/tasks/${id}`, payload);
      showToast('Task updated ✓');
    } else {
      await api('POST', '/tasks', payload);
      showToast('Task created ✓');
    }
    closeModal();
    loadTasks();
  } catch (err) {
    showToast(err.message, true);
  }
});

/* ════════════════════════════════════════
   CONFIRM MODAL
════════════════════════════════════════ */
let confirmCallback = null;

function openConfirm(title, msg, onOk) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-msg').textContent   = msg;
  confirmCallback = onOk;
  confirmOverlay.classList.add('open');
}
function closeConfirm() {
  confirmOverlay.classList.remove('open');
  confirmCallback = null;
}
document.getElementById('confirm-close').addEventListener('click',  closeConfirm);
document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
confirmOverlay.addEventListener('click', e => { if (e.target === confirmOverlay) closeConfirm(); });
document.getElementById('confirm-ok').addEventListener('click', async () => {
  if (confirmCallback) await confirmCallback();
  closeConfirm();
});

/* ════════════════════════════════════════
   KEYBOARD SHORTCUTS
════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeConfirm();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !modalOverlay.classList.contains('open')) {
    e.preventDefault();
    openModal();
  }
});

/* ════════════════════════════════════════
   HELPERS
════════════════════════════════════════ */
function labelStatus(s) {
  return { 'todo': 'To Do', 'in-progress': 'In Progress', 'done': 'Done' }[s] || s;
}
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatDate(d) {
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

let toastTimer;
function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

function highlightError(id) {
  const el = document.getElementById(id);
  el.style.borderColor = 'var(--high)';
  el.focus();
  setTimeout(() => { el.style.borderColor = ''; }, 1500);
}

/* ── Init ── */
loadTasks();
