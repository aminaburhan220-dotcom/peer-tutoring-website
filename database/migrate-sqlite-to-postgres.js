require('dotenv').config();

const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const fs = require('fs');

const tables = [
  'users',
  'students',
  'tutors',
  'subjects',
  'tutor_subjects',
  'availability',
  'bookings',
  'messages',
  'notifications',
  'reviews',
  'favorites',
  'activity_logs'
];

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the target PostgreSQL connection string.');

  const sourcePath = path.resolve(process.env.SQLITE_PATH || path.join(__dirname, 'peertutor.sqlite'));
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite source database does not exist: ${sourcePath}`);

  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const violations = source.pragma('foreign_key_check');
  if (violations.length) {
    source.close();
    throw new Error(`SQLite source contains ${violations.length} foreign-key violation(s).`);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
  let client;

  try {
    await pool.query(fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8'));
    client = await pool.connect();
    await client.query('BEGIN');

    for (const table of tables) {
      const targetCount = await client.query(`SELECT COUNT(*) AS count FROM "${table}"`);
      if (table !== 'subjects' && Number(targetCount.rows[0].count) !== 0) {
        throw new Error(`Target table "${table}" is not empty; migration stopped without overwriting data.`);
      }
    }

    const relationsExist = await client.query('SELECT (SELECT COUNT(*) FROM tutor_subjects) + (SELECT COUNT(*) FROM bookings) AS count');
    if (Number(relationsExist.rows[0].count) !== 0) {
      throw new Error('Target subjects are referenced by existing data; migration stopped without overwriting data.');
    }
    await client.query('DELETE FROM subjects');

    const copied = {};
    for (const table of tables) {
      const rows = source.prepare(`SELECT * FROM "${table}"`).all();
      copied[table] = rows.length;
      if (!rows.length) continue;

      const columns = source.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name);
      const columnList = columns.map(column => `"${column}"`).join(', ');
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const insert = `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`;
      for (const row of rows) {
        await client.query(insert, columns.map(column => row[column]));
      }
    }

    for (const table of tables) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`
      );
    }

    for (const table of tables) {
      const targetCount = await client.query(`SELECT COUNT(*) AS count FROM "${table}"`);
      if (Number(targetCount.rows[0].count) !== copied[table]) {
        throw new Error(`Verification failed for "${table}": expected ${copied[table]} rows.`);
      }
    }

    await client.query('COMMIT');
    console.log('SQLite data copied and verified by table:');
    for (const table of tables) console.log(`  ${table}: ${copied[table]} rows`);
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client) client.release();
    source.close();
    await pool.end();
  }
}

migrate().catch(error => {
  console.error('PostgreSQL data migration failed:', error.message);
  process.exitCode = 1;
});
