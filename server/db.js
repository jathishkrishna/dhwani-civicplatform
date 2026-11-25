const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data.json');

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

// Pre-defined departments and officers
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

function read() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

function write(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing database:', e);
  }
}

let data = read();
if (!data) data = {};

// Ensure structure
if (!Array.isArray(data.complaints)) data.complaints = [];
if (!Array.isArray(data.users)) data.users = [];
if (!Array.isArray(data.notifications)) data.notifications = [];
if (!Array.isArray(data.sessions)) data.sessions = [];
if (!data.meta || typeof data.meta !== 'object') data.meta = {};
if (!data.meta.idCounters || typeof data.meta.idCounters !== 'object') data.meta.idCounters = {};

// Seed default users if empty
if (data.users.length === 0) {
  data.users.push(
    {
      id: 'usr_admin_01',
      name: 'Commissioner M. Hegde',
      email: 'admin@Dhwani.org',
      phone: '+91 824 2220300',
      passwordHash: hashPassword('admin123'),
      role: 'admin',
      department: 'Municipal Administration',
      title: 'Municipal Commissioner',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'usr_officer_pwd',
      name: 'Ravi Kumar (JE)',
      email: 'officer.pwd@Dhwani.org',
      phone: '+91 98450 11223',
      passwordHash: hashPassword('pwd123'),
      role: 'admin',
      department: 'PWD (Roads & Infrastructure)',
      title: 'Junior Engineer — Kadri Section',
      createdAt: '2026-01-05T00:00:00.000Z'
    },
    {
      id: 'usr_citizen_ananya',
      name: 'Ananya Rao',
      email: 'citizen@example.com',
      phone: '9876543210',
      passwordHash: hashPassword('citizen123'),
      role: 'citizen',
      department: null,
      title: 'Resident, Kadri',
      createdAt: '2026-02-10T00:00:00.000Z'
    }
  );
}

// Seed sample complaints if low or normalize existing
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

// Normalize existing complaints to support new fields
data.complaints.forEach((c, idx) => {
  if (!c.title) {
    c.title = c.category ? `${c.category} reported at ${c.area || 'Mangaluru'}` : 'Civic Issue';
  }
  if (!c.priority) {
    c.priority = (idx % 3 === 0) ? 'High' : (idx % 2 === 0 ? 'Medium' : 'Low');
  }
  if (!Array.isArray(c.photos)) {
    c.photos = c.photo ? [c.photo] : [];
  }
  if (!Array.isArray(c.videos)) {
    c.videos = [];
  }
  if (!c.coords && c.area && AREA_COORDS[c.area]) {
    c.coords = AREA_COORDS[c.area];
    c.lat = c.coords[0];
    c.lng = c.coords[1];
  }
  if (!c.slaHours) {
    c.slaHours = '7 days';
  }
  if (!Array.isArray(c.statusHistory) || c.statusHistory.length === 0) {
    c.statusHistory = [
      {
        id: `sh_${Date.now()}_init_${idx}`,
        status: 'Submitted',
        changedBy: c.name || 'Citizen',
        role: 'Citizen',
        timestamp: c.createdAt || new Date().toISOString(),
        remarks: 'Complaint filed through Dhwani online portal.',
        evidencePhoto: null
      }
    ];
    if (c.status === 'In Progress' || c.status === 'Received') {
      c.statusHistory.push({
        id: `sh_${Date.now()}_prog_${idx}`,
        status: c.status,
        changedBy: c.officer || 'Municipal Desk',
        role: 'Municipal Authority',
        timestamp: c.updatedAt || new Date().toISOString(),
        remarks: c.notes && c.notes[0] ? c.notes[0].text : 'Inspected and assigned for resolution.',
        evidencePhoto: null
      });
    } else if (c.status === 'Resolved') {
      c.statusHistory.push({
        id: `sh_${Date.now()}_res_${idx}`,
        status: 'Resolved',
        changedBy: c.officer || 'Supervising Engineer',
        role: 'Municipal Authority',
        timestamp: c.updatedAt || new Date().toISOString(),
        remarks: 'Issue verified and resolved on-site.',
        evidencePhoto: null
      });
    }
  }
  // Legacy demo data only: complaints that have NO reporterId field at all get the demo citizen.
  // (Guest and anonymous complaints store reporterId = null on purpose and must stay that way.)
  if (c.reporterId === undefined) {
    c.reporterId = 'usr_citizen_ananya';
  }

  // Community voting + anonymous reporting fields
  if (!Array.isArray(c.voters)) c.voters = [];
  if (typeof c.anonymous !== 'boolean') c.anonymous = false;
});

// If fewer than 5 sample complaints, add realistic rich complaints for demonstration
if (data.complaints.length < 5) {
  const now = Date.now();
  const sampleComplaints = [
    {
      id: 'CP-2026-00001',
      title: 'Deep crater pothole on Kadri Temple Road',
      description: 'Multiple deep potholes right outside the primary school gate. Water accumulates during rains making it dangerous for two-wheelers and children.',
      category: 'Road damage and potholes',
      area: 'Kadri',
      landmark: 'Near Kadri Manjunatha Temple South Gate',
      lat: 12.8948,
      lng: 74.8552,
      coords: [12.8948, 74.8552],
      status: 'In Progress',
      priority: 'High',
      department: 'PWD (Roads & Infrastructure)',
      officer: 'Ravi Kumar (JE - PWD Kadri)',
      slaHours: '7 days',
      expectedResolutionDate: new Date(now + 2 * 86400000).toISOString(),
      photos: [],
      videos: [],
      resolutionPhoto: null,
      resolutionRemarks: null,
      rejectionReason: null,
      reporterId: 'usr_citizen_ananya',
      reporterName: 'Ananya Rao',
      reporterPhone: '9876543210',
      reporterEmail: 'citizen@example.com',
      isPublic: true,
      createdAt: new Date(now - 4 * 86400000).toISOString(),
      updatedAt: new Date(now - 1 * 86400000).toISOString(),
      resolvedAt: null,
      statusHistory: [
        {
          id: 'sh_cp1_1',
          status: 'Submitted',
          changedBy: 'Ananya Rao',
          role: 'Citizen',
          timestamp: new Date(now - 4 * 86400000).toISOString(),
          remarks: 'Citizen reported hazardous pothole on busy pedestrian stretch.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp1_2',
          status: 'Verified',
          changedBy: 'Control Room Officer',
          role: 'Municipal Authority',
          timestamp: new Date(now - 3 * 86400000).toISOString(),
          remarks: 'Location confirmed; marked as high priority due to school proximity.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp1_3',
          status: 'Assigned',
          changedBy: 'Ward Engineer',
          role: 'Municipal Authority',
          timestamp: new Date(now - 2 * 86400000).toISOString(),
          remarks: 'Assigned to Ravi Kumar (JE - PWD) for asphalt patching.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp1_4',
          status: 'In Progress',
          changedBy: 'Ravi Kumar (JE - PWD Kadri)',
          role: 'Municipal Authority',
          timestamp: new Date(now - 1 * 86400000).toISOString(),
          remarks: 'Road crew scheduled; bitumen mix dispatched from mixing plant.',
          evidencePhoto: null
        }
      ],
      notes: [
        { text: 'Site inspection completed by junior engineer.', author: 'Ravi Kumar', role: 'PWD', at: new Date(now - 2 * 86400000).toISOString() },
        { text: 'Patching work started today morning.', author: 'Ravi Kumar', role: 'PWD', at: new Date(now - 1 * 86400000).toISOString() }
      ]
    },
    {
      id: 'CP-2026-00002',
      title: 'Overflowing garbage bin behind Hampankatta Market',
      description: 'Solid waste container has not been cleared for 3 days. Stray cattle and dogs are scattering waste across the road causing severe odor.',
      category: 'Garbage and waste management',
      area: 'Hampankatta',
      landmark: 'Behind Central Fish & Vegetable Market',
      lat: 12.8698,
      lng: 74.8426,
      coords: [12.8698, 74.8426],
      status: 'Resolved',
      priority: 'Critical',
      department: 'Health & Sanitation Section',
      officer: 'Suresh Nayak (Sanitary Inspector)',
      slaHours: '24 hours',
      expectedResolutionDate: new Date(now - 5 * 86400000).toISOString(),
      photos: [],
      videos: [],
      resolutionPhoto: null,
      resolutionRemarks: 'Garbage compactor vehicle completed waste evacuation and spot sanitized with bleaching powder.',
      rejectionReason: null,
      reporterId: 'usr_citizen_ananya',
      reporterName: 'Ananya Rao',
      reporterPhone: '9876543210',
      reporterEmail: 'citizen@example.com',
      isPublic: true,
      createdAt: new Date(now - 6 * 86400000).toISOString(),
      updatedAt: new Date(now - 5 * 86400000).toISOString(),
      resolvedAt: new Date(now - 5 * 86400000).toISOString(),
      statusHistory: [
        {
          id: 'sh_cp2_1',
          status: 'Submitted',
          changedBy: 'Ananya Rao',
          role: 'Citizen',
          timestamp: new Date(now - 6 * 86400000).toISOString(),
          remarks: 'Reported overflowing garbage creating health hazard.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp2_2',
          status: 'Verified',
          changedBy: 'Health Section Desk',
          role: 'Municipal Authority',
          timestamp: new Date(now - 5.8 * 86400000).toISOString(),
          remarks: 'Escalated as critical health priority.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp2_3',
          status: 'In Progress',
          changedBy: 'Suresh Nayak',
          role: 'Municipal Authority',
          timestamp: new Date(now - 5.5 * 86400000).toISOString(),
          remarks: 'Garbage truck team deployed on-site.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp2_4',
          status: 'Resolved',
          changedBy: 'Suresh Nayak',
          role: 'Municipal Authority',
          timestamp: new Date(now - 5 * 86400000).toISOString(),
          remarks: 'Container emptied, area swept and disinfected with lime powder.',
          evidencePhoto: null
        }
      ],
      notes: [
        { text: 'Compactor vehicle #KA-19-G-4412 cleared the spot.', author: 'Suresh Nayak', role: 'Health Section', at: new Date(now - 5 * 86400000).toISOString() }
      ]
    },
    {
      id: 'CP-2026-00003',
      title: 'Main pipeline drinking water leakage flooding street',
      description: 'Clean drinking water gushing from underground pipeline joint since 6 AM. Gallons of water wasted and low pressure in nearby homes.',
      category: 'Water leakage',
      area: 'Bejai',
      landmark: 'Near Bejai Church junction',
      lat: 12.8872,
      lng: 74.8435,
      coords: [12.8872, 74.8435],
      status: 'Assigned',
      priority: 'Critical',
      department: 'Mangaluru City Water Supply Board',
      officer: 'Rajesh Bhat (Assistant Executive Engineer)',
      slaHours: '48 hours',
      expectedResolutionDate: new Date(now + 1 * 86400000).toISOString(),
      photos: [],
      videos: [],
      resolutionPhoto: null,
      resolutionRemarks: null,
      rejectionReason: null,
      reporterId: 'usr_citizen_ananya',
      reporterName: 'Ananya Rao',
      reporterPhone: '9876543210',
      reporterEmail: 'citizen@example.com',
      isPublic: true,
      createdAt: new Date(now - 1 * 86400000).toISOString(),
      updatedAt: new Date(now - 18 * 3600000).toISOString(),
      resolvedAt: null,
      statusHistory: [
        {
          id: 'sh_cp3_1',
          status: 'Submitted',
          changedBy: 'Ananya Rao',
          role: 'Citizen',
          timestamp: new Date(now - 1 * 86400000).toISOString(),
          remarks: 'Severe pipeline burst reported.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp3_2',
          status: 'Verified',
          changedBy: 'Emergency Helpline',
          role: 'Municipal Authority',
          timestamp: new Date(now - 22 * 3600000).toISOString(),
          remarks: 'Main valve temporarily regulated to prevent further flooding.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp3_3',
          status: 'Assigned',
          changedBy: 'Water Board Superintending Eng',
          role: 'Municipal Authority',
          timestamp: new Date(now - 18 * 3600000).toISOString(),
          remarks: 'Assigned to Rajesh Bhat. Valve technician team dispatched with clamp repair kit.',
          evidencePhoto: null
        }
      ],
      notes: []
    },
    {
      id: 'CP-2026-00004',
      title: 'Blocked stormwater storm drain causing waterlogging',
      description: 'Silt and plastic waste blocking main drain grating. Water backflows onto pedestrian walkway during heavy downpours.',
      category: 'Drainage and sewage',
      area: 'Kottara',
      landmark: 'Kottara Chowki service road',
      lat: 12.9160,
      lng: 74.8320,
      coords: [12.9160, 74.8320],
      status: 'Submitted',
      priority: 'Medium',
      department: 'Engineering Section (Drainage & Sewage)',
      officer: null,
      slaHours: '72 hours',
      expectedResolutionDate: new Date(now + 3 * 86400000).toISOString(),
      photos: [],
      videos: [],
      resolutionPhoto: null,
      resolutionRemarks: null,
      rejectionReason: null,
      reporterId: 'usr_citizen_ananya',
      reporterName: 'Ananya Rao',
      reporterPhone: '9876543210',
      reporterEmail: 'citizen@example.com',
      isPublic: true,
      createdAt: new Date(now - 12 * 3600000).toISOString(),
      updatedAt: new Date(now - 12 * 3600000).toISOString(),
      resolvedAt: null,
      statusHistory: [
        {
          id: 'sh_cp4_1',
          status: 'Submitted',
          changedBy: 'Ananya Rao',
          role: 'Citizen',
          timestamp: new Date(now - 12 * 3600000).toISOString(),
          remarks: 'Initial complaint submitted awaiting verification.',
          evidencePhoto: null
        }
      ],
      notes: []
    },
    {
      id: 'CP-2026-00005',
      title: 'Four streetlights not functioning for over a week',
      description: 'Entire stretch of road near beach park is in complete darkness at night. Unsafe for women and evening commuters.',
      category: 'Streetlight failure',
      area: 'Panambur',
      landmark: 'Panambur Beach entrance approach road',
      lat: 12.9450,
      lng: 74.8020,
      coords: [12.9450, 74.8020],
      status: 'In Progress',
      priority: 'Medium',
      department: 'MESCOM (Electrical Division)',
      officer: 'Ganesh Poojary (Section Officer Kadri)',
      slaHours: '48 hours',
      expectedResolutionDate: new Date(now + 1 * 86400000).toISOString(),
      photos: [],
      videos: [],
      resolutionPhoto: null,
      resolutionRemarks: null,
      rejectionReason: null,
      reporterId: 'usr_citizen_ananya',
      reporterName: 'Ananya Rao',
      reporterPhone: '9876543210',
      reporterEmail: 'citizen@example.com',
      isPublic: true,
      createdAt: new Date(now - 2 * 86400000).toISOString(),
      updatedAt: new Date(now - 14 * 3600000).toISOString(),
      resolvedAt: null,
      statusHistory: [
        {
          id: 'sh_cp5_1',
          status: 'Submitted',
          changedBy: 'Ananya Rao',
          role: 'Citizen',
          timestamp: new Date(now - 2 * 86400000).toISOString(),
          remarks: 'Reported continuous dark streetlights.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp5_2',
          status: 'Verified',
          changedBy: 'Electrical Control Room',
          role: 'Municipal Authority',
          timestamp: new Date(now - 30 * 3600000).toISOString(),
          remarks: 'Feeder pillar circuit fault diagnosed.',
          evidencePhoto: null
        },
        {
          id: 'sh_cp5_3',
          status: 'In Progress',
          changedBy: 'Ganesh Poojary',
          role: 'Municipal Authority',
          timestamp: new Date(now - 14 * 3600000).toISOString(),
          remarks: 'Hydraulic ladder truck deployed to replace LED ballast.',
          evidencePhoto: null
        }
      ],
      notes: [
        { text: 'Replacement LED luminaires being fitted today.', author: 'Ganesh Poojary', role: 'MESCOM', at: new Date(now - 14 * 3600000).toISOString() }
      ]
    }
  ];

  sampleComplaints.forEach(sc => {
    if (!data.complaints.some(c => c.id === sc.id)) {
      sc.voters = [];
      sc.anonymous = false;
      data.complaints.push(sc);
    }
  });
}

// Complaint ID counters: IDs only ever go up, so a deleted report's ID (and any
// QR code / link pointing at it) is never handed to a different report.
function syncIdCounters() {
  data.complaints.forEach(c => {
    const m = /^CP-(\d{4})-(\d+)$/.exec(c.id || '');
    if (!m) return;
    const year = m[1];
    const num = parseInt(m[2], 10);
    if ((data.meta.idCounters[year] || 0) < num) data.meta.idCounters[year] = num;
  });
}
syncIdCounters();

write(data);

module.exports = {
  // Department info
  getDepartments: () => DEPARTMENTS,

  // Auth & Users
  getUsers: () => data.users,
  getUserById: (id) => data.users.find(u => u.id === id),
  getUserByEmail: (email) => data.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase().trim()),
  addUser: (userData) => {
    const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const user = {
      id,
      name: userData.name || 'Citizen',
      email: userData.email.toLowerCase().trim(),
      phone: userData.phone || '',
      passwordHash: hashPassword(userData.password || 'password123'),
      role: userData.role || 'citizen',
      department: userData.department || null,
      title: userData.title || (userData.role === 'admin' ? 'Municipal Staff' : 'Resident'),
      createdAt: new Date().toISOString()
    };
    data.users.push(user);
    write(data);
    return user;
  },
  updateUser: (id, patch) => {
    const u = data.users.find(x => x.id === id);
    if (!u) return null;
    if (patch.password) {
      u.passwordHash = hashPassword(patch.password);
      delete patch.password;
    }
    Object.assign(u, patch);
    write(data);
    return u;
  },
  authenticateUser: (email, password) => {
    const u = data.users.find(x => x.email.toLowerCase() === (email || '').toLowerCase().trim());
    if (!u) return null;
    if (verifyPassword(password, u.passwordHash)) {
      return u;
    }
    return null;
  },

  // Sessions
  createSession: (userId) => {
    const token = `cpsess_${crypto.randomBytes(24).toString('hex')}`;
    const sess = {
      token,
      userId,
      createdAt: Date.now()
    };
    data.sessions.push(sess);
    // Keep max 200 sessions
    if (data.sessions.length > 200) data.sessions.shift();
    write(data);
    return token;
  },
  getSessionUser: (token) => {
    if (!token) return null;
    const sess = data.sessions.find(s => s.token === token);
    if (!sess) return null;
    // Session valid for 30 days
    if (Date.now() - sess.createdAt > 30 * 86400000) return null;
    return data.users.find(u => u.id === sess.userId) || null;
  },
  deleteSession: (token) => {
    const idx = data.sessions.findIndex(s => s.token === token);
    if (idx !== -1) {
      data.sessions.splice(idx, 1);
      write(data);
    }
  },

  // Complaints
  getComplaints: (query = {}) => {
    let list = [...data.complaints];

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

    // Sort order
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
      // Default: newest first
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return list;
  },

  getComplaint: (id) => {
    if (!id) return null;
    const cleanId = id.trim().toUpperCase();
    return data.complaints.find(c => c.id.toUpperCase() === cleanId) || null;
  },

  getNextComplaintId: () => {
    const year = String(new Date().getFullYear());
    const prefix = `CP-${year}-`;
    let nextNum = (data.meta.idCounters[year] || 0) + 1;
    let candidate = `${prefix}${String(nextNum).padStart(5, '0')}`;
    while (data.complaints.some(c => c.id === candidate)) {
      nextNum++;
      candidate = `${prefix}${String(nextNum).padStart(5, '0')}`;
    }
    data.meta.idCounters[year] = nextNum; // persisted on the next write (addComplaint)
    return candidate;
  },

  addComplaint: (c) => {
    data.complaints.unshift(c);
    write(data);
    return c;
  },

  updateComplaint: (id, patch) => {
    const c = data.complaints.find(x => x.id.toUpperCase() === id.trim().toUpperCase());
    if (!c) return null;
    Object.assign(c, patch);
    write(data);
    return c;
  },

  // Permanently delete a complaint and the notifications that point at it.
  // Returns the removed complaint (so the caller can delete its uploaded files) or null.
  removeComplaint: (id) => {
    const idx = data.complaints.findIndex(x => x.id.toUpperCase() === (id || '').trim().toUpperCase());
    if (idx === -1) return null;
    const [removed] = data.complaints.splice(idx, 1);
    data.notifications = data.notifications.filter(n => n.complaintId !== removed.id);
    write(data);
    return removed;
  },

  // Community voting: toggles `voterKey` on the complaint. Returns { votes, voted } or null.
  toggleVote: (id, voterKey) => {
    const c = data.complaints.find(x => x.id.toUpperCase() === (id || '').trim().toUpperCase());
    if (!c) return null;
    if (!Array.isArray(c.voters)) c.voters = [];
    const idx = c.voters.indexOf(voterKey);
    if (idx === -1) c.voters.push(voterKey);
    else c.voters.splice(idx, 1);
    write(data);
    return { votes: c.voters.length, voted: idx === -1 };
  },

  addStatusChange: (id, status, changedBy, role, remarks, evidencePhoto, extra = {}) => {
    const c = data.complaints.find(x => x.id.toUpperCase() === id.trim().toUpperCase());
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
    }

    if (extra.department) c.department = extra.department;
    if (extra.officer !== undefined) c.officer = extra.officer;
    if (extra.priority) c.priority = extra.priority;

    c.statusHistory = c.statusHistory || [];
    const historyEntry = {
      id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      status,
      changedBy: changedBy || 'Municipal Official',
      role: role || 'Municipal Authority',
      timestamp: c.updatedAt,
      remarks: remarks || `Status updated to ${status}.`,
      evidencePhoto: evidencePhoto || null
    };
    c.statusHistory.push(historyEntry);

    write(data);
    return c;
  },

  addNote: (id, note) => {
    const c = data.complaints.find(x => x.id.toUpperCase() === id.trim().toUpperCase());
    if (!c) return null;
    c.notes = c.notes || [];
    c.notes.push(note);
    c.updatedAt = new Date().toISOString();
    write(data);
    return c;
  },

  // Notifications
  getNotifications: (userId) => {
    if (!userId) return [];
    return data.notifications
      .filter(n => n.userId === userId || n.userId === 'all_admins' || n.userId === 'broadcast')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  addNotification: (notif) => {
    const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full = {
      id,
      userId: notif.userId,
      complaintId: notif.complaintId || null,
      title: notif.title,
      message: notif.message,
      type: notif.type || 'info',
      read: false,
      createdAt: new Date().toISOString()
    };
    data.notifications.unshift(full);
    if (data.notifications.length > 500) data.notifications.pop();
    write(data);
    return full;
  },

  markNotificationRead: (id, userId) => {
    const n = data.notifications.find(x => x.id === id && (x.userId === userId || x.userId === 'all_admins'));
    if (n) {
      n.read = true;
      write(data);
      return n;
    }
    return null;
  },

  markAllNotificationsRead: (userId) => {
    data.notifications.forEach(n => {
      if (n.userId === userId || (n.userId === 'all_admins' && userId.startsWith('usr_admin'))) {
        n.read = true;
      }
    });
    write(data);
    return true;
  },

  // Statistics & Analytics
  getStatsSummary: () => {
    const complaints = data.complaints;
    const total = complaints.length;
    const pending = complaints.filter(c => c.status === 'Submitted').length;
    const verified = complaints.filter(c => c.status === 'Verified').length;
    const assigned = complaints.filter(c => c.status === 'Assigned').length;
    const inProgress = complaints.filter(c => c.status === 'In Progress').length;
    const resolved = complaints.filter(c => c.status === 'Resolved').length;
    const rejected = complaints.filter(c => c.status === 'Rejected').length;
    const critical = complaints.filter(c => (c.priority === 'Critical' || c.priority === 'High') && c.status !== 'Resolved' && c.status !== 'Rejected').length;

    // Calculate resolution rate
    const closed = resolved + rejected;
    const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;

    // Calculate average resolution time for resolved complaints
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

    return {
      total,
      pending,
      verified,
      assigned,
      inProgress,
      resolved,
      rejected,
      active: pending + verified + assigned + inProgress,
      critical,
      resolutionRate,
      avgResolutionHours,
      slaComplianceRate: 92
    };
  },

  getAnalytics: () => {
    const complaints = data.complaints;

    // Category breakdown
    const categoryCounts = {};
    complaints.forEach(c => {
      const cat = c.category || 'Other';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    // Area breakdown
    const areaCounts = {};
    complaints.forEach(c => {
      const area = c.area || 'Other';
      areaCounts[area] = (areaCounts[area] || 0) + 1;
    });

    // Department performance
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

    // Priority breakdown
    const priorityCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    complaints.forEach(c => {
      const p = c.priority || 'Medium';
      if (priorityCounts[p] !== undefined) priorityCounts[p]++;
    });

    // Status breakdown
    const statusCounts = {
      Submitted: 0,
      Verified: 0,
      Assigned: 0,
      'In Progress': 0,
      Resolved: 0,
      Rejected: 0
    };
    complaints.forEach(c => {
      const s = c.status || 'Submitted';
      if (statusCounts[s] !== undefined) statusCounts[s]++;
    });

    return {
      categoryCounts,
      areaCounts,
      deptStats,
      priorityCounts,
      statusCounts
    };
  },

  reset: () => {
    data.complaints = [];
    data.notifications = [];
    data.sessions = [];
    data.meta.idCounters = {};
    write(data);
  }
};
