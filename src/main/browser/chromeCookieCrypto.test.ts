import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { deriveKey, decryptValue, chromeTimestampToUnix, isTrackerDomain, parseRows } from './chromeCookieCrypto';

// ─── Helper: encrypt a value the same way Chrome does ─────────────────────

function encryptCookieValue(
  plaintext: string,
  password: string,
  version: 'v10' | 'v11',
  hostKey: string,
  dbVersion: number,
): string {
  const key = crypto.pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1');
  const iv = Buffer.alloc(16, ' ');

  let data = Buffer.from(plaintext, 'utf8');

  // DB version >= 24: prepend SHA-256 of host_key
  if (dbVersion >= 24) {
    const hash = crypto.createHash('sha256').update(hostKey).digest();
    data = Buffer.concat([hash, data]);
  }

  // PKCS7 padding
  const padLen = 16 - (data.length % 16);
  const padding = Buffer.alloc(padLen, padLen);
  data = Buffer.concat([data, padding]);

  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

  const prefix = Buffer.from(version, 'utf8');
  return Buffer.concat([prefix, encrypted]).toString('hex').toUpperCase();
}

// ─── deriveKey ────────────────────────────────────────────────────────────

describe('deriveKey', () => {
  it('produces a 16-byte buffer', () => {
    const key = deriveKey('peanuts');
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(16);
  });

  it('is deterministic', () => {
    const a = deriveKey('test-password');
    const b = deriveKey('test-password');
    expect(a.equals(b)).toBe(true);
  });

  it('different passwords produce different keys', () => {
    const a = deriveKey('password1');
    const b = deriveKey('password2');
    expect(a.equals(b)).toBe(false);
  });
});

// ─── decryptValue ─────────────────────────────────────────────────────────

describe('decryptValue', () => {
  const v10Password = 'peanuts';
  const v11Password = 'my-secret-key';
  const v11Key = deriveKey(v11Password);

  it('decrypts a v10 cookie (dbVersion < 24)', () => {
    const hex = encryptCookieValue('session_abc123', v10Password, 'v10', '.example.com', 0);
    const result = decryptValue(hex, null, 0, '.example.com');
    expect(result).toBe('session_abc123');
  });

  it('decrypts a v11 cookie (dbVersion < 24)', () => {
    const hex = encryptCookieValue('token_xyz', v11Password, 'v11', '.example.com', 0);
    const result = decryptValue(hex, v11Key, 0, '.example.com');
    expect(result).toBe('token_xyz');
  });

  it('decrypts a v10 cookie (dbVersion >= 24, strips hash prefix)', () => {
    const hex = encryptCookieValue('myvalue', v10Password, 'v10', '.github.com', 24);
    const result = decryptValue(hex, null, 24, '.github.com');
    expect(result).toBe('myvalue');
  });

  it('decrypts a v11 cookie (dbVersion >= 24, strips hash prefix)', () => {
    const hex = encryptCookieValue('auth_token_456', v11Password, 'v11', '.google.com', 24);
    const result = decryptValue(hex, v11Key, 24, '.google.com');
    expect(result).toBe('auth_token_456');
  });

  it('returns null for v11 when no key provided', () => {
    const hex = encryptCookieValue('test', v11Password, 'v11', '.x.com', 0);
    expect(decryptValue(hex, null, 0, '.x.com')).toBeNull();
  });

  it('returns null for empty/short hex', () => {
    expect(decryptValue('', null, 0, '')).toBeNull();
    expect(decryptValue('AB', null, 0, '')).toBeNull();
  });

  it('returns null for unknown version prefix', () => {
    expect(decryptValue('763132AABBCCDD', null, 0, '')).toBeNull(); // "v12"
  });

  it('handles multi-block values', () => {
    const longValue = 'a'.repeat(100);
    const hex = encryptCookieValue(longValue, v10Password, 'v10', '.test.com', 0);
    expect(decryptValue(hex, null, 0, '.test.com')).toBe(longValue);
  });
});

// ─── chromeTimestampToUnix ────────────────────────────────────────────────

describe('chromeTimestampToUnix', () => {
  it('returns 0 for session cookies (chromeTs === 0)', () => {
    expect(chromeTimestampToUnix(0)).toBe(0);
  });

  it('converts Chrome epoch to Unix epoch correctly', () => {
    // Chrome epoch: Jan 1, 1601. Unix epoch: Jan 1, 1970.
    // Difference: 11644473600 seconds = 11644473600000000 microseconds
    // Unix timestamp 0 = Chrome timestamp 11644473600000000
    const unixEpochInChrome = 11_644_473_600_000_000;
    expect(chromeTimestampToUnix(unixEpochInChrome)).toBe(0);
  });

  it('converts a known date correctly', () => {
    // 2025-01-01 00:00:00 UTC = Unix 1735689600
    // Chrome = (1735689600 + 11644473600) * 1000000 = 13380163200000000
    const chromeTs = 13_380_163_200_000_000;
    expect(chromeTimestampToUnix(chromeTs)).toBe(1_735_689_600);
  });
});

// ─── isTrackerDomain ──────────────────────────────────────────────────────

describe('isTrackerDomain', () => {
  it('identifies known ad/tracker domains', () => {
    expect(isTrackerDomain('.ads.doubleclick.net')).toBe(true);
    expect(isTrackerDomain('.googlesyndication.com')).toBe(true);
    expect(isTrackerDomain('.taboola.com')).toBe(true);
    expect(isTrackerDomain('.criteo.com')).toBe(true);
    expect(isTrackerDomain('.adnxs.com')).toBe(true);
    expect(isTrackerDomain('.3lift.com')).toBe(true);
    expect(isTrackerDomain('.rkdms.com')).toBe(true);
    expect(isTrackerDomain('.a-mo.net')).toBe(true);
  });

  it('does not flag legitimate domains', () => {
    expect(isTrackerDomain('.google.com')).toBe(false);
    expect(isTrackerDomain('.github.com')).toBe(false);
    expect(isTrackerDomain('.claude.ai')).toBe(false);
    expect(isTrackerDomain('.reddit.com')).toBe(false);
    expect(isTrackerDomain('.amazon.com')).toBe(false);
    expect(isTrackerDomain('.stripe.com')).toBe(false);
  });
});

// ─── parseRows ────────────────────────────────────────────────────────────

describe('parseRows', () => {
  it('parses pipe-delimited sqlite3 output', () => {
    const output = '.github.com|_octo|/|AABBCC|13438381125477480|1|1|1\n';
    const rows = parseRows(output);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      host_key: '.github.com',
      name: '_octo',
      path: '/',
      encrypted_value_hex: 'AABBCC',
      expires_utc: 13438381125477480,
      is_secure: 1,
      is_httponly: 1,
      samesite: 1,
    });
  });

  it('parses multiple rows', () => {
    const output = [
      '.a.com|name1|/|AA|100|1|0|0',
      '.b.com|name2|/path|BB|200|0|1|2',
    ].join('\n');
    const rows = parseRows(output);
    expect(rows).toHaveLength(2);
    expect(rows[0].host_key).toBe('.a.com');
    expect(rows[1].host_key).toBe('.b.com');
    expect(rows[1].samesite).toBe(2);
  });

  it('skips empty lines', () => {
    const output = '\n.x.com|n|/|FF|0|0|0|0\n\n';
    expect(parseRows(output)).toHaveLength(1);
  });

  it('skips lines with too few fields', () => {
    const output = 'incomplete|data|only\n.x.com|n|/|FF|0|0|0|0\n';
    expect(parseRows(output)).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(parseRows('')).toEqual([]);
    expect(parseRows('\n')).toEqual([]);
  });

  it('handles zero/missing numeric fields', () => {
    const output = '.x.com|n|/|FF||0|0|0\n';
    const rows = parseRows(output);
    expect(rows[0].expires_utc).toBe(0);
  });
});
