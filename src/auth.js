'use strict';

/**
 * Sifre hash'leme ve basit oturum (session) yonetimi.
 * Harici bagimlilik yok - Node.js yerlesik crypto modulu kullanilir.
 */

const { scryptSync, randomBytes, timingSafeEqual, randomUUID } = require('node:crypto');

// ------------------------------------------------------------
// Sifre hash / dogrulama (scrypt)
// ------------------------------------------------------------
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const candidate = scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ------------------------------------------------------------
// Oturumlar (bellek ici). Sunucu yeniden baslayinca sifirlanir.
// ------------------------------------------------------------
const SESSION_TTL_MS = 1000 * 60 * 60 * 8; // 8 saat
const sessions = new Map();

function createSession(admin) {
  const token = randomUUID().replace(/-/g, '') + randomBytes(16).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, {
    adminId: admin.id,
    username: admin.username,
    fullName: admin.full_name || admin.username,
    expiresAt,
  });
  return { token, expiresAt };
}

function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

/** Token'i eski oturumlardan temizle (periyodik). */
function cleanupSessions() {
  const now = Date.now();
  for (const [token, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(token);
  }
  for (const [token, s] of userSessions) {
    if (s.expiresAt < now) userSessions.delete(token);
  }
}
setInterval(cleanupSessions, 1000 * 60 * 30).unref();

// ------------------------------------------------------------
// Uye oturumlari (kayit/giris sistemi). Yoneticiden ayri depo.
// ------------------------------------------------------------
const userSessions = new Map();

function createUserSession(user) {
  const token = randomUUID().replace(/-/g, '') + randomBytes(16).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  userSessions.set(token, {
    userId: user.id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    department: user.department,
    expiresAt,
  });
  return { token, expiresAt };
}

function getUserSession(token) {
  if (!token) return null;
  const s = userSessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    userSessions.delete(token);
    return null;
  }
  return s;
}

function destroyUserSession(token) {
  if (token) userSessions.delete(token);
}

/** Express middleware: uye oturumu dogrular (Authorization: Bearer <token>). */
function userAuthMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const session = getUserSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Yetkisiz. Lutfen giris yapin.' });
  }
  req.user = session;
  req.token = token;
  next();
}

// ------------------------------------------------------------
// Express middleware: Authorization: Bearer <token>
// ------------------------------------------------------------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ error: 'Yetkisiz. Lutfen giris yapin.' });
  }
  req.admin = session;
  req.token = token;
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  authMiddleware,
  createUserSession,
  getUserSession,
  destroyUserSession,
  userAuthMiddleware,
};
