const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.use('/uploads', express.static(uploadsDir));

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
function getUserFromReq(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return db.getSessionUser(token);
  }
  return null;
}

function requireAuth(req, res, next) {
  const user = getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = getUserFromReq(req);
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

// Delete a report's uploaded photos/videos from disk
function removeUploadedFiles(c) {
  const urls = new Set([
    ...(c.photos || []),
    ...(c.videos || []),
    c.photo,
    c.resolutionPhoto,
    ...((c.statusHistory || []).map(h => h.evidencePhoto))
  ]);
  urls.forEach((url) => {
    if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
    const file = path.join(uploadsDir, path.basename(url)); // basename blocks ../ tricks
    fs.unlink(file, () => {});
  });
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

// Shortcut used by routes
function view(complaint, req) {
  return sanitizeComplaintForUser(complaint, getUserFromReq(req), req);
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
app.get('/api/departments', (_req, res) => {
  res.json(db.getDepartments());
});

app.get('/api/categories', (_req, res) => {
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
app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const existing = db.getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // Citizens register as 'citizen'; admin creation can be allowed if explicitly requested or default
  const user = db.addUser({
    name,
    email,
    phone,
    password,
    role: role === 'admin' ? 'admin' : 'citizen'
  });

  const token = db.createSession(user.id);

  // Welcome notification
  db.addNotification({
    userId: user.id,
    title: 'Welcome to Dhwani Mangaluru',
    message: `Hello ${user.name}, your account is active. You can now report issues, track their progress in real-time, and view your complaint history.`,
    type: 'general'
  });

  const { passwordHash, ...safeUser } = user;
  res.status(201).json({ user: safeUser, token });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.authenticateUser(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = db.createSession(user.id);
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

app.get('/api/auth/me', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    db.deleteSession(authHeader.slice(7).trim());
  }
  res.json({ ok: true });
});

app.put('/api/auth/profile', requireAuth, (req, res) => {
  const { name, phone, password } = req.body || {};
  const patch = {};
  if (name) patch.name = name;
  if (phone) patch.phone = phone;
  if (password) patch.password = password;

  const updated = db.updateUser(req.user.id, patch);
  const { passwordHash, ...safeUser } = updated;
  res.json({ user: safeUser });
});

// ------------------------------------------------------------
// COMPLAINTS
// ------------------------------------------------------------

// List complaints (with filters). sort=votes returns the most upvoted first.
app.get('/api/complaints', (req, res) => {
  const list = db.getComplaints(req.query);
  res.json(list.map(c => view(c, req)));
});

// Single complaint by ID (direct URL & tracking support)
app.get('/api/complaints/:id', (req, res) => {
  const c = db.getComplaint(req.params.id);
  if (!c) {
    return res.status(404).json({ error: `Complaint with reference ${req.params.id} not found` });
  }
  res.json(view(c, req));
});

// Create Complaint
app.post('/api/complaints', (req, res) => {
  const {
    title,
    category,
    area,
    landmark,
    description,
    name,
    phone,
    email,
    priority,
    lat,
    lng,
    photos,
    videos
  } = req.body || {};

  const isAnonymous = req.body && (req.body.anonymous === true || req.body.anonymous === 'true');

  // Anonymous reports are never linked to an account, even if a login token was sent.
  const user = isAnonymous ? null : getUserFromReq(req);

  if (!category || !area || !description) {
    return res.status(400).json({ error: 'Category, area and description are required fields.' });
  }

  const meta = CATEGORY_MAP[category] || CATEGORY_MAP['Other civic issues'];
  const generatedId = db.getNextComplaintId();
  const now = new Date();

  // SLA calculation
  const slaHoursNum = meta.slaHours || 120;
  const expectedDate = new Date(now.getTime() + slaHoursNum * 60 * 60 * 1000).toISOString();

  const finalTitle = title && title.trim().length > 0
    ? title.trim()
    : `${category} reported at ${area}`;

  const reporterName = isAnonymous ? 'Anonymous Citizen' : (user ? user.name : (name || 'Anonymous Citizen'));
  const reporterPhone = isAnonymous ? '' : (user ? (user.phone || phone || '') : (phone || ''));
  const reporterEmail = isAnonymous ? '' : (user ? user.email : (email || ''));
  const reporterId = user ? user.id : null;

  const hasCoords = lat !== null && lat !== undefined && lng !== null && lng !== undefined && !isNaN(Number(lat)) && !isNaN(Number(lng));
  const numericLat = hasCoords ? Number(lat) : null;
  const numericLng = hasCoords ? Number(lng) : null;
  const coords = hasCoords ? [numericLat, numericLng] : null;

  // Secret that lets the person who filed this report delete it later (stored hashed).
  const deleteToken = crypto.randomBytes(24).toString('hex');

  const complaint = {
    id: generatedId,
    title: finalTitle,
    category,
    area,
    landmark: landmark ? landmark.trim() : '',
    description: description.trim(),
    name: reporterName,
    phone: reporterPhone,
    email: reporterEmail,
    reporterId,
    reporterName,
    reporterPhone,
    reporterEmail,
    anonymous: !!isAnonymous,
    deleteTokenHash: sha256(deleteToken),
    voters: [],
    photos: Array.isArray(photos) ? photos : [],
    videos: Array.isArray(videos) ? videos : [],
    photo: Array.isArray(photos) && photos.length > 0 ? photos[0] : null,
    status: 'Submitted',
    priority: priority || meta.priority || 'Medium',
    department: meta.department,
    officer: meta.officer || null,
    slaHours: meta.sla,
    expectedResolutionDate: expectedDate,
    resolutionPhoto: null,
    resolutionRemarks: null,
    rejectionReason: null,
    lat: numericLat,
    lng: numericLng,
    coords,
    isPublic: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    resolvedAt: null,
    statusHistory: [
      {
        id: `sh_${Date.now()}_init`,
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

  db.addComplaint(complaint);

  // Notify user if authenticated (anonymous reports have no reporterId, so no one is notified)
  if (reporterId) {
    db.addNotification({
      userId: reporterId,
      complaintId: complaint.id,
      title: 'Complaint Registered',
      message: `Your complaint ${complaint.id} regarding "${complaint.title}" has been submitted to ${complaint.department}.`,
      type: 'status_update'
    });
  }

  // Notify admins
  db.addNotification({
    userId: 'all_admins',
    complaintId: complaint.id,
    title: 'New Civic Report Filed',
    message: `[${complaint.id}] New ${complaint.priority} priority report in ${complaint.area}: "${complaint.title}".`,
    type: 'assignment'
  });

  // deleteToken is returned ONCE, here. The browser keeps it so this device can delete the report.
  res.status(201).json({ ...sanitizeComplaintForUser(complaint, user, req), deleteToken });
});

// Upload media to existing complaint
app.post('/api/complaints/:id/upload', upload.array('files', 5), (req, res) => {
  const c = db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });
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

  c.photos = Array.from(new Set([...(c.photos || []), ...images]));
  c.videos = Array.from(new Set([...(c.videos || []), ...videos]));
  if (!c.photo && c.photos.length > 0) c.photo = c.photos[0];
  c.updatedAt = new Date().toISOString();

  db.updateComplaint(req.params.id, c);

  res.json({
    success: true,
    urls: uploadedUrls,
    photos: c.photos,
    videos: c.videos,
    complaint: view(c, req)
  });
});

// Legacy single photo endpoint (kept for complete backward compatibility)
app.post('/api/complaints/:id/photo', upload.single('photo'), (req, res) => {
  const c = db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const url = `/uploads/${req.file.filename}`;
  c.photos = c.photos || [];
  if (!c.photos.includes(url)) c.photos.push(url);
  c.photo = url;
  c.updatedAt = new Date().toISOString();

  db.updateComplaint(req.params.id, c);
  res.json({ photo: url, complaint: view(c, req) });
});

// Community voting: toggles the caller's upvote. Logged-in users vote once per account,
// guests once per device (X-Device-Id header sent by the frontend).
app.post('/api/complaints/:id/vote', voteLimiter, (req, res) => {
  const user = getUserFromReq(req);
  const key = voterKeyFor(user, req);
  if (!key) {
    return res.status(400).json({ error: 'Could not identify voter. Please reload the page and try again.' });
  }

  const result = db.toggleVote(req.params.id, key);
  if (!result) return res.status(404).json({ error: 'Complaint not found' });
  res.json(result);
});

// Delete a complaint. Allowed for: an admin, the logged-in owner, or whoever holds the
// deleteToken issued at creation (anonymous / guest reporters). Non-admins can only delete
// while the report is still in DELETABLE_STATUSES.
app.delete('/api/complaints/:id', (req, res) => {
  const user = getUserFromReq(req);
  const c = db.getComplaint(req.params.id);
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

  const removed = db.removeComplaint(c.id);
  if (removed) removeUploadedFiles(removed);
  res.json({ success: true, id: c.id });
});

// Update complaint status & assignment (Admin / Authority action)
app.patch('/api/complaints/:id/status', requireAdmin, (req, res) => {
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

  const c = db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });

  // Determine actor name
  const actorName = user ? user.name : (req.body.adminName || 'Municipal Authority');
  const actorRole = user ? (user.role === 'admin' ? 'Municipal Authority' : 'Authorized Officer') : 'Municipal Authority';

  const extra = {};
  if (department) extra.department = department;
  if (officer !== undefined) extra.officer = officer;
  if (priority) extra.priority = priority;

  const updated = db.addStatusChange(
    req.params.id,
    status,
    actorName,
    actorRole,
    remarks,
    evidencePhoto,
    extra
  );

  // Notify the citizen if there's a registered reporter
  if (c.reporterId) {
    db.addNotification({
      userId: c.reporterId,
      complaintId: c.id,
      title: `Complaint Status: ${status}`,
      message: `Your complaint [${c.id}] is now marked as "${status}". ${remarks ? 'Remark: ' + remarks : ''}`,
      type: status === 'Resolved' ? 'resolution' : 'status_update'
    });
  }

  res.json(view(updated, req));
});

// Add progress remark/note
app.post('/api/complaints/:id/notes', (req, res) => {
  const user = getUserFromReq(req);
  const { text } = req.body || {};
  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Note text is required' });
  }

  const c = db.getComplaint(req.params.id);
  if (!c) return res.status(404).json({ error: 'Complaint not found' });

  const authorName = user ? user.name : (req.body.author || 'Citizen / Officer');
  const authorRole = user ? (user.role === 'admin' ? 'Municipal Official' : 'Citizen') : 'Update';

  const note = {
    id: `note_${Date.now()}`,
    text: text.trim(),
    author: authorName,
    role: authorRole,
    at: new Date().toISOString()
  };

  db.addNote(req.params.id, note);
  const updated = db.getComplaint(req.params.id);

  // If added by admin, notify citizen; if added by citizen, notify admin
  if (user && user.role === 'admin' && c.reporterId) {
    db.addNotification({
      userId: c.reporterId,
      complaintId: c.id,
      title: 'New Update on your Complaint',
      message: `Officer ${authorName} posted an update on [${c.id}]: "${text.slice(0, 80)}${text.length > 80 ? '...' : ''}"`,
      type: 'status_update'
    });
  }

  res.json(view(updated, req));
});

// ------------------------------------------------------------
// NOTIFICATIONS
// ------------------------------------------------------------
app.get('/api/notifications', (req, res) => {
  const user = getUserFromReq(req);
  if (!user) {
    return res.json([]);
  }
  const notifs = db.getNotifications(user.id);
  res.json(notifs);
});

app.patch('/api/notifications/:id/read', requireAuth, (req, res) => {
  const result = db.markNotificationRead(req.params.id, req.user.id);
  if (!result) return res.status(404).json({ error: 'Notification not found' });
  res.json(result);
});

app.patch('/api/notifications/read-all', requireAuth, (req, res) => {
  db.markAllNotificationsRead(req.user.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------
// STATS & ANALYTICS
// ------------------------------------------------------------
app.get('/api/stats/summary', (_req, res) => {
  res.json(db.getStatsSummary());
});

app.get('/api/stats/analytics', (_req, res) => {
  res.json(db.getAnalytics());
});

// Reset (demo cleanup) — admin only. It used to be callable by anyone, which would let a
// stranger wipe every report.
app.post('/api/reset', requireAdmin, (_req, res) => {
  db.reset();
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

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`✅ Dhwani — Professional Civic Platform Backend`);
  console.log(`   Running at http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
