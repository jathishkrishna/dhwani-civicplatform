// ============================================================
// Dhwani — PROFESSIONAL CIVIC TECH PLATFORM
// Complete Frontend Application & Single Page Router
// ============================================================

const API = '';

// Category Configuration & Colors (matching exact specification)
const CATEGORIES = {
  'Road damage and potholes': {
    emoji: '🛣️',
    color: '#e03131', // Red
    dept: 'PWD (Roads & Infrastructure)',
    sla: '7 days',
    desc: 'Potholes, cracks, broken bitumen, and road cave-ins'
  },
  'Garbage and waste management': {
    emoji: '🗑️',
    color: '#f08c00', // Orange
    dept: 'Health & Sanitation Section',
    sla: '24 hours',
    desc: 'Overflowing bins, illegal garbage dumping, and street litter'
  },
  'Water leakage': {
    emoji: '💧',
    color: '#1971c2', // Blue
    dept: 'Mangaluru City Water Supply Board',
    sla: '48 hours',
    desc: 'Burst pipelines, leaking valves, and low water pressure'
  },
  'Drainage and sewage': {
    emoji: '🌊',
    color: '#9c36b5', // Purple
    dept: 'Engineering Section (Drainage & Sewage)',
    sla: '72 hours',
    desc: 'Blocked stormwater drains, overflowing manholes, and sewage'
  },
  'Streetlight failure': {
    emoji: '💡',
    color: '#f59f00', // Yellow
    dept: 'MESCOM (Electrical Division)',
    sla: '48 hours',
    desc: 'Dark streetlights, flickering lamps, and broken poles'
  },
  'Electricity and exposed wires': {
    emoji: '⚡',
    color: '#e8590c', // Amber
    dept: 'MESCOM (Electrical Division)',
    sla: '12 hours',
    desc: 'Hanging live wires, damaged transformer, and electrocution hazards'
  },
  'Public safety': {
    emoji: '🚨',
    color: '#c92a2a', // Dark red
    dept: 'Mangaluru City Traffic Police',
    sla: '12 hours',
    desc: 'Unsafe crossings, open construction pits, and missing railings'
  },
  'Traffic problems': {
    emoji: '🚦',
    color: '#d9480f', // Orange-red
    dept: 'Mangaluru City Traffic Police',
    sla: '12 hours',
    desc: 'Illegal parking, broken signals, and severe bottlenecks'
  },
  'Park and public-space maintenance': {
    emoji: '🌳',
    color: '#2f9e44', // Green
    dept: 'Parks & Public Spaces Department',
    sla: '4 days',
    desc: 'Damaged playground equipment, overgrown weeds, broken benches'
  },
  'Other civic issues': {
    emoji: '📌',
    color: '#868e96', // Gray
    dept: 'Ward Office / General Administration',
    sla: '5 days',
    desc: 'Encroachments, stray animal menace, noise pollution, etc.'
  }
};

// Aliases for legacy categories
const CATEGORY_ALIASES = {
  'Garbage / Illegal Dumping': 'Garbage and waste management',
  'Pothole / Road Damage': 'Road damage and potholes',
  'Broken Streetlight': 'Streetlight failure',
  'Drainage / Waterlogging': 'Drainage and sewage',
  'Beach / Public Space Litter': 'Garbage and waste management',
  'Traffic / Parking': 'Traffic problems',
  'Other': 'Other civic issues'
};

function getCategoryConfig(cat) {
  const normalized = CATEGORY_ALIASES[cat] || cat;
  return CATEGORIES[normalized] || CATEGORIES['Other civic issues'];
}

// Mangaluru Map Constants
const MANGALURU_CENTER = [12.9141, 74.8560];
const MANGALURU_ZOOM = 13;

const AREA_COORDS = {
  'Hampankatta':     [12.8698, 74.8426],
  'Kadri':           [12.8950, 74.8550],
  'Kottara':         [12.9160, 74.8320],
  'Bejai':           [12.8870, 74.8430],
  'Balmatta':        [12.8750, 74.8480],
  'Surathkal':       [13.0068, 74.7944],
  'Kankanady':       [12.8760, 74.8620],
  'Ullal':           [12.8050, 74.8500],
  'Panambur':        [12.9450, 74.8020],
  'Other Mangaluru': [12.9141, 74.8560]
};

// ============================================================
// State Store
// ============================================================
const state = {
  user: null,
  token: localStorage.getItem('Dhwani_token') || null,
  notifications: [],
  complaintsCache: [],
  currentRoute: '/',
  pendingLocation: null,
  postLoginRedirect: null,
  activeMap: null,
  activeCluster: null,
  activeHeat: null,
  heatEnabled: false
};

// ============================================================
// API Helpers
// ============================================================
async function apiRequest(endpoint, options = {}) {
  const { noAuth, ...fetchOptions } = options;
  const headers = { ...fetchOptions.headers };
  if (state.token && !noAuth) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  headers['X-Device-Id'] = getDeviceId();
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API}${endpoint}`, { ...fetchOptions, headers });
  if (res.status === 401 && !noAuth) {
    // Session expired
    state.user = null;
    state.token = null;
    localStorage.removeItem('Dhwani_token');
    updateHeaderAuthUI();
  }
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP ${res.status}: Failed request`);
  }
  return res.json();
}

async function fetchComplaints(query = {}) {
  const q = new URLSearchParams(query).toString();
  return apiRequest(`/api/complaints${q ? '?' + q : ''}`);
}

async function fetchComplaint(id) {
  return apiRequest(`/api/complaints/${encodeURIComponent(id)}`);
}

async function fetchSummaryStats() {
  return apiRequest('/api/stats/summary');
}

async function fetchAnalytics() {
  return apiRequest('/api/stats/analytics');
}

async function fetchDepartments() {
  return apiRequest('/api/departments');
}

async function fetchUserNotifications() {
  if (!state.token) return [];
  return apiRequest('/api/notifications');
}


// ============================================================
// Device identity, report ownership & community voting helpers
// ============================================================
// Statuses in which the person who filed a report may still delete it.
// Once officials start work, the report is part of the public audit trail.
// Set to null to allow deletion at any status.
const DELETABLE_STATUSES = ['Submitted', 'Verified', 'Rejected'];

function getDeviceId() {
  try {
    let id = localStorage.getItem('Dhwani_device');
    if (!id) {
      id = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'dev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('Dhwani_device', id);
    }
    return id;
  } catch (e) {
    return 'dev-session-' + (window.__dhwaniTmpDevice = window.__dhwaniTmpDevice || Math.random().toString(36).slice(2, 12));
  }
}

// Delete tokens are issued by the server when a report is created. They let
// anonymous / guest reporters prove ownership later without any account.
function getOwnedTokens() {
  try { return JSON.parse(localStorage.getItem('Dhwani_owned') || '{}'); } catch (e) { return {}; }
}
function saveOwnedToken(id, token) {
  if (!id || !token) return;
  const all = getOwnedTokens();
  all[id] = token;
  try { localStorage.setItem('Dhwani_owned', JSON.stringify(all)); } catch (e) {}
}
function removeOwnedToken(id) {
  const all = getOwnedTokens();
  delete all[id];
  try { localStorage.setItem('Dhwani_owned', JSON.stringify(all)); } catch (e) {}
}

function isComplaintOwner(c) {
  if (!c) return false;
  if (getOwnedTokens()[c.id]) return true;
  return !!(state.user && c.reporterId && c.reporterId === state.user.id) || !!c.isOwner;
}
function canDeleteComplaint(c) {
  if (!isComplaintOwner(c)) return false;
  return !DELETABLE_STATUSES || DELETABLE_STATUSES.includes(c.status);
}

async function deleteComplaint(id, { redirect = '/my-complaints', onDone } = {}) {
  if (!confirm(`Delete report ${id}?\n\nThis permanently removes the report, its photos and its votes. This cannot be undone.`)) return;
  try {
    await apiRequest(`/api/complaints/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ deleteToken: getOwnedTokens()[id] || null })
    });
    removeOwnedToken(id);
    showToast(`Report ${id} deleted`, 'success');
    if (onDone) onDone();
    else navigate(redirect);
  } catch (err) {
    showToast(err.message || 'Could not delete this report', 'error');
  }
}
window.deleteComplaint = deleteComplaint;

// ---- Community voting ("I'm affected too") ----
function voteButtonHtml(c, { large = false } = {}) {
  const voted = !!c.hasVoted;
  const votes = Number(c.votes) || 0;
  return `
    <button type="button" class="vote-btn ${voted ? 'voted' : ''} ${large ? 'vote-btn-lg' : ''}"
            data-vote-id="${escapeHtml(c.id)}" aria-pressed="${voted}"
            title="${voted ? 'Remove your vote' : 'I am affected too: upvote this issue'}"
            onclick="toggleVote('${escapeHtml(c.id)}', event)">
      <span class="vote-arrow">▲</span>
      <span class="vote-count">${votes}</span>
      ${large ? `<span class="vote-label">${voted ? 'You upvoted this' : 'Upvote this issue'}</span>` : ''}
    </button>
  `;
}

async function toggleVote(id, ev) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  const buttons = document.querySelectorAll(`[data-vote-id="${CSS.escape(id)}"]`);
  buttons.forEach(b => b.disabled = true);
  try {
    const res = await apiRequest(`/api/complaints/${encodeURIComponent(id)}/vote`, { method: 'POST' });
    buttons.forEach(b => {
      b.classList.toggle('voted', !!res.voted);
      b.setAttribute('aria-pressed', String(!!res.voted));
      b.querySelector('.vote-count').textContent = res.votes;
      const label = b.querySelector('.vote-label');
      if (label) label.textContent = res.voted ? 'You upvoted this' : 'Upvote this issue';
    });
    const summary = document.getElementById('voteSummaryText');
    if (summary) summary.textContent = voteSummaryText(res.votes);
  } catch (err) {
    showToast(err.message || 'Could not record your vote', 'error');
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
}
window.toggleVote = toggleVote;

function voteSummaryText(n) {
  n = Number(n) || 0;
  if (n === 0) return 'Be the first to confirm this issue affects you.';
  return n === 1 ? '1 citizen says this affects them.' : `${n} citizens say this affects them.`;
}

// Toast
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  const icons = { info: 'ℹ️', success: '✓', error: '⚠️' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================================
// Auth Management
// ============================================================
async function initAuth() {
  if (!state.token) {
    updateHeaderAuthUI();
    return;
  }
  try {
    const res = await apiRequest('/api/auth/me');
    state.user = res.user;
    updateHeaderAuthUI();
    loadNotifications();
  } catch (err) {
    state.token = null;
    state.user = null;
    localStorage.removeItem('Dhwani_token');
    updateHeaderAuthUI();
  }
}

function updateHeaderAuthUI() {
  const container = document.getElementById('authNavContainer');
  const mobileContainer = document.getElementById('mobileAuthSection');
  if (!container) return;

  if (state.user) {
    const initials = state.user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const isAdmin = state.user.role === 'admin';

    container.innerHTML = `
      <button id="userProfileBtn" class="user-menu-btn" type="button">
        <span class="user-avatar-sm">${initials}</span>
        <span class="user-menu-name">${state.user.name.split(' ')[0]}</span>
        <span class="user-role-badge ${isAdmin ? 'admin' : ''}">${isAdmin ? 'Officer' : 'Citizen'}</span>
        <span style="font-size: 10px; color: var(--ink-400);">▼</span>
      </button>
      <div id="userDropdown" class="dropdown-menu">
        <div style="padding: 10px 14px; border-bottom: 1px solid var(--ink-100);">
          <div style="font-weight: 800; font-size: 13px; color: var(--ink-900);">${state.user.name}</div>
          <div style="font-size: 11px; color: var(--ink-400);">${state.user.email}</div>
        </div>
        <a class="dropdown-item" href="/profile" data-link>👤 Profile & Settings</a>
        <a class="dropdown-item" href="/my-complaints" data-link>📁 My Complaints</a>
        ${isAdmin ? `
          <div class="dropdown-divider"></div>
          <div style="padding: 4px 14px; font-size: 10px; font-weight: 800; color: var(--ink-400); text-transform: uppercase;">Admin Console</div>
          <a class="dropdown-item" href="/admin" data-link>📊 Dashboard</a>
          <a class="dropdown-item" href="/admin/complaints" data-link>⚙️ Manage Complaints</a>
          <a class="dropdown-item" href="/admin/analytics" data-link>📈 Analytics</a>
        ` : ''}
        <div class="dropdown-divider"></div>
        <button id="logoutBtn" class="dropdown-item" style="width: 100%; border: 0; background: none; color: #e03131;">
          🚪 Sign Out
        </button>
      </div>
    `;

    document.getElementById('userProfileBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('userDropdown')?.classList.toggle('show');
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      logout();
    });

    if (mobileContainer) {
      mobileContainer.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
          <span class="user-avatar-sm">${initials}</span>
          <div>
            <div style="font-weight: 700; font-size: 13px;">${state.user.name}</div>
            <div style="font-size: 11px; color: var(--ink-500);">${state.user.role}</div>
          </div>
        </div>
        <button id="mobileLogoutBtn" class="btn btn-ghost btn-sm" style="width: 100%;">Sign Out</button>
      `;
      document.getElementById('mobileLogoutBtn')?.addEventListener('click', () => logout());
    }
  } else {
    container.innerHTML = `
      <a class="btn btn-ghost btn-sm" href="/login" data-link>Sign In</a>
    `;
    if (mobileContainer) {
      mobileContainer.innerHTML = `
        <div style="display: flex; gap: 10px;">
          <a class="btn btn-primary btn-sm" style="flex: 1;" href="/login" data-link>Sign In</a>
          <a class="btn btn-ghost btn-sm" style="flex: 1;" href="/register" data-link>Register</a>
        </div>
      `;
    }
  }
}

async function logout() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
  } catch (e) {}
  state.token = null;
  state.user = null;
  localStorage.removeItem('Dhwani_token');
  updateHeaderAuthUI();
  showToast('Signed out successfully');
  navigate('/');
}

async function loadNotifications() {
  if (!state.user) return;
  try {
    const list = await fetchUserNotifications();
    state.notifications = list;
    const unread = list.filter(n => !n.read).length;

    const badge = document.getElementById('notifBadge');
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? 'inline-block' : 'none';
    }

    const listEl = document.getElementById('notifList');
    if (listEl) {
      if (list.length === 0) {
        listEl.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--ink-400); font-size: 12px;">No notifications</div>';
      } else {
        listEl.innerHTML = list.slice(0, 6).map(n => `
          <div class="notif-dropdown-item" data-id="${n.id}" data-complaint-id="${n.complaintId || ''}" style="
            padding: 10px 14px; border-bottom: 1px solid var(--ink-100); cursor: pointer;
            background: ${n.read ? 'transparent' : 'var(--brand-50)'};
            transition: background .2s ease;
          ">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong style="font-size: 12px; color: var(--ink-900);">${n.title}</strong>
              <small style="font-size: 10px; color: var(--ink-400);">${timeAgo(n.createdAt)}</small>
            </div>
            <p style="margin: 4px 0 0; font-size: 11px; color: var(--ink-600); line-height: 1.4;">${n.message}</p>
          </div>
        `).join('');

        listEl.querySelectorAll('.notif-dropdown-item').forEach(el => {
          el.addEventListener('click', async () => {
            const notifId = el.getAttribute('data-id');
            const compId = el.getAttribute('data-complaint-id');
            try {
              await apiRequest(`/api/notifications/${notifId}/read`, { method: 'PATCH' });
            } catch (e) {}
            document.getElementById('notifDropdown')?.classList.remove('show');
            if (compId) {
              navigate(`/track?id=${compId}`);
            } else {
              navigate('/notifications');
            }
          });
        });
      }
    }
  } catch (err) {
    console.warn('Could not load notifications', err);
  }
}

// ============================================================
// Client-Side Router
// ============================================================
function navigate(url, pushState = true) {
  // Officers have their own console: keep them off the citizen-only pages
  if (state.user?.role === 'admin') {
    const p0 = url.split('?')[0];
    if (p0 === '/map') {
      url = '/admin/map' + (url.includes('?') ? '?' + url.split('?')[1] : '');
      pushState = false;
      window.history.replaceState({}, '', url);
    } else if (['/', '/home', '/report', '/complaints', '/my-complaints'].includes(p0)) {
      url = '/admin';
      pushState = false;
      window.history.replaceState({}, '', url);
    }
  }
  if (pushState) {
    window.history.pushState({}, '', url);
  }
  state.currentRoute = url;

  // Close mobile drawer and dropdowns
  document.getElementById('mobileDrawerOverlay')?.classList.remove('open');
  document.getElementById('userDropdown')?.classList.remove('show');
  document.getElementById('notifDropdown')?.classList.remove('show');

  // Update navbar active link
  updateNavActiveState(url);

  // Parse path and query
  const [path, queryString] = url.split('?');
  const params = new URLSearchParams(queryString || '');

  document.body.classList.toggle('admin-mode', state.user?.role === 'admin' && path !== '/login' && path !== '/register');

  // Route dispatcher
  window.scrollTo({ top: 0, behavior: 'smooth' });

  if (path === '/' || path === '/home') {
    renderHomePage();
  } else if (path === '/report') {
    renderReportPage();
  } else if (path === '/track') {
    const id = params.get('id');
    renderTrackPage(id);
  } else if (path.startsWith('/track/')) {
    const id = path.split('/')[2];
    renderTrackPage(id);
  } else if (path === '/complaints') {
    renderComplaintsPage(params);
  } else if (path === '/map') {
    renderMapPage(params);
  } else if (path === '/my-complaints') {
    renderMyComplaintsPage();
  } else if (path === '/notifications') {
    renderNotificationsPage();
  } else if (path === '/profile') {
    renderProfilePage();
  } else if (path === '/login') {
    renderLoginPage();
  } else if (path === '/register') {
    renderRegisterPage();
  } else if (path === '/admin/map') {
    renderMapPage(params);
  } else if (path === '/admin') {
    renderAdminDashboardPage();
  } else if (path === '/admin/complaints') {
    renderAdminComplaintsPage();
  } else if (path === '/admin/analytics') {
    renderAdminAnalyticsPage();
  } else {
    render404Page();
  }

  // Shared pages (map, tracking, notifications, profile) get the officer layout too
  if (state.user?.role === 'admin') {
    const sharedKey = { '/admin/map': 'map', '/notifications': 'notifications', '/profile': 'profile' }[path]
      || (path.startsWith('/track') ? 'complaints' : null);
    if (sharedKey) mountAdminShell(sharedKey);
  }
}

function updateNavActiveState(url) {
  const [cleanPath] = url.split('?');
  document.querySelectorAll('#desktopNav a, #mobileNavLinks a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === cleanPath || (cleanPath.startsWith(href) && href !== '/')) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });
}

// Global click delegation for internal routing
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]') || e.target.closest('a[href^="/"]');
  if (link && !link.hasAttribute('target') && !link.hasAttribute('download')) {
    const href = link.getAttribute('href');
    if (href && href.startsWith('/') && !href.startsWith('/api') && !href.startsWith('/uploads')) {
      e.preventDefault();
      navigate(href);
    }
  }
});

window.addEventListener('popstate', () => {
  navigate(window.location.pathname + window.location.search, false);
});

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('#userProfileBtn') && !e.target.closest('#userDropdown')) {
    document.getElementById('userDropdown')?.classList.remove('show');
  }
  if (!e.target.closest('#notifBellBtn') && !e.target.closest('#notifDropdown')) {
    document.getElementById('notifDropdown')?.classList.remove('show');
  }
});

// ============================================================
// MAP GENERATION HELPERS
// ============================================================
function getCategoryColor(category) {
  return getCategoryConfig(category).color;
}

function getCategoryEmoji(category) {
  return getCategoryConfig(category).emoji;
}

function createMapMarker(complaint) {
  const cat = getCategoryConfig(complaint.category);
  const color = cat.color;
  const emoji = cat.emoji;
  const coords = complaint.coords || AREA_COORDS[complaint.area] || MANGALURU_CENTER;

  // Status border color
  const statusColor = {
    'Submitted':   '#ef9c46',
    'Verified':    '#3b82f6',
    'Assigned':    '#6366f1',
    'In Progress': '#087f5b',
    'Resolved':    '#10b981',
    'Rejected':    '#ef4444'
  }[complaint.status] || '#087f5b';

  const icon = L.divIcon({
    className: 'custom-pin-wrapper',
    html: `
      <div class="custom-pin-marker" style="background:${color};">
        <div class="status-ring" style="border-color:${statusColor};"></div>
        <span>${emoji}</span>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -34]
  });

  const marker = L.marker(coords, { icon });
  marker.complaintData = complaint;

  const photoHtml = (complaint.photos && complaint.photos.length > 0)
    ? `<img src="${complaint.photos[0]}" style="width: 100%; height: 110px; object-fit: cover; border-radius: 8px; margin: 8px 0;" alt="evidence">`
    : (complaint.photo ? `<img src="${complaint.photo}" style="width: 100%; height: 110px; object-fit: cover; border-radius: 8px; margin: 8px 0;" alt="evidence">` : '');

  const popupHtml = `
    <div>
      <div class="popup-cat">${emoji} ${complaint.category}</div>
      <div class="popup-id">${complaint.id}</div>
      <div class="popup-title">${escapeHtml(complaint.title)}</div>
      ${photoHtml}
      <div class="popup-meta">📍 <b>${complaint.area || 'Mangaluru'}</b>${complaint.landmark ? ' · ' + escapeHtml(complaint.landmark) : ''}</div>
      <div class="popup-meta">🏛️ ${complaint.department || 'Ward Office'}</div>
      <div class="popup-meta">📅 ${formatDate(complaint.createdAt)}</div>
      <div class="popup-footer">
        <span class="status-badge ${getStatusBadgeClass(complaint.status)}">${complaint.status}</span>
        <a href="/track?id=${complaint.id}" data-link style="font-size: 11px; font-weight: 800; color: var(--brand-700);">Track Details →</a>
      </div>
    </div>
  `;

  marker.bindPopup(popupHtml, { maxWidth: 280 });
  return marker;
}

// ============================================================
// PAGE: HOME (/)
// ============================================================
async function renderHomePage() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- Hero Section -->
    <section class="hero">
      <div class="hero-glow"></div>
      <div class="container hero-grid">
        <div class="hero-copy">
          <div class="eyebrow"><span class="pulse-dot"></span> Mangaluru Smart Civic Tech</div>
          <h1>See an issue?<br><em>Raise your voice.</em></h1>
          <p class="hero-text">
            Report potholes, overflowing garbage, drainage blockages, broken streetlights and water leaks in Mangaluru. Every complaint receives a verified reference ID, department SLA, and trackable real-time resolution.
          </p>
          <div class="hero-actions">
            <a class="btn btn-primary btn-lg" href="/report" data-link>Report Civic Issue <span>→</span></a>
            <a class="btn btn-ghost btn-lg" href="/track" data-link>Track Complaint</a>
            <a class="btn btn-outline btn-lg" href="/map" data-link>Explore Live Map</a>
          </div>
          <div class="trust-row">
            <span>✓ Verified Reference IDs</span>
            <span>✓ Real-Time Map</span>
            <span>✓ Municipal Department Routing</span>
            <span>✓ Public Accountability</span>
          </div>
        </div>

        <div class="hero-card-wrap">
          <div class="hero-card">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <span class="eyebrow" style="font-size: 10px;">CITY DASHBOARD</span>
                <h3 style="margin: 4px 0 0; font-family: 'Plus Jakarta Sans', sans-serif;">Mangaluru Municipal Corp</h3>
              </div>
              <span class="status-badge progress">● MCC LIVE</span>
            </div>

            <!-- Mini Live Map Preview -->
            <div id="heroMapPreview" class="hero-map-preview"></div>

            <!-- Live KPI Counters -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; border-top: 1px solid var(--ink-100); padding-top: 16px; text-align: center;">
              <div>
                <strong id="heroStatTotal" style="display: block; font-size: 22px; font-family: 'Plus Jakarta Sans', sans-serif; color: var(--ink-900);">--</strong>
                <span style="font-size: 10px; color: var(--ink-400); font-weight: 700; text-transform: uppercase;">Total</span>
              </div>
              <div>
                <strong id="heroStatPending" style="display: block; font-size: 22px; font-family: 'Plus Jakarta Sans', sans-serif; color: var(--status-submitted);">--</strong>
                <span style="font-size: 10px; color: var(--ink-400); font-weight: 700; text-transform: uppercase;">Review</span>
              </div>
              <div>
                <strong id="heroStatProgress" style="display: block; font-size: 22px; font-family: 'Plus Jakarta Sans', sans-serif; color: var(--brand-600);">--</strong>
                <span style="font-size: 10px; color: var(--ink-400); font-weight: 700; text-transform: uppercase;">In Action</span>
              </div>
              <div>
                <strong id="heroStatResolved" style="display: block; font-size: 22px; font-family: 'Plus Jakarta Sans', sans-serif; color: var(--status-resolved);">--</strong>
                <span style="font-size: 10px; color: var(--ink-400); font-weight: 700; text-transform: uppercase;">Resolved</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Categories Section -->
    <section class="category-section">
      <div class="container">
        <div style="text-align: center; max-width: 680px; margin: 0 auto 36px;">
          <span class="eyebrow">WHAT TO REPORT</span>
          <h2 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 32px; font-weight: 800; margin: 10px 0;">
            Comprehensive civic reporting for every street.
          </h2>
          <p style="color: var(--ink-500); font-size: 15px;">
            Choose from 10 standardized civic categories to automatically route your complaint to the concerned Mangaluru municipal department.
          </p>
        </div>

        <div class="category-cards">
          ${Object.entries(CATEGORIES).map(([name, cat]) => `
            <div class="cat-card" onclick="navigate('/report?category=' + encodeURIComponent('${name}'))">
              <div class="cat-icon-wrap" style="background: ${cat.color}15; color: ${cat.color};">
                ${cat.emoji}
              </div>
              <h4>${name}</h4>
              <p>${cat.desc}</p>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: auto; font-size: 11px; font-weight: 700;">
                <span style="color: var(--ink-400);">SLA: ${cat.sla}</span>
                <span style="color: var(--brand-600);">Report →</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- How It Works Section -->
    <section class="how-section">
      <div class="container">
        <div style="text-align: center; max-width: 640px; margin: 0 auto 36px;">
          <span class="eyebrow">TRANSPARENT PROCESS</span>
          <h2 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 32px; font-weight: 800; margin: 10px 0;">
            From problem to resolution in 4 steps.
          </h2>
          <p style="color: var(--ink-500); font-size: 15px;">
            Designed for citizen convenience and administrative accountability.
          </p>
        </div>

        <div class="steps-grid">
          <div class="step-item">
            <span class="step-num">01</span>
            <div class="step-icon">📸</div>
            <h3>Report with Location</h3>
            <p>Pinpoint the location on the Mangaluru map, select category, and upload photo/video proof.</p>
          </div>
          <div class="step-item">
            <span class="step-num">02</span>
            <div class="step-icon">🪪</div>
            <h3>Get Unique Reference ID</h3>
            <p>Receive an immutable tracking ID (e.g. CP-2026-00042) routed directly to the responsible engineer.</p>
          </div>
          <div class="step-item">
            <span class="step-num">03</span>
            <div class="step-icon">⏱️</div>
            <h3>Track Real-Time Progress</h3>
            <p>Monitor your issue through Verified, Assigned, In-Progress, and Resolution milestones.</p>
          </div>
          <div class="step-item">
            <span class="step-num">04</span>
            <div class="step-icon">✅</div>
            <h3>Verified Resolution</h3>
            <p>Officers submit photographic proof upon work completion, and citizens receive final notification.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Recent Complaints Feed -->
    <section style="padding: 80px 0;">
      <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 32px; flex-wrap: wrap; gap: 16px;">
          <div>
            <span class="eyebrow">COMMUNITY ACTIVITY</span>
            <h2 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 30px; font-weight: 800; margin: 8px 0 0;">
              Recently Reported Civic Issues
            </h2>
          </div>
          <a class="btn btn-ghost" href="/complaints" data-link>View All Issues →</a>
        </div>

        <div id="homeRecentComplaintsGrid" class="complaint-grid">
          <div style="padding: 40px; text-align: center; color: var(--ink-400); grid-column: 1 / -1;">Loading civic issues...</div>
        </div>
      </div>
    </section>

    <!-- Community Impact Banner -->
    <section style="padding: 60px 0; background: linear-gradient(135deg, var(--brand-700), var(--brand-900)); color: #fff;">
      <div class="container">
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 30px; text-align: center;">
          <div>
            <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 40px; font-weight: 800; color: #a7edcf;">60+</div>
            <div style="font-size: 13px; color: #d5f7e8; margin-top: 4px;">MCC Wards Covered</div>
          </div>
          <div>
            <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 40px; font-weight: 800; color: #a7edcf;">92%</div>
            <div style="font-size: 13px; color: #d5f7e8; margin-top: 4px;">SLA Compliance Rate</div>
          </div>
          <div>
            <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 40px; font-weight: 800; color: #a7edcf;">24 hrs</div>
            <div style="font-size: 13px; color: #d5f7e8; margin-top: 4px;">Avg Sanitation Response</div>
          </div>
          <div>
            <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 40px; font-weight: 800; color: #a7edcf;">100%</div>
            <div style="font-size: 13px; color: #d5f7e8; margin-top: 4px;">Public Auditability</div>
          </div>
        </div>
      </div>
    </section>
  `;

  // Initialize stats and mini map preview
  try {
    const stats = await fetchSummaryStats();
    document.getElementById('heroStatTotal').textContent = stats.total;
    document.getElementById('heroStatPending').textContent = stats.pending;
    document.getElementById('heroStatProgress').textContent = stats.inProgress + stats.assigned;
    document.getElementById('heroStatResolved').textContent = stats.resolved;

    // Load recent complaints
    const recent = await fetchComplaints({ sort: 'newest' });
    const grid = document.getElementById('homeRecentComplaintsGrid');
    if (grid) {
      if (recent.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; color: var(--ink-400); padding: 30px;">No complaints submitted yet. Be the first to report!</div>';
      } else {
        grid.innerHTML = recent.slice(0, 3).map(c => renderComplaintCard(c)).join('');
      }
    }

    // Initialize Hero Leaflet Map Preview
    const previewEl = document.getElementById('heroMapPreview');
    if (previewEl && typeof L !== 'undefined') {
      const isTouch = L.Browser.mobile || L.Browser.touch;
      const heroMap = L.map('heroMapPreview', {
        center: MANGALURU_CENTER,
        zoom: 12,
        minZoom: 10,
        maxZoom: 18,
        zoomControl: false,
        attributionControl: false,
        dragging: true,              // drag to pan
        touchZoom: true,             // pinch to zoom
        doubleClickZoom: true,
        scrollWheelZoom: false,      // enabled only after the map is clicked (see below)
        boxZoom: false,
        keyboard: true,
        tap: false                   // avoids ghost-click issues on iOS
      });
      L.control.zoom({ position: 'bottomright' }).addTo(heroMap);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(heroMap);

      // Wheel zoom only once the user focuses the map, so the page can still scroll past it
      heroMap.on('focus click', () => heroMap.scrollWheelZoom.enable());
      heroMap.on('blur mouseout', () => heroMap.scrollWheelZoom.disable());

      const bounds = [];
      recent.slice(0, 10).forEach(c => {
        if (c.coords) {
          createMapMarker(c).addTo(heroMap);
          bounds.push(c.coords);
        }
      });

      // Fit all pins in view (with room for marker height), then fix sizing after layout
      if (bounds.length > 1) {
        heroMap.fitBounds(bounds, { paddingTopLeft: [30, 50], paddingBottomRight: [30, 20], maxZoom: 14 });
      }
      setTimeout(() => heroMap.invalidateSize(), 200);
    }
  } catch (err) {
    console.warn('Error loading home stats', err);
  }
}

// Complaint Card Component
function renderComplaintCard(c) {
  const cat = getCategoryConfig(c.category);
  const photoUrl = (c.photos && c.photos[0]) || c.photo || null;
  const imageMarkup = photoUrl
    ? `<img src="${photoUrl}" alt="${escapeHtml(c.title)}" loading="lazy">`
    : `<div style="height: 100%; display: grid; place-items: center; font-size: 40px; background: ${cat.color}10;">${cat.emoji}</div>`;

  return `
    <article class="complaint-card" onclick="navigate('/track?id=' + '${c.id}')" style="cursor: pointer;">
      <div class="complaint-card-image">
        ${imageMarkup}
        <span class="status-badge ${getStatusBadgeClass(c.status)}" style="position: absolute; top: 12px; left: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.2);">
          ${c.status}
        </span>
        <span class="priority-badge priority-${(c.priority || 'medium').toLowerCase()}" style="position: absolute; top: 12px; right: 12px;">
          ${c.priority || 'Medium'}
        </span>
      </div>
      <div class="complaint-card-body">
        <div class="complaint-card-meta">
          <span class="category-pill" style="border-left: 3px solid ${cat.color};">
            ${cat.emoji} ${c.category}
          </span>
          <small style="font-size: 11px; color: var(--ink-400);">${timeAgo(c.createdAt)}</small>
        </div>
        <h3 class="complaint-card-title">${escapeHtml(c.title)}</h3>
        <p class="complaint-card-desc">${escapeHtml(c.description)}</p>
        <div class="complaint-card-footer">
          <span style="font-size: 12px; color: var(--ink-600); font-weight: 600;">
            📍 ${c.area || 'Mangaluru'}
          </span>
          ${voteButtonHtml(c)}
          <span style="font-size: 12px; font-weight: 800; color: var(--brand-700);">
            Track ${c.id} →
          </span>
        </div>
      </div>
    </article>
  `;
}

// ============================================================
// PAGE: REPORT ISSUE (/report)
// ============================================================
function renderReportPage() {
  const app = document.getElementById('app');
  const queryParams = new URLSearchParams(window.location.search);
  const preselectedCat = queryParams.get('category') || 'Road damage and potholes';

  // Sign-in required: citizens cannot file a report without an account
  if (!state.user) {
    state.postLoginRedirect = '/report' + window.location.search;
    app.innerHTML = `
      <div class="container narrow" style="padding: 60px 0;">
        <div class="card" style="text-align: center; padding: 48px 28px; border-radius: var(--radius-xl);">
          <div style="font-size: 40px; margin-bottom: 12px;">🔐</div>
          <span class="eyebrow">SIGN IN REQUIRED</span>
          <h1 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 28px; font-weight: 800; margin: 10px 0;">
            Please sign in to report an issue
          </h1>
          <p style="color: var(--ink-500); max-width: 460px; margin: 0 auto 26px;">
            Reports are linked to a verified citizen account so officers can follow up and you can track every update from your dashboard.
          </p>
          <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
            <a class="btn btn-primary btn-lg" href="/login" data-link>Sign In →</a>
            <a class="btn btn-ghost btn-lg" href="/register" data-link>Create Account</a>
          </div>
          <div style="margin-top: 22px; font-size: 13px;">
            <a href="/track" data-link style="font-weight: 800; color: var(--brand-700);">Just want to track a complaint? No sign-in needed →</a>
          </div>
        </div>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    <div class="container narrow">
      <div class="page-header">
        <span class="eyebrow">NEW CIVIC COMPLAINT</span>
        <h1 class="page-title">Report an Issue</h1>
        <p class="page-subtitle">
          Your report will generate an official reference ID and be assigned to the concerned municipal department with a resolution timeframe.
        </p>
      </div>

      <div class="report-form-container">
        <form id="reportIssueForm">
          <!-- Step 1: Issue Title & Category -->
          <div class="form-section-title">
            <span class="user-avatar-sm" style="width: 24px; height: 24px; font-size: 11px;">1</span>
            Issue Details
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
              Issue Title <sup>*</sup>
            </label>
            <input id="reportTitle" class="form-input" placeholder="e.g. Dangerous crater pothole outside Kadri primary school" required maxlength="120">
          </div>

          <div style="margin-bottom: 24px;">
            <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
              Select Category <sup>*</sup>
            </label>
            <div class="category-selector-grid">
              ${Object.entries(CATEGORIES).map(([name, cat]) => `
                <div class="category-radio-card ${name === preselectedCat ? 'selected' : ''}" data-category="${name}">
                  <span style="font-size: 18px;">${cat.emoji}</span>
                  <span>${name}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
            <div>
              <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
                Assigned Department Preview
              </label>
              <div id="deptPreviewBox" style="background: var(--ink-50); border: 1px solid var(--ink-100); border-radius: 10px; padding: 12px 14px; font-size: 13px; font-weight: 700; color: var(--brand-800);">
                PWD (Roads & Infrastructure)
              </div>
            </div>

            <div>
              <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
                Priority / Severity
              </label>
              <select id="reportPriority" class="form-select">
                <option value="Low">Low (Minor annoyance)</option>
                <option value="Medium" selected>Medium (Standard civic issue)</option>
                <option value="High">High (Impacting daily life)</option>
                <option value="Critical">Critical (Immediate safety hazard)</option>
              </select>
            </div>
          </div>

          <!-- Step 2: Location -->
          <div class="form-section-title">
            <span class="user-avatar-sm" style="width: 24px; height: 24px; font-size: 11px;">2</span>
            Location & Landmark
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px;">
            <div>
              <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
                Area / Ward <sup>*</sup>
              </label>
              <select id="reportArea" class="form-select" required>
                <option value="">Select Mangaluru area...</option>
                <option value="Kadri" selected>Kadri</option>
                <option value="Hampankatta">Hampankatta</option>
                <option value="Kottara">Kottara</option>
                <option value="Bejai">Bejai</option>
                <option value="Balmatta">Balmatta</option>
                <option value="Surathkal">Surathkal</option>
                <option value="Kankanady">Kankanady</option>
                <option value="Ullal">Ullal</option>
                <option value="Panambur">Panambur</option>
                <option value="Other Mangaluru">Other Mangaluru</option>
              </select>
            </div>

            <div>
              <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
                Nearby Landmark / Street Name
              </label>
              <input id="reportLandmark" class="form-input" placeholder="e.g. Near Kadri Park South Gate, Opp KMC Hospital">
            </div>
          </div>

          <!-- Interactive Mini Map Location Picker -->
          <div class="location-picker-box">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
              <div>
                <strong style="font-size: 13px; color: var(--ink-800);">📍 Exact Map Coordinates</strong>
                <span id="reportLocationLabel" style="display: block; font-size: 11px; color: var(--ink-500); margin-top: 2px;">
                  Click anywhere on the map below or use your device GPS.
                </span>
              </div>
              <button id="reportGpsBtn" type="button" class="btn btn-ghost btn-sm">
                ⌖ Detect My GPS Location
              </button>
            </div>
            <div id="reportMiniMap" class="location-mini-map"></div>
          </div>

          <!-- Step 3: Description & Evidence -->
          <div class="form-section-title">
            <span class="user-avatar-sm" style="width: 24px; height: 24px; font-size: 11px;">3</span>
            Description & Photographic Proof
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
              Detailed Description <sup>*</sup>
            </label>
            <textarea id="reportDescription" class="form-textarea" rows="4" maxlength="500" placeholder="Please describe what happened, how long the issue has existed, and any specific hazards..." required></textarea>
            <div style="text-align: right; font-size: 11px; color: var(--ink-400); margin-top: 4px;">
              <span id="reportCharCount">0</span>/500 characters
            </div>
          </div>

          <!-- Multi-file Upload Box -->
          <div style="margin-bottom: 24px;">
            <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
              Photos or Video Evidence (Max 5 files, 15MB each)
            </label>
            <label class="upload-dropzone" for="reportFileInput">
              <input id="reportFileInput" type="file" multiple accept="image/*,video/mp4" style="display: none;">
              <div style="font-size: 32px; margin-bottom: 8px;">📸</div>
              <strong style="font-size: 14px; color: var(--ink-800); display: block;">Click to browse or drag photos here</strong>
              <small style="color: var(--ink-400); font-size: 11px;">Supports JPG, PNG, WEBP, and MP4 videos</small>
            </label>
            <div id="reportUploadPreviews" class="upload-previews"></div>
          </div>

          <!-- Step 4: Citizen Contact Info -->
          <div class="form-section-title">
            <span class="user-avatar-sm" style="width: 24px; height: 24px; font-size: 11px;">4</span>
            Citizen Information
          </div>

          <label class="anon-toggle" for="reportAnonymous">
            <input id="reportAnonymous" type="checkbox">
            <span class="anon-toggle-text">
              <strong>🕶️ Report anonymously</strong>
              <small>Your name, phone number and account are not attached to this report. Officers and the public will see it as "Anonymous Citizen". You will not get SMS updates, so save the reference ID.</small>
            </span>
          </label>

          <div id="reportIdentityFields" style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
            <div>
              <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
                Your Name <span style="font-size: 11px; color: var(--ink-400); font-weight: 500;">(optional)</span>
              </label>
              <input id="reportName" class="form-input" placeholder="Full Name" value="${state.user ? state.user.name : ''}">
            </div>
            <div>
              <label style="display: block; font-weight: 800; font-size: 13px; margin-bottom: 8px;">
                Phone Number <span style="font-size: 11px; color: var(--ink-400); font-weight: 500;">(for status SMS)</span>
              </label>
              <input id="reportPhone" class="form-input" type="tel" placeholder="10-digit mobile number" value="${state.user ? state.user.phone : ''}">
            </div>
          </div>

          <div style="background: var(--ink-50); border: 1px solid var(--ink-100); border-radius: 10px; padding: 12px 14px; font-size: 11px; color: var(--ink-600); margin-bottom: 24px;">
            🔒 <b>Privacy Protection:</b> Your phone number and email are never shown publicly on the tracking board. Choose "Report anonymously" to hide them from officers too.
          </div>

          <button id="reportSubmitBtn" class="btn btn-primary btn-lg" style="width: 100%;" type="submit">
            Submit Civic Complaint →
          </button>
        </form>
      </div>
    </div>
  `;

  // Mini Map Initialization
  let chosenLat = 12.8950;
  let chosenLng = 74.8550;
  let miniMapMarker = null;

  setTimeout(() => {
    const miniMapEl = document.getElementById('reportMiniMap');
    if (miniMapEl && typeof L !== 'undefined') {
      const miniMap = L.map('reportMiniMap', {
        center: [chosenLat, chosenLng],
        zoom: 14,
        zoomControl: true
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(miniMap);

      miniMapMarker = L.marker([chosenLat, chosenLng], { draggable: true }).addTo(miniMap);
      miniMapMarker.on('dragend', (e) => {
        const { lat, lng } = e.target.getLatLng();
        chosenLat = lat;
        chosenLng = lng;
        document.getElementById('reportLocationLabel').textContent = `Location set: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      });

      miniMap.on('click', (e) => {
        const { lat, lng } = e.latlng;
        chosenLat = lat;
        chosenLng = lng;
        miniMapMarker.setLatLng([lat, lng]);
        document.getElementById('reportLocationLabel').textContent = `Location set: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      });

      // Area selector change
      document.getElementById('reportArea')?.addEventListener('change', (e) => {
        const area = e.target.value;
        if (AREA_COORDS[area]) {
          const coords = AREA_COORDS[area];
          chosenLat = coords[0];
          chosenLng = coords[1];
          miniMap.setView(coords, 14);
          miniMapMarker.setLatLng(coords);
          document.getElementById('reportLocationLabel').textContent = `Location centered at ${area}`;
        }
      });
    }
  }, 100);

  // Category Selector Cards
  let selectedCategory = preselectedCat;
  document.querySelectorAll('.category-radio-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.category-radio-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedCategory = card.getAttribute('data-category');
      const catConfig = getCategoryConfig(selectedCategory);
      document.getElementById('deptPreviewBox').textContent = `${catConfig.dept} (SLA: ${catConfig.sla})`;
    });
  });

  // Description character count
  document.getElementById('reportDescription')?.addEventListener('input', (e) => {
    document.getElementById('reportCharCount').textContent = e.target.value.length;
  });

  // GPS Locate Button
  document.getElementById('reportGpsBtn')?.addEventListener('click', () => {
    if (!navigator.geolocation) return showToast('Geolocation not supported by your browser', 'error');
    document.getElementById('reportLocationLabel').textContent = 'Locating GPS position...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        chosenLat = pos.coords.latitude;
        chosenLng = pos.coords.longitude;
        if (miniMapMarker) miniMapMarker.setLatLng([chosenLat, chosenLng]);
        document.getElementById('reportLocationLabel').textContent = `GPS Located (${chosenLat.toFixed(5)}, ${chosenLng.toFixed(5)})`;
        showToast('GPS location pinned', 'success');
      },
      () => {
        document.getElementById('reportLocationLabel').textContent = 'Could not retrieve GPS. Please tap map manually.';
        showToast('Could not access GPS', 'error');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // Multi-file Upload State
  const selectedFiles = [];
  const fileInput = document.getElementById('reportFileInput');
  fileInput?.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    files.forEach(f => {
      if (selectedFiles.length >= 5) {
        showToast('Maximum 5 files allowed', 'error');
        return;
      }
      if (f.size > 15 * 1024 * 1024) {
        showToast(`File "${f.name}" exceeds 15MB limit`, 'error');
        return;
      }
      selectedFiles.push(f);
    });
    renderUploadPreviews();
  });

  function renderUploadPreviews() {
    const container = document.getElementById('reportUploadPreviews');
    if (!container) return;
    container.innerHTML = selectedFiles.map((file, idx) => {
      const isVideo = file.type.startsWith('video/');
      const src = URL.createObjectURL(file);
      return `
        <div class="preview-item">
          ${isVideo ? `<video src="${src}" muted></video>` : `<img src="${src}" alt="preview">`}
          <button type="button" class="preview-remove-btn" onclick="removeSelectedFile(${idx})">✕</button>
        </div>
      `;
    }).join('');
  }

  window.removeSelectedFile = (idx) => {
    selectedFiles.splice(idx, 1);
    renderUploadPreviews();
  };

  // Anonymous toggle: disable and clear identity fields
  const anonBox = document.getElementById('reportAnonymous');
  anonBox?.addEventListener('change', () => {
    const on = anonBox.checked;
    document.getElementById('reportIdentityFields')?.classList.toggle('is-disabled', on);
    ['reportName', 'reportPhone'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = on;
      if (on) { el.dataset.prev = el.value; el.value = ''; }
      else if (el.dataset.prev) { el.value = el.dataset.prev; }
    });
  });

  // Form Submit
  const form = document.getElementById('reportIssueForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('reportSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Submitting report to MCC...</span>`;

    const title = document.getElementById('reportTitle')?.value.trim();
    const area = document.getElementById('reportArea')?.value;
    const landmark = document.getElementById('reportLandmark')?.value.trim();
    const description = document.getElementById('reportDescription')?.value.trim();
    const priority = document.getElementById('reportPriority')?.value;
    const isAnonymous = !!document.getElementById('reportAnonymous')?.checked;
    const name = isAnonymous ? '' : document.getElementById('reportName')?.value.trim();
    const phone = isAnonymous ? '' : document.getElementById('reportPhone')?.value.trim();

    if (!selectedCategory || !area || !description || !title) {
      showToast('Please fill all required fields', 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = `Submit Civic Complaint →`;
      return;
    }

    try {
      const payload = {
        title,
        category: selectedCategory,
        area,
        landmark,
        description,
        priority,
        name,
        phone,
        anonymous: isAnonymous,
        lat: chosenLat,
        lng: chosenLng
      };

      if (!state.user || !state.token) {
        showToast('Please sign in to submit a report', 'error');
        navigate('/report');
        return;
      }

      // Always sent with the login token. "Anonymous" only hides your name
      // and phone from the public board and officers.
      const created = await apiRequest('/api/complaints', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      // Remember the server-issued delete token so this device can delete the report later
      if (created.deleteToken) saveOwnedToken(created.id, created.deleteToken);

      // Upload any selected media files
      if (selectedFiles.length > 0) {
        const formData = new FormData();
        selectedFiles.forEach(f => formData.append('files', f));
        await apiRequest(`/api/complaints/${created.id}/upload`, {
          method: 'POST',
          body: formData
        });
      }

      showToast(`Complaint ${created.id} submitted successfully!`, 'success');

      // Render submission success view with direct tracking button
      renderSubmissionSuccess(created);
    } catch (err) {
      showToast(err.message || 'Submission failed. Please check network.', 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = `Submit Civic Complaint →`;
    }
  });
}

// ============================================================
// QR CODE + SHARE helpers for the tracking ID
// ============================================================
function getTrackUrl(id) {
  return `${window.location.origin}/track?id=${encodeURIComponent(id)}`;
}

// Markup for the QR + share block. Call initTrackShare(id) after inserting it.
function trackShareBlockHtml(id) {
  return `
    <div class="track-share-block" style="display:flex; gap:20px; align-items:center; justify-content:center; flex-wrap:wrap; background: var(--ink-50); border: 1px solid var(--ink-100); border-radius: var(--radius); padding: 18px; margin: 20px auto; max-width: 520px; text-align:left;">
      <div id="trackQrBox" style="background:#fff; padding:10px; border-radius:12px; border:1px solid var(--border); width:156px; height:156px; display:grid; place-items:center;"></div>
      <div style="flex:1; min-width:200px;">
        <small style="display:block; font-size:10px; font-weight:800; color:var(--ink-400); text-transform:uppercase; letter-spacing:.1em;">SCAN TO TRACK</small>
        <p style="margin:6px 0 12px; font-size:13px; color:var(--ink-500);">Scan this QR or send the link to follow <b>${escapeHtml(id)}</b> on any device.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" id="shareNativeBtn">📤 Send</button>
          <button type="button" class="btn btn-ghost btn-sm" id="shareWhatsappBtn">WhatsApp</button>
          <button type="button" class="btn btn-ghost btn-sm" id="shareEmailBtn">Email</button>
          <button type="button" class="btn btn-ghost btn-sm" id="shareCopyLinkBtn">🔗 Copy link</button>
          <button type="button" class="btn btn-ghost btn-sm" id="downloadQrBtn">⬇ QR</button>
        </div>
      </div>
    </div>
  `;
}

function initTrackShare(id) {
  const url = getTrackUrl(id);
  const message = `Track my civic complaint ${id} with Mangaluru Municipal Corp (Dhwani): ${url}`;

  // Generate QR (qrcodejs, loaded in index.html)
  const box = document.getElementById('trackQrBox');
  if (box) {
    box.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
      new QRCode(box, { text: url, width: 136, height: 136, colorDark: '#0b3d2e', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } else {
      box.innerHTML = '<small style="color:var(--ink-400); text-align:center;">QR unavailable offline</small>';
    }
  }

  const on = (elId, fn) => document.getElementById(elId)?.addEventListener('click', fn);

  on('shareNativeBtn', async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Complaint ${id}`, text: message, url }); } catch (e) { /* user cancelled */ }
    } else {
      navigator.clipboard?.writeText(message).then(() => showToast('Link copied. Paste it in any app to send', 'success'));
    }
  });
  on('shareWhatsappBtn', () => window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener'));
  on('shareEmailBtn', () => {
    window.location.href = `mailto:?subject=${encodeURIComponent('Complaint ' + id + ' - tracking link')}&body=${encodeURIComponent(message)}`;
  });
  on('shareCopyLinkBtn', () => navigator.clipboard?.writeText(url).then(() => showToast('Tracking link copied', 'success')));
  on('downloadQrBtn', () => {
    const canvas = box?.querySelector('canvas');
    const img = box?.querySelector('img');
    const href = canvas ? canvas.toDataURL('image/png') : img?.src;
    if (!href) return showToast('QR not ready yet', 'error');
    const a = document.createElement('a');
    a.href = href; a.download = `${id}-qr.png`;
    document.body.appendChild(a); a.click(); a.remove();
  });
}

function renderSubmissionSuccess(complaint) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container narrow" style="padding: 60px 0;">
      <div class="card" style="text-align: center; padding: 48px 32px; border-radius: var(--radius-xl);">
        <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--brand-100); color: var(--brand-700); font-size: 30px; font-weight: 800; display: grid; place-items: center; margin: 0 auto 20px;">
          ✓
        </div>
        <span class="eyebrow">SUBMISSION CONFIRMED</span>
        <h1 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 32px; font-weight: 800; margin: 10px 0;">
          Your Civic Complaint Has Been Filed
        </h1>
        <p style="color: var(--ink-500); max-width: 500px; margin: 0 auto 28px;">
          Your complaint has been assigned a permanent unique reference number and automatically forwarded to <b>${complaint.department}</b>.
        </p>

        <div style="background: var(--ink-50); border: 2px dashed var(--brand-300); border-radius: var(--radius); padding: 18px; max-width: 440px; margin: 0 auto 28px;">
          <small style="display: block; font-size: 10px; font-weight: 800; color: var(--ink-400); text-transform: uppercase; letter-spacing: .1em;">
            COMPLAINT REFERENCE ID
          </small>
          <strong id="createdIdVal" style="display: block; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 24px; color: var(--brand-700); margin: 6px 0;">
            ${complaint.id}
          </strong>
          <button id="copyRefIdBtn" class="btn btn-ghost btn-sm" type="button">
            📋 Copy Reference ID
          </button>
        </div>

        ${complaint.anonymous ? `
          <div style="background: var(--ink-50); border: 1px solid var(--ink-100); border-radius: 10px; padding: 12px 14px; font-size: 12px; color: var(--ink-600); max-width: 520px; margin: 0 auto 20px; text-align: left;">
            🕶️ <b>Anonymous report.</b> Save the reference ID above. You can delete this report later from this same browser/device, but it won't appear under "My Complaints".
          </div>` : ''}

        ${trackShareBlockHtml(complaint.id)}

        <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
          <a class="btn btn-primary btn-lg" href="/track?id=${complaint.id}" data-link>
            Track This Complaint Now →
          </a>
          <a class="btn btn-ghost btn-lg" href="/report" data-link>
            Report Another Issue
          </a>
          <a class="btn btn-outline btn-lg" href="/my-complaints" data-link>
            My Complaints
          </a>
        </div>
      </div>
    </div>
  `;

  initTrackShare(complaint.id);

  document.getElementById('copyRefIdBtn')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(complaint.id).then(() => {
      showToast('Reference ID copied to clipboard', 'success');
    });
  });
}

// ============================================================
// PAGE: TRACK COMPLAINT (/track) — Highest Priority
// ============================================================
async function renderTrackPage(complaintId) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container narrow">
      <div class="page-header">
        <span class="eyebrow">REAL-TIME CIVIC TRACKING</span>
        <h1 class="page-title">Track Complaint Status</h1>
        <p class="page-subtitle">
          Enter your unique reference ID (e.g. CP-2026-00001) to view the live investigation timeline, department assigned, officer remarks, and resolution verification.
        </p>
      </div>

      <!-- Search Box -->
      <form id="trackSearchForm" class="track-search-bar">
        <span style="display: grid; place-items: center; padding-left: 12px; font-size: 18px; color: var(--ink-400);">🔍</span>
        <input id="trackSearchInput" class="track-search-input" placeholder="e.g. CP-2026-00001 or CP-MNG-..." value="${complaintId || ''}" autocomplete="off" required>
        <button class="btn btn-primary" type="submit">Track Complaint</button>
      </form>

      <!-- Results Container -->
      <div id="trackResultContainer">
        ${complaintId ? `<div style="padding: 40px; text-align: center; color: var(--ink-400);">Retrieving complaint details from municipal database...</div>` : `
          <div style="text-align: center; padding: 48px 20px; background: var(--surface); border: 1px dashed var(--ink-200); border-radius: var(--radius-lg); color: var(--ink-500);">
            <div style="font-size: 36px; margin-bottom: 12px;">🪪</div>
            <strong style="display: block; font-size: 16px; color: var(--ink-800);">Enter a Complaint Reference ID Above</strong>
            <p style="font-size: 13px; max-width: 440px; margin: 6px auto 0;">
              Every report submitted through Dhwani receives a permanent ID for transparent public tracking.
            </p>
            <div style="margin-top: 18px; display: flex; justify-content: center; gap: 8px;">
              <span style="font-size: 11px; color: var(--ink-400);">Try sample:</span>
              <button class="btn btn-ghost btn-sm" onclick="navigate('/track?id=CP-2026-00001')">CP-2026-00001</button>
              <button class="btn btn-ghost btn-sm" onclick="navigate('/track?id=CP-2026-00002')">CP-2026-00002</button>
            </div>
          </div>
        `}
      </div>
    </div>
  `;

  document.getElementById('trackSearchForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('trackSearchInput')?.value.trim();
    if (id) {
      navigate(`/track?id=${encodeURIComponent(id)}`);
    }
  });

  if (complaintId) {
    loadAndRenderTrackingDetails(complaintId);
  }
}

async function loadAndRenderTrackingDetails(id) {
  const container = document.getElementById('trackResultContainer');
  if (!container) return;

  try {
    const c = await fetchComplaint(id);
    if (!c) {
      container.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px; border-color: #fecaca; background: #fff5f5;">
          <div style="font-size: 32px; margin-bottom: 10px;">⚠️</div>
          <h3 style="margin: 0 0 6px; color: #991b1b;">Complaint Not Found</h3>
          <p style="color: #b91c1c; font-size: 14px; margin: 0 0 16px;">
            No record matches complaint reference <b>"${escapeHtml(id)}"</b>. Please verify the ID from your submission receipt.
          </p>
          <a class="btn btn-ghost btn-sm" href="/complaints" data-link>Browse Public Issues Board →</a>
        </div>
      `;
      return;
    }

    const cat = getCategoryConfig(c.category);
    const isResolved = c.status === 'Resolved';
    const isRejected = c.status === 'Rejected';
    const isReopened = c.status === 'Reopened';

    // Standard 5-step visual timeline
    const steps = ['Submitted', 'Verified', 'Assigned', 'In Progress', 'Resolved'];
    const currentStepIndex = steps.indexOf(c.status);

    let timelineHtml = '';
    if (isRejected) {
      timelineHtml = `
        <div class="progress-timeline" style="grid-template-columns: 1fr 1fr;">
          <div class="timeline-step completed">
            <div class="timeline-circle">✓</div>
            <div class="timeline-label">Submitted</div>
            <div class="timeline-time">${formatDate(c.createdAt)}</div>
          </div>
          <div class="timeline-step rejected-step active">
            <div class="timeline-circle">✕</div>
            <div class="timeline-label" style="color: #ef4444;">Rejected</div>
            <div class="timeline-time">${formatDate(c.updatedAt)}</div>
          </div>
        </div>
      `;
    } else {
      timelineHtml = `
        <div class="progress-timeline">
          ${steps.map((st, i) => {
            const isCompleted = currentStepIndex >= i;
            const isActive = currentStepIndex === i;
            // Find timestamp from status history if exists
            const hist = (c.statusHistory || []).find(h => h.status === st);
            const timeStr = hist ? formatDate(hist.timestamp) : (isCompleted ? 'Completed' : 'Pending');

            return `
              <div class="timeline-step ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''}">
                <div class="timeline-circle">${isCompleted ? '✓' : (i + 1)}</div>
                <div class="timeline-label">${st}</div>
                <div class="timeline-time">${timeStr}</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Media gallery
    const allPhotos = Array.from(new Set([...(c.photos || []), ...(c.photo ? [c.photo] : [])]));
    const galleryHtml = allPhotos.length > 0 ? `
      <div style="margin: 24px 0;">
        <label style="display: block; font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--ink-400); margin-bottom: 8px;">
          Citizen Photo Evidence (${allPhotos.length})
        </label>
        <div class="media-gallery">
          ${allPhotos.map(url => `
            <div class="media-thumb" onclick="openLightbox('${url}', '${escapeHtml(c.title)}')">
              <img src="${url}" alt="evidence" loading="lazy">
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    // Resolution evidence
    const resolutionHtml = isResolved ? `
      <div class="resolution-banner">
        <div style="font-size: 32px;">🏆</div>
        <div style="flex: 1;">
          <strong style="display: block; font-size: 15px; color: #065f46;">Officially Resolved & Verified</strong>
          <p style="margin: 4px 0 0; font-size: 13px; color: #047857;">
            ${escapeHtml(c.resolutionRemarks || 'Site work verified and closed according to municipal standard operating procedures.')}
          </p>
          <small style="display: block; font-size: 11px; color: #059669; margin-top: 4px;">
            Resolved at: ${formatDateTime(c.resolvedAt || c.updatedAt)} by ${escapeHtml(c.officer || c.department)}
          </small>
        </div>
        ${c.resolutionPhoto ? `
          <div class="media-thumb" onclick="openLightbox('${c.resolutionPhoto}', 'Resolution Evidence')" style="border-color: #34d399;">
            <img src="${c.resolutionPhoto}" alt="resolution proof">
          </div>
        ` : ''}
      </div>
    ` : '';

    // Rejection banner
    const rejectionHtml = isRejected ? `
      <div style="background: #fef2f2; border: 1.5px solid #fecaca; border-radius: var(--radius-lg); padding: 18px; margin: 20px 0; display: flex; gap: 16px;">
        <div style="font-size: 26px;">❌</div>
        <div>
          <strong style="display: block; font-size: 14px; color: #991b1b;">Report Rejected</strong>
          <p style="margin: 4px 0 0; font-size: 13px; color: #b91c1c;">
            <b>Reason:</b> ${escapeHtml(c.rejectionReason || 'Duplicate or out-of-jurisdiction report.')}
          </p>
        </div>
      </div>
    ` : '';

    // Audit / Remarks Timeline
    const historyHtml = (c.statusHistory && c.statusHistory.length > 0) ? `
      <div style="margin-top: 28px; border-top: 1px solid var(--ink-100); padding-top: 24px;">
        <label style="display: block; font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--ink-400); margin-bottom: 12px;">
          Audited Action & Progress History
        </label>
        <div class="audit-history-list">
          ${c.statusHistory.map(h => `
            <div class="audit-item">
              <span class="audit-dot"></span>
              <div class="audit-body">
                <div class="audit-header">
                  <span class="status-badge ${getStatusBadgeClass(h.status)}">${h.status}</span>
                  <span style="font-size: 11px; color: var(--ink-400);">${formatDateTime(h.timestamp)}</span>
                </div>
                <div class="audit-remarks">${escapeHtml(h.remarks || 'Status updated.')}</div>
                <div style="font-size: 11px; color: var(--ink-500);">
                  Action by: <b>${escapeHtml(h.changedBy)}</b> (${h.role || 'Officer'})
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    container.innerHTML = `
      <div class="track-detail-card">
        <!-- Card Top Header -->
        <div class="track-hero-header">
          <div>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <span class="track-id-badge">
                ${c.id}
                <button class="track-copy-btn" onclick="copyText('${c.id}')">Copy</button>
              </span>
              <span class="category-pill" style="border-left: 3px solid ${cat.color};">
                ${cat.emoji} ${c.category}
              </span>
              <span class="priority-badge priority-${(c.priority || 'medium').toLowerCase()}">
                ${c.priority || 'Medium'} Priority
              </span>
              ${c.anonymous ? '<span class="anon-chip">🕶️ Anonymous report</span>' : ''}
            </div>
            <h2 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 22px; font-weight: 800; margin: 12px 0 6px; color: var(--ink-900);">
              ${escapeHtml(c.title)}
            </h2>
            <div style="font-size: 13px; color: var(--ink-500);">
              📍 <b>${c.area || 'Mangaluru'}</b>${c.landmark ? ' · ' + escapeHtml(c.landmark) : ''}
              ${c.lat ? ` (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})` : ''}
            </div>
          </div>
          <span class="status-badge ${getStatusBadgeClass(c.status)}" style="font-size: 13px; padding: 6px 14px;">
            ${c.status}
          </span>
        </div>

        <!-- Visual Milestone Timeline -->
        ${timelineHtml}

        <!-- Resolution / Rejection Callout -->
        ${resolutionHtml}
        ${rejectionHtml}

        <!-- Description Box -->
        <div style="background: var(--ink-50); border: 1px solid var(--ink-100); border-radius: var(--radius); padding: 18px; margin: 20px 0;">
          <label style="display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; color: var(--ink-400); margin-bottom: 6px;">
            Citizen Description
          </label>
          <p style="margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink-800);">
            ${escapeHtml(c.description)}
          </p>
        </div>

        <!-- Evidence Gallery -->
        ${galleryHtml}

        <!-- Community Voting -->
        <div class="vote-panel">
          ${voteButtonHtml(c, { large: true })}
          <div>
            <strong style="display: block; font-size: 13px; color: var(--ink-800);">Community support</strong>
            <span id="voteSummaryText" style="font-size: 12px; color: var(--ink-500);">${voteSummaryText(c.votes)}</span>
          </div>
        </div>

        <!-- Key Metadata Grid -->
        <div class="meta-grid-3">
          <div class="meta-tile">
            <small>Assigned Department</small>
            <strong>${c.department || 'Ward Office'}</strong>
          </div>
          <div class="meta-tile">
            <small>Assigned Officer</small>
            <strong>${c.officer || 'Pending allocation'}</strong>
          </div>
          <div class="meta-tile">
            <small>SLA Target Duration</small>
            <strong>${c.slaHours || '5 days'}</strong>
          </div>
        </div>

        <div class="meta-grid-3">
          <div class="meta-tile">
            <small>Date Reported</small>
            <strong>${formatDateTime(c.createdAt)}</strong>
          </div>
          <div class="meta-tile">
            <small>Last Audit Update</small>
            <strong>${formatDateTime(c.updatedAt)}</strong>
          </div>
          <div class="meta-tile">
            <small>Expected Resolution</small>
            <strong style="color: var(--brand-700);">${c.expectedResolutionDate ? formatDate(c.expectedResolutionDate) : 'Within SLA'}</strong>
          </div>
        </div>

        <!-- QR + Share -->
        ${trackShareBlockHtml(c.id)}

        <!-- Mini Pinned Map of the Location -->
        <div style="margin: 24px 0;">
          <label style="display: block; font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--ink-400); margin-bottom: 8px;">
            Pinned Location
          </label>
          <div id="trackMiniMap" style="height: 220px; border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border);"></div>
        </div>

        <!-- Audit History -->
        ${historyHtml}

        <!-- Actions Footer -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 32px; border-top: 1px solid var(--ink-100); padding-top: 20px; flex-wrap: wrap; gap: 12px;">
          <div style="font-size: 12px; color: var(--ink-400);">
            Need assistance? Call MCC Helpline: <b>0824-2220300</b>
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨️ Print Summary</button>
            ${canDeleteComplaint(c) ? `<button class="btn btn-danger btn-sm" id="deleteReportBtn" type="button">🗑 Delete Report</button>` : ''}
            <a class="btn btn-primary btn-sm" href="/report" data-link>Report Another Issue →</a>
          </div>
        </div>
      </div>
    `;

    initTrackShare(c.id);
    document.getElementById('deleteReportBtn')?.addEventListener('click', () => {
      deleteComplaint(c.id, { redirect: state.user ? '/my-complaints' : '/complaints' });
    });

    // Render Mini Map for tracking
    setTimeout(() => {
      const mapEl = document.getElementById('trackMiniMap');
      if (mapEl && typeof L !== 'undefined') {
        const coords = c.coords || AREA_COORDS[c.area] || MANGALURU_CENTER;
        const miniMap = L.map('trackMiniMap', {
          center: coords,
          zoom: 15,
          zoomControl: true,
          attributionControl: false
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(miniMap);
        createMapMarker(c).addTo(miniMap);
      }
    }, 100);

  } catch (err) {
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px; color: #ef4444;">
        Failed to fetch tracking details. Please verify your connection.
      </div>
    `;
  }
}

// ============================================================
// PAGE: COMPLAINTS / EXPLORE ISSUES (/complaints)
// ============================================================
async function renderComplaintsPage(queryParams = new URLSearchParams()) {
  const app = document.getElementById('app');
  const search = queryParams.get('search') || '';
  const status = queryParams.get('status') || 'all';
  const category = queryParams.get('category') || 'all';
  const priority = queryParams.get('priority') || 'all';
  const sort = queryParams.get('sort') || 'newest';

  app.innerHTML = `
    <div class="container">
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px;">
        <div>
          <span class="eyebrow">MANGALURU PUBLIC BOARD</span>
          <h1 class="page-title">Explore Civic Issues</h1>
          <p class="page-subtitle">
            Browse and monitor active infrastructure reports across all 60 wards of Mangaluru.
          </p>
        </div>
        <a class="btn btn-primary" href="/report" data-link>Report New Issue <span>＋</span></a>
      </div>

      <!-- Filter Controls -->
      <div class="filter-bar">
        <div style="flex: 1; min-width: 220px;">
          <input id="filterSearch" class="form-input" placeholder="Search by title, locality, or CP reference..." value="${escapeHtml(search)}">
        </div>

        <div>
          <select id="filterStatus" class="form-select">
            <option value="all" ${status === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="Submitted" ${status === 'Submitted' ? 'selected' : ''}>Submitted</option>
            <option value="Verified" ${status === 'Verified' ? 'selected' : ''}>Verified</option>
            <option value="In Progress" ${status === 'In Progress' ? 'selected' : ''}>In Progress</option>
            <option value="Resolved" ${status === 'Resolved' ? 'selected' : ''}>Resolved</option>
            <option value="Rejected" ${status === 'Rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </div>

        <div>
          <select id="filterCategory" class="form-select">
            <option value="all" ${category === 'all' ? 'selected' : ''}>All Categories</option>
            ${Object.keys(CATEGORIES).map(catName => `
              <option value="${catName}" ${category === catName ? 'selected' : ''}>${catName}</option>
            `).join('')}
          </select>
        </div>

        <div>
          <select id="filterPriority" class="form-select">
            <option value="all" ${priority === 'all' ? 'selected' : ''}>All Priorities</option>
            <option value="Critical" ${priority === 'Critical' ? 'selected' : ''}>Critical</option>
            <option value="High" ${priority === 'High' ? 'selected' : ''}>High</option>
            <option value="Medium" ${priority === 'Medium' ? 'selected' : ''}>Medium</option>
            <option value="Low" ${priority === 'Low' ? 'selected' : ''}>Low</option>
          </select>
        </div>

        <div>
          <select id="filterSort" class="form-select">
            <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest First</option>
            <option value="oldest" ${sort === 'oldest' ? 'selected' : ''}>Oldest First</option>
            <option value="priority" ${sort === 'priority' ? 'selected' : ''}>Highest Priority</option>
            <option value="votes" ${sort === 'votes' ? 'selected' : ''}>Most Voted</option>
          </select>
        </div>

        <button id="applyFiltersBtn" class="btn btn-ghost btn-sm">Filter</button>
      </div>

      <!-- Complaint Cards Grid -->
      <div id="complaintsListGrid" class="complaint-grid">
        <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--ink-400);">Loading complaints...</div>
      </div>
    </div>
  `;

  const loadComplaints = async () => {
    try {
      const q = {};
      if (search) q.search = search;
      if (status !== 'all') q.status = status;
      if (category !== 'all') q.category = category;
      if (priority !== 'all') q.priority = priority;
      if (sort && sort !== 'votes') q.sort = sort;

      const list = await fetchComplaints(q);
      if (sort === 'votes') {
        list.sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0) || new Date(b.createdAt) - new Date(a.createdAt));
      }
      const grid = document.getElementById('complaintsListGrid');
      if (!grid) return;

      if (list.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: var(--surface); border: 1px dashed var(--ink-200); border-radius: var(--radius-lg);">
            <div style="font-size: 32px; margin-bottom: 10px;">🔍</div>
            <strong style="display: block; font-size: 16px; color: var(--ink-800);">No complaints matched your filter criteria</strong>
            <p style="font-size: 13px; color: var(--ink-500); margin: 6px 0 16px;">Try adjusting your search terms or clearing the status filter.</p>
            <button class="btn btn-ghost btn-sm" onclick="navigate('/complaints')">Reset All Filters</button>
          </div>
        `;
      } else {
        grid.innerHTML = list.map(c => renderComplaintCard(c)).join('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  loadComplaints();

  // Attach filter event listeners
  const triggerFilter = () => {
    const s = document.getElementById('filterSearch')?.value.trim();
    const st = document.getElementById('filterStatus')?.value;
    const cat = document.getElementById('filterCategory')?.value;
    const pr = document.getElementById('filterPriority')?.value;
    const so = document.getElementById('filterSort')?.value;

    const params = new URLSearchParams();
    if (s) params.set('search', s);
    if (st && st !== 'all') params.set('status', st);
    if (cat && cat !== 'all') params.set('category', cat);
    if (pr && pr !== 'all') params.set('priority', pr);
    if (so) params.set('sort', so);

    navigate(`/complaints?${params.toString()}`);
  };

  document.getElementById('applyFiltersBtn')?.addEventListener('click', triggerFilter);
  document.getElementById('filterStatus')?.addEventListener('change', triggerFilter);
  document.getElementById('filterCategory')?.addEventListener('change', triggerFilter);
  document.getElementById('filterPriority')?.addEventListener('change', triggerFilter);
  document.getElementById('filterSort')?.addEventListener('change', triggerFilter);
  document.getElementById('filterSearch')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') triggerFilter();
  });
}

// ============================================================
// PAGE: INTERACTIVE MAP (/map)
// Preserves Leaflet, OpenStreetMap, Cluster, and Heatmap
// ============================================================
async function renderMapPage(queryParams = new URLSearchParams()) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container wide">
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 14px;">
        <div>
          <span class="eyebrow">GEOSPATIAL INFRASTRUCTURE INTELLIGENCE</span>
          <h1 class="page-title">Interactive Civic Map</h1>
          <p class="page-subtitle">
            Color-coded civic reports across Mangaluru with marker clustering, density heatmap, and click-to-report.
          </p>
        </div>
        <div style="display: flex; gap: 10px;">
          <a class="btn btn-primary btn-sm" href="/report" data-link>Report at Location <span>＋</span></a>
        </div>
      </div>

      <div class="map-page-layout">
        <!-- Map Sidebar Filters -->
        <aside class="map-sidebar">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--ink-100); padding-bottom: 12px;">
            <strong style="font-size: 14px; font-family: 'Plus Jakarta Sans', sans-serif;">Map Filters</strong>
            <button id="mapResetFiltersBtn" class="btn btn-ghost btn-sm" style="padding: 2px 8px; font-size: 10px;">Reset</button>
          </div>

          <div class="map-filter-group">
            <label>Search Issue / Location</label>
            <input id="mapSearchInput" class="form-input" placeholder="Kadri, pothole, street...">
          </div>

          <div class="map-filter-group">
            <label>Status Filter</label>
            <select id="mapStatusFilter" class="map-filter-select">
              <option value="all">All Statuses</option>
              <option value="Submitted">Submitted (Pending)</option>
              <option value="Verified">Verified</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
            </select>
          </div>

          <div class="map-filter-group">
            <label>Category Filter</label>
            <select id="mapCategoryFilter" class="map-filter-select">
              <option value="all">All Categories</option>
              ${Object.keys(CATEGORIES).map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>

          <div class="map-filter-group">
            <label>Priority Filter</label>
            <select id="mapPriorityFilter" class="map-filter-select">
              <option value="all">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div style="border-top: 1px solid var(--ink-100); padding-top: 14px;">
            <label style="display: block; font-size: 11px; font-weight: 800; text-transform: uppercase; color: var(--ink-400); margin-bottom: 8px;">
              Active Map Metrics
            </label>
            <div style="font-size: 12px; color: var(--ink-600); line-height: 1.8;">
              • Visible Markers: <b id="mapMarkerCount">0</b><br>
              • Heatmap Radius: <b>30px</b><br>
              • City: <b>Mangaluru, Karnataka</b>
            </div>
          </div>
        </aside>

        <!-- Main Map Area -->
        <div class="map-view-wrapper">
          <div id="fullInteractiveMap" class="interactive-leaflet-map" style="height: 640px;"></div>

          <!-- Floating Map Controls -->
          <div class="map-controls-floating">
            <button id="mapLocateBtn" class="map-ctrl-btn" title="Locate My GPS Position">
              ⌖ My Location
            </button>
            <button id="mapToggleHeatBtn" class="map-ctrl-btn" title="Toggle Incident Heatmap">
              🔥 Heatmap View
            </button>
            <button id="mapRefreshBtn" class="map-ctrl-btn" title="Refresh Map Data">
              ↻ Refresh
            </button>
          </div>

          <!-- Floating Color Legend -->
          <div class="map-legend-floating">
            <strong style="font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-400);">Category Marker Colors</strong>
            <div class="legend-grid">
              <div class="legend-item"><span class="legend-dot" style="background: var(--cat-road);"></span> Road / Pothole</div>
              <div class="legend-item"><span class="legend-dot" style="background: var(--cat-garbage);"></span> Garbage / Waste</div>
              <div class="legend-item"><span class="legend-dot" style="background: var(--cat-water);"></span> Water Leakage</div>
              <div class="legend-item"><span class="legend-dot" style="background: var(--cat-drainage);"></span> Drainage / Sewage</div>
              <div class="legend-item"><span class="legend-dot" style="background: var(--cat-light);"></span> Streetlight</div>
              <div class="legend-item"><span class="legend-dot" style="background: var(--cat-safety);"></span> Public Safety</div>
              <div class="legend-item"><span class="legend-dot" style="background: var(--cat-park);"></span> Parks / Spaces</div>
              <div class="legend-item"><span class="legend-dot" style="background: var(--cat-other);"></span> Other Civic</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Initialize Full Leaflet Map
  let mapInstance = null;
  let clusterGroup = null;
  let heatLayer = null;
  let heatOn = false;
  let userLocationMarker = null;

  setTimeout(async () => {
    const mapEl = document.getElementById('fullInteractiveMap');
    if (!mapEl || typeof L === 'undefined') return;

    mapInstance = L.map('fullInteractiveMap', {
      center: MANGALURU_CENTER,
      zoom: MANGALURU_ZOOM,
      zoomControl: true,
      scrollWheelZoom: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(mapInstance);

    // Marker Clustering
    clusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const sizeClass = count < 10 ? 'cluster-small' : (count < 30 ? 'cluster-medium' : 'cluster-large');
        return L.divIcon({
          html: `<div class="cluster-icon ${sizeClass}">${count}</div>`,
          className: 'custom-cluster',
          iconSize: L.point(40, 40)
        });
      }
    }).addTo(mapInstance);

    // Add Area Labels for Mangaluru Wards
    Object.entries(AREA_COORDS).forEach(([name, coords]) => {
      if (name === 'Other Mangaluru') return;
      L.marker(coords, {
        icon: L.divIcon({
          className: 'area-label',
          html: `<span style="background:rgba(255,255,255,0.88);padding:3px 8px;border-radius:6px;font-size:10px;font-weight:800;color:#25322d;border:1px solid #d6e6df;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.1);">📍 ${name}</span>`,
          iconSize: [0, 0],
          iconAnchor: [0, 0]
        }),
        interactive: false
      }).addTo(mapInstance);
    });

    // Click anywhere on map to report issue at that spot
    mapInstance.on('click', (e) => {
      const { lat, lng } = e.latlng;
      let nearestArea = 'Mangaluru';
      let minDist = Infinity;
      Object.entries(AREA_COORDS).forEach(([area, coords]) => {
        const dist = (coords[0] - lat) ** 2 + (coords[1] - lng) ** 2;
        if (dist < minDist) { minDist = dist; nearestArea = area; }
      });

      L.popup({ maxWidth: 260 })
        .setLatLng(e.latlng)
        .setContent(`
          <div style="font-family:'DM Sans',sans-serif; padding: 4px;">
            <div style="font-weight:800;font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;margin-bottom:4px;">
              📍 Report Civic Issue Here?
            </div>
            <div style="font-size:11px;color:var(--ink-500);margin-bottom:10px;">
              ${lat.toFixed(5)}, ${lng.toFixed(5)}<br>
              Near <b>${nearestArea}</b>
            </div>
            <button id="mapPopupReportBtn" style="
              background:linear-gradient(135deg,var(--brand-600),var(--brand-700));
              color:#fff;border:0;border-radius:8px;padding:8px 12px;
              font-weight:800;font-size:11px;cursor:pointer;width:100%;
            ">Report issue at this spot →</button>
          </div>
        `)
        .openOn(mapInstance);

      setTimeout(() => {
        document.getElementById('mapPopupReportBtn')?.addEventListener('click', () => {
          mapInstance.closePopup();
          navigate(`/report?area=${encodeURIComponent(nearestArea)}`);
        });
      }, 50);
    });

    // Render Markers based on filters
    const renderMarkers = async () => {
      clusterGroup.clearLayers();
      const st = document.getElementById('mapStatusFilter')?.value;
      const cat = document.getElementById('mapCategoryFilter')?.value;
      const pr = document.getElementById('mapPriorityFilter')?.value;
      const search = document.getElementById('mapSearchInput')?.value.trim();

      const q = {};
      if (st && st !== 'all') q.status = st;
      if (cat && cat !== 'all') q.category = cat;
      if (pr && pr !== 'all') q.priority = pr;
      if (search) q.search = search;

      const complaints = await fetchComplaints(q);
      document.getElementById('mapMarkerCount').textContent = complaints.length;

      complaints.forEach(c => {
        if (c.coords || AREA_COORDS[c.area]) {
          clusterGroup.addLayer(createMapMarker(c));
        }
      });

      if (heatOn) {
        buildHeatmap(complaints);
      }
    };

    function buildHeatmap(complaints) {
      if (heatLayer) {
        mapInstance.removeLayer(heatLayer);
        heatLayer = null;
      }
      const points = complaints
        .filter(c => c.coords || AREA_COORDS[c.area])
        .map(c => {
          const coords = c.coords || AREA_COORDS[c.area];
          return [coords[0], coords[1], 1];
        });

      if (points.length > 0) {
        heatLayer = L.heatLayer(points, {
          radius: 32,
          blur: 24,
          maxZoom: 16,
          gradient: {
            0.0: '#35c695',
            0.4: '#0fa978',
            0.6: '#ef9c46',
            0.8: '#e36c45',
            1.0: '#c92a2a'
          }
        }).addTo(mapInstance);
      }
    }

    // Toggle Heatmap button
    document.getElementById('mapToggleHeatBtn')?.addEventListener('click', async () => {
      heatOn = !heatOn;
      const btn = document.getElementById('mapToggleHeatBtn');
      btn.classList.toggle('active', heatOn);
      if (heatOn) {
        clusterGroup.remove();
        const complaints = await fetchComplaints();
        buildHeatmap(complaints);
        btn.textContent = '📍 Marker View';
        showToast('Heatmap view enabled');
      } else {
        if (heatLayer) { mapInstance.removeLayer(heatLayer); heatLayer = null; }
        clusterGroup.addTo(mapInstance);
        btn.textContent = '🔥 Heatmap View';
        showToast('Marker cluster view enabled');
      }
    });

    // Locate Me Button
    document.getElementById('mapLocateBtn')?.addEventListener('click', () => {
      if (!navigator.geolocation) return showToast('Geolocation not supported', 'error');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          mapInstance.flyTo([latitude, longitude], 15, { duration: 1.2 });
          if (userLocationMarker) mapInstance.removeLayer(userLocationMarker);
          userLocationMarker = L.marker([latitude, longitude], {
            icon: L.divIcon({
              className: 'user-location-marker',
              html: '',
              iconSize: [18, 18],
              iconAnchor: [9, 9]
            })
          }).addTo(mapInstance).bindPopup('You are here').openPopup();
          showToast('GPS Location pinned', 'success');
        },
        () => showToast('Could not retrieve location', 'error'),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });

    // Refresh Button
    document.getElementById('mapRefreshBtn')?.addEventListener('click', () => {
      renderMarkers();
      showToast('Map updated with latest reports');
    });

    // Sidebar filter listeners
    document.getElementById('mapStatusFilter')?.addEventListener('change', renderMarkers);
    document.getElementById('mapCategoryFilter')?.addEventListener('change', renderMarkers);
    document.getElementById('mapPriorityFilter')?.addEventListener('change', renderMarkers);
    document.getElementById('mapSearchInput')?.addEventListener('input', renderMarkers);
    document.getElementById('mapResetFiltersBtn')?.addEventListener('click', () => {
      document.getElementById('mapStatusFilter').value = 'all';
      document.getElementById('mapCategoryFilter').value = 'all';
      document.getElementById('mapPriorityFilter').value = 'all';
      document.getElementById('mapSearchInput').value = '';
      renderMarkers();
    });

    // Initial Marker Render
    renderMarkers();
  }, 100);
}

// ============================================================
// PAGE: MY COMPLAINTS (/my-complaints)
// ============================================================
async function renderMyComplaintsPage() {
  const app = document.getElementById('app');

  if (!state.user) {
    app.innerHTML = `
      <div class="container narrow" style="padding: 60px 0;">
        <div class="card" style="text-align: center; padding: 48px 24px;">
          <div style="font-size: 40px; margin-bottom: 12px;">📁</div>
          <h2 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 26px; font-weight: 800; margin: 8px 0;">
            Sign in to view My Complaints
          </h2>
          <p style="color: var(--ink-500); max-width: 440px; margin: 0 auto 24px;">
            Your personal civic dashboard lets you monitor and track all issues reported from your account in one place.
          </p>
          <div style="display: flex; justify-content: center; gap: 12px;">
            <a class="btn btn-primary" href="/login" data-link>Sign In to Account →</a>
            <a class="btn btn-ghost" href="/track" data-link>Track with ID instead</a>
          </div>
        </div>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 16px;">
        <div>
          <span class="eyebrow">CITIZEN DASHBOARD</span>
          <h1 class="page-title">My Submitted Complaints</h1>
          <p class="page-subtitle">
            All civic complaints filed by <b>${escapeHtml(state.user.name)}</b> (${escapeHtml(state.user.email)}).
          </p>
        </div>
        <a class="btn btn-primary" href="/report" data-link>Report New Issue <span>＋</span></a>
      </div>

      <!-- KPI Stats -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px;">
        <div class="stat-card">
          <div class="stat-icon" style="background: var(--brand-50); color: var(--brand-700);">📋</div>
          <div class="stat-info">
            <small>Total Reported</small>
            <strong id="myStatTotal">--</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: #fef3e6; color: #c47a2e;">⏳</div>
          <div class="stat-info">
            <small>Under Review</small>
            <strong id="myStatPending">--</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: #eff6ff; color: #2563eb;">🛠️</div>
          <div class="stat-info">
            <small>In Action</small>
            <strong id="myStatProgress">--</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: #ecfdf5; color: #059669;">✅</div>
          <div class="stat-info">
            <small>Resolved</small>
            <strong id="myStatResolved">--</strong>
          </div>
        </div>
      </div>

      <!-- List of User Complaints -->
      <div id="myComplaintsList">
        <div style="padding: 40px; text-align: center; color: var(--ink-400);">Loading your complaints...</div>
      </div>
    </div>
  `;

  try {
    const list = await fetchComplaints({ reporterId: state.user.id });
    document.getElementById('myStatTotal').textContent = list.length;
    document.getElementById('myStatPending').textContent = list.filter(c => c.status === 'Submitted' || c.status === 'Verified').length;
    document.getElementById('myStatProgress').textContent = list.filter(c => c.status === 'In Progress' || c.status === 'Assigned').length;
    document.getElementById('myStatResolved').textContent = list.filter(c => c.status === 'Resolved').length;

    const listEl = document.getElementById('myComplaintsList');
    if (list.length === 0) {
      listEl.innerHTML = `
        <div class="card" style="text-align: center; padding: 48px; border-radius: var(--radius-lg);">
          <div style="font-size: 36px; margin-bottom: 10px;">📝</div>
          <h3 style="margin: 0 0 6px;">You haven't reported any issues yet</h3>
          <p style="color: var(--ink-500); font-size: 14px; margin: 0 0 20px;">
            Spot something on your street? Potholes, broken streetlights, or waste accumulation can be filed in seconds.
          </p>
          <a class="btn btn-primary btn-sm" href="/report" data-link>Report Your First Issue →</a>
        </div>
      `;
    } else {
      listEl.innerHTML = `
        <div class="admin-table-container">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Complaint ID</th>
                <th>Issue Details</th>
                <th>Category</th>
                <th>Locality</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Submitted</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(c => {
                const cat = getCategoryConfig(c.category);
                return `
                  <tr>
                    <td>
                      <strong style="font-family: 'Plus Jakarta Sans', sans-serif; color: var(--brand-700);">${c.id}</strong>
                    </td>
                    <td>
                      <div style="font-weight: 700; color: var(--ink-900); max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${escapeHtml(c.title)}
                      </div>
                      <small style="color: var(--ink-400);">${c.department || 'Ward Office'}</small>
                    </td>
                    <td>
                      <span class="category-pill">${cat.emoji} ${c.category}</span>
                    </td>
                    <td>${c.area || 'Mangaluru'}</td>
                    <td>
                      <span class="status-badge ${getStatusBadgeClass(c.status)}">${c.status}</span>
                    </td>
                    <td>
                      <span class="priority-badge priority-${(c.priority || 'medium').toLowerCase()}">${c.priority || 'Medium'}</span>
                    </td>
                    <td>${formatDate(c.createdAt)}</td>
                    <td>
                      <div class="row-actions">
                        <a class="btn btn-ghost btn-sm" href="/track?id=${c.id}" data-link>Track Live →</a>
                        ${canDeleteComplaint({ ...c, isOwner: true }) ? `<button type="button" class="btn btn-danger btn-sm" data-delete="${escapeHtml(c.id)}">Delete</button>` : ''}
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
    document.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteComplaint(btn.dataset.delete, { onDone: () => renderMyComplaintsPage() });
      });
    });
  } catch (err) {
    console.error(err);
  }
}

// ============================================================
// PAGE: NOTIFICATIONS (/notifications)
// ============================================================
async function renderNotificationsPage() {
  const app = document.getElementById('app');

  if (!state.user) {
    app.innerHTML = `
      <div class="container narrow" style="padding: 60px 0; text-align: center;">
        <h2>Please sign in to view notifications</h2>
        <a class="btn btn-primary" href="/login" data-link>Sign In</a>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    <div class="container narrow">
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-end;">
        <div>
          <span class="eyebrow">UPDATES & ALERTS</span>
          <h1 class="page-title">Notifications</h1>
          <p class="page-subtitle">Real-time status changes and assignments for your civic complaints.</p>
        </div>
        <button id="markAllReadPageBtn" class="btn btn-ghost btn-sm">Mark All as Read</button>
      </div>

      <div id="fullNotifList" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 40px;">
        <div style="padding: 30px; text-align: center; color: var(--ink-400);">Loading notifications...</div>
      </div>
    </div>
  `;

  document.getElementById('markAllReadPageBtn')?.addEventListener('click', async () => {
    try {
      await apiRequest('/api/notifications/read-all', { method: 'PATCH' });
      showToast('All notifications marked as read', 'success');
      loadAndRenderNotifications();
    } catch (e) {}
  });

  const loadAndRenderNotifications = async () => {
    try {
      const list = await fetchUserNotifications();
      const container = document.getElementById('fullNotifList');
      if (!container) return;

      if (list.length === 0) {
        container.innerHTML = `
          <div class="card" style="text-align: center; padding: 48px; color: var(--ink-500);">
            <div style="font-size: 32px; margin-bottom: 8px;">🔔</div>
            <strong>No notifications yet</strong>
            <p style="font-size: 13px; margin-top: 4px;">You will receive alerts here whenever the status of your complaints change.</p>
          </div>
        `;
      } else {
        container.innerHTML = list.map(n => `
          <div class="card" style="
            display: flex; gap: 16px; align-items: flex-start; cursor: pointer;
            background: ${n.read ? 'var(--surface)' : 'var(--brand-50)'};
            border-color: ${n.read ? 'var(--border)' : 'var(--brand-300)'};
          " onclick="handleNotificationClick('${n.id}', '${n.complaintId || ''}')">
            <div style="font-size: 24px;">${n.type === 'resolution' ? '✅' : '📢'}</div>
            <div style="flex: 1;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 14px; color: var(--ink-900);">${n.title}</strong>
                <small style="font-size: 11px; color: var(--ink-400);">${formatDateTime(n.createdAt)}</small>
              </div>
              <p style="margin: 6px 0 0; font-size: 13px; color: var(--ink-700); line-height: 1.5;">${n.message}</p>
              ${n.complaintId ? `
                <span style="display: inline-block; margin-top: 8px; font-size: 11px; font-weight: 800; color: var(--brand-700);">
                  View Complaint [${n.complaintId}] →
                </span>
              ` : ''}
            </div>
          </div>
        `).join('');
      }
    } catch (e) {
      console.error(e);
    }
  };

  loadAndRenderNotifications();
}

window.handleNotificationClick = async (notifId, compId) => {
  try {
    await apiRequest(`/api/notifications/${notifId}/read`, { method: 'PATCH' });
  } catch (e) {}
  if (compId) {
    navigate(`/track?id=${compId}`);
  }
};

// ============================================================
// PAGE: PROFILE (/profile)
// ============================================================
async function renderProfilePage() {
  const app = document.getElementById('app');

  if (!state.user) {
    navigate('/login');
    return;
  }

  app.innerHTML = `
    <div class="container narrow">
      <div class="page-header">
        <span class="eyebrow">USER SETTINGS</span>
        <h1 class="page-title">Citizen Profile</h1>
        <p class="page-subtitle">Manage your personal credentials, contact details, and role permissions.</p>
      </div>

      <div class="card" style="padding: 32px; border-radius: var(--radius-xl); margin-bottom: 40px;">
        <div style="display: flex; align-items: center; gap: 18px; border-bottom: 1px solid var(--ink-100); padding-bottom: 24px; margin-bottom: 24px;">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: linear-gradient(135deg, var(--brand-500), var(--brand-700)); color: #fff; font-size: 20px; font-weight: 800; display: grid; place-items: center;">
            ${state.user.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h2 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 20px; font-weight: 800; margin: 0 0 4px;">${state.user.name}</h2>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="user-role-badge ${state.user.role === 'admin' ? 'admin' : ''}">${state.user.role.toUpperCase()}</span>
              <span style="font-size: 12px; color: var(--ink-400);">${state.user.email}</span>
            </div>
          </div>
        </div>

        <form id="profileUpdateForm">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 20px;">
            <div>
              <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Full Name</label>
              <input id="profileNameInput" class="form-input" value="${escapeHtml(state.user.name)}" required>
            </div>
            <div>
              <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Mobile Phone</label>
              <input id="profilePhoneInput" class="form-input" value="${escapeHtml(state.user.phone || '')}">
            </div>
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Change Password (leave blank to keep current)</label>
            <input id="profilePasswordInput" type="password" class="form-input" placeholder="Enter new password (optional)">
          </div>

          <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--ink-100); padding-top: 20px;">
            <button class="btn btn-primary" type="submit">Save Profile Changes</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.getElementById('profileUpdateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('profileNameInput')?.value.trim();
    const phone = document.getElementById('profilePhoneInput')?.value.trim();
    const password = document.getElementById('profilePasswordInput')?.value;

    try {
      const payload = { name, phone };
      if (password) payload.password = password;

      const res = await apiRequest('/api/auth/profile', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      state.user = res.user;
      updateHeaderAuthUI();
      showToast('Profile updated successfully', 'success');
      navigate('/profile');
    } catch (err) {
      showToast(err.message || 'Failed to update profile', 'error');
    }
  });
}

// ============================================================
// PAGE: LOGIN & REGISTER (/login, /register)
// ============================================================
function renderLoginPage() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container narrow" style="padding: 60px 0;">
      <div class="card" style="max-width: 460px; margin: auto; padding: 40px; border-radius: var(--radius-xl);">
        <div style="text-align: center; margin-bottom: 28px;">
          <span class="brand-mark" style="margin: 0 auto 14px; width: 48px; height: 48px; font-size: 18px;">DH</span>
          <h1 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 24px; font-weight: 800; margin: 0 0 6px;">Sign in to Dhwani</h1>
          <p style="color: var(--ink-500); font-size: 13px; margin: 0;">Access your submitted reports and municipal dashboard.</p>
        </div>

        <!-- 1-Click Demo Logins for Instant Evaluation -->
        <div style="background: var(--ink-50); border: 1px solid var(--ink-100); border-radius: var(--radius); padding: 14px; margin-bottom: 22px;">
          <small style="display: block; font-size: 10px; font-weight: 800; text-transform: uppercase; color: var(--ink-500); margin-bottom: 8px;">
            ⚡ Quick 1-Click Demo Evaluation
          </small>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button id="quickCitizenLoginBtn" type="button" class="btn btn-ghost btn-sm" style="flex: 1;">
              👤 Demo Citizen
            </button>
            <button id="quickAdminLoginBtn" type="button" class="btn btn-primary btn-sm" style="flex: 1;">
              🏛️ Demo Admin
            </button>
          </div>
        </div>

        <form id="loginForm">
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Email Address</label>
            <input id="loginEmail" type="email" class="form-input" placeholder="e.g. citizen@example.com" required>
          </div>

          <div style="margin-bottom: 20px;">
            <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Password</label>
            <input id="loginPassword" type="password" class="form-input" placeholder="••••••••" required>
          </div>

          <button class="btn btn-primary btn-lg" style="width: 100%;" type="submit">
            Sign In →
          </button>
        </form>

        <div style="text-align: center; margin-top: 24px; font-size: 13px; color: var(--ink-500);">
          Don't have an account? <a href="/register" data-link style="font-weight: 800; color: var(--brand-700);">Register here</a>
        </div>
      </div>
    </div>
  `;

  // Quick Demo Buttons
  document.getElementById('quickCitizenLoginBtn')?.addEventListener('click', () => {
    document.getElementById('loginEmail').value = 'citizen@example.com';
    document.getElementById('loginPassword').value = 'citizen123';
    document.getElementById('loginForm')?.dispatchEvent(new Event('submit'));
  });

  document.getElementById('quickAdminLoginBtn')?.addEventListener('click', () => {
    document.getElementById('loginEmail').value = 'admin@Dhwani.org';
    document.getElementById('loginPassword').value = 'admin123';
    document.getElementById('loginForm')?.dispatchEvent(new Event('submit'));
  });

  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;

    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('Dhwani_token', res.token);
      updateHeaderAuthUI();
      loadNotifications();
      showToast(`Welcome back, ${state.user.name}!`, 'success');

      const next = state.postLoginRedirect;
      state.postLoginRedirect = null;
      if (state.user.role === 'admin') {
        navigate('/admin');
      } else {
        navigate(next || '/my-complaints');
      }
    } catch (err) {
      showToast(err.message || 'Login failed. Please check credentials.', 'error');
    }
  });
}

function renderRegisterPage() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container narrow" style="padding: 60px 0;">
      <div class="card" style="max-width: 480px; margin: auto; padding: 40px; border-radius: var(--radius-xl);">
        <div style="text-align: center; margin-bottom: 28px;">
          <span class="brand-mark" style="margin: 0 auto 14px; width: 48px; height: 48px; font-size: 18px;">DH</span>
          <h1 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 24px; font-weight: 800; margin: 0 0 6px;">Create Citizen Account</h1>
          <p style="color: var(--ink-500); font-size: 13px; margin: 0;">Register to track all your civic complaints with zero hassle.</p>
        </div>

        <form id="registerForm">
          <div style="margin-bottom: 16px;">
            <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Full Name <sup>*</sup></label>
            <input id="regName" class="form-input" placeholder="e.g. Ramesh Bhandary" required>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Email Address <sup>*</sup></label>
            <input id="regEmail" type="email" class="form-input" placeholder="e.g. ramesh@example.com" required>
          </div>

          <div style="margin-bottom: 16px;">
            <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Mobile Phone <sup>*</sup></label>
            <input id="regPhone" type="tel" class="form-input" placeholder="10-digit mobile number" required>
          </div>

          <div style="margin-bottom: 22px;">
            <label style="display: block; font-weight: 800; font-size: 12px; margin-bottom: 6px;">Password <sup>*</sup></label>
            <input id="regPassword" type="password" class="form-input" placeholder="Create secure password" required minlength="6">
          </div>

          <button class="btn btn-primary btn-lg" style="width: 100%;" type="submit">
            Create Account →
          </button>
        </form>

        <div style="text-align: center; margin-top: 24px; font-size: 13px; color: var(--ink-500);">
          Already registered? <a href="/login" data-link style="font-weight: 800; color: var(--brand-700);">Sign in here</a>
        </div>
      </div>
    </div>
  `;

  document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('regName')?.value.trim();
    const email = document.getElementById('regEmail')?.value.trim();
    const phone = document.getElementById('regPhone')?.value.trim();
    const password = document.getElementById('regPassword')?.value;

    try {
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, phone, password, role: 'citizen' })
      });

      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('Dhwani_token', res.token);
      updateHeaderAuthUI();
      showToast('Registration successful! Welcome to Dhwani.', 'success');
      const next = state.postLoginRedirect;
      state.postLoginRedirect = null;
      navigate(next || '/my-complaints');
    } catch (err) {
      showToast(err.message || 'Registration failed', 'error');
    }
  });
}

// ============================================================
// ADMIN SHELL — separate sidebar layout for officers
// ============================================================
function mountAdminShell(active) {
  const app = document.getElementById('app');
  if (!app || app.querySelector('.admin-shell')) return;
  document.body.classList.add('admin-mode');
  const u = state.user || {};
  const initials = (u.name || 'OF').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const item = (key, href, icon, label) =>
    `<a href="${href}" data-link class="admin-nav-item ${active === key ? 'active' : ''}"><span class="admin-nav-ico">${icon}</span><span>${label}</span></a>`;
  const titles = { dashboard: 'Dashboard', complaints: 'Complaints Queue', analytics: 'Analytics', map: 'Live Map', notifications: 'Notifications', profile: 'Profile & Settings' };

  // Move (not re-parse) the page nodes so event listeners and Leaflet maps survive
  const frag = document.createDocumentFragment();
  while (app.firstChild) frag.appendChild(app.firstChild);

  app.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <a class="admin-brand" href="/admin" data-link>
          <span class="brand-mark">DH</span>
          <div><strong>Dhwani</strong><small>Officer Console</small></div>
        </a>
        <nav class="admin-nav">
          <div class="admin-nav-label">Workspace</div>
          ${item('dashboard', '/admin', '📊', 'Dashboard')}
          ${item('complaints', '/admin/complaints', '🗂️', 'Complaints')}
          ${item('analytics', '/admin/analytics', '📈', 'Analytics')}
          ${item('map', '/admin/map', '🗺️', 'Live Map')}
          <div class="admin-nav-label">Account</div>
          ${item('notifications', '/notifications', '🔔', 'Notifications')}
          ${item('profile', '/profile', '👤', 'Profile & Settings')}
        </nav>
        <div class="admin-side-foot">
          <button type="button" class="admin-nav-item" id="adminThemeBtn"><span class="admin-nav-ico">🌓</span><span>Switch theme</span></button>
          <div class="admin-user">
            <span class="user-avatar-sm">${escapeHtml(initials)}</span>
            <div class="admin-user-text">
              <strong>${escapeHtml(u.name || 'Officer')}</strong>
              <small>${escapeHtml(u.department || 'Municipal Corporation')}</small>
            </div>
          </div>
          <button type="button" class="admin-signout" id="adminSignOutBtn">🚪 Sign out</button>
        </div>
      </aside>
      <section class="admin-main">
        <div class="admin-topstrip">
          <div class="admin-crumbs">Officer Console <span>/</span> <b>${titles[active] || ''}</b></div>
          <div class="admin-clock">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        </div>
        <div class="admin-main-body"></div>
      </section>
    </div>`;

  app.querySelector('.admin-main-body').appendChild(frag);
  document.getElementById('adminThemeBtn')?.addEventListener('click', () => document.getElementById('themeToggleBtn')?.click());
  document.getElementById('adminSignOutBtn')?.addEventListener('click', () => logout());

  // Let Leaflet maps re-measure their container after the layout change
  [0, 250, 700].forEach(ms => setTimeout(() => window.dispatchEvent(new Event('resize')), ms));
}

// ============================================================
// PAGE: ADMIN DASHBOARD (/admin)
// ============================================================
async function renderAdminDashboardPage() {
  const app = document.getElementById('app');

  if (!state.user || state.user.role !== 'admin') {
    app.innerHTML = `
      <div class="container narrow" style="padding: 60px 0; text-align: center;">
        <div class="card" style="padding: 40px;">
          <div style="font-size: 36px; margin-bottom: 10px;">🔒</div>
          <h2>Municipal Staff Authorization Required</h2>
          <p style="color: var(--ink-500); margin-bottom: 20px;">You must sign in as an authorized Municipal Officer or Administrator to access the administrative console.</p>
          <button class="btn btn-primary" onclick="navigate('/login')">Sign In with Admin Credentials</button>
        </div>
      </div>
    `;
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 14px;">
        <div>
          <span class="eyebrow">MCC MUNICIPAL ADMINISTRATION</span>
          <h1 class="page-title">Executive Admin Console</h1>
          <p class="page-subtitle">Welcome, <b>${escapeHtml(state.user.name)}</b> (${escapeHtml(state.user.department || 'Municipal Corporation')})</p>
        </div>
        <div style="display: flex; gap: 10px;">
          <a class="btn btn-ghost" href="/admin/complaints" data-link>Manage Complaints Console →</a>
          <a class="btn btn-outline" href="/admin/analytics" data-link>Detailed Analytics</a>
        </div>
      </div>

      <!-- KPI Metrics -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
        <div class="stat-card">
          <div class="stat-icon" style="background: #eef2ff; color: #4338ca;">📊</div>
          <div class="stat-info">
            <small>Total Received</small>
            <strong id="adminStatTotal">--</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: #fef3e6; color: #c47a2e;">⏳</div>
          <div class="stat-info">
            <small>Pending Verification</small>
            <strong id="adminStatPending">--</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: var(--brand-50); color: var(--brand-700);">🛠️</div>
          <div class="stat-info">
            <small>In Active Progress</small>
            <strong id="adminStatProgress">--</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: #ecfdf5; color: #059669;">✅</div>
          <div class="stat-info">
            <small>Resolved Cases</small>
            <strong id="adminStatResolved">--</strong>
          </div>
        </div>
      </div>

      <!-- Secondary Row -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px;">
        <div class="stat-card">
          <div class="stat-icon" style="background: #fee2e2; color: #991b1b;">🚨</div>
          <div class="stat-info">
            <small>Critical Priority</small>
            <strong id="adminStatCritical" style="color: #991b1b;">--</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: #f0fdf4; color: #166534;">📈</div>
          <div class="stat-info">
            <small>Resolution Rate</small>
            <strong id="adminStatRate">--%</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: #fefce8; color: #854d0e;">⏱️</div>
          <div class="stat-info">
            <small>Avg Resolution Time</small>
            <strong id="adminStatAvgHours">-- hrs</strong>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background: #fdf2f8; color: #9d174d;">🎯</div>
          <div class="stat-info">
            <small>SLA Compliance</small>
            <strong id="adminStatSla">92%</strong>
          </div>
        </div>
      </div>

      <!-- Quick Action Table: Needs Attention -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h3 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 18px; margin: 0;">Complaints Requiring Immediate Action</h3>
        <a href="/admin/complaints" data-link style="font-size: 12px; font-weight: 700; color: var(--brand-700);">View full management queue →</a>
      </div>

      <div id="adminActionQueueTable" class="admin-table-container">
        <div style="padding: 30px; text-align: center; color: var(--ink-400);">Loading queue...</div>
      </div>
    </div>
  `;

  mountAdminShell('dashboard');

  try {
    const stats = await fetchSummaryStats();
    document.getElementById('adminStatTotal').textContent = stats.total;
    document.getElementById('adminStatPending').textContent = stats.pending;
    document.getElementById('adminStatProgress').textContent = stats.inProgress + stats.assigned;
    document.getElementById('adminStatResolved').textContent = stats.resolved;
    document.getElementById('adminStatCritical').textContent = stats.critical;
    document.getElementById('adminStatRate').textContent = `${stats.resolutionRate}%`;
    document.getElementById('adminStatAvgHours').textContent = `${stats.avgResolutionHours} hrs`;

    const pendingList = await fetchComplaints({ status: 'Submitted,Verified,Assigned,In Progress' });
    const tableContainer = document.getElementById('adminActionQueueTable');
    if (pendingList.length === 0) {
      tableContainer.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--ink-500);">All complaints are resolved! No pending action items.</div>';
    } else {
      tableContainer.innerHTML = `
        <table class="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Category & Title</th>
              <th>Area</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Department</th>
              <th>Reported</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${pendingList.slice(0, 6).map(c => `
              <tr>
                <td class="col-id"><span class="ref-id">${escapeHtml(c.id)}</span></td>
                <td class="col-title">
                  <div class="cell-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</div>
                  <small class="cell-sub">${escapeHtml(c.category)}</small>
                </td>
                <td>${escapeHtml(c.area)}</td>
                <td><span class="priority-badge priority-${(c.priority || 'medium').toLowerCase()}">${escapeHtml(c.priority)}</span></td>
                <td><span class="status-badge ${getStatusBadgeClass(c.status)}">${escapeHtml(c.status)}</span></td>
                <td class="col-dept"><div class="cell-dept">${escapeHtml(c.department)}</div></td>
                <td class="nowrap">${formatDate(c.createdAt)}</td>
                <td>
                  <button type="button" class="btn btn-primary btn-sm" onclick="openAdminManageModal('${escapeHtml(c.id)}')">Manage →</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    console.error(err);
  }
}

// ============================================================
// PAGE: ADMIN MANAGE COMPLAINTS (/admin/complaints)
// ============================================================
async function renderAdminComplaintsPage() {
  const app = document.getElementById('app');

  if (!state.user || state.user.role !== 'admin') {
    navigate('/login');
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 14px;">
        <div>
          <span class="eyebrow">MUNICIPAL DESK</span>
          <h1 class="page-title">Manage Complaints Queue</h1>
          <p class="page-subtitle">Verify, assign officers, update statuses, add progress notes, and certify resolution evidence.</p>
        </div>
        <div style="display: flex; gap: 10px;">
          <a class="btn btn-ghost" href="/admin" data-link>← Back to Dashboard</a>
        </div>
      </div>

      <!-- Filters Bar -->
      <div class="filter-bar">
        <input id="adminFilterSearch" class="form-input" style="flex: 1; min-width: 220px;" placeholder="Search by ID, keyword, citizen...">

        <select id="adminFilterStatus" class="form-select">
          <option value="all">All Statuses</option>
          <option value="Submitted">Submitted (Needs Verification)</option>
          <option value="Verified">Verified</option>
          <option value="Assigned">Assigned</option>
          <option value="In Progress">In Progress</option>
          <option value="Resolved">Resolved</option>
          <option value="Rejected">Rejected</option>
        </select>

        <select id="adminFilterPriority" class="form-select">
          <option value="all">All Priorities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select id="adminFilterDept" class="form-select">
          <option value="all">All Departments</option>
          <option value="PWD (Roads & Infrastructure)">PWD (Roads)</option>
          <option value="Health & Sanitation Section">Health & Sanitation</option>
          <option value="Mangaluru City Water Supply Board">Water Supply Board</option>
          <option value="Engineering Section (Drainage & Sewage)">Drainage Section</option>
          <option value="MESCOM (Electrical Division)">MESCOM Electrical</option>
          <option value="Mangaluru City Traffic Police">Traffic Police</option>
        </select>

        <button id="adminApplyFiltersBtn" class="btn btn-primary btn-sm">Filter</button>
      </div>

      <!-- Complaints Queue Table -->
      <div id="adminFullTableContainer" class="admin-table-container">
        <div style="padding: 40px; text-align: center; color: var(--ink-400);">Loading complaints queue...</div>
      </div>
    </div>
  `;

  mountAdminShell('complaints');

  // ---- Queue state ----
  const PRIORITY_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  const STATUS_RANK = { Submitted: 1, Verified: 2, Assigned: 3, 'In Progress': 4, Reopened: 5, Resolved: 6, Rejected: 7 };
  let currentList = [];
  let sortKey = 'createdAt';
  let sortDir = 'desc';

  const sortValue = (c, key) => {
    if (key === 'priority') return PRIORITY_RANK[c.priority] || 0;
    if (key === 'status') return STATUS_RANK[c.status] || 0;
    if (key === 'createdAt') return new Date(c.createdAt || 0).getTime();
    return String(c[key] || '').toLowerCase();
  };

  const sortArrow = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const renderQueue = () => {
    const container = document.getElementById('adminFullTableContainer');
    if (!container) return;

    if (currentList.length === 0) {
      container.innerHTML = `
        <div class="admin-empty">
          <div class="admin-empty-icon">📭</div>
          <strong>No complaints found</strong>
          <span>Try clearing the filters or searching with a different keyword.</span>
        </div>`;
      return;
    }

    const list = [...currentList].sort((a, b) => {
      const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    const count = (...names) => currentList.filter(c => names.includes(c.status)).length;
    const th = (label, key) => key
      ? `<th class="sortable" data-sort="${key}">${label}${sortArrow(key)}</th>`
      : `<th>${label}</th>`;

    container.innerHTML = `
      <div class="admin-summary">
        <div class="admin-chip"><strong>${currentList.length}</strong><span>Total</span></div>
        <div class="admin-chip chip-submitted"><strong>${count('Submitted', 'Reopened')}</strong><span>New</span></div>
        <div class="admin-chip chip-progress"><strong>${count('Verified', 'Assigned', 'In Progress')}</strong><span>In action</span></div>
        <div class="admin-chip chip-resolved"><strong>${count('Resolved')}</strong><span>Resolved</span></div>
        <div class="admin-chip chip-rejected"><strong>${count('Rejected')}</strong><span>Rejected</span></div>
      </div>
      <div class="admin-table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              ${th('Reference ID', 'id')}
              ${th('Title & Category', 'title')}
              ${th('Location', 'area')}
              ${th('Priority', 'priority')}
              ${th('Status', 'status')}
              ${th('Department & Officer')}
              ${th('Reported By')}
              ${th('Date', 'createdAt')}
              ${th('Actions')}
            </tr>
          </thead>
          <tbody>
            ${list.map(c => {
              const id = escapeHtml(c.id);
              const prio = escapeHtml(c.priority || 'Medium');
              return `
              <tr>
                <td class="col-id"><span class="ref-id">${id}</span></td>
                <td class="col-title">
                  <div class="cell-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</div>
                  <small class="cell-sub">${escapeHtml(c.category)}</small>
                </td>
                <td class="col-loc">
                  <div>${escapeHtml(c.area)}</div>
                  <small class="cell-sub">${escapeHtml(c.landmark || '')}</small>
                </td>
                <td><span class="priority-badge priority-${prio.toLowerCase()}">${prio}</span></td>
                <td><span class="status-badge ${getStatusBadgeClass(c.status)}">${escapeHtml(c.status)}</span></td>
                <td class="col-dept">
                  <div class="cell-dept">${escapeHtml(c.department)}</div>
                  <small class="cell-sub ${c.officer ? '' : 'is-unassigned'}">${escapeHtml(c.officer || 'Unassigned')}</small>
                </td>
                <td class="col-reporter">
                  <div>${c.anonymous ? '🕶️ Anonymous Citizen' : escapeHtml(c.reporterName || c.name || 'Anonymous')}</div>
                  <small class="cell-sub nowrap">${c.anonymous ? '' : escapeHtml(c.reporterPhone || c.phone || '')}</small>
                </td>
                <td class="nowrap">${formatDate(c.createdAt)}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="btn btn-primary btn-sm" data-manage="${id}">Manage</button>
                    <a class="btn btn-ghost btn-sm" href="/track?id=${encodeURIComponent(c.id)}" data-link>View</a>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  };

  const loadQueue = async () => {
    const s = document.getElementById('adminFilterSearch')?.value.trim();
    const st = document.getElementById('adminFilterStatus')?.value;
    const pr = document.getElementById('adminFilterPriority')?.value;
    const dept = document.getElementById('adminFilterDept')?.value;

    const q = {};
    if (s) q.search = s;
    if (st && st !== 'all') q.status = st;
    if (pr && pr !== 'all') q.priority = pr;
    if (dept && dept !== 'all') q.department = dept;

    const container = document.getElementById('adminFullTableContainer');
    try {
      currentList = await fetchComplaints(q);
    } catch (err) {
      console.error('Failed to load complaints queue:', err);
      if (container) container.innerHTML = '<div class="admin-empty"><div class="admin-empty-icon">⚠️</div><strong>Could not load complaints</strong><span>Please refresh and try again.</span></div>';
      return;
    }
    renderQueue();
  };

  loadQueue();

  // Delegated clicks: Manage buttons + sortable headers
  document.getElementById('adminFullTableContainer')?.addEventListener('click', (e) => {
    const manageBtn = e.target.closest('[data-manage]');
    if (manageBtn) {
      window.openAdminManageModal(manageBtn.dataset.manage);
      return;
    }
    const sortTh = e.target.closest('th[data-sort]');
    if (sortTh) {
      const key = sortTh.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = key; sortDir = key === 'createdAt' || key === 'priority' ? 'desc' : 'asc'; }
      renderQueue();
    }
  });

  document.getElementById('adminApplyFiltersBtn')?.addEventListener('click', loadQueue);
  document.getElementById('adminFilterStatus')?.addEventListener('change', loadQueue);
  document.getElementById('adminFilterPriority')?.addEventListener('change', loadQueue);
  document.getElementById('adminFilterDept')?.addEventListener('change', loadQueue);
  let searchTimer;
  document.getElementById('adminFilterSearch')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadQueue, 350);
  });
  document.getElementById('adminFilterSearch')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') { clearTimeout(searchTimer); loadQueue(); }
  });
}

// ============================================================
// ADMIN MANAGE MODAL HANDLER
// ============================================================
window.openAdminManageModal = async (complaintId) => {
  try {
    const c = await fetchComplaint(complaintId);
    if (!c) return showToast('Complaint not found', 'error');

    // Null-safe helpers so one missing element can never break the whole modal
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    const setValue = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };

    setValue('modalComplaintId', c.id);
    setText('modalComplaintRef', c.id);
    // Title lives in #adminModalTitle (old code targeted a non-existent #modalComplaintTitle)
    setText('adminModalTitle', c.title ? `Manage: ${c.title}` : 'Update Complaint');
    setText('modalComplaintCategory', c.category || '');
    setText('modalComplaintArea', `📍 ${c.area || ''}${c.landmark ? ' · ' + c.landmark : ''}`);

    const statusBadge = document.getElementById('modalCurrentStatusBadge');
    if (statusBadge) {
      statusBadge.textContent = c.status;
      statusBadge.className = `status-badge ${getStatusBadgeClass(c.status)}`;
    }

    setValue('modalStatusSelect', c.status);
    setValue('modalPrioritySelect', c.priority || 'Medium');
    setValue('modalOfficerInput', c.officer || '');
    setValue('modalRemarksTextarea', '');
    setValue('modalEvidenceFileInput', '');

    // Populate department options (tolerate a plain array or { departments: [] })
    const deptData = await fetchDepartments();
    const depts = Array.isArray(deptData) ? deptData : (deptData?.departments || []);
    const deptSelect = document.getElementById('modalDeptSelect');
    if (deptSelect) {
      const names = depts.map(d => d.name);
      if (c.department && !names.includes(c.department)) names.unshift(c.department);
      deptSelect.innerHTML = names.map(n => `
        <option value="${escapeHtml(n)}" ${c.department === n ? 'selected' : ''}>${escapeHtml(n)}</option>
      `).join('');
    }

    // Toggle resolution evidence block. Using .onchange (not addEventListener)
    // so reopening the modal doesn't stack duplicate listeners.
    const resBlock = document.getElementById('modalResolutionEvidenceBlock');
    const statusSelect = document.getElementById('modalStatusSelect');
    if (resBlock && statusSelect) {
      resBlock.style.display = c.status === 'Resolved' ? 'block' : 'none';
      statusSelect.onchange = (e) => {
        resBlock.style.display = e.target.value === 'Resolved' ? 'block' : 'none';
      };
    }

    document.getElementById('adminModal')?.classList.add('open');
  } catch (err) {
    console.error('openAdminManageModal failed:', err);
    showToast(`Failed to open management modal${err?.message ? ': ' + err.message : ''}`, 'error');
  }
};

document.getElementById('closeAdminModalBtn')?.addEventListener('click', () => {
  document.getElementById('adminModal')?.classList.remove('open');
});
document.getElementById('cancelAdminModalBtn')?.addEventListener('click', () => {
  document.getElementById('adminModal')?.classList.remove('open');
});
document.getElementById('adminModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'adminModal') e.target.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('adminModal')?.classList.remove('open');
});

document.getElementById('adminManageForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('modalComplaintId')?.value;
  const status = document.getElementById('modalStatusSelect')?.value;
  const priority = document.getElementById('modalPrioritySelect')?.value;
  const department = document.getElementById('modalDeptSelect')?.value;
  const officer = document.getElementById('modalOfficerInput')?.value.trim();
  const remarks = document.getElementById('modalRemarksTextarea')?.value.trim();
  const evidenceFile = document.getElementById('modalEvidenceFileInput')?.files?.[0];

  const saveBtn = document.getElementById('saveAdminModalBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving changes...';

  try {
    let evidencePhotoUrl = null;
    if (evidenceFile) {
      const formData = new FormData();
      formData.append('files', evidenceFile);
      const uploadRes = await apiRequest(`/api/complaints/${id}/upload`, {
        method: 'POST',
        body: formData
      });
      if (uploadRes.urls && uploadRes.urls[0]) {
        evidencePhotoUrl = uploadRes.urls[0];
      }
    }

    const payload = {
      status,
      priority,
      department,
      officer,
      remarks,
      evidencePhoto: evidencePhotoUrl,
      adminName: state.user ? state.user.name : 'Municipal Authority'
    };

    await apiRequest(`/api/complaints/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    showToast(`Complaint ${id} status updated to ${status}!`, 'success');
    document.getElementById('adminModal')?.classList.remove('open');

    // Refresh current view if admin queue
    if (state.currentRoute.startsWith('/admin/complaints')) {
      renderAdminComplaintsPage();
    } else if (state.currentRoute.startsWith('/admin')) {
      renderAdminDashboardPage();
    } else if (state.currentRoute.startsWith('/track')) {
      renderTrackPage(id);
    }
  } catch (err) {
    showToast(err.message || 'Failed to update complaint status', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & Notify Citizen →';
  }
});

// ============================================================
// PAGE: ADMIN ANALYTICS (/admin/analytics)
// ============================================================
async function renderAdminAnalyticsPage() {
  const app = document.getElementById('app');

  if (!state.user || state.user.role !== 'admin') {
    navigate('/login');
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="page-header" style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 14px;">
        <div>
          <span class="eyebrow">DATA INTELLIGENCE</span>
          <h1 class="page-title">Municipal Analytics & Insights</h1>
          <p class="page-subtitle">Civic problem density, department efficiency, and SLA compliance metrics.</p>
        </div>
        <a class="btn btn-ghost" href="/admin" data-link>← Back to Admin Console</a>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 30px;">
        <!-- Category Distribution -->
        <div class="card">
          <h3 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 16px; margin: 0 0 16px;">Reports by Civic Category</h3>
          <div id="analyticsCategoryBars">Loading...</div>
        </div>

        <!-- Area Breakdown -->
        <div class="card">
          <h3 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 16px; margin: 0 0 16px;">Reports by Mangaluru Area</h3>
          <div id="analyticsAreaBars">Loading...</div>
        </div>
      </div>

      <!-- Department Workload & Resolution Table -->
      <div class="card" style="margin-bottom: 40px;">
        <h3 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 16px; margin: 0 0 16px;">Department Workload & Performance</h3>
        <div id="analyticsDeptTable">Loading...</div>
      </div>
    </div>
  `;

  mountAdminShell('analytics');

  try {
    const data = await fetchAnalytics();

    // Render Category Distribution Bars
    const catContainer = document.getElementById('analyticsCategoryBars');
    const totalCat = Object.values(data.categoryCounts).reduce((a, b) => a + b, 0) || 1;
    catContainer.innerHTML = Object.entries(data.categoryCounts).map(([cat, count]) => {
      const pct = Math.round((count / totalCat) * 100);
      const conf = getCategoryConfig(cat);
      return `
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 4px;">
            <span>${conf.emoji} ${cat}</span>
            <span><b>${count}</b> (${pct}%)</span>
          </div>
          <div style="height: 8px; background: var(--ink-100); border-radius: 4px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: ${conf.color}; border-radius: 4px;"></div>
          </div>
        </div>
      `;
    }).join('');

    // Render Area Bars
    const areaContainer = document.getElementById('analyticsAreaBars');
    const totalArea = Object.values(data.areaCounts).reduce((a, b) => a + b, 0) || 1;
    areaContainer.innerHTML = Object.entries(data.areaCounts).map(([area, count]) => {
      const pct = Math.round((count / totalArea) * 100);
      return `
        <div style="margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 700; margin-bottom: 4px;">
            <span>📍 ${area}</span>
            <span><b>${count}</b> (${pct}%)</span>
          </div>
          <div style="height: 8px; background: var(--ink-100); border-radius: 4px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: var(--brand-600); border-radius: 4px;"></div>
          </div>
        </div>
      `;
    }).join('');

    // Render Department Table
    const deptContainer = document.getElementById('analyticsDeptTable');
    deptContainer.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Department</th>
            <th>Total Received</th>
            <th>Pending</th>
            <th>In Progress</th>
            <th>Resolved</th>
            <th>Resolution Rate</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(data.deptStats).map(([dName, dStat]) => {
            const rate = dStat.total > 0 ? Math.round((dStat.resolved / dStat.total) * 100) : 0;
            return `
              <tr>
                <td><b>${dName}</b></td>
                <td>${dStat.total}</td>
                <td><span class="status-badge submitted">${dStat.pending}</span></td>
                <td><span class="status-badge progress">${dStat.inProgress}</span></td>
                <td><span class="status-badge resolved">${dStat.resolved}</span></td>
                <td>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="width: 80px; height: 6px; background: var(--ink-100); border-radius: 3px; overflow: hidden;">
                      <div style="width: ${rate}%; height: 100%; background: var(--brand-500);"></div>
                    </div>
                    <b>${rate}%</b>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error(err);
  }
}

// ============================================================
// PAGE: 404 NOT FOUND
// ============================================================
function render404Page() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="container narrow" style="padding: 80px 0; text-align: center;">
      <div style="font-size: 64px; margin-bottom: 12px;">🗺️</div>
      <h1 style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 36px; font-weight: 800; margin: 0 0 10px;">Page Not Found</h1>
      <p style="color: var(--ink-500); font-size: 16px; max-width: 440px; margin: 0 auto 28px;">
        The requested civic portal link does not exist or may have been moved.
      </p>
      <div style="display: flex; justify-content: center; gap: 12px;">
        <a class="btn btn-primary" href="/" data-link>Return to Home</a>
        <a class="btn btn-ghost" href="/track" data-link>Track a Complaint</a>
      </div>
    </div>
  `;
}

// ============================================================
// UTILITIES: Lightbox, Theme, Time Format
// ============================================================
window.openLightbox = (src, caption = '') => {
  const modal = document.getElementById('lightboxModal');
  const img = document.getElementById('lightboxImg');
  const cap = document.getElementById('lightboxCaption');
  if (modal && img) {
    img.src = src;
    if (cap) cap.textContent = caption;
    modal.classList.add('open');
  }
};

document.getElementById('closeLightboxBtn')?.addEventListener('click', () => {
  document.getElementById('lightboxModal')?.classList.remove('open');
});
document.getElementById('lightboxModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'lightboxModal') {
    document.getElementById('lightboxModal')?.classList.remove('open');
  }
});

function initThemeToggle() {
  const saved = localStorage.getItem('Dhwani_theme');
  const isDark = saved === 'dark';
  document.body.classList.toggle('dark', isDark);
  updateThemeIcon(isDark);

  document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const nowDark = document.body.classList.contains('dark');
    localStorage.setItem('Dhwani_theme', nowDark ? 'dark' : 'light');
    updateThemeIcon(nowDark);
  });
}

function updateThemeIcon(isDark) {
  const icon = document.getElementById('themeToggleIcon');
  if (icon) icon.textContent = isDark ? '☀' : '☾';
}

function initHeaderScroll() {
  const topbar = document.getElementById('mainTopbar');
  if (topbar) {
    window.addEventListener('scroll', () => {
      topbar.classList.toggle('scrolled', window.scrollY > 8);
    }, { passive: true });
  }

  // Hamburger drawer
  document.getElementById('hamburgerBtn')?.addEventListener('click', () => {
    document.getElementById('mobileDrawerOverlay')?.classList.add('open');
  });
  document.getElementById('closeDrawerBtn')?.addEventListener('click', () => {
    document.getElementById('mobileDrawerOverlay')?.classList.remove('open');
  });
  document.getElementById('mobileDrawerOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'mobileDrawerOverlay') {
      document.getElementById('mobileDrawerOverlay')?.classList.remove('open');
    }
  });

  // Bell dropdown toggle
  document.getElementById('notifBellBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('notifDropdown')?.classList.toggle('show');
  });

  document.getElementById('markAllReadBtn')?.addEventListener('click', async () => {
    try {
      await apiRequest('/api/notifications/read-all', { method: 'PATCH' });
      showToast('Notifications marked as read', 'success');
      loadNotifications();
    } catch (e) {}
  });
}

window.copyText = (text) => {
  navigator.clipboard?.writeText(text).then(() => {
    showToast(`Copied ${text}`, 'success');
  });
};

function getStatusBadgeClass(status) {
  return {
    'Submitted':   'submitted',
    'Verified':    'verified',
    'Assigned':    'assigned',
    'In Progress': 'progress',
    'Resolved':    'resolved',
    'Rejected':    'rejected',
    'Reopened':    'reopened'
  }[status] || 'submitted';
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch (e) {
    return iso;
  }
}

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return iso;
  }
}

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// APPLICATION ENTRY POINT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  initThemeToggle();
  initHeaderScroll();
  await initAuth();

  // Initial Route Dispatch
  navigate(window.location.pathname + window.location.search, false);
});