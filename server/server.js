const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const fraud = require('./fraud');
const { startSlaSweep } = require('./sla');
const fileStore = require('./storage');

const app = express();
// Behind a host's proxy (Render, Railway...) req.ip would otherwise be the proxy's address for every
// visitor, and the login/vote limiters would block everyone together. 1 = trust one proxy hop.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Express 4 does not catch rejected promises from async handlers: forward them to the error middleware.
['get', 'post', 'put', 'patch', 'delete'].forEach((m) => {
  const orig = app[m].bind(app);
  app[m] = (...args) => orig(...args.map(h =>
    (typeof h === 'function' && h.constructor.name === 'AsyncFunction')
      ? (req, res, next) => h(req, res, next).catch(next)
      : h));
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Multer storage for photos and videos
const storage = multer.diskStorage({
  destination: (_req, _f, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'];
    if (allowed.includes(file.mimetype.toLowerCase()) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, WEBP and MP4 are accepted.'));
    }
  }
});

app.use('/uploads', express.static(uploadsDir));   // local files (temporary copies / older uploads)
// Everything else comes from Supabase Storage. File names are unique, so they can be cached for a year.
app.get('/uploads/:name', async (req, res) => {
  const f = await fileStore.fetchFile(req.params.name);
  if (!f) return res.status(404).json({ error: 'File not found' });
  res.set('Content-Type', f.type);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(f.buffer);
});

// Serve ONLY the three frontend files. (Previously the whole project folder was served,
// which made server/data.json — password hashes, login session tokens, delete-token
// hashes — downloadable by anyone at /server/data.json.)
const projectRoot = path.join(__dirname, '..');
['index.html', 'app.js', 'style.css'].forEach((file) => {
  app.get('/' + file, (_req, res) => res.sendFile(path.join(projectRoot, file)));
});

// ============================================================
// Auth Middleware
// ============================================================
async function getUserFromReq(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return await db.getSessionUser(token);
  }
  return null;
}

async function requireAuth(req, res, next) {
  const user = await getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const user = await getUserFromReq(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = user;
  next();
}

// ============================================================
// Anonymous reports, owner delete & community voting helpers
// ============================================================

// Statuses in which a reporter may still delete their own report.
// Keep in sync with DELETABLE_STATUSES in app.js. Admins can always delete.
const DELETABLE_STATUSES = ['Submitted', 'Verified', 'Rejected'];

// Areas the report form offers. Anything else sent by a client is ignored
// (the server then falls back to the area detected from the map pin).
const AREAS = ['Hampankatta', 'Kadri', 'Kottara', 'Bejai', 'Balmatta', 'Surathkal', 'Kankanady', 'Ullal', 'Panambur', 'Other Mangaluru'];

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function safeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch (e) {
    return false;
  }
}

// Owner by account (never true for anonymous reports: they have no reporterId)
function isAccountOwner(c, user) {
  return !!(user && c && c.reporterId && c.reporterId === user.id);
}

// Owner by delete token (issued once when the report is created)
function hasValidDeleteToken(c, token) {
  return !!(token && c && c.deleteTokenHash && safeEqualHex(sha256(token), c.deleteTokenHash));
}

// One vote per logged-in user, or per device id for guests
function voterKeyFor(user, req) {
  if (user && user.id) return `u:${user.id}`;
  const deviceId = req.get('x-device-id');
  if (deviceId && /^[\w-]{8,64}$/.test(deviceId)) return `d:${deviceId}`;
  return null;
}

// Very small in-memory rate limiter for voting (per IP)
const voteHits = new Map();
function voteLimiter(req, res, next) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 30;
  const key = req.ip || 'unknown';
  const hits = (voteHits.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) {
    return res.status(429).json({ error: 'Too many votes. Please slow down.' });
  }
  hits.push(now);
  voteHits.set(key, hits);
  if (voteHits.size > 5000) {
    for (const [k, v] of voteHits) {
      if (!v.some(t => now - t < windowMs)) voteHits.delete(k);
    }
  }
  next();
}

// In-memory limiter for login / register: max 10 attempts per IP per 15 minutes.
// (Resets when the server restarts. Fine for one server; use a shared store if you scale out.)
const authHits = new Map();
function authLimiter(req, res, next) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const max = 10;
  const key = req.ip || 'unknown';
  const hits = (authHits.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= max) {
    return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
  }
  hits.push(now);
  authHits.set(key, hits);
  if (authHits.size > 5000) {
    for (const [k, v] of authHits) {
      if (!v.some(t => now - t < windowMs)) authHits.delete(k);
    }
  }
  next();
}

// Delete a report's uploaded photos/videos from disk
function removeUploadedFiles(c) {
  const urls = new Set([
    ...(c.photos || []),
    ...(c.videos || []),
    c.photo,
    c.resolutionPhoto,
    ...((c.statusHistory || []).map(h => h.evidencePhoto))
  ]);
  const names = [];
  urls.forEach((url) => {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
    const name = path.basename(url); // basename blocks ../ tricks
    names.push(name);
    fs.unlink(path.join(uploadsDir, name), () => {});
  });
  fileStore.removeMany(names);
}

// Utility: Mask sensitive contact info for public view
function maskContact(text, type = 'phone') {
  if (!text) return '';
  if (type === 'phone') {
    const clean = text.replace(/\s+/g, '');
    if (clean.length >= 7) {
      return `${clean.slice(0, 3)}•••••${clean.slice(-2)}`;
    }
    return '••••••••';
  }
  if (type === 'email') {
    const parts = text.split('@');
    if (parts.length === 2) {
      const name = parts[0];
      const domain = parts[1];
      const maskedName = name.length > 2 ? `${name[0]}•••${name.slice(-1)}` : '•••';
      return `${maskedName}@${domain}`;
    }
    return '••••@••••.com';
  }
  return text;
}

const IDENTITY_FIELDS = ['reporterId', 'reporterName', 'reporterPhone', 'reporterEmail', 'name', 'phone', 'email'];

// Builds the safe, client-facing version of a complaint.
// Adds: votes, hasVoted, anonymous, isOwner. Removes: voters, deleteTokenHash.
function sanitizeComplaintForUser(complaint, user, req) {
  if (!complaint) return null;

  const out = { ...complaint };
  const voters = Array.isArray(complaint.voters) ? complaint.voters : [];
  const key = req ? voterKeyFor(user, req) : null;

  out.votes = voters.length;
  out.hasVoted = !!key && voters.includes(key);
  out.anonymous = !!complaint.anonymous;
  out.isOwner = isAccountOwner(complaint, user);
  delete out.voters;
  delete out.deleteTokenHash;
  // Server-only abuse-control fields: never sent to anyone (submitterId would unmask anonymous reporters)
  delete out.submitterId;
  delete out.photoHashes;
  // Fraud signals are for officers only; showing them to reporters would teach people how to evade them
  if (!(user && user.role === 'admin')) {
    delete out.flags;
    delete out.trustScore;
    delete out.reviewStatus;
  }

  // Anonymous means anonymous: no identity for anyone, admins included.
  if (out.anonymous) {
    IDENTITY_FIELDS.forEach(f => { out[f] = null; });
    return out;
  }

  const isAdmin = user && user.role === 'admin';
  const canSeeContact = isAdmin || out.isOwner ||
    (user && user.email && complaint.reporterEmail && user.email === complaint.reporterEmail);

  if (canSeeContact) return out;

  // Public visitor view: mask private details
  return {
    ...out,
    reporterPhone: maskContact(complaint.reporterPhone, 'phone'),
    reporterEmail: maskContact(complaint.reporterEmail, 'email'),
    phone: maskContact(complaint.phone, 'phone'),
    isPublicView: true
  };
}

// Shortcut used by routes (async: always `await` it)
async function view(complaint, req, knownUser) {
  const user = knownUser !== undefined ? knownUser : await getUserFromReq(req);
  return sanitizeComplaintForUser(complaint, user, req);
}


// ============================================================
// Fake-report controls
// ============================================================
// Reports the trust score put on hold are hidden from the public until an officer reviews them.
// The reporter (and admins) can still see them.
function canSeeComplaint(c, user) {
  if (c.reviewStatus !== 'held') return true;
  if (user && user.role === 'admin') return true;
  return !!(user && (c.reporterId === user.id || c.submitterId === user.id));
}

// Who may attach files: admins, or the account that filed the report (also for anonymous ones,
// via the server-only submitterId)
function canModifyMedia(c, user) {
  return !!(user && (user.role === 'admin' || c.reporterId === user.id || c.submitterId === user.id));
}

// Removes uploaded files again if a request is rejected
function discardFiles(files) {
  (files || []).forEach(f => { if (f && f.path) fs.unlink(f.path, () => {}); });
}

// Hash newly uploaded images, compare with every photo already in the system, update flags/score.
async function fingerprintUploads(c, files, byAdmin = false) {
  const patch = {};
  const photoHashes = [...(c.photoHashes || [])];
  const flags = [...(c.flags || [])];
  let penalty = 0;
  const others = await db.getComplaints({});

  for (const f of files) {
    if (!f.mimetype || !f.mimetype.startsWith('image/')) continue;
    let h;
    try { h = await fraud.imageHashes(f.path); } catch (e) { continue; }
    const matches = fraud.findPhotoMatches(h, others, c.id);
    // Duplicate of a photo from another report: strongest evidence of recycling
    if (matches.length && !byAdmin) {   // officers attaching evidence are not scored
      const m = matches[0];
      const flag = `${m.kind === 'resolution' ? 'photo_reused_resolution' : 'photo_reused'}:${m.id}`;
      if (!flags.includes(flag)) { flags.push(flag); penalty += m.kind === 'resolution' ? 45 : 35; }
    }
    // Same picture twice inside this report doesn't add information, just ignore it
    if (!photoHashes.some(p => p.sha256 === h.sha256)) {
      photoHashes.push({ url: `/uploads/${f.filename}`, sha256: h.sha256, phash: h.phash, kind: 'report' });
    }
  }
  patch.photoHashes = photoHashes;
  if (penalty) {
    const score = Math.max(0, (typeof c.trustScore === 'number' ? c.trustScore : 100) - penalty);
    patch.flags = flags;
    patch.trustScore = score;
    patch.reviewStatus = fraud.reviewStatusFor(score);
  }
  return patch;
}

// Per-account limit: stops one account from flooding the system with fake reports
async function reportsByUserSince(userId, sinceMs) {
  return (await db.getComplaints({})).filter(c =>
    (c.submitterId === userId || c.reporterId === userId) && new Date(c.createdAt).getTime() >= sinceMs);
}

// Category to Department & SLA Mapping
const CATEGORY_MAP = {
  'Road damage and potholes': {
    department: 'PWD (Roads & Infrastructure)',
    sla: '7 days',
    slaHours: 168,
    priority: 'High',
    officer: 'Ravi Kumar (JE - PWD Kadri)'
  },
  'Garbage and waste management': {
    department: 'Health & Sanitation Section',
    sla: '24 hours',
    slaHours: 24,
    priority: 'High',
    officer: 'Suresh Nayak (Sanitary Inspector)'
  },
  'Water leakage': {
    department: 'Mangaluru City Water Supply Board',
    sla: '48 hours',
    slaHours: 48,
    priority: 'Critical',
    officer: 'Rajesh Bhat (Assistant Executive Engineer)'
  },
  'Drainage and sewage': {
    department: 'Engineering Section (Drainage & Sewage)',
    sla: '72 hours',
    slaHours: 72,
    priority: 'High',
    officer: 'Premanand Rao (Executive Engineer)'
  },
  'Streetlight failure': {
    department: 'MESCOM (Electrical Division)',
    sla: '48 hours',
    slaHours: 48,
    priority: 'Medium',
    officer: 'Ganesh Poojary (Section Officer Kadri)'
  },
  'Electricity and exposed wires': {
    department: 'MESCOM (Electrical Division)',
    sla: '12 hours',
    slaHours: 12,
    priority: 'Critical',
    officer: 'Kiran Shetty (Line Inspector)'
  },
  'Public safety': {
    department: 'Mangaluru City Traffic Police',
    sla: '12 hours',
    slaHours: 12,
    priority: 'Critical',
    officer: 'Inspector Harish (Traffic Division West)'
  },
  'Traffic problems': {
    department: 'Mangaluru City Traffic Police',
    sla: '12 hours',
    slaHours: 12,
    priority: 'Medium',
    officer: 'Sub-Inspector Deepa K'
  },
  'Park and public-space maintenance': {
    department: 'Parks & Public Spaces Department',
    sla: '4 days',
    slaHours: 96,
    priority: 'Low',
    officer: 'Vasant Kumar (Horticulture Superintendent)'
  },
  'Other civic issues': {
    department: 'Ward Office / General Administration',
    sla: '5 days',
    slaHours: 120,
    priority: 'Medium',
    officer: 'Sharath Hegde (Ward Officer Central)'
  }
};

// Fallback for legacy categories
CATEGORY_MAP['Garbage / Illegal Dumping'] = CATEGORY_MAP['Garbage and waste management'];
CATEGORY_MAP['Pothole / Road Damage'] = CATEGORY_MAP['Road damage and potholes'];
CATEGORY_MAP['Broken Streetlight'] = CATEGORY_MAP['Streetlight failure'];
CATEGORY_MAP['Drainage / Waterlogging'] = CATEGORY_MAP['Drainage and sewage'];
CATEGORY_MAP['Beach / Public Space Litter'] = CATEGORY_MAP['Garbage and waste management'];
CATEGORY_MAP['Traffic / Parking'] = CATEGORY_MAP['Traffic problems'];
CATEGORY_MAP['Other'] = CATEGORY_MAP['Other civic issues'];

// ============================================================
// API ROUTES
// ============================================================

app.get('/api/health', (_req, res) => res.json({ ok: true, timestamp: new Date().toISOString() }));

// Metadata
app.get('/api/departments', async (_req, res) => {
  res.json(db.getDepartments());
});

app.get('/api/categories', async (_req, res) => {
  const categories = [
    { name: 'Road damage and potholes', emoji: '🛣️', color: '#e03131', dept: 'PWD (Roads & Infrastructure)' },
    { name: 'Garbage and waste management', emoji: '🗑️', color: '#f08c00', dept: 'Health & Sanitation Section' },
    { name: 'Water leakage', emoji: '💧', color: '#1971c2', dept: 'Mangaluru City Water Supply Board' },
    { name: 'Drainage and sewage', emoji: '🌊', color: '#9c36b5', dept: 'Engineering Section (Drainage & Sewage)' },
    { name: 'Streetlight failure', emoji: '💡', color: '#f59f00', dept: 'MESCOM (Electrical Division)' },
    { name: 'Electricity and exposed wires', emoji: '⚡', color: '#e8590c', dept: 'MESCOM (Electrical Division)' },
    { name: 'Public safety', emoji: '🚨', color: '#c92a2a', dept: 'Mangaluru City Traffic Police' },
    { name: 'Traffic problems', emoji: '🚦', color: '#d9480f', dept: 'Mangaluru City Traffic Police' },
    { name: 'Park and public-space maintenance', emoji: '🌳', color: '#2f9e44', dept: 'Parks & Public Spaces Department' },
    { name: 'Other civic issues', emoji: '📌', color: '#868e96', dept: 'Ward Office / General Administration' }
  ];
  res.json(categories);
});

// ------------------------------------------------------------
// AUTH
// ------------------------------------------------------------
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  // Names and emails are shown in the UI: refuse characters that could carry markup
  if (/[<>"]/.test(String(name)) || /[<>"\s]/.test(String(email))) {
    return res.status(400).json({ error: 'Name or email contains invalid characters.' });
  }

  const existing = await db.getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // Public registration ALWAYS creates a citizen. The role from the request is ignored.
  // To create an officer, set role = 'admin' on that user in the Supabase "users" table.
  const user = await db.addUser({
    name,
    email,
    phone,
    password,
    role: 'citizen'
  });

  const token = await db.createSession(user.id);

  // Welcome notification
  await db.addNotification({
    userId: user.id,
    title: 'Welcome to Dhwani Mangaluru',
    message: `Hello ${user.name}, your account is active. You can now report issues, track their progress in real-time, and view your complaint history.`,
    type: 'general'
  });

  const { passwordHash, ...safeUser } = user;
  res.status(201).json({ user: safeUser, token });
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await db.authenticateUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = await db.createSession(user.id);
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

app.get('/api/auth/me', async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.post('/api/auth/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    await db.deleteSession(authHeader.slice(7).trim());
  }
  res.json({ ok: true });
});

app.put('/api/auth/profile', requireAuth, async (req, res) => {
  const { name, phone, password } = req.body || {};
  const patch = {};
  if (name) {
    if (/[<>"]/.test(String(name))) {
      return res.status(400).json({ error: 'Name contains invalid characters.' });
    }
    patch.name = name;
  }
  if (phone) patch.phone = phone;
  if (password) patch.password = password;

  const updated = await db.updateUser(req.user.id, patch);
  const { passwordHash, ...safeUser } = updated;
  res.json({ user: safeUser });
});

// ------------------------------------------------------------
// COMPLAINTS
// ------------------------------------------------------------

// List complaints (with filters). sort=votes returns the most upvoted first.
app.get('/api/complaints', async (req, res) => {
  const user = await getUserFromReq(req);
  const rows = await db.getComplaints(req.query);
  const list = rows
    .filter(c => canSeeComplaint(c, user))
    .map(c => sanitizeComplaintForUser(c, user, req));
  res.json(list);
});

// Single complaint by ID (direct URL & tracking support)
app.get('/api/complaints/:id', async (req, res) => {
  const c = await db.getComplaint(req.params.id);
  if (!c) {
    return res.status(404).json({ error: `Complaint with reference ${req.params.id} not found` });
  }
  if (!canSeeComplaint(c, await getUserFromReq(req))) {
    return res.status(404).json({ error: `Complaint with reference ${req.params.id} not found` });
  }
  res.json(await view(c, req));
});

// Create Complaint. Sign-in is REQUIRED (enforced here, not only in the browser).
// "Anonymous" hides the reporter's identity from everyone else, but the server keeps an internal
// submitterId so one account cannot spam fake reports. That field is never sent to any client.
//
// Required from the browser: category, description, and at least one photo.
// Area/ward is OPTIONAL: if the browser doesn't send one, the server derives it from the map pin.
app.post('/api/complaints', requireAuth, upload.array('files', 5), async (req, res, next) => {
 try {
  const files = req.files || [];
  const {
    title, category, area: rawArea, landmark, description,
    name, phone, email, priority, lat, lng, photos, videos
  } = req.body || {};

  // Only accept an area from the known list; otherwise it is derived from the map pin below
  const area = AREAS.includes(String(rawArea || '').trim()) ? String(rawArea).trim() : '';

  const isAnonymous = req.body && (req.body.anonymous === true || req.body.anonymous === 'true');
  const authUser = req.user;

  // Only category and description must come from the user.
  const missing = [];
  if (!category || String(category).trim().length === 0) missing.push('category');
  if (!description || String(description).trim().length === 0) missing.push('description');
  if (missing.length) {
    // Shows exactly which field arrived empty (check your server console while debugging)
    console.warn('[complaints] rejected, missing:', missing.join(', '), '| received fields:', Object.keys(req.body || {}), '| files:', files.length);
    discardFiles(files);
    return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}.` });
  }
  // Only known categories are accepted (the category text is shown to officers)
  if (!Object.prototype.hasOwnProperty.call(CATEGORY_MAP, category)) {
    discardFiles(files);
    return res.status(400).json({ error: 'Invalid category.' });
  }
  // A report must come with at least one photo (checked on the server, not just in the browser)
  if (!files.some(f => f.mimetype && f.mimetype.startsWith('image/'))) {
    discardFiles(files);
    return res.status(400).json({ error: 'At least one photo is required to submit a report.' });
  }

  const nowMs = Date.now();
  const dayCount = (await reportsByUserSince(authUser.id, nowMs - 24 * 3600 * 1000)).length;
  if (authUser.role !== 'admin' && dayCount >= fraud.REPORTS_PER_DAY) {
    discardFiles(files);
    return res.status(429).json({ error: `Daily limit of ${fraud.REPORTS_PER_DAY} reports reached. Please try again tomorrow.` });
  }

  // Anonymous reports carry no identity on the record
  const user = isAnonymous ? null : authUser;

  const meta = CATEGORY_MAP[category] || CATEGORY_MAP['Other civic issues'];
  const generatedId = await db.getNextComplaintId();
  const now = new Date(nowMs);

  // Map pin (optional)
  const hasCoords = lat !== null && lat !== undefined && lat !== '' && lng !== null && lng !== undefined && lng !== '' && !isNaN(Number(lat)) && !isNaN(Number(lng));
  const numericLat = hasCoords ? Number(lat) : null;
  const numericLng = hasCoords ? Number(lng) : null;
  const coords = hasCoords ? [numericLat, numericLng] : null;

  // Ward / zone are decided by the server from the pin; whatever the browser sent is ignored.
  const ward = fraud.assignWard(numericLat, numericLng, area);

  // Area: use what the browser sent (if valid), otherwise the ward detected from the pin.
  const finalArea = area || (ward && ward.area) || '';
  if (!finalArea) {
    discardFiles(files);
    return res.status(400).json({ error: 'Could not detect the area. Please drop a pin on the map or choose an area.' });
  }

  const slaHoursNum = meta.slaHours || 120;
  const expectedDate = new Date(nowMs + slaHoursNum * 60 * 60 * 1000).toISOString();

  const finalTitle = title && String(title).trim().length > 0
    ? String(title).trim()
    : `${category} reported at ${finalArea}`;

  const reporterName = isAnonymous ? 'Anonymous Citizen' : authUser.name;
  const reporterPhone = isAnonymous ? '' : (authUser.phone || phone || '');
  const reporterEmail = isAnonymous ? '' : authUser.email;
  const reporterId = user ? user.id : null;

  // Trust score is computed here too. The browser's own score/flags are never trusted.
  const assessment = fraud.assessNewReport({
    user: authUser,
    category,
    description,
    lat: numericLat,
    lng: numericLng,
    allComplaints: await db.getComplaints({}),
    recentByUser: await reportsByUserSince(authUser.id, nowMs - 3600 * 1000)
  });

  const deleteToken = crypto.randomBytes(24).toString('hex');

  const complaint = {
    id: generatedId,
    title: finalTitle,
    category,
    area: finalArea,
    landmark: landmark ? String(landmark).trim() : '',
    description: String(description).trim(),
    name: reporterName,
    phone: reporterPhone,
    email: reporterEmail,
    reporterId,
    reporterName,
    reporterPhone,
    reporterEmail,
    anonymous: !!isAnonymous,
    submitterId: authUser.id,            // server-only (stripped in sanitizeComplaintForUser)
    deleteTokenHash: sha256(deleteToken),
    voters: [],
    photos: files.filter(f => f.mimetype.startsWith('image/')).map(f => `/uploads/${f.filename}`),
    videos: files.filter(f => f.mimetype.startsWith('video/')).map(f => `/uploads/${f.filename}`),
    photoHashes: [],
    status: 'Submitted',
    priority: priority || meta.priority || 'Medium',
    department: meta.department,
    officer: meta.officer || null,
    slaHours: meta.sla,
    expectedResolutionDate: expectedDate,
    overdue: false,
    slaWarned: false,
    resolutionPhoto: null,
    resolutionRemarks: null,
    rejectionReason: null,
    lat: numericLat,
    lng: numericLng,
    coords,
    ward: ward.area,
    zone: ward.zone,
    zoneOffice: ward.office,
    zonePhone: ward.phone,
    trustScore: assessment.score,
    flags: assessment.flags,
    reviewStatus: assessment.reviewStatus,
    isPublic: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    resolvedAt: null,
    statusHistory: [
      {
        id: `sh_${nowMs}_init`,
        status: 'Submitted',
        changedBy: reporterName,
        role: 'Citizen',
        timestamp: now.toISOString(),
        remarks: 'Complaint registered successfully in Dhwani system.',
        evidencePhoto: null
      }
    ],
    notes: []
  };
  complaint.photo = complaint.photos[0] || null;

  // Photo checks: reused pictures lower the trust score right away
  const fp = await fingerprintUploads(complaint, files);
  Object.assign(complaint, fp);

  await fileStore.persist(files);      // photos/videos go to Supabase Storage
  await db.addComplaint(complaint);

  if (reporterId) {
    await db.addNotification({
      userId: reporterId,
      complaintId: complaint.id,
      title: 'Complaint Registered',
      message: `Your complaint ${complaint.id} regarding "${complaint.title}" has been submitted to ${complaint.department}.`,
      type: 'status_update'
    });
  }

  const flagNote = complaint.reviewStatus === 'ok' ? '' : ` ⚠ Needs verification (trust ${complaint.trustScore}/100).`;
  await db.addNotification({
    userId: 'all_admins',
    complaintId: complaint.id,
    title: 'New Civic Report Filed',
    message: `[${complaint.id}] New ${complaint.priority} priority report in ${complaint.area}: "${complaint.title}".${flagNote}`,
    type: 'assignment'
  });

  res.status(201).json({ ...sanitizeComplaintForUser(complaint, authUser, req), deleteToken });
 } catch (e) { discardFiles(req.files); next(e); }
});

// Upload media to an existing complaint. Sign-in required; only the filer (or an admin) may attach files.
app.post('/api/complaints/:id/upload', requireAuth, upload.array('files', 5), async (req, res, next) => {
  try {
    const c = await db.getComplaint(req.params.id);
    if (!c) { discardFiles(req.files); return res.status(404).json({ error: 'Complaint not found' }); }
    if (!canModifyMedia(c, req.user)) { discardFiles(req.files); return res.status(403).json({ error: 'You can only add files to your own reports.' }); }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const uploadedUrls = req.files.map(f => `/uploads/${f.filename}`);
    const images = [];
    const videos = [];
    req.files.forEach(f => {
      const url = `/uploads/${f.filename}`;
      if (f.mimetype.startsWith('video/')) videos.push(url);
      else images.push(url);
    });

    const fp = await fingerprintUploads(c, req.files, req.user.role === 'admin');
    await fileStore.persist(req.files);
    const photos = Array.from(new Set([...(c.photos || []), ...images]));
    const patch = {
      ...fp,
      photos,
      videos: Array.from(new Set([...(c.videos || []), ...videos])),
      photo: c.photo || photos[0] || null,
      updatedAt: new Date().toISOString()
    };
    const updated = await db.updateComplaint(req.params.id, patch);

    res.json({
      success: true,
      urls: uploadedUrls,
      photos: updated.photos,
      videos: updated.videos,
      complaint: await view(updated, req)
    });
  } catch (e) { next(e); }
});

// Legacy single photo endpoint (same rules as /upload)
app.post('/api/complaints/:id/photo', requireAuth, upload.single('photo'), async (req, res, next) => {
  try {
    const c = await db.getComplaint(req.params.id);
    if (!c) { discardFiles([req.file]); return res.status(404).json({ error: 'Complaint not found' }); }
    if (!canModifyMedia(c, req.user)) { discardFiles([req.file]); return res.status(403).json({ error: 'You can only add files to your own reports.' }); }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const url = `/uploads/${req.file.filename}`;
    const fp = await fingerprintUploads(c, [req.file], req.user.role === 'admin');
    await fileStore.persist([req.file]);
    const photos = [...(c.photos || [])];
    if (!photos.includes(url)) photos.push(url);
    const updated = await db.updateComplaint(req.params.id, { ...fp, photos, photo: url, updatedAt: new Date().toISOString() });
    res.json({ photo: url, complaint: await view(updated, req) });
  } catch (e) { next(e); }
});

// Community voting: toggles the caller's upvote. Logged-in users vote once per account,
// guests once per device (X-Device-Id header sent by the frontend).
app.post('/api/complaints/:id/vote', voteLimiter, async (req, res) => {
  const user = await getUserFromReq(req);
  const key = voterKeyFor(user, req);
  if (!key) {
    return res.status(400).json({ error: 'Could not identify voter. Please reload the page and try again.' });
  }

  const result = await db.toggleVote(req.params.id, key);
  if (!result) return res.status(404).json({ error: 'Complaint not found' });
  res.json(result);
});

// Delete a complaint. Allowed for: an admin, the logged-in owner, or whoever holds the
// deleteToken issued at creation (anonymous / guest reporters). Non-admins can only delete
// while the report is still in DELETABLE_STATUSES.
app.delete('/api/complaints/:id', async (req, res) => {
  const user = await getUserFromReq(req);
  const c = await db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });

  const deleteToken = (req.body && req.body.deleteToken) || null;
  const isAdmin = !!(user && user.role === 'admin');
  const isOwner = isAccountOwner(c, user) || hasValidDeleteToken(c, deleteToken);

  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: 'You can only delete reports that you filed.' });
  }
  if (!isAdmin && !DELETABLE_STATUSES.includes(c.status)) {
    return res.status(409).json({ error: `This report can no longer be deleted because it is already "${c.status}".` });
  }

  const removed = await db.removeComplaint(c.id);
  if (removed) removeUploadedFiles(removed);
  res.json({ success: true, id: c.id });
});

// Update complaint status & assignment (Admin / Authority action)
app.patch('/api/complaints/:id/status', requireAdmin, async (req, res) => {
  const user = req.user;
  const {
    status,
    officer,
    department,
    priority,
    remarks,
    evidencePhoto
  } = req.body || {};

  const allowed = ['Submitted', 'Verified', 'Assigned', 'In Progress', 'Resolved', 'Rejected', 'Reopened'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed values: ${allowed.join(', ')}` });
  }

  const c = await db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });

  // Determine actor name
  const actorName = user ? user.name : (req.body.adminName || 'Municipal Authority');
  const actorRole = user ? (user.role === 'admin' ? 'Municipal Authority' : 'Authorized Officer') : 'Municipal Authority';

  const extra = {};
  if (department) extra.department = department;
  if (officer !== undefined) extra.officer = officer;
  if (priority) extra.priority = priority;

  const updated = await db.addStatusChange(
    req.params.id,
    status,
    actorName,
    actorRole,
    remarks,
    evidencePhoto,
    extra
  );

  // Fingerprint the officer's resolution photo so it can't be recycled as a "new" problem later
  if (status === 'Resolved' && typeof evidencePhoto === 'string' && evidencePhoto.startsWith('/uploads/')) {
    fileStore.withLocal(path.basename(evidencePhoto), (file) => fraud.imageHashes(file)).then(async h => {
      if (!h) return;
      const cur = await db.getComplaint(req.params.id);
      if (cur) await db.updateComplaint(cur.id, { photoHashes: [...(cur.photoHashes || []), { url: evidencePhoto, sha256: h.sha256, phash: h.phash, kind: 'resolution' }] });
    }).catch(() => {});
  }

  // Notify the citizen if there's a registered reporter
  if (c.reporterId) {
    await db.addNotification({
      userId: c.reporterId,
      complaintId: c.id,
      title: `Complaint Status: ${status}`,
      message: `Your complaint [${c.id}] is now marked as "${status}". ${remarks ? 'Remark: ' + remarks : ''}`,
      type: status === 'Resolved' ? 'resolution' : 'status_update'
    });
  }

  res.json(await view(updated, req));
});

// Add progress remark/note. Sign-in required; only admins and the person who filed the report may post.
app.post('/api/complaints/:id/notes', requireAuth, async (req, res) => {
  const user = req.user;
  const { text } = req.body || {};
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Note text is required' });
  }

  const c = await db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });

  if (!(user.role === 'admin' || isAccountOwner(c, user) || c.submitterId === user.id)) {
    return res.status(403).json({ error: 'You can only add notes to your own reports.' });
  }

  // The author comes from the logged-in account, never from the request body
  const authorName = user.name;
  const authorRole = user.role === 'admin' ? 'Municipal Official' : 'Citizen';

  const note = {
    id: `note_${Date.now()}`,
    text: text.trim(),
    author: authorName,
    role: authorRole,
    at: new Date().toISOString()
  };

  await db.addNote(req.params.id, note);
  const updated = await db.getComplaint(req.params.id);

  // If added by admin, notify citizen
  if (user.role === 'admin' && c.reporterId) {
    await db.addNotification({
      userId: c.reporterId,
      complaintId: c.id,
      title: 'New Update on your Complaint',
      message: `Officer ${authorName} posted an update on [${c.id}]: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`,
      type: 'status_update'
    });
  }

  res.json(await view(updated, req));
});

// ------------------------------------------------------------
// NOTIFICATIONS
// ------------------------------------------------------------
app.get('/api/notifications', async (req, res) => {
  const user = await getUserFromReq(req);
  if (!user) {
    return res.json([]);
  }
  const notifs = await db.getNotifications(user.id);
  res.json(notifs);
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  const result = await db.markNotificationRead(req.params.id, req.user.id);
  if (!result) return res.status(404).json({ error: 'Notification not found' });
  res.json(result);
});

app.patch('/api/notifications/read-all', requireAuth, async (req, res) => {
  await db.markAllNotificationsRead(req.user.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------
// STATS & ANALYTICS
// ------------------------------------------------------------
app.get('/api/stats/summary', async (_req, res) => {
  res.json(await db.getStatsSummary());
});

app.get('/api/stats/analytics', async (_req, res) => {
  res.json(await db.getAnalytics());
});

// Reset (demo cleanup) — admin only. It used to be callable by anyone, which would let a
// stranger wipe every report.
app.post('/api/reset', requireAdmin, async (_req, res) => {
  await db.reset();
  res.json({ ok: true });
});

// ------------------------------------------------------------
// SPA Fallback Routing
// ------------------------------------------------------------
app.get(/^\/(?!api|uploads).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Error handling middleware
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Fingerprint photos that existed before this feature, so old (and resolved) photos are matchable
async function backfillPhotoHashes() {
  let n = 0;
  for (const c of await db.getComplaints({})) {
    const have = new Set((c.photoHashes || []).map(p => p.url));
    const todo = [];
    (c.photos || []).forEach(u => todo.push({ url: u, kind: 'report' }));
    if (c.resolutionPhoto) todo.push({ url: c.resolutionPhoto, kind: 'resolution' });
    const add = [];
    for (const t of todo) {
      if (typeof t.url !== 'string' || !t.url.startsWith('/uploads/') || have.has(t.url)) continue;
      try {
        const h = await fileStore.withLocal(path.basename(t.url), (file) => fraud.imageHashes(file));
        if (!h) continue;
        add.push({ url: t.url, sha256: h.sha256, phash: h.phash, kind: t.kind }); have.add(t.url);
      } catch (e) {}
    }
    if (add.length) { await db.updateComplaint(c.id, { photoHashes: [...(c.photoHashes || []), ...add] }); n += add.length; }
  }
  if (n) console.log(`[fraud] fingerprinted ${n} existing photo(s)`);
}

db.init().then(() => fileStore.init()).then(() => app.listen(PORT, () => {
  startSlaSweep(db);
  backfillPhotoHashes().catch(e => console.error('[fraud] backfill failed:', e));
  console.log(`\n======================================================`);
  console.log(`✅ Dhwani — Professional Civic Platform Backend`);
  console.log(`   Running at http://localhost:${PORT}`);
  console.log(`======================================================\n`);
})).catch((e) => {
  console.error('\n❌ Could not start: ' + e.message + '\n');
  process.exit(1);
});
