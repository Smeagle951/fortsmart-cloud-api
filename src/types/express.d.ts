export {};

declare global {
  namespace Express {
    interface Request {
      cloudAuth?: {
        apiKeyId: string;
        farmId: string | null;
        apiKeyHash: string;
        deviceId?: string;
      };
    }
  }
}
