// ============================================================
// Automatic SLA tracking: runs on a timer, no officer action needed
// ============================================================
//  * 75% of the SLA used and still not In Progress  -> warn admins (once)
//  * SLA deadline passed                            -> mark overdue, escalate, notify admins + reporter (once)
//  * In Progress with no update for 48 hours         -> nudge admins (every 48 h)
// Every automatic action is written to the complaint's audit history as "System",
// so it shows up on the public tracking timeline.
// (All db calls are async now, so the sweep awaits them.)
const SWEEP_EVERY_MS = 15 * 60 * 1000;
const WARN_AT = 0.75;
const STALL_MS = 48 * 3600 * 1000;
const CLOSED = ['Resolved', 'Rejected'];

function historyEntry(status, remarks) {
  return {
    id: `sh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    status,
    changedBy: 'System',
    role: 'Automation',
    timestamp: new Date().toISOString(),
    remarks,
    evidencePhoto: null
  };
}

async function runSlaSweep(db) {
  const now = Date.now();
  let changed = 0;

  const complaints = await db.getComplaints({});
  for (const c of complaints) {
    if (CLOSED.includes(c.status)) continue;
    const created = new Date(c.createdAt).getTime();
    const due = new Date(c.expectedResolutionDate).getTime();
    if (!created || !due || due <= created) continue;

    const elapsed = (now - created) / (due - created);
    const base = { complaintId: c.id };

    if (now > due && !c.overdue) {
      await db.updateComplaint(c.id, {
        overdue: true,
        escalatedAt: new Date(now).toISOString(),
        statusHistory: [...(c.statusHistory || []), historyEntry(c.status, 'SLA deadline passed. Automatically escalated to the Municipal Commissioner.')]
      });
      await db.addNotification({ ...base, userId: 'all_admins', type: 'assignment',
        title: 'SLA breached', message: `[${c.id}] "${c.title}" passed its ${c.slaHours || 'SLA'} deadline while "${c.status}". Escalated automatically.` });
      if (c.reporterId) {
        await db.addNotification({ ...base, userId: c.reporterId, type: 'status_update',
          title: 'Complaint escalated', message: `Your complaint [${c.id}] took longer than its target time, so it has been escalated to senior officials.` });
      }
      changed++;
    } else if (!c.overdue && !c.slaWarned && elapsed >= WARN_AT && !['In Progress'].includes(c.status)) {
      await db.updateComplaint(c.id, {
        slaWarned: true,
        statusHistory: [...(c.statusHistory || []), historyEntry(c.status, 'Over 75% of the SLA time has passed. Reminder sent to the department.')]
      });
      await db.addNotification({ ...base, userId: 'all_admins', type: 'assignment',
        title: 'SLA at risk', message: `[${c.id}] "${c.title}" has used over 75% of its SLA and is still "${c.status}".` });
      changed++;
    }

    if (c.status === 'In Progress') {
      const lastUpdate = new Date(c.updatedAt || c.createdAt).getTime();
      const lastNudge = c.lastNudgeAt ? new Date(c.lastNudgeAt).getTime() : 0;
      if (now - lastUpdate > STALL_MS && now - lastNudge > STALL_MS) {
        await db.updateComplaint(c.id, { lastNudgeAt: new Date(now).toISOString() });
        await db.addNotification({ ...base, userId: 'all_admins', type: 'assignment',
          title: 'No progress update', message: `[${c.id}] "${c.title}" has been "In Progress" for over 48 hours with no update.` });
        changed++;
      }
    }
  }

  if (changed) console.log(`[sla] sweep: ${changed} complaint(s) updated`);
  return changed;
}

function startSlaSweep(db) {
  let running = false;
  const tick = async () => {
    if (running) return;            // never start a sweep while the previous one is still going
    running = true;
    try { await runSlaSweep(db); } catch (e) { console.error('[sla] sweep failed:', e); }
    running = false;
  };
  setTimeout(tick, 5000);                        // shortly after start-up
  const timer = setInterval(tick, SWEEP_EVERY_MS);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { runSlaSweep, startSlaSweep };
