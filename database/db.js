const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'peertutor.sqlite');
const isNew = !fs.existsSync(DB_PATH);

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Ensure schema always exists (safe to run repeatedly - CREATE TABLE IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Lightweight migrations: add columns that didn't exist in earlier versions of
// this schema, so upgrading an existing database never breaks an install.
// (New installs get these columns directly from schema.sql above — these only
// fire for a database file created before a given feature existed.)
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('gender')) {
  db.exec("ALTER TABLE users ADD COLUMN gender TEXT CHECK(gender IN ('male','female'))");
}

const subjectColumns = db.prepare("PRAGMA table_info(subjects)").all().map(c => c.name);
if (!subjectColumns.includes('image_url')) {
  db.exec("ALTER TABLE subjects ADD COLUMN image_url TEXT");
}

const tutorColumns = db.prepare("PRAGMA table_info(tutors)").all().map(c => c.name);
if (!tutorColumns.includes('delivery_mode')) {
  db.exec("ALTER TABLE tutors ADD COLUMN delivery_mode TEXT DEFAULT 'online' CHECK(delivery_mode IN ('online','in-person','both'))");
}

// Subjects are reference/catalog data (like a fixed list of categories), not
// demo data — the site should never be usable-but-empty just because someone
// started the server before running `npm run seed`. Guarantee the core
// subjects always exist, independent of the optional demo-data seed script.
// Six have a real distinct photo; the rest use the icon-card treatment.
const subjectCount = db.prepare('SELECT COUNT(*) AS c FROM subjects').get().c;
if (subjectCount === 0) {
  const insertSubject = db.prepare('INSERT OR IGNORE INTO subjects (name, icon, description, image_url) VALUES (?,?,?,?)');
  const coreSubjects = [
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
  for (const [name, icon, description, image_url] of coreSubjects) {
    insertSubject.run(name, icon, description, image_url);
  }
}

// Backfill: if a database was already seeded before these four subjects had
// real photos assigned, give them one now (only touches rows that are still
// missing an image, so it never overwrites an image someone set manually).
const backfillImages = {
  'Mathematics': 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?auto=format&fit=crop&w=800&q=80',
  'Data Science': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
  'Cybersecurity': 'https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&w=800&q=80',
  'Database Systems': 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=80'
};
const updateSubjectImage = db.prepare('UPDATE subjects SET image_url = ? WHERE name = ? AND image_url IS NULL');
for (const [name, url] of Object.entries(backfillImages)) {
  updateSubjectImage.run(url, name);
}

module.exports = db;
module.exports.isNew = isNew;
