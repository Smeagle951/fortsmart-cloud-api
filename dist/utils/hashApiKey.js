import crypto from 'node:crypto';
export function getApiKeyPepper() {
    return process.env.API_KEY_PEPPER ?? '';
}
/** SHA-256 hex da chave + pepper (armazenar só o hash). */
export function hashRawApiKey(rawKey, pepper = getApiKeyPepper()) {
    return crypto.createHash('sha256').update(`${rawKey}${pepper}`, 'utf8').digest('hex');
}
/** Prefixo curto para exibição / admin (não revela a chave completa). */
export function displayKeyPrefix(rawKey) {
    const t = rawKey.trim();
    if (t.length === 0)
        return '(empty)';
    return t.length <= 12 ? `${t.slice(0, 3)}…` : `${t.slice(0, 12)}…`;
}
//# sourceMappingURL=hashApiKey.js.map