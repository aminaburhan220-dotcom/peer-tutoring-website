const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireRole } = require('../middleware/role');
const { handleAvatarUpload } = require('../middleware/upload');
const { logActivity } = require('../middleware/activity');

router.use(requireRole('student'));

async function getStudent(userId) {
  return await db.prepare('SELECT * FROM students WHERE user_id = ?').get(userId);
}

// ---------- BECOME A PEER TUTOR ----------
// Any student can add a peer tutor profile to their existing account — this
// is the core "students teach students" flow. It does NOT replace or remove
// their student profile; a single account can be a learner and a peer tutor
// (in different subjects) at the same time.
router.post('/become-tutor', async (req, res) => {
  const existingTutor = await db.prepare('SELECT id FROM tutors WHERE user_id = ?').get(req.session.user.id);
  if (existingTutor) {
    req.flash('error', "You're already a peer tutor on this account.");
    return res.redirect('/student/dashboard');
  }

  await db.prepare(`INSERT INTO tutors (user_id, qualification, university, department, bio, teaching_method, experience_years, hourly_rate, status)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(req.session.user.id, '', '', '', '', '', 0, 10, 'pending');

  req.session.user.hasTutorProfile = true;
  await logActivity('became_peer_tutor', `${req.session.user.full_name} became a peer tutor from their student account.`);

  req.flash('success', "You're now a peer tutor! Complete your tutor profile and pick your subjects — an admin will review it before it's visible to other students.");
  res.redirect('/tutor/profile');
});

// ---------- DASHBOARD ----------
router.get('/dashboard', async (req, res) => {
  const student = await getStudent(req.session.user.id);

  const upcoming = await db.prepare(`
    SELECT b.*, u.full_name AS tutor_name, s.name AS subject_name
    FROM bookings b JOIN tutors t ON t.id = b.tutor_id JOIN users u ON u.id = t.user_id
    JOIN subjects s ON s.id = b.subject_id
    WHERE b.student_id = ? AND b.status = 'accepted'
    ORDER BY b.session_date ASC
  `).all(student.id);

  const completedCount = (await db.prepare(`SELECT COUNT(*) c FROM bookings WHERE student_id = ? AND status='completed'`).get(student.id)).c;
  const pendingCount = (await db.prepare(`SELECT COUNT(*) c FROM bookings WHERE student_id = ? AND status='pending'`).get(student.id)).c;

  const favorites = await db.prepare(`
    SELECT t.*, u.full_name, u.avatar FROM favorites f
    JOIN tutors t ON t.id = f.tutor_id JOIN users u ON u.id = t.user_id
    WHERE f.student_id = ? LIMIT 4
  `).all(student.id);

  const recentMessages = await db.prepare(`
    SELECT m.*, u.full_name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
    WHERE m.receiver_id = ? ORDER BY m.created_at DESC LIMIT 5
  `).all(req.session.user.id);

  res.render('student/dashboard', {
    student, upcoming, completedCount, pendingCount, favorites, recentMessages
  });
});

// ---------- PROFILE ----------
router.get('/profile', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  res.render('student/profile', { student, user: req.session.user });
});

router.post('/profile', handleAvatarUpload, async (req, res) => {
  const { full_name, phone, university, department, bio } = req.body;
  await db.prepare('UPDATE users SET full_name = ?, phone = ? WHERE id = ?').run(full_name, phone, req.session.user.id);
  await db.prepare('UPDATE students SET university = ?, department = ?, bio = ? WHERE user_id = ?')
    .run(university, department, bio, req.session.user.id);

  // A custom uploaded photo always overrides the gender-based default avatar.
  if (req.file) {
    const avatarPath = '/uploads/avatars/' + req.file.filename;
    await db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarPath, req.session.user.id);
    req.session.user.avatar = avatarPath;
  }

  req.session.user.full_name = full_name;
  req.flash('success', 'Profile updated successfully.');
  res.redirect('/student/profile');
});

// ---------- FIND TUTORS (redirect to public page which already supports filters) ----------
router.get('/find-tutors', (req, res) => res.redirect('/find-tutors'));

// ---------- BOOKINGS ----------
router.get('/bookings', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  const bookings = await db.prepare(`
    SELECT b.*, u.full_name AS tutor_name, sub.name AS subject_name, t.id AS tutor_table_id
    FROM bookings b JOIN tutors t ON t.id = b.tutor_id JOIN users u ON u.id = t.user_id
    JOIN subjects sub ON sub.id = b.subject_id
    WHERE b.student_id = ?
    ORDER BY b.created_at DESC
  `).all(student.id);
  res.render('student/bookings', { bookings });
});

router.get('/book/:tutorId', async (req, res) => {
  const tutor = await db.prepare(`SELECT t.*, u.full_name FROM tutors t JOIN users u ON u.id = t.user_id WHERE t.id = ? AND t.status='approved'`).get(req.params.tutorId);
  if (!tutor) { req.flash('error', 'Tutor not found.'); return res.redirect('/find-tutors'); }
  const subjects = await db.prepare(`SELECT s.* FROM subjects s JOIN tutor_subjects ts ON ts.subject_id = s.id WHERE ts.tutor_id = ?`).all(tutor.id);
  res.render('student/book', { tutor, subjects });
});

router.post('/book/:tutorId', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  const { subject_id, session_date, start_time, end_time, session_type, message } = req.body;

  if (!subject_id || !session_date || !start_time || !end_time) {
    req.flash('error', 'Please fill in all required booking fields.');
    return res.redirect(`/student/book/${req.params.tutorId}`);
  }

  await db.prepare(`INSERT INTO bookings (student_id, tutor_id, subject_id, session_date, start_time, end_time, session_type, message, status)
    VALUES (?,?,?,?,?,?,?,?, 'pending')`)
    .run(student.id, req.params.tutorId, subject_id, session_date, start_time, end_time, session_type || 'online', message || '');

  const tutor = await db.prepare('SELECT user_id FROM tutors WHERE id = ?').get(req.params.tutorId);
  await db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)`)
    .run(tutor.user_id, 'booking', `New booking request from ${req.session.user.full_name}.`, '/tutor/requests');
  await logActivity('booking_created', `${req.session.user.full_name} requested a session for ${session_date}.`);

  req.flash('success', 'Booking request sent! You will be notified once the tutor responds.');
  res.redirect('/student/bookings');
});

router.post('/bookings/:id/cancel', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  const booking = await db.prepare('SELECT * FROM bookings WHERE id = ? AND student_id = ?').get(req.params.id, student.id);
  if (!booking) { req.flash('error', 'Booking not found.'); return res.redirect('/student/bookings'); }
  await db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(req.params.id);
  req.flash('success', 'Booking cancelled.');
  res.redirect('/student/bookings');
});

// ---------- SESSION HISTORY ----------
router.get('/history', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  const history = await db.prepare(`
    SELECT b.*, u.full_name AS tutor_name, sub.name AS subject_name,
      (SELECT COUNT(*) FROM reviews r WHERE r.booking_id = b.id) AS reviewed
    FROM bookings b JOIN tutors t ON t.id = b.tutor_id JOIN users u ON u.id = t.user_id
    JOIN subjects sub ON sub.id = b.subject_id
    WHERE b.student_id = ? AND b.status = 'completed'
    ORDER BY b.session_date DESC
  `).all(student.id);
  res.render('student/history', { history });
});

// ---------- FAVORITES ----------
router.get('/favorites', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  const favorites = await db.prepare(`
    SELECT t.*, u.full_name, u.avatar FROM favorites f
    JOIN tutors t ON t.id = f.tutor_id JOIN users u ON u.id = t.user_id
    WHERE f.student_id = ?
  `).all(student.id);
  res.render('student/favorites', { favorites });
});

router.post('/favorites/:tutorId/toggle', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  const existing = await db.prepare('SELECT id FROM favorites WHERE student_id = ? AND tutor_id = ?').get(student.id, req.params.tutorId);
  if (existing) {
    await db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
    req.flash('success', 'Removed from favorites.');
  } else {
    await db.prepare('INSERT INTO favorites (student_id, tutor_id) VALUES (?,?)').run(student.id, req.params.tutorId);
    req.flash('success', 'Added to favorites.');
  }
  res.redirect('back');
});

// ---------- REVIEWS ----------
router.get('/reviews', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  const reviews = await db.prepare(`
    SELECT r.*, u.full_name AS tutor_name FROM reviews r
    JOIN tutors t ON t.id = r.tutor_id JOIN users u ON u.id = t.user_id
    WHERE r.student_id = ? ORDER BY r.created_at DESC
  `).all(student.id);

  const reviewable = await db.prepare(`
    SELECT b.*, u.full_name AS tutor_name, sub.name AS subject_name
    FROM bookings b JOIN tutors t ON t.id = b.tutor_id JOIN users u ON u.id = t.user_id
    JOIN subjects sub ON sub.id = b.subject_id
    WHERE b.student_id = ? AND b.status = 'completed'
      AND b.id NOT IN (SELECT booking_id FROM reviews WHERE student_id = ?)
  `).all(student.id, student.id);

  res.render('student/reviews', { reviews, reviewable });
});

router.post('/reviews/:bookingId', async (req, res) => {
  const student = await getStudent(req.session.user.id);
  const { rating, comment } = req.body;
  const booking = await db.prepare(`SELECT * FROM bookings WHERE id = ? AND student_id = ? AND status = 'completed'`).get(req.params.bookingId, student.id);
  if (!booking) { req.flash('error', 'Invalid booking for review.'); return res.redirect('/student/reviews'); }

  await db.prepare('INSERT INTO reviews (booking_id, student_id, tutor_id, rating, comment) VALUES (?,?,?,?,?)')
    .run(booking.id, student.id, booking.tutor_id, Number(rating), comment || '');

  const avg = (await db.prepare('SELECT AVG(rating) a FROM reviews WHERE tutor_id = ?').get(booking.tutor_id)).a;
  await db.prepare('UPDATE tutors SET average_rating = ? WHERE id = ?').run(Math.round(avg * 10) / 10, booking.tutor_id);

  const tutor = await db.prepare('SELECT user_id FROM tutors WHERE id = ?').get(booking.tutor_id);
  await db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)`)
    .run(tutor.user_id, 'review', `${req.session.user.full_name} left you a new review.`, '/tutor/reviews');
  await logActivity('review_submitted', `${req.session.user.full_name} left a ${rating}-star review.`);

  req.flash('success', 'Thanks for your feedback!');
  res.redirect('/student/reviews');
});

// ---------- MESSAGES ----------
router.get('/messages', async (req, res) => {
  const userId = req.session.user.id;
  const conversations = await db.prepare(`
    SELECT u.id AS user_id, u.full_name, u.avatar,
      (SELECT content FROM messages m2 WHERE (m2.sender_id = u.id AND m2.receiver_id = ?) OR (m2.sender_id = ? AND m2.receiver_id = u.id) ORDER BY m2.created_at DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*) FROM messages m3 WHERE m3.sender_id = u.id AND m3.receiver_id = ? AND m3.is_read = 0) AS unread
    FROM users u
    WHERE u.role = 'tutor' AND u.id IN (
      SELECT sender_id FROM messages WHERE receiver_id = ?
      UNION SELECT receiver_id FROM messages WHERE sender_id = ?
    )
    ORDER BY u.full_name
  `).all(userId, userId, userId, userId, userId);
  res.render('student/messages', { conversations, activeConversation: null, thread: [] });
});

router.get('/messages/:userId', async (req, res) => {
  const userId = req.session.user.id;
  const otherId = req.params.userId;

  await db.prepare(`UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?`).run(otherId, userId);

  const conversations = await db.prepare(`
    SELECT u.id AS user_id, u.full_name, u.avatar,
      (SELECT content FROM messages m2 WHERE (m2.sender_id = u.id AND m2.receiver_id = ?) OR (m2.sender_id = ? AND m2.receiver_id = u.id) ORDER BY m2.created_at DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*) FROM messages m3 WHERE m3.sender_id = u.id AND m3.receiver_id = ? AND m3.is_read = 0) AS unread
    FROM users u
    WHERE u.role = 'tutor' AND u.id IN (
      SELECT sender_id FROM messages WHERE receiver_id = ?
      UNION SELECT receiver_id FROM messages WHERE sender_id = ?
    )
    ORDER BY u.full_name
  `).all(userId, userId, userId, userId, userId);

  const activeConversation = await db.prepare('SELECT id, full_name, avatar FROM users WHERE id = ?').get(otherId);
  const thread = await db.prepare(`
    SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
  `).all(userId, otherId, otherId, userId);

  res.render('student/messages', { conversations, activeConversation, thread });
});

router.post('/messages/:userId', async (req, res) => {
  const userId = req.session.user.id;
  const otherId = req.params.userId;
  const { content } = req.body;
  if (content && content.trim()) {
    await db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)').run(userId, otherId, content.trim());
    await db.prepare('INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)')
      .run(otherId, 'message', `New message from ${req.session.user.full_name}.`, '/tutor/messages');
  }
  res.redirect(`/student/messages/${otherId}`);
});

// ---------- NOTIFICATIONS ----------
router.get('/notifications', async (req, res) => {
  const notifications = await db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.user.id);
  res.render('student/notifications', { notifications });
});

// ---------- SETTINGS ----------
router.get('/settings', (req, res) => res.render('student/settings'));

router.post('/settings/password', async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { current_password, new_password, confirm_password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(current_password, user.password)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/student/settings');
  }
  if (new_password !== confirm_password || new_password.length < 6) {
    req.flash('error', 'New passwords must match and be at least 6 characters.');
    return res.redirect('/student/settings');
  }
  await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  req.flash('success', 'Password updated successfully.');
  res.redirect('/student/settings');
});

module.exports = router;
