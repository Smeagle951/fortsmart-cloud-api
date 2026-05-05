import type { PoolClient } from 'pg';
export type ApiKeyRow = {
    id: string;
    farm_id: string | null;
    key_hash: string;
    key_prefix: string | null;
    is_active: boolean;
};
export declare const DEFAULT_MODULES: readonly ["base", "planting", "monitoring", "inventory", "reports"];
export declare function findActiveByRawKey(rawKey: string): Promise<ApiKeyRow | null>;
export declare function authenticateBearer(authorization: string | undefined): Promise<ApiKeyRow>;
export declare function touchLastUsed(apiKeyId: string, client?: PoolClient): Promise<void>;
/** Documentação: use o mesmo pepper do servidor ao gerar key_hash para INSERT. */
export declare function hashKeyForInsert(rawKey: string): {
    key_hash: string;
    key_prefix: string;
};
//# sourceMappingURL=apiKey.service.d.ts.map