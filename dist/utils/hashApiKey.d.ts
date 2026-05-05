export declare function getApiKeyPepper(): string;
/** SHA-256 hex da chave + pepper (armazenar só o hash). */
export declare function hashRawApiKey(rawKey: string, pepper?: string): string;
/** Prefixo curto para exibição / admin (não revela a chave completa). */
export declare function displayKeyPrefix(rawKey: string): string;
//# sourceMappingURL=hashApiKey.d.ts.map