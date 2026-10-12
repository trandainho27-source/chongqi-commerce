const encoder = new TextEncoder();
export const uid = () => crypto.randomUUID();
export function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
export async function sha(value: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
export function safeEqual(a: string, b: string) {
    let result = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++)
        result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return result === 0;
}
function b64(bytes: Uint8Array) {
    return btoa(String.fromCharCode(...bytes));
}
function bytes(s: string) {
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
export async function hashPassword(password: string, salt = randomToken()) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000 }, key, 256);
    return `pbkdf2:100000:${salt}:${b64(new Uint8Array(bits))}`;
}
export async function verifyPassword(password: string, stored: string) {
    const [, iterations, salt] = stored.split(':');
    return iterations === '100000' && safeEqual(await hashPassword(password, salt), stored);
}
async function aes(secret: string) {
    if (!secret || !/^[a-f0-9]{64}$/i.test(secret))
        throw new Error('INVENTORY_KEY_MISSING');
    return crypto.subtle.importKey('raw', Uint8Array.from(secret.match(/../g)!, x => parseInt(x, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(value: string, secret: string, context: string) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const result = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, await aes(secret), encoder.encode(value));
    return `${b64(iv)}.${b64(new Uint8Array(result))}`;
}
export async function decrypt(value: string, secret: string, context: string) {
    const [iv, payload] = value.split('.');
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: encoder.encode(context) }, await aes(secret), bytes(payload)));
}
export async function hmac(value: string, secret: string) {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
