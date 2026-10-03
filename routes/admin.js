const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireRole } = require('../middleware/role');
const { logActivity } = require('../middleware/activity');

router.use(requireRole('admin'));

// ---------- DASHBOARD ----------
router.get('/dashboard', (req, res) => {
  const stats = {
    totalStudents: db.prepare(`SELECT COUNT(*) c FROM students`).get().c,
    totalTutors: db.prepare(`SELECT COUNT(*) c FROM tutors`).get().c,
    pendingTutors: db.prepare(`SELECT COUNT(*) c FROM tutors WHERE status='pending'`).get().c,
    totalSubjects: db.prepare(`SELECT COUNT(*) c FROM subjects`).get().c,
    totalBookings: db.prepare(`SELECT COUNT(*) c FROM bookings`).get().c,
    pendingBookings: db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status='pending'`).get().c,
    completedSessions: db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status='completed'`).get().c,
    totalReviews: db.prepare(`SELECT COUNT(*) c FROM reviews`).get().c,
    // Revenue is an estimate: each completed booking counts at the tutor's
    // current hourly rate (same method used on the tutor Earnings page).
    totalRevenue: db.prepare(`
      SELECT COALESCE(SUM(t.hourly_rate), 0) AS total
      FROM bookings b JOIN tutors t ON t.id = b.tutor_id
      WHERE b.status = 'completed'
    `).get().total
  };

  const bySubject = db.prepare(`
    SELECT s.name, COUNT(b.id) AS count FROM subjects s
    LEFT JOIN bookings b ON b.subject_id = s.id
    GROUP BY s.id ORDER BY count DESC
  `).all();

  const byStatus = db.prepare(`SELECT status, COUNT(*) AS count FROM bookings GROUP BY status`).all();

  const recentBookings = db.prepare(`
    SELECT b.*, su.full_name AS student_name, tu.full_name AS tutor_name, sub.name AS subject_name
    FROM bookings b
    JOIN students s ON s.id = b.student_id JOIN users su ON su.id = s.user_id
    JOIN tutors t ON t.id = b.tutor_id JOIN users tu ON tu.id = t.user_id
    JOIN subjects sub ON sub.id = b.subject_id
    ORDER BY b.created_at DESC LIMIT 5
  `).all();

  const recentActivity = db.prepare(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 8`).all();

  res.render('admin/dashboard', { stats, bySubject, byStatus, recentBookings, recentActivity });
});

// ---------- STUDENTS ----------
router.get('/students', (req, res) => {
  const q = req.query.q || '';
  const students = db.prepare(`
    SELECT s.*, u.full_name, u.email, u.phone, u.is_active, u.created_at
    FROM students s JOIN users u ON u.id = s.user_id
    WHERE u.full_name LIKE ? OR u.email LIKE ?
    ORDER BY u.created_at DESC
  `).all(`%${q}%`, `%${q}%`);
  res.render('admin/students', { students, q });
});

router.get('/students/:id/edit', (req, res) => {
  const student = db.prepare(`SELECT s.*, u.full_name, u.email, u.phone FROM students s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(req.params.id);
  if (!student) { req.flash('error', 'Student not found.'); return res.redirect('/admin/students'); }
  res.render('admin/student-edit', { student });
});

router.post('/students/:id/edit', (req, res) => {
  const { full_name, email, phone, university, department, bio } = req.body;
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.redirect('/admin/students');
  db.prepare('UPDATE users SET full_name=?, email=?, phone=? WHERE id=?').run(full_name, email, phone, student.user_id);
  db.prepare('UPDATE students SET university=?, department=?, bio=? WHERE id=?').run(university, department, bio, student.id);
  req.flash('success', 'Student updated.');
  res.redirect('/admin/students');
});

router.post('/students/:id/toggle-active', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.redirect('/admin/students');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(student.user_id);
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(user.is_active ? 0 : 1, user.id);
  req.flash('success', `Student account ${user.is_active ? 'deactivated' : 'activated'}.`);
  res.redirect('/admin/students');
});

router.post('/students/:id/delete', (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (student) db.prepare('DELETE FROM users WHERE id = ?').run(student.user_id); // cascades
  req.flash('success', 'Student account deleted.');
  res.redirect('/admin/students');
});

// ---------- TUTORS ----------
router.get('/tutors', (req, res) => {
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
  const tutors = db.prepare(sql).all(...params);
  res.render('admin/tutors', { tutors, q, status });
});

router.post('/tutors/:id/approve', (req, res) => {
  db.prepare(`UPDATE tutors SET status = 'approved' WHERE id = ?`).run(req.params.id);
  const tutor = db.prepare('SELECT t.user_id, u.full_name FROM tutors t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(req.params.id);
  if (tutor) {
    db.prepare('INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)')
      .run(tutor.user_id, 'tutor_approved', 'Congratulations! Your tutor profile has been approved.', '/tutor/dashboard');
    logActivity('tutor_approved', `Admin approved tutor ${tutor.full_name}.`);
  }
  req.flash('success', 'Tutor approved.');
  res.redirect('/admin/tutors');
});

router.post('/tutors/:id/reject', (req, res) => {
  db.prepare(`UPDATE tutors SET status = 'rejected' WHERE id = ?`).run(req.params.id);
  const tutor = db.prepare('SELECT u.full_name FROM tutors t JOIN users u ON u.id = t.user_id WHERE t.id = ?').get(req.params.id);
  if (tutor) logActivity('tutor_rejected', `Admin rejected tutor ${tutor.full_name}.`);
  req.flash('success', 'Tutor rejected.');
  res.redirect('/admin/tutors');
});

router.get('/tutors/:id/edit', (req, res) => {
  const tutor = db.prepare(`SELECT t.*, u.full_name, u.email, u.phone FROM tutors t JOIN users u ON u.id = t.user_id WHERE t.id = ?`).get(req.params.id);
  if (!tutor) { req.flash('error', 'Tutor not found.'); return res.redirect('/admin/tutors'); }
  res.render('admin/tutor-edit', { tutor });
});

router.post('/tutors/:id/edit', (req, res) => {
  const { full_name, email, phone, qualification, university, department, hourly_rate, experience_years } = req.body;
  const tutor = db.prepare('SELECT * FROM tutors WHERE id = ?').get(req.params.id);
  if (!tutor) return res.redirect('/admin/tutors');
  db.prepare('UPDATE users SET full_name=?, email=?, phone=? WHERE id=?').run(full_name, email, phone, tutor.user_id);
  db.prepare('UPDATE tutors SET qualification=?, university=?, department=?, hourly_rate=?, experience_years=? WHERE id=?')
    .run(qualification, university, department, Number(hourly_rate) || 0, Number(experience_years) || 0, tutor.id);
  req.flash('success', 'Tutor updated.');
  res.redirect('/admin/tutors');
});

router.post('/tutors/:id/toggle-active', (req, res) => {
  const tutor = db.prepare('SELECT * FROM tutors WHERE id = ?').get(req.params.id);
  if (!tutor) return res.redirect('/admin/tutors');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tutor.user_id);
  db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(user.is_active ? 0 : 1, user.id);
  req.flash('success', `Tutor account ${user.is_active ? 'deactivated' : 'activated'}.`);
  res.redirect('/admin/tutors');
});

router.post('/tutors/:id/delete', (req, res) => {
  const tutor = db.prepare('SELECT * FROM tutors WHERE id = ?').get(req.params.id);
  if (tutor) db.prepare('DELETE FROM users WHERE id = ?').run(tutor.user_id);
  req.flash('success', 'Tutor account deleted.');
  res.redirect('/admin/tutors');
});

// ---------- SUBJECTS ----------
router.get('/subjects', (req, res) => {
  const subjects = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM tutor_subjects ts WHERE ts.subject_id = s.id) AS tutorCount
    FROM subjects s ORDER BY s.name
  `).all();
  res.render('admin/subjects', { subjects });
});

router.post('/subjects', (req, res) => {
  const { name, icon, description } = req.body;
  if (!name) { req.flash('error', 'Subject name is required.'); return res.redirect('/admin/subjects'); }
  try {
    db.prepare('INSERT INTO subjects (name, icon, description) VALUES (?,?,?)').run(name, icon || 'fa-book', description || '');
    req.flash('success', 'Subject added.');
  } catch (e) {
    req.flash('error', 'A subject with that name already exists.');
  }
  res.redirect('/admin/subjects');
});

router.post('/subjects/:id/edit', (req, res) => {
  const { name, icon, description } = req.body;
  db.prepare('UPDATE subjects SET name=?, icon=?, description=? WHERE id=?').run(name, icon, description, req.params.id);
  req.flash('success', 'Subject updated.');
  res.redirect('/admin/subjects');
});

router.post('/subjects/:id/delete', (req, res) => {
  db.prepare('DELETE FROM subjects WHERE id = ?').run(req.params.id);
  req.flash('success', 'Subject deleted.');
  res.redirect('/admin/subjects');
});

// ---------- BOOKINGS ----------
router.get('/bookings', (req, res) => {
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
  const bookings = db.prepare(sql).all(...params);
  res.render('admin/bookings', { bookings, status });
});

router.post('/bookings/:id/status', (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'];
  if (valid.includes(status)) {
    db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
    req.flash('success', 'Booking status updated.');
  }
  res.redirect('/admin/bookings');
});

// ---------- REVIEWS ----------
router.get('/reviews', (req, res) => {
  const reviews = db.prepare(`
    SELECT r.*, su.full_name AS student_name, tu.full_name AS tutor_name
    FROM reviews r
    JOIN students s ON s.id = r.student_id JOIN users su ON su.id = s.user_id
    JOIN tutors t ON t.id = r.tutor_id JOIN users tu ON tu.id = t.user_id
    ORDER BY r.created_at DESC
  `).all();
  res.render('admin/reviews', { reviews });
});

router.post('/reviews/:id/delete', (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (review) {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(review.id);
    const avg = db.prepare('SELECT AVG(rating) a FROM reviews WHERE tutor_id = ?').get(review.tutor_id).a || 0;
    db.prepare('UPDATE tutors SET average_rating = ? WHERE id = ?').run(Math.round(avg * 10) / 10, review.tutor_id);
  }
  req.flash('success', 'Review deleted.');
  res.redirect('/admin/reviews');
});

// ---------- MESSAGES (moderation overview) ----------
router.get('/messages', (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, su.full_name AS sender_name, ru.full_name AS receiver_name
    FROM messages m JOIN users su ON su.id = m.sender_id JOIN users ru ON ru.id = m.receiver_id
    ORDER BY m.created_at DESC LIMIT 100
  `).all();
  res.render('admin/messages', { messages });
});

// ---------- REPORTS ----------
router.get('/reports', (req, res) => {
  const monthlyBookings = db.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
    FROM bookings GROUP BY month ORDER BY month
  `).all();

  const topTutors = db.prepare(`
    SELECT u.full_name, t.average_rating, t.total_sessions
    FROM tutors t JOIN users u ON u.id = t.user_id
    WHERE t.status = 'approved' ORDER BY t.average_rating DESC LIMIT 5
  `).all();

  const subjectPopularity = db.prepare(`
    SELECT s.name, COUNT(b.id) AS count FROM subjects s
    LEFT JOIN bookings b ON b.subject_id = s.id
    GROUP BY s.id ORDER BY count DESC
  `).all();

  res.render('admin/reports', { monthlyBookings, topTutors, subjectPopularity });
});

// ---------- ACTIVITY LOGS ----------
router.get('/activity-logs', (req, res) => {
  const logs = db.prepare(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 200`).all();
  res.render('admin/activity-logs', { logs });
});

// ---------- SETTINGS ----------
router.get('/settings', (req, res) => res.render('admin/settings'));

router.post('/settings/profile', (req, res) => {
  const { full_name } = req.body;
  if (!full_name || !full_name.trim()) {
    req.flash('error', 'Full name cannot be empty.');
    return res.redirect('/admin/settings');
  }
  db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(full_name.trim(), req.session.user.id);
  req.session.user.full_name = full_name.trim();
  req.flash('success', 'Profile updated successfully.');
  res.redirect('/admin/settings');
});

router.post('/settings/password', (req, res) => {
  const bcrypt = require('bcryptjs');
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(current_password, user.password)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/admin/settings');
  }
  if (new_password !== confirm_password || new_password.length < 6) {
    req.flash('error', 'New passwords must match and be at least 6 characters.');
    return res.redirect('/admin/settings');
  }
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  req.flash('success', 'Password updated successfully.');
  res.redirect('/admin/settings');
});

module.exports = router;
