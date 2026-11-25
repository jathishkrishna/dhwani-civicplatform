// ============================================================
// Supabase (PostgreSQL) data layer.
// Same function names as the old JSON-file db.js, but every data function is now ASYNC
// (returns a Promise), so callers must `await` them.
//
// Storage layout:
//   users, sessions, notifications, counters  -> normal tables
//   complaints -> a few real columns (for the Supabase dashboard / indexes)
//                 + a `doc` JSON column holding the full complaint object,
//                 so the shape the frontend sees is exactly what it was before.
// ============================================================
const crypto = require('crypto');
const sb = require('./supabase');

// ---------------- Passwords (unchanged, so existing hashes keep working) ----------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

// ---------------- Static data ----------------
const DEPARTMENTS = [
  {
    name: 'PWD (Roads & Infrastructure)',
    categories: ['Road damage and potholes', 'Other civic issues'],
    sla: '7 days',
    slaHours: 168,
    officers: ['Ravi Kumar (JE - PWD Kadri)', 'Priya Shenoy (AE - Roads Central)', 'Mohan Das (Site Inspector)']
  },
  {
    name: 'Health & Sanitation Section',
    categories: ['Garbage and waste management', 'Beach / Public Space Litter', 'Park and public-space maintenance'],
    sla: '24 hours',
    slaHours: 24,
    officers: ['Dr. Muralidhar (Health Officer)', 'Suresh Nayak (Sanitary Inspector Hampankatta)', 'Rashmi Rao (Waste Mgmt Officer)']
  },
  {
    name: 'Mangaluru City Water Supply Board',
    categories: ['Water leakage'],
    sla: '48 hours',
    slaHours: 48,
    officers: ['Rajesh Bhat (Assistant Executive Engineer)', 'Venkatesh Rao (Pipelines Inspector)']
  },
  {
    name: 'Engineering Section (Drainage & Sewage)',
    categories: ['Drainage and sewage', 'Drainage / Waterlogging'],
    sla: '72 hours',
    slaHours: 72,
    officers: ['Premanand Rao (Executive Engineer)', 'Sandeep Acharya (Stormwater JE)', 'Divya Hegde (Sanitary Engineer)']
  },
  {
    name: 'MESCOM (Electrical Division)',
    categories: ['Streetlight failure', 'Electricity and exposed wires', 'Broken Streetlight'],
    sla: '48 hours',
    slaHours: 48,
    officers: ['Ganesh Poojary (Section Officer Kadri)', 'Kiran Shetty (Line Inspector)', 'Naveen Kumar (Electrical JE)']
  },
  {
    name: 'Mangaluru City Traffic Police',
    categories: ['Traffic problems', 'Traffic / Parking', 'Public safety'],
    sla: '12 hours',
    slaHours: 12,
    officers: ['Inspector Harish (Traffic Division West)', 'Sub-Inspector Deepa K', 'Officer Ramesh (Surveillance)']
  },
  {
    name: 'Parks & Public Spaces Department',
    categories: ['Park and public-space maintenance'],
    sla: '4 days',
    slaHours: 96,
    officers: ['Vasant Kumar (Horticulture Superintendent)', 'Latha P (Public Spaces Officer)']
  },
  {
    name: 'Ward Office / General Administration',
    categories: ['Other civic issues', 'Other'],
    sla: '5 days',
    slaHours: 120,
    officers: ['Sharath Hegde (Ward Officer Central)', 'Sunita D (Public Relations Officer)']
  }
];

// ---------------- Helpers ----------------
// Throws a readable error when a Supabase call fails
function must(res, what) {
  if (res.error) {
    const e = new Error(`[db] ${what || 'query'} failed: ${res.error.message}`);
    e.cause = res.error;
    throw e;
  }
  return res.data;
}

const normEmail = (e) => String(e || '').toLowerCase().trim();
const normId = (id) => String(id || '').trim().toUpperCase();

const userOut = (r) => r && ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  passwordHash: r.password_hash,
  role: r.role,
  department: r.department,
  title: r.title,
  createdAt: r.created_at
});

const notifOut = (r) => r && ({
  id: r.id,
  userId: r.user_id,
  complaintId: r.complaint_id,
  title: r.title,
  message: r.message,
  type: r.type,
  read: r.read,
  createdAt: r.created_at
});

// The real columns that mirror the complaint (the full object lives in `doc`)
const complaintRow = (c) => ({
  id: c.id,
  status: c.status || 'Submitted',
  category: c.category || null,
  priority: c.priority || null,
  area: c.area || null,
  department: c.department || null,
  reporter_id: c.reporterId || null,
  created_at: c.createdAt || new Date().toISOString(),
  updated_at: c.updatedAt || c.createdAt || new Date().toISOString(),
  doc: c
});

// Reads every complaint (Supabase returns at most 1000 rows per request, so page through)
async function allComplaints() {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await sb.from('complaints').select('doc').order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    const rows = must(res, 'read complaints');
    out.push(...rows.map(r => r.doc));
    if (rows.length < PAGE) break;
  }
  return out;
}

async function saveComplaint(c) {
  must(await sb.from('complaints').upsert(complaintRow(c), { onConflict: 'id' }), 'save complaint');
  return c;
}

// ---------------- Start-up ----------------
// Creates the demo accounts if the users table is empty. Call (and await) once before the server starts.
async function init() {
  const { count, error } = await sb.from('users').select('id', { count: 'exact', head: true });
  if (error) {
    throw new Error(`Could not reach the Supabase "users" table: ${error.message}. ` +
      'Did you run schema.sql in the Supabase SQL editor, and are SUPABASE_URL / SUPABASE_SECRET_KEY correct in .env?');
  }
  if (count === 0) {
    must(await sb.from('users').insert([
      {
        id: 'usr_admin_01', name: 'Commissioner M. Hegde', email: 'admin@dhwani.org', phone: '+91 824 2220300',
        password_hash: hashPassword('admin123'), role: 'admin', department: 'Municipal Administration',
        title: 'Municipal Commissioner', created_at: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'usr_officer_pwd', name: 'Ravi Kumar (JE)', email: 'officer.pwd@dhwani.org', phone: '+91 98450 11223',
        password_hash: hashPassword('pwd123'), role: 'admin', department: 'PWD (Roads & Infrastructure)',
        title: 'Junior Engineer — Kadri Section', created_at: '2026-01-05T00:00:00.000Z'
      },
      {
        id: 'usr_citizen_ananya', name: 'Ananya Rao', email: 'citizen@example.com', phone: '9876543210',
        password_hash: hashPassword('citizen123'), role: 'citizen', department: null,
        title: 'Resident, Kadri', created_at: '2026-02-10T00:00:00.000Z'
      }
    ]), 'seed demo users');
    console.log('[db] created demo accounts (admin@dhwani.org / citizen@example.com)');
  }
  console.log('[db] connected to Supabase');
}

module.exports = {
  init,

  // Department info (static, not async)
  getDepartments: () => DEPARTMENTS,

  // ---------------- Auth & Users ----------------
  getUsers: async () => must(await sb.from('users').select('*'), 'read users').map(userOut),

  getUserById: async (id) => {
    if (!id) return null;
    return userOut(must(await sb.from('users').select('*').eq('id', id).maybeSingle(), 'read user'));
  },

  getUserByEmail: async (email) => {
    const e = normEmail(email);
    if (!e) return null;
    return userOut(must(await sb.from('users').select('*').eq('email', e).maybeSingle(), 'read user by email'));
  },

  addUser: async (userData) => {
    const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const row = {
      id,
      name: userData.name || 'Citizen',
      email: normEmail(userData.email),
      phone: userData.phone || '',
      password_hash: hashPassword(userData.password || 'password123'),
      role: userData.role || 'citizen',
      department: userData.department || null,
      title: userData.title || (userData.role === 'admin' ? 'Municipal Staff' : 'Resident'),
      created_at: new Date().toISOString()
    };
    return userOut(must(await sb.from('users').insert(row).select().single(), 'add user'));
  },

  updateUser: async (id, patch) => {
    const row = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.department !== undefined) row.department = patch.department;
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.role !== undefined) row.role = patch.role;
    if (patch.password) row.password_hash = hashPassword(patch.password);
    if (Object.keys(row).length === 0) return userOut(must(await sb.from('users').select('*').eq('id', id).maybeSingle(), 'read user'));
    return userOut(must(await sb.from('users').update(row).eq('id', id).select().maybeSingle(), 'update user'));
  },

  authenticateUser: async (email, password) => {
    const u = await module.exports.getUserByEmail(email);
    if (!u) return null;
    return verifyPassword(password, u.passwordHash) ? u : null;
  },

  // ---------------- Sessions ----------------
  createSession: async (userId) => {
    const token = `cpsess_${crypto.randomBytes(24).toString('hex')}`;
    must(await sb.from('sessions').insert({ token, user_id: userId, created_at: Date.now() }), 'create session');
    // Tidy up sessions older than 30 days (best effort, never blocks login)
    sb.from('sessions').delete().lt('created_at', Date.now() - 30 * 86400000).then(() => {}, () => {});
    return token;
  },

  getSessionUser: async (token) => {
    if (!token) return null;
    const sess = must(await sb.from('sessions').select('*').eq('token', token).maybeSingle(), 'read session');
    if (!sess) return null;
    if (Date.now() - Number(sess.created_at) > 30 * 86400000) return null; // valid for 30 days
    return module.exports.getUserById(sess.user_id);
  },

  deleteSession: async (token) => {
    if (!token) return;
    must(await sb.from('sessions').delete().eq('token', token), 'delete session');
  },

  // ---------------- Complaints ----------------
  getComplaints: async (query = {}) => {
    let list = await allComplaints();

    if (query.status && query.status !== 'all') {
      const statuses = query.status.split(',').map(s => s.trim().toLowerCase());
      list = list.filter(c => statuses.includes((c.status || '').toLowerCase()));
    }
    if (query.category && query.category !== 'all') {
      list = list.filter(c => (c.category || '').toLowerCase() === query.category.toLowerCase());
    }
    if (query.priority && query.priority !== 'all') {
      list = list.filter(c => (c.priority || '').toLowerCase() === query.priority.toLowerCase());
    }
    if (query.area && query.area !== 'all') {
      list = list.filter(c => (c.area || '').toLowerCase() === query.area.toLowerCase());
    }
    if (query.department && query.department !== 'all') {
      list = list.filter(c => (c.department || '').toLowerCase() === query.department.toLowerCase());
    }
    if (query.reporterId) {
      list = list.filter(c => c.reporterId === query.reporterId);
    }
    if (query.flagged === 'true') {
      list = list.filter(c => (c.flags || []).length > 0 || c.reviewStatus === 'held');
    }
    if (query.overdue === 'true') {
      list = list.filter(c => c.overdue && c.status !== 'Resolved' && c.status !== 'Rejected');
    }
    if (query.search) {
      const q = query.search.toLowerCase().trim();
      list = list.filter(c =>
        (c.id && c.id.toLowerCase().includes(q)) ||
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.description && c.description.toLowerCase().includes(q)) ||
        (c.area && c.area.toLowerCase().includes(q)) ||
        (c.landmark && c.landmark.toLowerCase().includes(q)) ||
        (c.category && c.category.toLowerCase().includes(q))
      );
    }

    if (query.sort === 'oldest') {
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (query.sort === 'priority') {
      const pOrder = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
      list.sort((a, b) => (pOrder[b.priority] || 0) - (pOrder[a.priority] || 0));
    } else if (query.sort === 'votes') {
      list.sort((a, b) =>
        ((b.voters || []).length - (a.voters || []).length) ||
        (new Date(b.createdAt) - new Date(a.createdAt))
      );
    } else {
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return list;
  },

  getComplaint: async (id) => {
    if (!id) return null;
    const res = await sb.from('complaints').select('doc').eq('id', normId(id)).maybeSingle();
    const row = must(res, 'read complaint');
    return row ? row.doc : null;
  },

  // IDs only ever go up (a counter lives in the database), so a deleted report's ID is never reused
  getNextComplaintId: async () => {
    const year = String(new Date().getFullYear());
    for (let i = 0; i < 20; i++) {
      const n = must(await sb.rpc('next_complaint_number', { p_year: year }), 'next complaint number');
      const id = `CP-${year}-${String(n).padStart(5, '0')}`;
      const exists = must(await sb.from('complaints').select('id').eq('id', id).maybeSingle(), 'check id');
      if (!exists) return id;
    }
    throw new Error('[db] could not allocate a complaint id');
  },

  addComplaint: async (c) => {
    must(await sb.from('complaints').insert(complaintRow(c)), 'add complaint');
    return c;
  },

  updateComplaint: async (id, patch) => {
    const c = await module.exports.getComplaint(id);
    if (!c) return null;
    return saveComplaint({ ...c, ...patch });
  },

  // Permanently deletes a complaint and the notifications that point at it.
  // Returns the removed complaint (so the caller can delete its uploaded files) or null.
  removeComplaint: async (id) => {
    const c = await module.exports.getComplaint(id);
    if (!c) return null;
    must(await sb.from('notifications').delete().eq('complaint_id', c.id), 'delete notifications');
    must(await sb.from('complaints').delete().eq('id', c.id), 'delete complaint');
    return c;
  },

  // Toggles `voterKey` on the complaint. Returns { votes, voted } or null.
  toggleVote: async (id, voterKey) => {
    const c = await module.exports.getComplaint(id);
    if (!c) return null;
    const voters = Array.isArray(c.voters) ? [...c.voters] : [];
    const idx = voters.indexOf(voterKey);
    if (idx === -1) voters.push(voterKey);
    else voters.splice(idx, 1);
    await saveComplaint({ ...c, voters });
    return { votes: voters.length, voted: idx === -1 };
  },

  addStatusChange: async (id, status, changedBy, role, remarks, evidencePhoto, extra = {}) => {
    const c = await module.exports.getComplaint(id);
    if (!c) return null;

    c.status = status;
    c.updatedAt = new Date().toISOString();
    if (status === 'Resolved') {
      c.resolvedAt = c.updatedAt;
      if (evidencePhoto) c.resolutionPhoto = evidencePhoto;
      if (remarks) c.resolutionRemarks = remarks;
    } else if (status === 'Rejected') {
      if (remarks) c.rejectionReason = remarks;
    } else if (status === 'Reopened') {
      c.resolvedAt = null;
      // Reopened work gets a fresh clock-state so the SLA sweep can warn/escalate again
      c.overdue = false;
      c.slaWarned = false;
      c.escalatedAt = null;
    }

    if (extra.department) c.department = extra.department;
    if (extra.officer !== undefined) c.officer = extra.officer;
    if (extra.priority) c.priority = extra.priority;

    c.statusHistory = c.statusHistory || [];
    c.statusHistory.push({
      id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      status,
      changedBy: changedBy || 'Municipal Official',
      role: role || 'Municipal Authority',
      timestamp: c.updatedAt,
      remarks: remarks || `Status updated to ${status}.`,
      evidencePhoto: evidencePhoto || null
    });

    return saveComplaint(c);
  },

  addNote: async (id, note) => {
    const c = await module.exports.getComplaint(id);
    if (!c) return null;
    c.notes = c.notes || [];
    c.notes.push(note);
    c.updatedAt = new Date().toISOString();
    return saveComplaint(c);
  },

  // ---------------- Notifications ----------------
  getNotifications: async (userId) => {
    if (!userId) return [];
    const rows = must(await sb.from('notifications')
      .select('*')
      .in('user_id', [userId, 'all_admins', 'broadcast'])
      .order('created_at', { ascending: false })
      .limit(500), 'read notifications');
    return rows.map(notifOut);
  },

  addNotification: async (notif) => {
    const row = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      user_id: notif.userId,
      complaint_id: notif.complaintId || null,
      title: notif.title,
      message: notif.message,
      type: notif.type || 'info',
      read: false,
      created_at: new Date().toISOString()
    };
    return notifOut(must(await sb.from('notifications').insert(row).select().single(), 'add notification'));
  },

  markNotificationRead: async (id, userId) => {
    const row = must(await sb.from('notifications')
      .update({ read: true })
      .eq('id', id)
      .in('user_id', [userId, 'all_admins'])
      .select()
      .maybeSingle(), 'mark notification read');
    return notifOut(row);
  },

  markAllNotificationsRead: async (userId) => {
    must(await sb.from('notifications').update({ read: true }).eq('user_id', userId), 'mark all read');
    if (String(userId).startsWith('usr_admin')) {
      must(await sb.from('notifications').update({ read: true }).eq('user_id', 'all_admins'), 'mark admin notifications read');
    }
    return true;
  },

  // ---------------- Statistics & Analytics ----------------
  getStatsSummary: async () => {
    const complaints = await allComplaints();
    const total = complaints.length;
    const pending = complaints.filter(c => c.status === 'Submitted').length;
    const verified = complaints.filter(c => c.status === 'Verified').length;
    const assigned = complaints.filter(c => c.status === 'Assigned').length;
    const inProgress = complaints.filter(c => c.status === 'In Progress').length;
    const resolved = complaints.filter(c => c.status === 'Resolved').length;
    const rejected = complaints.filter(c => c.status === 'Rejected').length;
    const critical = complaints.filter(c => (c.priority === 'Critical' || c.priority === 'High') && c.status !== 'Resolved' && c.status !== 'Rejected').length;

    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

    let totalResolutionHours = 0;
    let resolvedWithTimes = 0;
    complaints.forEach(c => {
      if (c.status === 'Resolved' && c.createdAt && c.resolvedAt) {
        const diffMs = new Date(c.resolvedAt) - new Date(c.createdAt);
        if (diffMs > 0) {
          totalResolutionHours += diffMs / (1000 * 60 * 60);
          resolvedWithTimes++;
        }
      }
    });
    const avgResolutionHours = resolvedWithTimes > 0 ? Math.round(totalResolutionHours / resolvedWithTimes) : 28;

    const flagged = complaints.filter(c => ((c.flags || []).length > 0 || c.reviewStatus === 'held') && c.status !== 'Resolved' && c.status !== 'Rejected').length;
    const overdue = complaints.filter(c => c.overdue && c.status !== 'Resolved' && c.status !== 'Rejected').length;

    return {
      flagged, overdue, total, pending, verified, assigned, inProgress, resolved, rejected,
      active: pending + verified + assigned + inProgress,
      critical, resolutionRate, avgResolutionHours,
      slaComplianceRate: 92
    };
  },

  getAnalytics: async () => {
    const complaints = await allComplaints();

    const categoryCounts = {};
    complaints.forEach(c => {
      const cat = c.category || 'Other';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const areaCounts = {};
    complaints.forEach(c => {
      const area = c.area || 'Other';
      areaCounts[area] = (areaCounts[area] || 0) + 1;
    });

    const deptStats = {};
    DEPARTMENTS.forEach(d => {
      deptStats[d.name] = { total: 0, resolved: 0, inProgress: 0, pending: 0 };
    });
    complaints.forEach(c => {
      const d = c.department || 'Ward Office / General Administration';
      if (!deptStats[d]) deptStats[d] = { total: 0, resolved: 0, inProgress: 0, pending: 0 };
      deptStats[d].total++;
      if (c.status === 'Resolved') deptStats[d].resolved++;
      else if (c.status === 'In Progress') deptStats[d].inProgress++;
      else deptStats[d].pending++;
    });

    const priorityCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    complaints.forEach(c => {
      const p = c.priority || 'Medium';
      if (priorityCounts[p] !== undefined) priorityCounts[p]++;
    });

    const statusCounts = { Submitted: 0, Verified: 0, Assigned: 0, 'In Progress': 0, Resolved: 0, Rejected: 0 };
    complaints.forEach(c => {
      const s = c.status || 'Submitted';
      if (statusCounts[s] !== undefined) statusCounts[s]++;
    });

    return { categoryCounts, areaCounts, deptStats, priorityCounts, statusCounts };
  },

  // Demo cleanup: removes complaints, notifications, sessions and the ID counters (users stay)
  reset: async () => {
    must(await sb.from('notifications').delete().neq('id', ''), 'reset notifications');
    must(await sb.from('complaints').delete().neq('id', ''), 'reset complaints');
    must(await sb.from('sessions').delete().neq('token', ''), 'reset sessions');
    must(await sb.from('counters').delete().neq('year', ''), 'reset counters');
  }
};
