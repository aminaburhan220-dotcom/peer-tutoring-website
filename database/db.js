const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const isPostgres = Boolean(process.env.DATABASE_URL);
const transactionContext = new AsyncLocalStorage();
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
const backfillImages = {
  Mathematics: 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?auto=format&fit=crop&w=800&q=80',
  'Data Science': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
  Cybersecurity: 'https://images.unsplash.com/photo-1614064641938-3bbee52942c7?auto=format&fit=crop&w=800&q=80',
  'Database Systems': 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=800&q=80'
};

let sqlite;
let pool;
let isNew = false;

if (isPostgres) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
} else {
  const dbPath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, 'peertutor.sqlite'));
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  isNew = !fs.existsSync(dbPath);
  sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrateSqliteSchema();
  ensureSubjectsSync();
}

function migrateSqliteSchema() {
  const userColumns = sqlite.prepare('PRAGMA table_info(users)').all().map(column => column.name);
  if (!userColumns.includes('gender')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN gender TEXT CHECK(gender IN ('male','female'))");
  }
  const subjectColumns = sqlite.prepare('PRAGMA table_info(subjects)').all().map(column => column.name);
  if (!subjectColumns.includes('image_url')) {
    sqlite.exec('ALTER TABLE subjects ADD COLUMN image_url TEXT');
  }
  const tutorColumns = sqlite.prepare('PRAGMA table_info(tutors)').all().map(column => column.name);
  if (!tutorColumns.includes('delivery_mode')) {
    sqlite.exec("ALTER TABLE tutors ADD COLUMN delivery_mode TEXT DEFAULT 'online' CHECK(delivery_mode IN ('online','in-person','both'))");
  }
}

function ensureSubjectsSync() {
  if (sqlite.prepare('SELECT COUNT(*) AS count FROM subjects').get().count !== 0) return;
  const insert = sqlite.prepare('INSERT OR IGNORE INTO subjects (name, icon, description, image_url) VALUES (?,?,?,?)');
  for (const subject of coreSubjects) insert.run(...subject);
  const update = sqlite.prepare('UPDATE subjects SET image_url = ? WHERE name = ? AND image_url IS NULL');
  for (const [name, imageUrl] of Object.entries(backfillImages)) update.run(imageUrl, name);
}

function preparePostgresSql(sql, method) {
  let query = sql.trim();
  let parameterIndex = 0;
  const ignoreConflicts = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(query);
  query = query.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  query = query.replace(/\?/g, () => `$${++parameterIndex}`);

  if (ignoreConflicts && !/\bON\s+CONFLICT\b/i.test(query)) query += ' ON CONFLICT DO NOTHING';
  if (method === 'run' && /^\s*INSERT\b/i.test(query) && !/\bRETURNING\b/i.test(query)) {
    query += ' RETURNING id';
  }
  return query;
}

function prepare(sql) {
  return {
    all(...params) {
      if (!isPostgres) return sqlite.prepare(sql).all(...params);
      return runPostgres(sql, params).then(result => result.rows);
    },
    get(...params) {
      if (!isPostgres) return sqlite.prepare(sql).get(...params);
      return runPostgres(sql, params).then(result => result.rows[0]);
    },
    run(...params) {
      if (!isPostgres) return sqlite.prepare(sql).run(...params);
      return runPostgres(sql, params, 'run').then(result => ({
        lastInsertRowid: result.rows[0]?.id ?? null,
        changes: result.rowCount
      }));
    }
  };
}

async function runPostgres(sql, params, method) {
  const statement = preparePostgresSql(sql, method);
  const client = transactionContext.getStore() || pool;
  return client.query(statement, params);
}

async function initialize() {
  if (!isPostgres) return;
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8'));
  const subjectCount = await pool.query('SELECT COUNT(*) AS count FROM subjects');
  if (Number(subjectCount.rows[0].count) === 0) {
    for (const subject of coreSubjects) {
      await pool.query(
        'INSERT INTO subjects (name, icon, description, image_url) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING',
        subject
      );
    }
  }
  for (const [name, imageUrl] of Object.entries(backfillImages)) {
    await pool.query('UPDATE subjects SET image_url = $1 WHERE name = $2 AND image_url IS NULL', [imageUrl, name]);
  }
}

async function transaction(callback) {
  if (!isPostgres) {
    sqlite.exec('BEGIN');
    try {
      const result = await callback();
      sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await transactionContext.run(client, callback);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function close() {
  if (isPostgres) await pool.end();
  else sqlite.close();
}

module.exports = {
  prepare,
  initialize,
  transaction,
  close,
  isNew,
  isPostgres,
  pool
};
