const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireRole } = require('../middleware/role');
const { handleAvatarUpload } = require('../middleware/upload');
const { logActivity } = require('../middleware/activity');

router.use(requireRole('tutor'));

function getTutor(userId) {
  return db.prepare('SELECT * FROM tutors WHERE user_id = ?').get(userId);
}

// ---------- ALSO REGISTER AS A LEARNER ----------
// Symmetric to /student/become-tutor: a peer tutor account can also add a
// student (learner) profile, so they can book sessions with other peer
// tutors in subjects outside their own expertise.
router.post('/become-student', (req, res) => {
  const existingStudent = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.session.user.id);
  if (existingStudent) {
    req.flash('error', "You already have a student profile on this account.");
    return res.redirect('/tutor/dashboard');
  }

  db.prepare('INSERT INTO students (user_id, university, department, bio) VALUES (?,?,?,?)')
    .run(req.session.user.id, '', '', '');

  req.session.user.hasStudentProfile = true;
  logActivity('became_learner', `${req.session.user.full_name} added a student profile from their tutor account.`);

  req.flash('success', "You can now also book sessions as a learner! Complete your student profile anytime.");
  res.redirect('/student/profile');
});

// ---------- DASHBOARD ----------
router.get('/dashboard', (req, res) => {
  const tutor = getTutor(req.session.user.id);

  const totalStudents = db.prepare(`SELECT COUNT(DISTINCT student_id) c FROM bookings WHERE tutor_id = ?`).get(tutor.id).c;
  const upcoming = db.prepare(`
    SELECT b.*, u.full_name AS student_name, s.name AS subject_name
    FROM bookings b JOIN students st ON st.id = b.student_id JOIN users u ON u.id = st.user_id
    JOIN subjects s ON s.id = b.subject_id
    WHERE b.tutor_id = ? AND b.status = 'accepted' ORDER BY b.session_date ASC
  `).all(tutor.id);
  const completedCount = db.prepare(`SELECT COUNT(*) c FROM bookings WHERE tutor_id = ? AND status='completed'`).get(tutor.id).c;

  res.render('tutor/dashboard', { tutor, totalStudents, upcoming, completedCount });
});

// ---------- PROFILE ----------
router.get('/profile', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  res.render('tutor/profile', { tutor, user: req.session.user });
});

router.post('/profile', handleAvatarUpload, (req, res) => {
  const { full_name, phone, qualification, university, department, bio, teaching_method, experience_years, hourly_rate, delivery_mode } = req.body;
  db.prepare('UPDATE users SET full_name = ?, phone = ? WHERE id = ?').run(full_name, phone, req.session.user.id);
  db.prepare(`UPDATE tutors SET qualification=?, university=?, department=?, bio=?, teaching_method=?, experience_years=?, hourly_rate=?, delivery_mode=? WHERE user_id = ?`)
    .run(qualification, university, department, bio, teaching_method, Number(experience_years) || 0, Number(hourly_rate) || 0,
      ['online', 'in-person', 'both'].includes(delivery_mode) ? delivery_mode : 'online', req.session.user.id);

  // A custom uploaded photo always overrides the gender-based default avatar.
  if (req.file) {
    const avatarPath = '/uploads/avatars/' + req.file.filename;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarPath, req.session.user.id);
    req.session.user.avatar = avatarPath;
  }

  req.session.user.full_name = full_name;
  req.flash('success', 'Profile updated successfully.');
  res.redirect('/tutor/profile');
});

// ---------- SUBJECTS ----------
router.get('/subjects', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const allSubjects = db.prepare('SELECT * FROM subjects ORDER BY name').all();
  const mySubjectIds = db.prepare('SELECT subject_id FROM tutor_subjects WHERE tutor_id = ?').all(tutor.id).map(r => r.subject_id);
  res.render('tutor/subjects', { allSubjects, mySubjectIds });
});

router.post('/subjects', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  let selected = req.body.subject_ids || [];
  if (!Array.isArray(selected)) selected = [selected];

  db.prepare('DELETE FROM tutor_subjects WHERE tutor_id = ?').run(tutor.id);
  const insert = db.prepare('INSERT INTO tutor_subjects (tutor_id, subject_id) VALUES (?,?)');
  selected.forEach(id => insert.run(tutor.id, id));

  req.flash('success', 'Subjects updated.');
  res.redirect('/tutor/subjects');
});

// ---------- AVAILABILITY ----------
router.get('/availability', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const slots = db.prepare('SELECT * FROM availability WHERE tutor_id = ? ORDER BY id').all(tutor.id);
  res.render('tutor/availability', { slots });
});

router.post('/availability', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const { day_of_week, start_time, end_time } = req.body;
  if (day_of_week && start_time && end_time) {
    db.prepare('INSERT INTO availability (tutor_id, day_of_week, start_time, end_time) VALUES (?,?,?,?)').run(tutor.id, day_of_week, start_time, end_time);
    req.flash('success', 'Availability slot added.');
  }
  res.redirect('/tutor/availability');
});

router.post('/availability/:id/delete', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  db.prepare('DELETE FROM availability WHERE id = ? AND tutor_id = ?').run(req.params.id, tutor.id);
  req.flash('success', 'Availability slot removed.');
  res.redirect('/tutor/availability');
});

// ---------- BOOKING REQUESTS ----------
router.get('/requests', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const requests = db.prepare(`
    SELECT b.*, u.full_name AS student_name, u.avatar AS student_avatar, sub.name AS subject_name
    FROM bookings b JOIN students st ON st.id = b.student_id JOIN users u ON u.id = st.user_id
    JOIN subjects sub ON sub.id = b.subject_id
    WHERE b.tutor_id = ? AND b.status = 'pending' ORDER BY b.created_at DESC
  `).all(tutor.id);
  res.render('tutor/requests', { requests });
});

router.post('/requests/:id/accept', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND tutor_id = ?').get(req.params.id, tutor.id);
  if (!booking) return res.redirect('/tutor/requests');

  db.prepare(`UPDATE bookings SET status = 'accepted' WHERE id = ?`).run(booking.id);
  const student = db.prepare('SELECT user_id FROM students WHERE id = ?').get(booking.student_id);
  db.prepare('INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)')
    .run(student.user_id, 'booking_accepted', `${req.session.user.full_name} accepted your booking request.`, '/student/bookings');
  logActivity('booking_accepted', `${req.session.user.full_name} accepted a booking request.`);

  req.flash('success', 'Booking accepted.');
  res.redirect('/tutor/requests');
});

router.post('/requests/:id/reject', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND tutor_id = ?').get(req.params.id, tutor.id);
  if (!booking) return res.redirect('/tutor/requests');

  db.prepare(`UPDATE bookings SET status = 'rejected' WHERE id = ?`).run(booking.id);
  const student = db.prepare('SELECT user_id FROM students WHERE id = ?').get(booking.student_id);
  db.prepare('INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)')
    .run(student.user_id, 'booking_rejected', `${req.session.user.full_name} declined your booking request.`, '/student/bookings');
  logActivity('booking_rejected', `${req.session.user.full_name} rejected a booking request.`);

  req.flash('success', 'Booking rejected.');
  res.redirect('/tutor/requests');
});

// ---------- SESSIONS ----------
router.get('/sessions', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const sessions = db.prepare(`
    SELECT b.*, u.full_name AS student_name, u.avatar AS student_avatar, sub.name AS subject_name
    FROM bookings b JOIN students st ON st.id = b.student_id JOIN users u ON u.id = st.user_id
    JOIN subjects sub ON sub.id = b.subject_id
    WHERE b.tutor_id = ? AND b.status IN ('accepted','completed') ORDER BY b.session_date DESC
  `).all(tutor.id);
  res.render('tutor/sessions', { sessions });
});

router.post('/sessions/:id/complete', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ? AND tutor_id = ? AND status='accepted'`).get(req.params.id, tutor.id);
  if (!booking) return res.redirect('/tutor/sessions');

  db.prepare(`UPDATE bookings SET status = 'completed' WHERE id = ?`).run(booking.id);
  db.prepare('UPDATE tutors SET total_sessions = total_sessions + 1 WHERE id = ?').run(tutor.id);

  const student = db.prepare('SELECT user_id FROM students WHERE id = ?').get(booking.student_id);
  db.prepare('INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)')
    .run(student.user_id, 'session_completed', `Your session with ${req.session.user.full_name} was marked complete. Leave a review!`, '/student/reviews');
  logActivity('session_completed', `${req.session.user.full_name} marked a session as completed.`);

  req.flash('success', 'Session marked as completed.');
  res.redirect('/tutor/sessions');
});

// ---------- REVIEWS ----------
router.get('/reviews', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const reviews = db.prepare(`
    SELECT r.*, u.full_name AS student_name, u.avatar AS student_avatar
    FROM reviews r JOIN students s ON s.id = r.student_id JOIN users u ON u.id = s.user_id
    WHERE r.tutor_id = ? ORDER BY r.created_at DESC
  `).all(tutor.id);
  res.render('tutor/reviews', { reviews, tutor });
});

// ---------- EARNINGS ----------
router.get('/earnings', (req, res) => {
  const tutor = getTutor(req.session.user.id);
  const completedSessions = db.prepare(`
    SELECT b.*, u.full_name AS student_name, sub.name AS subject_name
    FROM bookings b JOIN students st ON st.id = b.student_id JOIN users u ON u.id = st.user_id
    JOIN subjects sub ON sub.id = b.subject_id
    WHERE b.tutor_id = ? AND b.status = 'completed' ORDER BY b.session_date DESC
  `).all(tutor.id);

  const totalEarnings = completedSessions.length * tutor.hourly_rate;

  res.render('tutor/earnings', { completedSessions, totalEarnings, tutor });
});

// ---------- MESSAGES ----------
router.get('/messages', (req, res) => {
  const userId = req.session.user.id;
  const conversations = db.prepare(`
    SELECT u.id AS user_id, u.full_name, u.avatar,
      (SELECT content FROM messages m2 WHERE (m2.sender_id = u.id AND m2.receiver_id = ?) OR (m2.sender_id = ? AND m2.receiver_id = u.id) ORDER BY m2.created_at DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*) FROM messages m3 WHERE m3.sender_id = u.id AND m3.receiver_id = ? AND m3.is_read = 0) AS unread
    FROM users u
    WHERE u.role = 'student' AND u.id IN (
      SELECT sender_id FROM messages WHERE receiver_id = ?
      UNION SELECT receiver_id FROM messages WHERE sender_id = ?
    )
    ORDER BY u.full_name
  `).all(userId, userId, userId, userId, userId);
  res.render('tutor/messages', { conversations, activeConversation: null, thread: [] });
});

router.get('/messages/:userId', (req, res) => {
  const userId = req.session.user.id;
  const otherId = req.params.userId;
  db.prepare(`UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?`).run(otherId, userId);

  const conversations = db.prepare(`
    SELECT u.id AS user_id, u.full_name, u.avatar,
      (SELECT content FROM messages m2 WHERE (m2.sender_id = u.id AND m2.receiver_id = ?) OR (m2.sender_id = ? AND m2.receiver_id = u.id) ORDER BY m2.created_at DESC LIMIT 1) AS last_message,
      (SELECT COUNT(*) FROM messages m3 WHERE m3.sender_id = u.id AND m3.receiver_id = ? AND m3.is_read = 0) AS unread
    FROM users u
    WHERE u.role = 'student' AND u.id IN (
      SELECT sender_id FROM messages WHERE receiver_id = ?
      UNION SELECT receiver_id FROM messages WHERE sender_id = ?
    )
    ORDER BY u.full_name
  `).all(userId, userId, userId, userId, userId);

  const activeConversation = db.prepare('SELECT id, full_name, avatar FROM users WHERE id = ?').get(otherId);
  const thread = db.prepare(`
    SELECT * FROM messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
  `).all(userId, otherId, otherId, userId);

  res.render('tutor/messages', { conversations, activeConversation, thread });
});

router.post('/messages/:userId', (req, res) => {
  const userId = req.session.user.id;
  const otherId = req.params.userId;
  const { content } = req.body;
  if (content && content.trim()) {
    db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?,?,?)').run(userId, otherId, content.trim());
    db.prepare('INSERT INTO notifications (user_id, type, content, link) VALUES (?,?,?,?)')
      .run(otherId, 'message', `New message from ${req.session.user.full_name}.`, '/student/messages');
  }
  res.redirect(`/tutor/messages/${otherId}`);
});

// ---------- NOTIFICATIONS ----------
router.get('/notifications', (req, res) => {
  const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.session.user.id);
  res.render('tutor/notifications', { notifications });
});

// ---------- SETTINGS ----------
router.get('/settings', (req, res) => res.render('tutor/settings'));

router.post('/settings/password', (req, res) => {
  const bcrypt = require('bcryptjs');
  const { current_password, new_password, confirm_password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(current_password, user.password)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/tutor/settings');
  }
  if (new_password !== confirm_password || new_password.length < 6) {
    req.flash('error', 'New passwords must match and be at least 6 characters.');
    return res.redirect('/tutor/settings');
  }
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), user.id);
  req.flash('success', 'Password updated successfully.');
  res.redirect('/tutor/settings');
});

module.exports = router;
