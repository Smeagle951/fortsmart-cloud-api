import type { Pool } from 'pg';
import type { OperationalModule } from '../validators/operationalSync.validator.js';
export type WindowsOperationalPayload = {
    farm_id: string;
    module: OperationalModule;
    records: Record<string, unknown>[];
    /** Resumo agregado (plantio/monitoramento usam chaves diferentes). */
    summary: Record<string, unknown> & {
        total?: number;
    };
    /** Presente em `/windows/planting` e `/windows/monitoring`. */
    plots?: Array<Record<string, unknown>>;
    diagnostics?: Record<string, unknown>;
};
export declare function loadWindowsOperational(pool: Pool, module: OperationalModule, farmId: string): Promise<WindowsOperationalPayload>;
//# sourceMappingURL=windowsOperational.service.d.ts.map