'use strict';

/**
 * Herkese acik API rotalari (site icerigi ve form gonderimleri).
 */

const express = require('express');
const { randomInt } = require('node:crypto');
const { all, get, run, count } = require('../db');
const { isValidEmail, missingFields, normalizeEmail } = require('../utils');
const {
  hashPassword,
  verifyPassword,
  createUserSession,
  destroyUserSession,
  userAuthMiddleware,
} = require('../auth');
const { sendVerificationCode, mailEnabled } = require('../mailer');

const router = express.Router();

// Kayit sirasinda secilebilecek birimler
const DEPARTMENTS = ['Yazılım', 'Mekanik', 'Elektronik', 'Tasarım', 'Medya', 'Yönetim'];

// Dogrulama kodu ayarlari
const CODE_TTL_MS = 10 * 60 * 1000; // 10 dakika
const MAX_ATTEMPTS = 6;

/** Kullaniciyi sifre alani olmadan disari doner. */
function publicUser(u) {
  return {
    id: u.id,
    first_name: u.first_name,
    last_name: u.last_name,
    username: u.username,
    email: u.email,
    age: u.age,
    department: u.department,
    created_at: u.created_at,
  };
}

/** Yeni 6 haneli dogrulama kodu uretir. */
function generateCode() {
  return String(randomInt(100000, 1000000));
}

/** Test modunda kodu API yanitina ekler, gercek modda eklemez. */
function codeField(code) {
  return mailEnabled ? {} : { devCode: code };
}

function attachSpecs(vehicle) {
  if (!vehicle) return vehicle;
  vehicle.specs = all(
    'SELECT id, label, value, unit, sort_order FROM vehicle_specs WHERE vehicle_id = ? ORDER BY sort_order ASC, id ASC',
    vehicle.id
  );
  return vehicle;
}

// ------------------------------------------------------------
// Site ayarlari
// ------------------------------------------------------------
router.get('/settings', (req, res) => {
  const settings = {};
  for (const row of all('SELECT key, value FROM settings')) settings[row.key] = row.value;
  res.json(settings);
});

// ------------------------------------------------------------
// Takim uyeleri
// ------------------------------------------------------------
router.get('/members', (req, res) => {
  res.json(all('SELECT * FROM members WHERE is_active = 1 ORDER BY sort_order ASC, id ASC'));
});

// ------------------------------------------------------------
// Araclar + teknik ozellikler
// ------------------------------------------------------------
router.get('/vehicles', (req, res) => {
  const rows = all('SELECT * FROM vehicles ORDER BY sort_order ASC, id ASC');
  res.json(rows.map(attachSpecs));
});

router.get('/vehicles/:slug', (req, res) => {
  const numeric = Number(req.params.slug);
  const v = get(
    'SELECT * FROM vehicles WHERE slug = ? OR id = ?',
    req.params.slug,
    Number.isFinite(numeric) ? numeric : -1
  );
  if (!v) return res.status(404).json({ error: 'Arac bulunamadi.' });
  res.json(attachSpecs(v));
});

// ------------------------------------------------------------
// Haberler / blog
// ------------------------------------------------------------
router.get('/news', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const { category, q } = req.query;
  let sql =
    'SELECT id, title, slug, category, summary, image, author, tags, published_at FROM news WHERE is_published = 1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (q) {
    sql += ' AND (title LIKE ? OR summary LIKE ? OR content LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY published_at DESC LIMIT ?';
  params.push(limit);
  res.json(all(sql, ...params));
});

router.get('/news/:slug', (req, res) => {
  const numeric = Number(req.params.slug);
  const item = get(
    'SELECT * FROM news WHERE (slug = ? OR id = ?) AND is_published = 1',
    req.params.slug,
    Number.isFinite(numeric) ? numeric : -1
  );
  if (!item) return res.status(404).json({ error: 'Icerik bulunamadi.' });
  res.json(item);
});

// ------------------------------------------------------------
// Duyurular
// ------------------------------------------------------------
router.get('/announcements', (req, res) => {
  res.json(
    all('SELECT * FROM announcements WHERE is_published = 1 ORDER BY is_pinned DESC, published_at DESC')
  );
});

// ------------------------------------------------------------
// Faaliyet alanlari
// ------------------------------------------------------------
router.get('/activity-areas', (req, res) => {
  res.json(all('SELECT * FROM activity_areas ORDER BY sort_order ASC, id ASC'));
});

// ------------------------------------------------------------
// Kariyer ilanlari
// ------------------------------------------------------------
router.get('/careers', (req, res) => {
  res.json(all('SELECT * FROM careers ORDER BY is_open DESC, id DESC'));
});

// ------------------------------------------------------------
// Sponsorlar
// ------------------------------------------------------------
const TIER_ORDER = "CASE tier WHEN 'Platin' THEN 1 WHEN 'Altın' THEN 2 WHEN 'Gümüş' THEN 3 WHEN 'Bronz' THEN 4 ELSE 5 END";
router.get('/sponsors', (req, res) => {
  res.json(all(`SELECT * FROM sponsors ORDER BY ${TIER_ORDER}, sort_order ASC, id ASC`));
});

// ------------------------------------------------------------
// Ana sayfa ozet istatistikleri
// ------------------------------------------------------------
router.get('/stats', (req, res) => {
  res.json({
    members: count('members'),
    vehicles: count('vehicles'),
    news: count('news'),
    announcements: count('announcements'),
    sponsors: count('sponsors'),
    activityAreas: count('activity_areas'),
  });
});

// ------------------------------------------------------------
// Site ici arama (komut paleti icin)
// ------------------------------------------------------------
router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ query: q, results: [] });
  const like = `%${q}%`;
  const results = [];

  const add = (type, rows, map) => {
    for (const row of rows) results.push(map(row));
  };

  add('Haber',
    all('SELECT title, slug, category, summary FROM news WHERE is_published = 1 AND (title LIKE ? OR summary LIKE ? OR content LIKE ?) ORDER BY published_at DESC LIMIT 6', like, like, like),
    (r) => ({ type: 'Haber', title: r.title, meta: r.category, desc: r.summary, url: `/haber?slug=${encodeURIComponent(r.slug || '')}` }));

  add('Duyuru',
    all('SELECT title, type, content FROM announcements WHERE is_published = 1 AND (title LIKE ? OR content LIKE ?) ORDER BY published_at DESC LIMIT 4', like, like),
    (r) => ({ type: 'Duyuru', title: r.title, meta: r.type, desc: r.content, url: '/duyurular' }));

  add('Ekip',
    all('SELECT name, role, department, bio FROM members WHERE is_active = 1 AND (name LIKE ? OR role LIKE ? OR department LIKE ? OR bio LIKE ?) LIMIT 5', like, like, like, like),
    (r) => ({ type: 'Ekip', title: r.name, meta: r.role || r.department, desc: r.bio || r.department, url: '/takim' }));

  add('İHA',
    all('SELECT name, slug, category, summary FROM vehicles WHERE name LIKE ? OR summary LIKE ? OR description LIKE ? LIMIT 5', like, like, like),
    (r) => ({ type: 'İHA', title: r.name, meta: r.category, desc: r.summary, url: `/arac#${r.slug || ''}` }));

  add('Faaliyet',
    all('SELECT title, description FROM activity_areas WHERE title LIKE ? OR description LIKE ? LIMIT 5', like, like),
    (r) => ({ type: 'Faaliyet', title: r.title, meta: 'Faaliyet Alanı', desc: r.description, url: '/faaliyetler' }));

  add('Kariyer',
    all('SELECT title, department, description FROM careers WHERE title LIKE ? OR description LIKE ? LIMIT 5', like, like),
    (r) => ({ type: 'Kariyer', title: r.title, meta: r.department, desc: r.description, url: '/kariyer' }));

  add('Sponsor',
    all('SELECT name, tier, description FROM sponsors WHERE name LIKE ? OR description LIKE ? LIMIT 4', like, like),
    (r) => ({ type: 'Sponsor', title: r.name, meta: `Sponsor · ${r.tier}`, desc: r.description, url: '/sponsorlar' }));

  res.json({ query: q, results });
});

// ------------------------------------------------------------
// Iletisim formu -> messages
// ------------------------------------------------------------
router.post('/messages', (req, res) => {
  const body = req.body || {};
  const missing = missingFields(body, ['name', 'email', 'message']);
  if (missing.length) {
    return res.status(400).json({ error: `Zorunlu alanlar eksik: ${missing.join(', ')}` });
  }
  if (!isValidEmail(body.email)) {
    return res.status(400).json({ error: 'Gecerli bir e-posta adresi girin.' });
  }
  const info = run(
    'INSERT INTO messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)',
    String(body.name).trim(),
    String(body.email).trim(),
    body.phone ? String(body.phone).trim() : null,
    body.subject ? String(body.subject).trim() : null,
    String(body.message).trim()
  );
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

// ------------------------------------------------------------
// Kariyer basvurusu -> career_applications
// ------------------------------------------------------------
router.post('/career-applications', (req, res) => {
  const body = req.body || {};
  const missing = missingFields(body, ['full_name', 'email']);
  if (missing.length) {
    return res.status(400).json({ error: `Zorunlu alanlar eksik: ${missing.join(', ')}` });
  }
  if (!isValidEmail(body.email)) {
    return res.status(400).json({ error: 'Gecerli bir e-posta adresi girin.' });
  }
  const careerId = Number(body.career_id);
  const info = run(
    `INSERT INTO career_applications
       (career_id, full_name, email, phone, university, department, message, cv_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    Number.isFinite(careerId) && careerId > 0 ? careerId : null,
    String(body.full_name).trim(),
    String(body.email).trim(),
    body.phone ? String(body.phone).trim() : null,
    body.university ? String(body.university).trim() : null,
    body.department ? String(body.department).trim() : null,
    body.message ? String(body.message).trim() : null,
    body.cv_url ? String(body.cv_url).trim() : null
  );
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

// ------------------------------------------------------------
// Uye kayit / giris sistemi -> users
// ------------------------------------------------------------
// Kayit adimi 1: bilgileri dogrula, e-posta adresine 6 haneli kod gonder.
// Kullanici kaydi, kod dogrulanana kadar email_verifications tablosunda bekler.
router.post('/register', async (req, res) => {
  const body = req.body || {};
  const missing = missingFields(body, ['first_name', 'last_name', 'username', 'email', 'password', 'age', 'department']);
  if (missing.length) {
    return res.status(400).json({ error: `Zorunlu alanlar eksik: ${missing.join(', ')}` });
  }

  const username = String(body.username).trim();
  if (!/^[A-Za-z0-9._]{3,24}$/.test(username)) {
    return res.status(400).json({ error: 'Kullanıcı adı 3-24 karakter olmalı; harf, rakam, nokta veya alt çizgi kullanın.' });
  }
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
  }
  if (String(body.password).length < 6) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });
  }
  const age = Number(body.age);
  if (!Number.isInteger(age) || age < 10 || age > 99) {
    return res.status(400).json({ error: 'Geçerli bir yaş girin (10-99).' });
  }
  const department = String(body.department).trim();
  if (!DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Geçerli bir birim seçin.' });
  }
  if (get('SELECT id FROM users WHERE username = ?', username)) {
    return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı.' });
  }
  if (get('SELECT id FROM users WHERE email = ?', email)) {
    return res.status(409).json({ error: 'Bu e-posta adresi zaten kayıtlı.' });
  }

  // Onaylandiginda olusturulacak kullanici bilgilerini beklet.
  const payload = JSON.stringify({
    first_name: String(body.first_name).trim(),
    last_name: String(body.last_name).trim(),
    username,
    email,
    password_hash: hashPassword(body.password),
    age,
    department,
  });

  const code = generateCode();
  run(
    `INSERT INTO email_verifications (email, code_hash, payload, attempts, expires_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash,
       payload   = excluded.payload,
       attempts  = 0,
       expires_at = excluded.expires_at,
       created_at = datetime('now')`,
    email, hashPassword(code), payload, Date.now() + CODE_TTL_MS
  );

  try {
    const { sent } = await sendVerificationCode(email, code);
    res.status(200).json({ ok: true, pending: true, email, mailSent: sent, ...codeField(code) });
  } catch (err) {
    console.error('Dogrulama e-postasi gonderilemedi:', err.message);
    res.status(502).json({ error: 'Doğrulama e-postası gönderilemedi. Lütfen tekrar deneyin.' });
  }
});

// Kayit adimi 2: e-postaya gelen kodu dogrula ve kullaniciyi olustur.
router.post('/verify-email', (req, res) => {
  const { email, code } = req.body || {};
  const em = normalizeEmail(email);
  if (!em || !code) {
    return res.status(400).json({ error: 'E-posta ve doğrulama kodu gerekli.' });
  }

  const rec = get('SELECT * FROM email_verifications WHERE email = ?', em);
  if (!rec) {
    return res.status(400).json({ error: 'Bu e-posta için bekleyen bir doğrulama bulunamadı.' });
  }
  if (rec.expires_at < Date.now()) {
    run('DELETE FROM email_verifications WHERE email = ?', em);
    return res.status(400).json({ error: 'Kodun süresi doldu. Lütfen yeni kod isteyin.' });
  }
  if (rec.attempts >= MAX_ATTEMPTS) {
    run('DELETE FROM email_verifications WHERE email = ?', em);
    return res.status(429).json({ error: 'Çok fazla hatalı deneme yapıldı. Lütfen yeni kod isteyin.' });
  }
  if (!verifyPassword(String(code).trim(), rec.code_hash)) {
    run('UPDATE email_verifications SET attempts = attempts + 1 WHERE email = ?', em);
    const left = Math.max(MAX_ATTEMPTS - (rec.attempts + 1), 0);
    return res.status(400).json({ error: `Kod hatalı. Kalan deneme hakkı: ${left}.` });
  }

  const data = JSON.parse(rec.payload);
  if (get('SELECT id FROM users WHERE username = ?', data.username)) {
    run('DELETE FROM email_verifications WHERE email = ?', em);
    return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı.' });
  }
  if (get('SELECT id FROM users WHERE email = ?', em)) {
    run('DELETE FROM email_verifications WHERE email = ?', em);
    return res.status(409).json({ error: 'Bu e-posta adresi zaten kayıtlı.' });
  }

  const info = run(
    `INSERT INTO users (first_name, last_name, username, email, password_hash, age, department)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    data.first_name, data.last_name, data.username, data.email,
    data.password_hash, data.age, data.department
  );
  run('DELETE FROM email_verifications WHERE email = ?', em);

  const user = get('SELECT * FROM users WHERE id = ?', Number(info.lastInsertRowid));
  const { token, expiresAt } = createUserSession(user);
  res.status(201).json({ ok: true, token, expiresAt, user: publicUser(user) });
});

// Bekleyen kayit icin yeni kod gonder.
router.post('/resend-code', async (req, res) => {
  const em = normalizeEmail((req.body || {}).email);
  if (!isValidEmail(em)) {
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi girin.' });
  }
  const rec = get('SELECT * FROM email_verifications WHERE email = ?', em);
  if (!rec) {
    return res.status(400).json({ error: 'Bu e-posta için bekleyen bir doğrulama bulunamadı.' });
  }

  const code = generateCode();
  run(
    'UPDATE email_verifications SET code_hash = ?, attempts = 0, expires_at = ? WHERE email = ?',
    hashPassword(code), Date.now() + CODE_TTL_MS, em
  );

  try {
    const { sent } = await sendVerificationCode(em, code);
    res.json({ ok: true, pending: true, email: em, mailSent: sent, ...codeField(code) });
  } catch (err) {
    console.error('Dogrulama e-postasi gonderilemedi:', err.message);
    res.status(502).json({ error: 'Doğrulama e-postası gönderilemedi. Lütfen tekrar deneyin.' });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Kullanıcı adı ve şifre gerekli.' });
  }
  const user = get('SELECT * FROM users WHERE username = ?', String(username).trim());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  }
  const { token, expiresAt } = createUserSession(user);
  res.json({ ok: true, token, expiresAt, user: publicUser(user) });
});

router.post('/logout', userAuthMiddleware, (req, res) => {
  destroyUserSession(req.token);
  res.json({ ok: true });
});

router.get('/me', userAuthMiddleware, (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.user.userId);
  if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
  res.json({ user: publicUser(user) });
});

module.exports = router;
