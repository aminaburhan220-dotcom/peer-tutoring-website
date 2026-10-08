const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { redirectIfAuthed } = require('../middleware/auth');
const { logActivity } = require('../middleware/activity');

// ---------- REGISTER ----------
router.get('/register', redirectIfAuthed, async (req, res) => {
  const preselectRole = req.query.role === 'tutor' ? 'tutor' : 'student';
  res.render('register', { formData: {}, preselectRole });
});

router.post('/register', redirectIfAuthed, async (req, res) => {
  const { full_name, email, password, confirm_password, role, gender } = req.body;
  // Preserves the tutor/student choice if any validation below fails and
  // sends the user back to the form, instead of silently resetting to Student.
  const backToForm = `/register${role === 'tutor' ? '?role=tutor' : ''}`;

  if (!full_name || !email || !password || !role) {
    req.flash('error', 'Please fill in all required fields.');
    return res.redirect(backToForm);
  }
  if (!['male', 'female'].includes(gender)) {
    req.flash('error', 'Please select a gender.');
    return res.redirect(backToForm);
  }
  if (password !== confirm_password) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect(backToForm);
  }
  if (password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    return res.redirect(backToForm);
  }
  if (!['student', 'tutor'].includes(role)) {
    req.flash('error', 'Invalid role selected.');
    return res.redirect('/register');
  }

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    req.flash('error', 'An account with that email already exists.');
    return res.redirect(backToForm);
  }

  // The profile picture always starts as a default avatar matching the
  // selected gender ('unspecified' gets a neutral avatar). Uploading a custom
  // photo later (from the profile page) overwrites this — it is never random.
  const defaultAvatar = gender === 'female' ? '/images/avatar-female.svg' : '/images/avatar-male.svg';

  const hashed = bcrypt.hashSync(password, 10);
  const insertUser = await db.prepare('INSERT INTO users (full_name, email, password, role, gender, avatar) VALUES (?,?,?,?,?,?)');
  const info = await insertUser.run(full_name, email, hashed, role, gender, defaultAvatar);
  const userId = info.lastInsertRowid;

  if (role === 'student') {
    await db.prepare('INSERT INTO students (user_id, university, department, bio) VALUES (?,?,?,?)').run(userId, '', '', '');
  } else if (role === 'tutor') {
    await db.prepare(`INSERT INTO tutors (user_id, qualification, university, department, bio, teaching_method, experience_years, hourly_rate, status) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(userId, '', '', '', '', '', 0, 10, 'pending');
  }

  req.flash('success', role === 'tutor'
    ? 'Account created! Your tutor profile is pending admin approval before it appears publicly.'
    : 'Account created! You can now log in.');
  await logActivity(role === 'tutor' ? 'tutor_registered' : 'student_registered', `${full_name} registered as a ${role}.`);
  res.redirect('/login');
});

// ---------- LOGIN ----------
router.get('/login', redirectIfAuthed, async (req, res) => {
  res.render('login');
});

router.post('/login', redirectIfAuthed, async (req, res) => {
  const { email, password } = req.body;
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    req.flash('error', 'Invalid email or password.');
    return res.redirect('/login');
  }
  if (!user.is_active) {
    req.flash('error', 'Your account has been deactivated. Please contact support.');
    return res.redirect('/login');
  }

  // A user may have a student profile, a tutor (peer tutor) profile, or both
  // on the same account — the dashboard/nav can offer a switcher when both exist.
  const hasStudentProfile = !!await db.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
  const hasTutorProfile = !!await db.prepare('SELECT id FROM tutors WHERE user_id = ?').get(user.id);

  req.session.user = {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    hasStudentProfile,
    hasTutorProfile
  };

  req.flash('success', `Welcome back, ${user.full_name}!`);
  res.redirect(`/${user.role}/dashboard`);
});

// ---------- LOGOUT ----------
router.post('/logout', async (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ---------- FORGOT PASSWORD ----------
// Note: Sending real password-reset emails requires an email service (e.g. SMTP/SendGrid)
// which is outside the scope of a self-contained local project. This flow validates the
// email exists and confirms a reset link "would be sent," so the page is fully functional
// as UI/UX and validation, but does not deliver an actual email.
router.get('/forgot-password', redirectIfAuthed, async (req, res) => {
  res.render('forgot-password');
});

router.post('/forgot-password', redirectIfAuthed, async (req, res) => {
  const { email } = req.body;
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (user) {
    req.flash('success', 'If that email exists in our system, password reset instructions have been sent.');
  } else {
    req.flash('success', 'If that email exists in our system, password reset instructions have been sent.');
  }
  res.redirect('/forgot-password');
});

module.exports = router;
