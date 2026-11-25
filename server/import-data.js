// ============================================================
// One-time import: copies everything from the old data.json into Supabase.
//   1) Run schema.sql in the Supabase SQL editor first.
//   2) Then, in the server folder:  node import-data.js
// Safe to run twice (it upserts, it never duplicates).
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sb = require('./supabase');

const FILE = path.join(__dirname, 'data.json');

async function upsertInBatches(table, rows, onConflict, size = 200) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`  ${table}: ${rows.length} row(s)`);
}

(async () => {
  if (!fs.existsSync(FILE)) {
    console.log('No data.json found, nothing to import.');
    return;
  }
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log('Importing data.json into Supabase...');

  const users = (data.users || []).map(u => ({
    id: u.id, name: u.name || 'Citizen', email: String(u.email || '').toLowerCase().trim(),
    phone: u.phone || '', password_hash: u.passwordHash, role: u.role || 'citizen',
    department: u.department || null, title: u.title || null,
    created_at: u.createdAt || new Date().toISOString()
  })).filter(u => u.email && u.password_hash);
  await upsertInBatches('users', users, 'id');

  const complaints = (data.complaints || []).map(c => ({
    id: c.id, status: c.status || 'Submitted', category: c.category || null, priority: c.priority || null,
    area: c.area || null, department: c.department || null, reporter_id: c.reporterId || null,
    created_at: c.createdAt || new Date().toISOString(),
    updated_at: c.updatedAt || c.createdAt || new Date().toISOString(),
    doc: c
  }));
  await upsertInBatches('complaints', complaints, 'id');

  const ids = new Set(complaints.map(c => c.id));
  const notifications = (data.notifications || []).map(n => ({
    id: n.id, user_id: n.userId, complaint_id: n.complaintId && ids.has(n.complaintId) ? n.complaintId : null,
    title: n.title || '', message: n.message || '', type: n.type || 'info',
    read: !!n.read, created_at: n.createdAt || new Date().toISOString()
  })).filter(n => n.user_id);
  await upsertInBatches('notifications', notifications, 'id');

  // ID counters: so new reports continue after the highest imported number
  const counters = {};
  Object.entries((data.meta && data.meta.idCounters) || {}).forEach(([y, v]) => { counters[y] = Number(v) || 0; });
  complaints.forEach(c => {
    const m = /^CP-(\d{4})-(\d+)$/.exec(c.id || '');
    if (m) counters[m[1]] = Math.max(counters[m[1]] || 0, parseInt(m[2], 10));
  });
  await upsertInBatches('counters', Object.entries(counters).map(([year, value]) => ({ year, value })), 'year');

  console.log('Done. Sessions were not imported, so everyone just signs in again.');
})().catch(e => { console.error('Import failed:', e.message); process.exit(1); });
