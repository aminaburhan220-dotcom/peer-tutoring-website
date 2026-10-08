const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireRole } = require('../middleware/role');
const { logActivity } = require('../middleware/activity');

router.use(requireRole('admin'));

// ---------- DASHBOARD ----------
router.get('/dashboard', async (req, res) => {
  const stats = {
    totalStudents: (await db.prepare(`SELECT COUNT(*) c FROM students`).get()).c,
    totalTutors: (await db.prepare(`SELECT COUNT(*) c FROM tutors`).get()).c,
    pendingTutors: (await db.prepare(`SELECT COUNT(*) c FROM tutors WHERE status='pending'`).get()).c,
    totalSubjects: (await db.prepare(`SELECT COUNT(*) c FROM subjects`).get()).c,
    totalBookings: (await db.prepare(`SELECT COUNT(*) c FROM bookings`).get()).c,
    pendingBookings: (await db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status='pending'`).get()).c,
    completedSessions: (await db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status='completed'`).get()).c,
    totalReviews: (await db.prepare(`SELECT COUNT(*) c FROM reviews`).get()).c,
    // Revenue is an estimate: each completed booking counts at the tutor's
    // current hourly rate (same method used on the tutor Earnings page).
    totalRevenue: (await db.prepare(`
      SELECT COALESCE(SUM(t.hourly_rate), 0) AS total
      FROM bookings b JOIN tutors t ON t.id = b.tutor_id
      WHERE b.status = 'completed'
    `).get()).total
  };

  const bySubject = await db.prepare(`
    SELECT s.name, COUNT(b.id) AS count FROM subjects s
    LEFT JOIN bookings b ON b.subject_id = s.id
    GROUP BY s.id ORDER BY count DESC
  `).all();

  const byStatus = await db.prepare(`SELECT status, COUNT(*) AS count FROM bookings GROUP BY status`).all();

  const recentBookings = await db.prepare(`
    SELECT b.*, su.full_name AS student_name, tu.full_name AS tutor_name, sub.name AS subject_name
    FROM bookings b
    JOIN students s ON s.id = b.student_id JOIN users su ON su.id = s.user_id
    JOIN tutors t ON t.id = b.tutor_id JOIN users tu ON tu.id = t.user_id
    JOIN subjects sub ON sub.id = b.subject_id
    ORDER BY b.created_at DESC LIMIT 5
  `).all();

  const recentActivity = await db.prepare(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 8`).all();

  res.render('admin/dashboard', { stats, bySubject, byStatus, recentBookings, recentActivity });
});

// ---------- STUDENTS ----------
router.get('/students', async (req, res) => {
  const q = req.query.q || '';
  const students = await db.prepare(`
    SELECT s.*, u.full_name, u.email, u.phone, u.is_active, u.created_at
    FROM students s JOIN users u ON u.id = s.user_id
    WHERE u.full_name LIKE ? OR u.email LIKE ?
    ORDER BY u.created_at DESC
  `).all(`%${q}%`, `%${q}%`);
  res.render('admin/students', { students, q });
});

router.get('/students/:id/edit', async (req, res) => {
  const student = await db.prepare(`SELECT s.*, u.full_name, u.email, u.phone FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(req.params.id);
  if (!student) { req.flash('error', 'Student not found.'); return res.redirect('/admin/students'); }
  res.render('admin/student-edit', { student });
});

router.post('/students/:id/edit', async (req, res) => {
  const { full_name, email, phone, university, department, bio } = req.body;
  const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.redirect('/admin/students');
  await db.prepare('UPDATE users SET full_name=?, email=?, phone=? WHERE id=?').run(full_name, email, phone, student.user_id);
  await db.prepare('UPDATE students SET university=?, department=?, bio=? WHERE id=?').run(university, department, bio, student.id);
  req.flash('success', 'Student updated.');
  res.redirect('/admin/students');
});

router.post('/students/:id/toggle-active', async (req, res) => {
  const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.redirect('/admin/students');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(student.user_id);
  await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(user.is_active ? 0 : 1, user.id);
  req.flash('success', `Student account ${user.is_active ? 'deactivated' : 'activated'}.`);
  res.redirect('/admin/students');
});

router.post('/students/:id/delete', async (req, res) => {
  const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (student) await db.prepare('DELETE FROM users WHERE id = ?').run(student.user_id); // cascades
  req.flash('success', 'Student account deleted.');
  res.redirect('/admin/students');
});

// ---------- TUTORS ----------
router.get('/tutors', async (req, res) => {
  const q = req.query.q || '';
  const status = req.query.status || '';
  let sql = `
    SELECT t.*, u.full_name, u.email, u.phone, u.is_active, u.created_at
    FROM tutors t JOIN users u ON u.id = t.user_id
    WHERE (u.full_name LIKE ? OR u.email LIKE ?)
  `;
  const params = [`%${q}%`, `%${q}%`];
  if (status) { sql += ` AND t.status = ?`; params.push(status); }
  sql += ` ORDER BY u.created_at DESC`;
  const tutors = await db.prepare(sql).all(...params);
  res.render('admin/tutors', { tutors, q, status });
});

router.post('/tutors/:id/approve', async (req, res) => {
  await db.prepare(`UPDATE tutors SET status = 'approved' WHERE id = ?`).run(req.params.id);
  const tutor = await db.prepare('SELECT t.user_id, u.full_name FROM tutors t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(req.params.id);
  if (tutor) {
    await db.prepare('INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)')
      .run(tutor.user_id, 'tutor_approved', 'Congratulations! Your tutor profile has been approved.', '/tutor/dashboard');
    await logActivity('tutor_approved', `Admin approved tutor ${tutor.full_name}.`);
  }
  req.flash('success', 'Tutor approved.');
  res.redirect('/admin/tutors');
});

router.post('/tutors/:id/reject', async (req, res) => {
  await db.prepare(`UPDATE tutors SET status = 'rejected' WHERE id = ?`).run(req.params.id);
  const tutor = await db.prepare('SELECT u.full_name FROM tutors t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(req.params.id);
  if (tutor) await logActivity('tutor_rejected', `Admin rejected tutor ${tutor.full_name}.`);
  req.flash('success', 'Tutor rejected.');
  res.redirect('/admin/tutors');
});

router.get('/tutors/:id/edit', async (req, res) => {
  const tutor = await db.prepare(`SELECT t.*, u.full_name, u.email, u.phone FROM tutors t JOIN users u ON u.id = t.user_id WHERE t.id = ?`).get(req.params.id);
  if (!tutor) { req.flash('error', 'Tutor not found.'); return res.redirect('/admin/tutors'); }
  res.render('admin/tutor-edit', { tutor });
});

router.post('/tutors/:id/edit', async (req, res) => {
  const { full_name, email, phone, qualification, university, department, hourly_rate, experience_years } = req.body;
  const tutor = await db.prepare('SELECT * FROM tutors WHERE id = ?').get(req.params.id);
  if (!tutor) return res.redirect('/admin/tutors');
  await db.prepare('UPDATE users SET full_name=?, email=?, phone=? WHERE id=?').run(full_name, email, phone, tutor.user_id);
  await db.prepare('UPDATE tutors SET qualification=?, university=?, department=?, hourly_rate=?, experience_years=? WHERE id=?')
    .run(qualification, university, department, Number(hourly_rate) || 0, Number(experience_years) || 0, tutor.id);
  req.flash('success', 'Tutor updated.');
  res.redirect('/admin/tutors');
});

router.post('/tutors/:id/toggle-active', async (req, res) => {
  const tutor = await db.prepare('SELECT * FROM tutors WHERE id = ?').get(req.params.id);
  if (!tutor) return res.redirect('/admin/tutors');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(tutor.user_id);
  await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(user.is_active ? 0 : 1, user.id);
  req.flash('success', `Tutor account ${user.is_active ? 'deactivated' : 'activated'}.`);
  res.redirect('/admin/tutors');
});

router.post('/tutors/:id/delete', async (req, res) => {
  const tutor = await db.prepare('SELECT * FROM tutors WHERE id = ?').get(req.params.id);
  if (tutor) await db.prepare('DELETE FROM users WHERE id = ?').run(tutor.user_id);
  req.flash('success', 'Tutor account deleted.');
  res.redirect('/admin/tutors');
});

// ---------- SUBJECTS ----------
router.get('/subjects', async (req, res) => {
  const subjects = await db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM tutor_subjects ts WHERE ts.subject_id = s.id) AS "tutorCount"
    FROM subjects s ORDER BY s.name
  `).all();
  res.render('admin/subjects', { subjects });
});

router.post('/subjects', async (req, res) => {
  const { name, icon, description } = req.body;
  if (!name) { req.flash('error', 'Subject name is required.'); return res.redirect('/admin/subjects'); }
  try {
    await db.prepare('INSERT INTO subjects (name, icon, description) VALUES (?,?,?)').run(name, icon || 'fa-book', description || '');
    req.flash('success', 'Subject added.');
  } catch (e) {
    if (e.code === '23505' || e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      req.flash('error', 'A subject with that name already exists.');
    } else {
      throw e;
    }
  }
  res.redirect('/admin/subjects');
});

router.post('/subjects/:id/edit', async (req, res) => {
  const { name, icon, description } = req.body;
  await db.prepare('UPDATE subjects SET name=?, icon=?, description=? WHERE id=?').run(name, icon, description, req.params.id);
  req.flash('success', 'Subject updated.');
  res.redirect('/admin/subjects');
});

router.post('/subjects/:id/delete', async (req, res) => {
  await db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
  req.flash('success', 'Subject deleted.');
  res.redirect('/admin/subjects');
});

// ---------- BOOKINGS ----------
router.get('/bookings', async (req, res) => {
  const status = req.query.status || '';
  let sql = `
    SELECT b.*, su.full_name AS student_name, tu.full_name AS tutor_name, sub.name AS subject_name
    FROM bookings b
    JOIN students s ON s.id = b.student_id JOIN users su ON su.id = s.user_id
    JOIN tutors t ON t.id = b.tutor_id JOIN users tu ON tu.id = t.user_id
    JOIN subjects sub ON sub.id = b.subject_id
  `;
  const params = [];
  if (status) { sql += ` WHERE b.status = ?`; params.push(status); }
  sql += ` ORDER BY b.created_at DESC`;
  const bookings = await db.prepare(sql).all(...params);
  res.render('admin/bookings', { bookings, status });
});

router.post('/bookings/:id/status', async (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'];
  if (valid.includes(status)) {
    await db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
    req.flash('success', 'Booking status updated.');
  }
  res.redirect('/admin/bookings');
});

// ---------- REVIEWS ----------
router.get('/reviews', async (req, res) => {
  const reviews = await db.prepare(`
    SELECT r.*, su.full_name AS student_name, tu.full_name AS tutor_name
    FROM reviews r
    JOIN students s ON s.id = r.student_id JOIN users su ON su.id = s.user_id
    JOIN tutors t ON t.id = r.tutor_id JOIN users tu ON tu.id = t.user_id
    ORDER BY r.created_at DESC
  `).all();
  res.render('admin/reviews', { reviews });
});

router.post('/reviews/:id/delete', async (req, res) => {
  const review = await db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (review) {
    await db.prepare('DELETE FROM reviews WHERE id = ?').run(review.id);
    const avg = (await db.prepare('SELECT AVG(rating) a FROM reviews WHERE tutor_id = ?').get(review.tutor_id)).a || 0;
    await db.prepare('UPDATE tutors SET average_rating = ? WHERE id = ?').run(Math.round(avg * 10) / 10, review.tutor_id);
  }
  req.flash('success', 'Review deleted.');
  res.redirect('/admin/reviews');
});

// ---------- MESSAGES (moderation overview) ----------
router.get('/messages', async (req, res) => {
  const messages = await db.prepare(`
    SELECT m.*, su.full_name AS sender_name, ru.full_name AS receiver_name
    FROM messages m JOIN users su ON su.id = m.sender_id JOIN users ru ON ru.id = m.receiver_id
    ORDER BY m.created_at DESC LIMIT 100
  `).all();
  res.render('admin/messages', { messages });
});

// ---------- REPORTS ----------
router.get('/reports', async (req, res) => {
  const monthlyBookings = await db.prepare(`
    SELECT SUBSTR(created_at, 1, 7) AS month, COUNT(*) AS count
    FROM bookings GROUP BY month ORDER BY month
  `).all();

  const topTutors = await db.prepare(`
    SELECT u.full_name, t.average_rating, t.total_sessions
    FROM tutors t JOIN users u ON u.id = t.user_id
    WHERE t.status = 'approved' ORDER BY t.average_rating DESC LIMIT 5
  `).all();

  const subjectPopularity = await db.prepare(`
    SELECT s.name, COUNT(b.id) AS count FROM subjects s
    LEFT JOIN bookings b ON b.subject_id = s.id
    GROUP BY s.id ORDER BY count DESC
  `).all();

  res.render('admin/reports', { monthlyBookings, topTutors, subjectPopularity });
});

// ---------- ACTIVITY LOGS ----------
router.get('/activity-logs', async (req, res) => {
  const logs = await db.prepare(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 200`).all();
  res.render('admin/activity-logs', { logs });
});

// ---------- SETTINGS ----------
router.get('/settings', (req, res) => res.render('admin/settings'));

router.post('/settings/profile', async (req, res) => {
  const { full_name } = req.body;
  if (!full_name || !full_name.trim()) {
    req.flash('error', 'Full name cannot be empty.');
    return res.redirect('/admin/settings');
  }
  await db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(full_name.trim(), req.session.user.id);
  req.session.user.full_name = full_name.trim();
  req.flash('success', 'Profile updated successfully.');
  res.redirect('/admin/settings');
});

router.post('/settings/password', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { current_password, new_password, confirm_password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(current_password, user.password)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/admin/settings');
  }
  if (new_password !== confirm_password || new_password.length < 6) {
    req.flash('error', 'New passwords must match and be at least 6 characters.');
    return res.redirect('/admin/settings');
  }
  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  req.flash('success', 'Password updated successfully.');
  res.redirect('/admin/settings');
});

module.exports = router;
