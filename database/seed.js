const bcrypt = require('bcryptjs');
const db = require('./db');

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

// Guard against re-seeding by checking specifically for the demo admin
// account, not "any user at all". This matters because it's common for
// someone to register their own test account (or run an interrupted seed)
// before running this script — checking "any user exists" would then skip
// seeding forever and leave Find Tutors permanently empty. Checking for the
// known demo account instead means `npm run seed` is safe to re-run anytime.
const alreadySeeded = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@peertutor.com');
if (alreadySeeded) {
  console.log('Demo data already seeded. Skipping. (Delete database/peertutor.sqlite to fully reset and reseed.)');
  process.exit(0);
}

const insertUser = db.prepare(`INSERT INTO users (full_name, email, password, role, gender, phone, avatar) VALUES (?,?,?,?,?,?,?)`);
const insertStudent = db.prepare(`INSERT INTO students (user_id, university, department, bio) VALUES (?,?,?,?)`);
const insertTutor = db.prepare(`INSERT INTO tutors (user_id, qualification, university, department, bio, teaching_method, experience_years, hourly_rate, status, average_rating, total_sessions, delivery_mode) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertSubject = db.prepare(`INSERT OR IGNORE INTO subjects (name, icon, description, image_url) VALUES (?,?,?,?)`);
const getSubjectByName = db.prepare(`SELECT id FROM subjects WHERE name = ?`);
const insertTutorSubject = db.prepare(`INSERT INTO tutor_subjects (tutor_id, subject_id) VALUES (?,?)`);
const insertAvailability = db.prepare(`INSERT INTO availability (tutor_id, day_of_week, start_time, end_time) VALUES (?,?,?,?)`);
const insertBooking = db.prepare(`INSERT INTO bookings (student_id, tutor_id, subject_id, session_date, start_time, end_time, session_type, message, status) VALUES (?,?,?,?,?,?,?,?,?)`);
const insertReview = db.prepare(`INSERT INTO reviews (booking_id, student_id, tutor_id, rating, comment) VALUES (?,?,?,?,?)`);
const insertMessage = db.prepare(`INSERT INTO messages (sender_id, receiver_id, content, is_read) VALUES (?,?,?,?)`);
const insertNotification = db.prepare(`INSERT INTO notifications (user_id, type, content, link, is_read) VALUES (?,?,?,?,?)`);
const insertFavorite = db.prepare(`INSERT INTO favorites (student_id, tutor_id) VALUES (?,?)`);

const tx = db.transaction(() => {
  // --- Subjects ---
  // database/db.js already guarantees these six exist on every server start
  // (subjects are reference data, not demo data). Using INSERT OR IGNORE here
  // too means this script is safe to run whether that already happened or not,
  // and we just look up the real IDs either way.
  const subjects = [
    ['English', 'fa-book-open', 'Grammar, writing, literature and conversation practice.', 'https://images.unsplash.com/photo-1660606422342-2ce59709bb14?auto=format&fit=crop&w=800&q=80'],
    ['Spanish', 'fa-language', 'Beginner to advanced Spanish speaking and grammar.', 'https://images.unsplash.com/photo-1764107183244-0cef642a99a9?auto=format&fit=crop&w=800&q=80'],
    ['Web Development', 'fa-code', 'HTML, CSS, JavaScript, and modern frameworks.', 'https://images.unsplash.com/photo-1731924009776-2f486f3a2c1f?auto=format&fit=crop&w=800&q=80'],
    ['Computer Science', 'fa-laptop-code', 'Algorithms, data structures, and programming fundamentals.', 'https://images.unsplash.com/photo-1719253480609-579ad1622c65?auto=format&fit=crop&w=800&q=80'],
    ['Graphic Design', 'fa-palette', 'Visual design, typography, and design tools.', 'https://images.unsplash.com/photo-1716471330475-f0669db8947a?auto=format&fit=crop&w=800&q=80'],
    ['Artificial Intelligence', 'fa-brain', 'Machine learning, neural networks, and AI concepts.', 'https://images.unsplash.com/photo-1744640326166-433469d102f2?auto=format&fit=crop&w=800&q=80'],
    ['Mathematics', 'fa-square-root-variable', 'Algebra, calculus, statistics, and problem-solving.', 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?auto=format&fit=crop&w=800&q=80'],
    ['Data Science', 'fa-chart-line', 'Data analysis, visualization, and statistical modeling.', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80'],
    ['Cybersecurity', 'fa-shield-halved', 'Network security, ethical hacking, and safe computing practices.', 'https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&w=800&q=80'],
    ['Database Systems', 'fa-database', 'SQL, database design, and data management fundamentals.', 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=80']
  ];
  const subjectIds = {};
  for (const [name, icon, description, image_url] of subjects) {
    insertSubject.run(name, icon, description, image_url);
    subjectIds[name] = getSubjectByName.get(name).id;
  }

  // --- Admin ---
  insertUser.run('Amina Mohamed', 'admin@peertutor.com', hash('Admin123!'), 'admin', 'female', '555-0100', 'https://images.unsplash.com/photo-1755434613831-1a8cb00bfb2c?auto=format&fit=crop&w=400&q=80');

  // --- Students ---
  const studentsData = [
    ['Hani Abdullahi', 'sara@student.com', 'female', 'City University', 'Computer Science', 'Second-year CS student who loves learning web development.', 'https://images.unsplash.com/photo-1753486986377-1395ccfb4a8a?auto=format&fit=crop&w=400&q=80'],
    ['Abdullahi Hassan', 'james@student.com', 'male', 'Northfield College', 'Business', 'Trying to improve my Spanish for a semester abroad.', 'https://images.unsplash.com/photo-1624224416603-c908080780b1?auto=format&fit=crop&w=400&q=80'],
    ['Hodan Ahmed', 'mei@student.com', 'female', 'City University', 'Design', 'Aspiring graphic designer looking for portfolio feedback.', 'https://images.unsplash.com/photo-1755434613831-1a8cb00bfb2c?auto=format&fit=crop&w=400&q=80']
  ];
  const studentIds = [];
  for (const [name, email, gender, uni, dept, bio, photo] of studentsData) {
    const u = insertUser.run(name, email, hash('Student123!'), 'student', gender, '555-0101', photo);
    const s = insertStudent.run(u.lastInsertRowid, uni, dept, bio);
    studentIds.push({ userId: u.lastInsertRowid, studentId: s.lastInsertRowid, name });
  }

  // --- Tutors ---
  const tutorsData = [
    {
      name: 'Mohamed Ali', email: 'david@tutor.com', gender: 'male', photo: 'https://images.unsplash.com/photo-1624224416603-c908080780b1?auto=format&fit=crop&w=400&q=80', qualification: 'B.Sc. Computer Science',
      university: 'Tech Institute', department: 'Computer Science',
      bio: 'Full-stack developer and 3rd-year CS student passionate about teaching web development.',
      method: 'Project-based, hands-on coding sessions with real examples.',
      experience: 3, rate: 18, status: 'approved', rating: 4.8, sessions: 42, delivery: 'online',
      subjects: ['Web Development', 'Computer Science']
    },
    {
      name: 'Ilham Hassan', email: 'laila@tutor.com', gender: 'female', photo: 'https://images.unsplash.com/photo-1755434613831-1a8cb00bfb2c?auto=format&fit=crop&w=400&q=80', qualification: 'B.A. English Literature',
      university: 'Riverside University', department: 'English',
      bio: 'Peer writing tutor who helps students improve essays and conversational English.',
      method: 'Discussion-based learning with structured writing feedback.',
      experience: 2, rate: 12, status: 'approved', rating: 4.9, sessions: 65, delivery: 'both',
      subjects: ['English']
    },
    {
      name: 'Ahmed Yusuf', email: 'carlos@tutor.com', gender: 'male', photo: 'https://images.unsplash.com/photo-1624224416603-c908080780b1?auto=format&fit=crop&w=400&q=80', qualification: 'B.A. Spanish & Linguistics',
      university: 'Riverside University', department: 'Languages',
      bio: 'Native Spanish speaker helping students build fluency and confidence.',
      method: 'Conversational immersion with grammar review.',
      experience: 4, rate: 15, status: 'approved', rating: 4.7, sessions: 51, delivery: 'in-person',
      subjects: ['Spanish']
    },
    {
      name: 'Sahra Ali', email: 'priya@tutor.com', gender: 'female', photo: 'https://images.unsplash.com/photo-1755434613831-1a8cb00bfb2c?auto=format&fit=crop&w=400&q=80', qualification: 'B.Des Visual Communication',
      university: 'City University', department: 'Design',
      bio: 'Graphic designer teaching layout, color theory, and design software basics.',
      method: 'Portfolio critiques and guided design exercises.',
      experience: 2, rate: 16, status: 'approved', rating: 4.6, sessions: 28, delivery: 'online',
      subjects: ['Graphic Design']
    },
    {
      name: 'Abdirahman Osman', email: 'omar@tutor.com', gender: 'male', photo: 'https://images.unsplash.com/photo-1624224416603-c908080780b1?auto=format&fit=crop&w=400&q=80', qualification: 'M.Sc. Artificial Intelligence',
      university: 'Tech Institute', department: 'Computer Science',
      bio: 'Graduate student researching machine learning, teaching AI fundamentals to peers.',
      method: 'Concept-first teaching with practical Python notebooks.',
      experience: 1, rate: 20, status: 'pending', rating: 0, sessions: 0, delivery: 'online',
      subjects: ['Artificial Intelligence', 'Computer Science']
    }
  ];

  const tutorIds = [];
  for (const t of tutorsData) {
    const u = insertUser.run(t.name, t.email, hash('Tutor123!'), 'tutor', t.gender, '555-0102', t.photo);
    const tu = insertTutor.run(u.lastInsertRowid, t.qualification, t.university, t.department, t.bio, t.method, t.experience, t.rate, t.status, t.rating, t.sessions, t.delivery);
    const tutorId = tu.lastInsertRowid;
    for (const sub of t.subjects) {
      insertTutorSubject.run(tutorId, subjectIds[sub]);
    }
    // availability
    insertAvailability.run(tutorId, 'Monday', '14:00', '18:00');
    insertAvailability.run(tutorId, 'Wednesday', '10:00', '13:00');
    insertAvailability.run(tutorId, 'Friday', '15:00', '19:00');
    tutorIds.push({ userId: u.lastInsertRowid, tutorId, name: t.name, subjects: t.subjects });
  }

  // --- Bookings ---
  const b1 = insertBooking.run(studentIds[0].studentId, tutorIds[0].tutorId, subjectIds['Web Development'], '2026-08-20', '15:00', '16:00', 'online', 'Need help understanding CSS flexbox.', 'accepted');
  const b2 = insertBooking.run(studentIds[1].studentId, tutorIds[2].tutorId, subjectIds['Spanish'], '2026-08-10', '10:00', '11:00', 'online', 'Practice conversational Spanish.', 'completed');
  const b3 = insertBooking.run(studentIds[2].studentId, tutorIds[3].tutorId, subjectIds['Graphic Design'], '2026-08-22', '16:00', '17:00', 'online', 'Portfolio review please.', 'pending');
  insertBooking.run(studentIds[0].studentId, tutorIds[1].tutorId, subjectIds['English'], '2026-07-15', '09:00', '10:00', 'online', 'Essay feedback.', 'completed');

  // --- Reviews (for completed bookings) ---
  insertReview.run(b2.lastInsertRowid, studentIds[1].studentId, tutorIds[2].tutorId, 5, 'Carlos was patient and made me feel comfortable speaking Spanish!');
  insertReview.run(b1.lastInsertRowid, studentIds[0].studentId, tutorIds[0].tutorId, 5, 'David explained flexbox so clearly. Highly recommend.');

  // --- Favorites ---
  insertFavorite.run(studentIds[0].studentId, tutorIds[0].tutorId);
  insertFavorite.run(studentIds[0].studentId, tutorIds[1].tutorId);

  // --- Messages ---
  insertMessage.run(studentIds[0].userId, tutorIds[0].userId, 'Hi David, looking forward to our session on Monday!', 1);
  insertMessage.run(tutorIds[0].userId, studentIds[0].userId, 'Sounds great, see you then!', 0);

  // --- Notifications ---
  insertNotification.run(tutorIds[0].userId, 'booking', 'New booking request from Sara Ahmed for Web Development.', '/tutor/requests', 0);
  insertNotification.run(studentIds[0].userId, 'booking_accepted', 'David Kim accepted your booking request.', '/student/bookings', 0);
});

tx();
console.log('Database seeded successfully.');
console.log('---------------------------------');
console.log('Admin login:  admin@peertutor.com / Admin123!');
console.log('Student login: sara@student.com / Student123!');
console.log('Tutor login:   david@tutor.com / Tutor123!');
