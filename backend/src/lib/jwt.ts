export interface JWTPayload {
  sub: string; // user ID
  role: 'admin' | 'viewer';
  type: 'access' | 'refresh';
  exp: number; // expiration timestamp
  iat: number; // issued at timestamp
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(data: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  const keyData = encoder.encode(secret);
  return await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function generateJWT(
  payload: Omit<JWTPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));

  const data = `${headerB64}.${payloadB64}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const signatureB64 = base64UrlEncode(signature);

  return `${data}.${signatureB64}`;
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    const key = await importKey(secret);
    const signature = base64UrlDecode(signatureB64);
    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      encoder.encode(data)
    );

    if (!isValid) {
      return null;
    }

    const payloadStr = decoder.decode(base64UrlDecode(payloadB64));
    const payload: JWTPayload = JSON.parse(payloadStr);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

export function generateAccessToken(
  userId: string,
  role: 'admin' | 'viewer',
  secret: string
): Promise<string> {
  return generateJWT(
    { sub: userId, role, type: 'access' },
    secret,
    15 * 60 // 15 minutes
  );
}

export function generateRefreshToken(
  userId: string,
  role: 'admin' | 'viewer',
  secret: string
): Promise<string> {
  return generateJWT(
    { sub: userId, role, type: 'refresh' },
    secret,
    30 * 24 * 60 * 60 // 30 days
  );
}
