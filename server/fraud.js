// ============================================================
// Fake-report detection + ward assignment helpers (server side)
// ============================================================
// Everything here only SCORES and FLAGS. Nothing is rejected automatically
// except the per-account daily limit enforced in server.js. Officers decide.
const fs = require('fs');
const crypto = require('crypto');

// `sharp` is optional. Without it we still catch byte-identical photos (SHA-256)
// but not resized / re-compressed copies. Install it with:  npm install sharp
let sharp = null;
try { sharp = require('sharp'); }
catch (e) { console.warn('[fraud] "sharp" is not installed: perceptual photo matching is disabled (exact-duplicate check still works). Run: npm install sharp'); }

// ---------------- Tunables ----------------
const REPORTS_PER_DAY = 10;          // hard cap per account (429 after this)
const PHASH_MAX_DIST = 10;           // Hamming distance (of 64) that counts as "same picture"
const PHASH_EXACT_DIST = 3;          // practically identical
const RESOLVED_RADIUS_M = 100;       // new report this close to a recently resolved one is suspicious
const RESOLVED_WINDOW_DAYS = 30;
const SERVICE_AREA = { minLat: 12.70, maxLat: 13.15, minLng: 74.65, maxLng: 75.10 }; // Mangaluru + surroundings

// ---------------- Geography ----------------
const AREA_COORDS = {
  'Hampankatta':     [12.8698, 74.8426],
  'Kadri':           [12.8950, 74.8550],
  'Kottara':         [12.9160, 74.8320],
  'Bejai':           [12.8870, 74.8430],
  'Balmatta':        [12.8750, 74.8480],
  'Surathkal':       [13.0068, 74.7944],
  'Kankanady':       [12.8760, 74.8620],
  'Ullal':           [12.8050, 74.8500],
  'Panambur':        [12.9450, 74.8020]
};
// Zonal offices (contact details from the MCC "Contact Us" page).
// NOTE: the area -> zone mapping is an approximation. Replace with official MCC data.
const ZONAL_OFFICES = {
  1: { name: 'Surathkal Zonal Office – Zone 1', phone: '0824-2220360' },
  2: { name: 'Lalbagh Zonal Office – Zone 2',   phone: '0824-2220313' },
  3: { name: 'Kadri Zonal Office – Zone 3',     phone: '0824-2951144' }
};
const AREA_ZONE = {
  'Surathkal': 1, 'Panambur': 1,
  'Hampankatta': 2, 'Balmatta': 2, 'Kankanady': 2, 'Ullal': 2, 'Other Mangaluru': 2,
  'Kadri': 3, 'Kottara': 3, 'Bejai': 3
};

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function inServiceArea(lat, lng) {
  return lat >= SERVICE_AREA.minLat && lat <= SERVICE_AREA.maxLat && lng >= SERVICE_AREA.minLng && lng <= SERVICE_AREA.maxLng;
}

// Nearest known area (and its zonal office) for a pin; falls back to the area the citizen chose
function assignWard(lat, lng, fallbackArea) {
  let area = null;
  if (typeof lat === 'number' && typeof lng === 'number') {
    let best = Infinity;
    for (const [name, c] of Object.entries(AREA_COORDS)) {
      const d = distanceMeters(lat, lng, c[0], c[1]);
      if (d < best) { best = d; area = name; }
    }
    if (best > 9000) area = 'Other Mangaluru';
  }
  if (!area) area = AREA_ZONE[fallbackArea] ? fallbackArea : 'Other Mangaluru';
  const zoneNo = AREA_ZONE[area] || 2;
  return { area, zone: zoneNo, office: ZONAL_OFFICES[zoneNo].name, phone: ZONAL_OFFICES[zoneNo].phone };
}

// ---------------- Photo fingerprints ----------------
// DCT perceptual hash: 32x32 grey -> 8x8 low-frequency block -> 64 bits (16 hex chars).
// Same algorithm as the browser check in app.js.
const COS = (() => {
  const t = [];
  for (let u = 0; u < 8; u++) t.push(Array.from({ length: 32 }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 64)));
  return t;
})();

function phashFromGray(data, channels = 1) {
  const N = 32;
  const gray = [];
  for (let y = 0; y < N; y++) {
    const row = [];
    for (let x = 0; x < N; x++) row.push(data[(y * N + x) * channels]);
    gray.push(row);
  }
  const coeffs = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        const cy = COS[v][y];
        for (let x = 0; x < N; x++) sum += gray[y][x] * cy * COS[u][x];
      }
      coeffs.push(sum);
    }
  }
  const sorted = coeffs.slice(1).sort((a, b) => a - b);   // ignore the DC term
  const median = sorted[Math.floor(sorted.length / 2)];
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    let nib = 0;
    for (let b = 0; b < 4; b++) nib = (nib << 1) | (coeffs[i + b] > median ? 1 : 0);
    hex += nib.toString(16);
  }
  return hex;
}

function phashDistance(a, b) {
  let dist = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { dist += x & 1; x >>= 1; }
  }
  return dist;
}

// { sha256, phash } for an image file on disk (phash is null when sharp is unavailable or the file can't be decoded)
async function imageHashes(filePath) {
  const buf = await fs.promises.readFile(filePath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  let phash = null;
  if (sharp) {
    try {
      const { data, info } = await sharp(buf)
        .rotate()                                  // honour EXIF orientation
        .resize(32, 32, { fit: 'fill' })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      phash = phashFromGray(data, info.channels || 1);
    } catch (e) { /* undecodable image: keep exact hash only */ }
  }
  return { sha256, phash };
}

// Matches of one photo against every stored photo on OTHER complaints (reports and officer resolution photos)
function findPhotoMatches(hashes, complaints, excludeId) {
  const out = [];
  for (const c of complaints) {
    if (c.id === excludeId) continue;
    let best = null;
    for (const ph of (c.photoHashes || [])) {
      let m = null;
      if (hashes.sha256 && ph.sha256 === hashes.sha256) m = { exact: true, dist: 0 };
      else if (hashes.phash && ph.phash) {
        const d = phashDistance(hashes.phash, ph.phash);
        if (d <= PHASH_MAX_DIST) m = { exact: d <= PHASH_EXACT_DIST, dist: d };
      }
      if (m && (!best || m.dist < best.dist)) best = { ...m, id: c.id, kind: ph.kind || 'report' };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.dist - b.dist);
}

// ---------------- Scoring ----------------
function normalizeText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function reviewStatusFor(score) {
  if (score >= 70) return 'ok';
  if (score >= 40) return 'verify';   // normal flow, officers see a "needs verification" hint
  return 'held';                      // low trust: officers review before acting
}

// Scores a brand-new report. Photo checks happen later, when files are uploaded.
function assessNewReport({ user, category, description, lat, lng, allComplaints, recentByUser, now = Date.now() }) {
  let score = 100;
  const flags = [];
  const penalise = (flag, pts) => { flags.push(flag); score -= pts; };

  if (typeof lat !== 'number' || typeof lng !== 'number') penalise('no_location', 15);
  else if (!inServiceArea(lat, lng)) penalise('out_of_service_area', 40);

  const text = String(description || '').trim();
  const uniqueChars = new Set(text.toLowerCase().replace(/\s/g, '')).size;
  if (text.length < 15 || uniqueChars <= 4) penalise('low_quality_text', 20);

  const norm = normalizeText(text);
  const weekMs = 7 * 86400000;
  if (norm.length >= 10 && allComplaints.some(c =>
    c.category === category && normalizeText(c.description) === norm && now - new Date(c.createdAt).getTime() < weekMs)) {
    penalise('duplicate_text', 30);
  }

  if (typeof lat === 'number' && typeof lng === 'number') {
    const cutoff = now - RESOLVED_WINDOW_DAYS * 86400000;
    const near = allComplaints
      .filter(c => c.status === 'Resolved' && c.category === category)
      .map(c => {
        const cLat = c.lat ?? (c.coords && c.coords[0]);
        const cLng = c.lng ?? (c.coords && c.coords[1]);
        const when = new Date(c.resolvedAt || c.updatedAt || c.createdAt).getTime();
        return { c, when, dist: (typeof cLat === 'number' && typeof cLng === 'number') ? distanceMeters(lat, lng, cLat, cLng) : Infinity };
      })
      .filter(x => x.dist <= RESOLVED_RADIUS_M && x.when >= cutoff)
      .sort((a, b) => a.dist - b.dist)[0];
    if (near) penalise(`near_resolved:${near.c.id}`, 25);
  }

  if (recentByUser.filter(c => now - new Date(c.createdAt).getTime() < 3600000).length >= 3) penalise('rapid_submissions', 20);
  if (user && user.createdAt && now - new Date(user.createdAt).getTime() < 86400000) penalise('new_account', 10);

  score = Math.max(0, score);
  return { score, flags, reviewStatus: reviewStatusFor(score) };
}

module.exports = {
  REPORTS_PER_DAY, PHASH_MAX_DIST, PHASH_EXACT_DIST,
  distanceMeters, inServiceArea, assignWard,
  phashFromGray, phashDistance, imageHashes, findPhotoMatches,
  assessNewReport, reviewStatusFor
};
