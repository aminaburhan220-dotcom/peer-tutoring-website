const express = require('express');
const router = express.Router();
const db = require('../database/db');

// ---------- HOME ----------
router.get('/', (req, res) => {
  const subjects = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM tutor_subjects ts JOIN tutors t ON t.id = ts.tutor_id WHERE ts.subject_id = s.id AND t.status='approved') AS tutorCount
    FROM subjects s ORDER BY s.id LIMIT 6
  `).all();

  const featuredTutors = db.prepare(`
    SELECT t.*, u.full_name, u.avatar
    FROM tutors t JOIN users u ON u.id = t.user_id
    WHERE t.status = 'approved'
    ORDER BY t.average_rating DESC LIMIT 4
  `).all();

  const stats = {
    students: db.prepare(`SELECT COUNT(*) c FROM students`).get().c,
    tutors: db.prepare(`SELECT COUNT(*) c FROM tutors WHERE status='approved'`).get().c,
    subjects: db.prepare(`SELECT COUNT(*) c FROM subjects`).get().c,
    sessions: db.prepare(`SELECT COUNT(*) c FROM bookings WHERE status='completed'`).get().c
  };

  const testimonials = db.prepare(`
    SELECT r.*, su.full_name AS student_name, su.avatar AS student_avatar, tu.full_name AS tutor_name
    FROM reviews r
    JOIN students s ON s.id = r.student_id JOIN users su ON su.id = s.user_id
    JOIN tutors t ON t.id = r.tutor_id JOIN users tu ON tu.id = t.user_id
    ORDER BY r.created_at DESC LIMIT 3
  `).all();

  res.render('home', { subjects, featuredTutors, stats, testimonials });
});

router.get('/about', (req, res) => res.render('about'));
router.get('/how-it-works', (req, res) => res.render('how-it-works'));
router.get('/contact', (req, res) => res.render('contact'));
router.get('/faq', (req, res) => res.render('faq'));

router.post('/contact', (req, res) => {
  // In a full implementation this would email the team or store the message.
  req.flash('success', 'Thanks for reaching out! We will get back to you within 1-2 business days.');
  res.redirect('/contact');
});

// ---------- SUBJECTS ----------
router.get('/subjects', (req, res) => {
  const subjects = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM tutor_subjects ts JOIN tutors t ON t.id = ts.tutor_id WHERE ts.subject_id = s.id AND t.status='approved') AS tutorCount
    FROM subjects s ORDER BY s.name
  `).all();
  res.render('subjects', { subjects });
});

// ---------- FIND TUTORS ----------
router.get('/find-tutors', (req, res) => {
  const { q, subject, rating, experience, department, availability, sort } = req.query;

  let sql = `
    SELECT t.*, u.full_name, u.avatar,
      GROUP_CONCAT(s.name) AS subjectNames
    FROM tutors t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN tutor_subjects ts ON ts.tutor_id = t.id
    LEFT JOIN subjects s ON s.id = ts.subject_id
    WHERE t.status = 'approved'
  `;
  const params = [];

  if (q) {
    sql += ` AND u.full_name LIKE ?`;
    params.push(`%${q}%`);
  }
  if (rating) {
    sql += ` AND t.average_rating >= ?`;
    params.push(Number(rating));
  }
  if (experience) {
    sql += ` AND t.experience_years >= ?`;
    params.push(Number(experience));
  }
  if (department) {
    sql += ` AND t.department LIKE ?`;
    params.push(`%${department}%`);
  }
  if (availability === 'online') {
    sql += ` AND t.delivery_mode IN ('online','both')`;
  } else if (availability === 'in-person') {
    sql += ` AND t.delivery_mode IN ('in-person','both')`;
  }

  sql += ` GROUP BY t.id`;

  if (subject) {
    sql += ` HAVING subjectNames LIKE ?`;
    params.push(`%${subject}%`);
  }

  if (sort === 'price_low') sql += ` ORDER BY t.hourly_rate ASC`;
  else if (sort === 'price_high') sql += ` ORDER BY t.hourly_rate DESC`;
  else sql += ` ORDER BY t.average_rating DESC`;

  const tutors = db.prepare(sql).all(...params);
  const subjects = db.prepare(`SELECT * FROM subjects ORDER BY name`).all();
  const totalApprovedTutors = db.prepare(`SELECT COUNT(*) c FROM tutors WHERE status = 'approved'`).get().c;

  res.render('find-tutors', { tutors, subjects, query: req.query, totalApprovedTutors });
});

// ---------- TUTOR PROFILE ----------
router.get('/tutors/:id', (req, res) => {
  const tutor = db.prepare(`
    SELECT t.*, u.full_name, u.avatar, u.email
    FROM tutors t JOIN users u ON u.id = t.user_id
    WHERE t.id = ? AND t.status = 'approved'
  `).get(req.params.id);

  if (!tutor) return res.status(404).render('404');

  const subjects = db.prepare(`
    SELECT s.* FROM subjects s
    JOIN tutor_subjects ts ON ts.subject_id = s.id
    WHERE ts.tutor_id = ?
  `).all(tutor.id);

  const reviews = db.prepare(`
    SELECT r.*, u.full_name AS student_name, u.avatar AS student_avatar
    FROM reviews r
    JOIN students s ON s.id = r.student_id
    JOIN users u ON u.id = s.user_id
    WHERE r.tutor_id = ?
    ORDER BY r.created_at DESC
  `).all(tutor.id);

  const availability = db.prepare(`SELECT * FROM availability WHERE tutor_id = ? ORDER BY id`).all(tutor.id);

  res.render('tutor-profile', { tutor, subjects, reviews, availability });
});

module.exports = router;
