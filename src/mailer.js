'use strict';

/**
 * E-posta gonderimi (nodemailer).
 * SMTP bilgileri .env dosyasindan okunur. Bilgiler tanimli degilse
 * "test modu" devreye girer: kod sunucu konsoluna yazilir ve API
 * yanitinda devCode alani ile donulur (gercek e-posta gonderilmez).
 */

const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = Number(process.env.SMTP_PORT || 465);
const SECURE = String(process.env.SMTP_SECURE || (PORT === 465)).toLowerCase() !== 'false';
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const FROM = process.env.SMTP_FROM || (USER ? `SAYE <${USER}>` : '');
const BRAND = process.env.SITE_NAME || 'SAYE';

/** SMTP bilgileri tanimli mi? */
const mailEnabled = Boolean(USER && PASS);

let transport = null;
if (mailEnabled) {
  transport = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: SECURE,
    auth: { user: USER, pass: PASS },
  });
}

/** Dogrulama e-postasinin HTML govdesi. */
function verificationHtml(code) {
  return `<!DOCTYPE html>
<html lang="tr">
<body style="margin:0;padding:24px;background:#0b0e13;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#141922;border:1px solid #242d3a;border-radius:8px;overflow:hidden">
    <div style="padding:20px 28px;border-bottom:1px solid #242d3a;background:linear-gradient(90deg,rgba(217,43,60,.16),transparent 60%)">
      <span style="color:#e2e9f1;font-size:18px;font-weight:700;letter-spacing:.06em">${BRAND}</span>
    </div>
    <div style="padding:28px">
      <h1 style="margin:0 0 12px;color:#e2e9f1;font-size:20px">E-posta Dogrulama</h1>
      <p style="margin:0 0 20px;color:#9dabbb;font-size:14px;line-height:1.7">
        Hesabini olusturmak icin asagidaki 6 haneli kodu kullan. Kod 10 dakika gecerlidir.
      </p>
      <div style="text-align:center;margin:0 0 20px">
        <span style="display:inline-block;padding:14px 26px;background:#1b222c;border:1px solid #242d3a;border-radius:6px;color:#fff;font-size:30px;font-weight:700;letter-spacing:.35em">${code}</span>
      </div>
      <p style="margin:0;color:#6f7d8d;font-size:12px;line-height:1.7">
        Bu kodu sen istemediysen bu e-postayi yok sayabilirsin.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Dogrulama kodunu e-posta ile gonderir.
 * @returns {Promise<{sent: boolean, test?: boolean}>}
 */
async function sendVerificationCode(to, code) {
  if (!mailEnabled) {
    console.log(`[mail-test-modu] ${to} adresi icin dogrulama kodu: ${code}`);
    return { sent: false, test: true };
  }
  await transport.sendMail({
    from: FROM,
    to,
    subject: `${BRAND} - E-posta Dogrulama Kodunuz`,
    text: `Dogrulama kodunuz: ${code}\nKod 10 dakika gecerlidir.`,
    html: verificationHtml(code),
  });
  return { sent: true };
}

module.exports = { sendVerificationCode, mailEnabled };
