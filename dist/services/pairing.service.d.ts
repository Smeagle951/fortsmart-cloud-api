export declare function createPairingSession(input: {
    apiKeyFarmId: string | null;
    farmCloudId: string;
    desktopInstallationId: string;
    ip?: string | null;
    userAgent?: string | null;
}): Promise<{
    id: string;
    farm_cloud_id: string;
    farm_name: string;
    pairing_code: string;
    pairing_token: string;
    expires_at: string;
    api_url: string;
}>;
export declare function consumePairingSession(input: {
    pairingToken?: string;
    pairingCode?: string;
    farmLocalId?: string | null;
    deviceId: string;
    appVersion?: string | null;
    platform?: string | null;
    deviceName?: string | null;
    ip?: string | null;
    userAgent?: string | null;
}): Promise<{
    farm_cloud_id: string;
    farm_name: string;
    api_key: string;
    session_token: string;
    expires_at: string;
    permissions: string[];
}>;
export declare function getPairingSessionStatus(input: {
    apiKeyFarmId: string | null;
    sessionId: string;
}): Promise<{
    id: string;
    status: string;
    expires_at: string;
    consumed_at: string | null;
    consumed_by_device_id: string | null;
}>;
export declare function revokePairingSession(input: {
    apiKeyFarmId: string | null;
    sessionId: string;
    ip?: string | null;
    userAgent?: string | null;
}): Promise<void>;
export declare function listTrustedDevices(farmId: string | null): Promise<Array<Record<string, unknown>>>;
export declare function revokeTrustedDevice(input: {
    apiKeyFarmId: string | null;
    deviceId: string;
    ip?: string | null;
    userAgent?: string | null;
}): Promise<void>;
export declare function validateDeviceBinding(input: {
    apiKeyHash: string;
    farmId: string | null;
    deviceId?: string | null;
}): Promise<void>;
//# sourceMappingURL=pairing.service.d.ts.map