'use strict';

/**
 * SQLite veritabani baglantisi (Node.js yerlesik node:sqlite modulu).
 * Harici/native bagimlilik gerektirmez.
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'solar-iha.sqlite');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

/** sema dosyasini uygular (tablolar yoksa olusturur). */
function initSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  migrate();
}

/** Eski veritabanlarini yeni semaya uyarlar (CREATE TABLE var olani degistirmez). */
function migrate() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (cols.length && !cols.includes('email')) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  }
}

// --- Kisa yardimci fonksiyonlar ---------------------------------
const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);
const count = (table) => get(`SELECT COUNT(*) AS c FROM ${table}`).c;

module.exports = { db, DB_PATH, DATA_DIR, initSchema, all, get, run, count };
