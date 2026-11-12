import crypto from 'node:crypto';
import { config } from './config.js';

const key = crypto.createHash('sha256').update(`enc:${config.appSecret}`).digest();
const hmacKey = crypto.createHash('sha256').update(`idx:${config.appSecret}`).digest();

/** Normalizes Korean mobile numbers. Returns 11/10-digit "01X..." string or null. */
export function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.startsWith('82')) d = '0' + d.slice(2).replace(/^0/, '');
  if (!/^01[016789]\d{7,8}$/.test(d)) return null;
  if (d.startsWith('010') && d.length !== 11) return null;
  return d;
}

export function maskPhone(p) {
  return `${p.slice(0, 3)}-****-${p.slice(-4)}`;
}

export function hashPhone(p) {
  return crypto.createHmac('sha256', hmacKey).update(p).digest('hex');
}

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(blob) {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export function token(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}
