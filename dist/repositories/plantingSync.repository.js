import { ensurePlantingModuleTables } from '../db/ensurePlantingSchema.js';
import { getOperationalSpec, logSync, upsertGeneric, } from './operationalSync.repository.js';
async function tableHasColumn(client, table, column) {
    const { rows } = await client.query(`SELECT 1 AS ok FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     LIMIT 1`, [table, column]);
    return rows.length > 0;
}
async function loadPlantingChildRows(client, table, farmId, plantingIds, plantingLocalIds) {
    const hasRecordFk = await tableHasColumn(client, table, 'planting_record_id');
    if (hasRecordFk && plantingIds.length > 0) {
        const { rows } = await client.query(`SELECT * FROM ${table}
       WHERE farm_id = $1::uuid AND deleted_at IS NULL
         AND planting_record_id = ANY($2::uuid[])`, [farmId, plantingIds]);
        return rows;
    }
    const hasLocalFk = await tableHasColumn(client, table, 'planting_local_id');
    if (hasLocalFk && plantingLocalIds.length > 0) {
        const { rows } = await client.query(`SELECT * FROM ${table}
       WHERE farm_id = $1::uuid AND deleted_at IS NULL
         AND planting_local_id = ANY($2::text[])`, [farmId, plantingLocalIds]);
        return rows;
    }
    const { rows } = await client.query(`SELECT * FROM ${table} WHERE farm_id = $1::uuid AND deleted_at IS NULL`, [farmId]);
    const idSet = new Set(plantingIds);
    const localSet = new Set(plantingLocalIds);
    return rows.filter((row) => {
        const rid = row.planting_record_id != null ? String(row.planting_record_id) : '';
        const lid = row.planting_local_id != null ? String(row.planting_local_id) : '';
        return (rid && idSet.has(rid)) || (lid && localSet.has(lid));
    });
}
function str(record, key) {
    const value = record[key];
    if (value == null)
        return null;
    const out = String(value).trim();
    return out === '' ? null : out;
}
function localId(record) {
    return str(record, 'local_id') ?? str(record, 'id') ?? '';
}
function num(record, key) {
    const value = record[key];
    if (value == null || value === '')
        return null;
    const out = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(out) ? out : null;
}
function iso(value) {
    if (value == null || value === '')
        return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toISOString();
}
function dateOnly(value) {
    if (value == null || value === '')
        return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toISOString().slice(0, 10);
}
function json(value, fallback) {
    return value == null ? fallback : value;
}
function uuidStr(v) {
    if (!v)
        return null;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : null;
}
async function resolvePlotCloudId(client, farmId, plotLocalId, plotCloudId) {
    const pc = uuidStr(plotCloudId);
    if (pc)
        return pc;
    if (!plotLocalId)
        return null;
    const { rows } = await client.query(`SELECT id::text AS id FROM plots
     WHERE farm_id = $1::uuid AND deleted_at IS NULL AND local_id = $2
     LIMIT 1`, [farmId, plotLocalId]);
    return rows[0]?.id ?? null;
}
async function resolvePlantingRecordId(client, farmId, plantingLocalId) {
    if (!plantingLocalId)
        return null;
    const { rows } = await client.query(`SELECT id::text AS id FROM planting_records
     WHERE farm_id = $1::uuid AND local_id = $2 AND deleted_at IS NULL
     LIMIT 1`, [farmId, plantingLocalId]);
    return rows[0]?.id ?? null;
}
export async function upsertPlantingBundle(client, farmId, records, body, deviceId) {
    const spec = getOperationalSpec('planting');
    const mapping = {
        planting_records: {},
        stand_evaluations: {},
        cv_records: {},
        calibration_records: {},
        phenology_records: {},
        geo_exports: {},
        images: {},
    };
    const failed = [];
    const mPlant = mapping.planting_records;
    const mStand = mapping.stand_evaluations;
    const mCv = mapping.cv_records;
    const mCalib = mapping.calibration_records;
    const mPhen = mapping.phenology_records;
    const mGeo = mapping.geo_exports;
    const mImg = mapping.images;
    const seen = {
        stand: new Set(),
        cv: new Set(),
        calib: new Set(),
        phen: new Set(),
        geo: new Set(),
        img: new Set(),
    };
    async function upsertOneChild(table, values, jsonCols, mapBucket, seenSet, entity) {
        const lid = str(values, 'local_id');
        if (!lid)
            return;
        if (seenSet.has(lid))
            return;
        seenSet.add(lid);
        try {
            const id = await upsertGeneric(client, table, values, jsonCols);
            mapBucket[lid] = id;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failed.push({ local_id: lid, error: message });
            await logSync(client, farmId, {
                module: 'planting',
                entity,
                local_id: lid,
                action: 'push',
                status: 'error',
                error_message: message,
                device_id: deviceId,
            });
        }
    }
    for (const record of records) {
        const plocal = localId(record);
        if (!plocal) {
            failed.push({ local_id: null, error: 'missing planting local_id' });
            continue;
        }
        try {
            const plotLocal = str(record, 'plot_local_id');
            const resolvedPlot = await resolvePlotCloudId(client, farmId, plotLocal, str(record, 'plot_cloud_id'));
            const enriched = { ...record, plot_cloud_id: resolvedPlot ?? record.plot_cloud_id };
            const values = spec.buildValues(enriched, farmId);
            const keys = Object.keys(values);
            const columns = keys.join(', ');
            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            const updateColumns = keys
                .filter((key) => key !== 'id' && key !== 'farm_id' && key !== 'local_id' && key !== 'created_at')
                .map((key) => `${key} = EXCLUDED.${key}`)
                .join(', ');
            const params = keys.map((key) => {
                const value = values[key];
                if (key === 'raw_payload' || key === 'photos' || key === 'geojson') {
                    return value == null ? null : JSON.stringify(value);
                }
                return value;
            });
            const { rows } = await client.query(`INSERT INTO ${spec.table} (${columns})
         VALUES (${placeholders})
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           ${updateColumns},
           updated_at = NOW()
         RETURNING id`, params);
            const plantingId = rows[0]?.id;
            if (!plantingId)
                throw new Error('planting upsert returned no id');
            mPlant[plocal] = plantingId;
            const plotL = str(record, 'plot_local_id');
            const processStand = async (child) => {
                const lid = localId(child) || str(child, 'id') || '';
                if (!lid)
                    return;
                await upsertOneChild('plant_stand_records', {
                    local_id: lid,
                    farm_id: farmId,
                    planting_record_id: plantingId,
                    planting_local_id: plocal,
                    plot_local_id: str(child, 'plot_local_id') ?? str(child, 'talhao_id') ?? plotL,
                    plot_cloud_id: uuidStr(str(child, 'plot_cloud_id')),
                    subarea_local_id: str(child, 'subarea_local_id') ?? str(child, 'subarea_id'),
                    subarea_cloud_id: uuidStr(str(child, 'subarea_cloud_id')),
                    deleted_at: iso(child.deleted_at),
                    evaluation_date: iso(child.evaluation_date ?? child.data_avaliacao ?? child.date),
                    emergence_date: dateOnly(child.emergence_date ?? child.data_emergencia),
                    phenological_stage: str(child, 'phenological_stage') ?? str(child, 'estagio_fenologico'),
                    plants_counted: num(child, 'plants_counted') ?? num(child, 'plantas_contadas'),
                    meters_evaluated: num(child, 'meters_evaluated') ?? num(child, 'comprimento_amostrado_m'),
                    plants_per_meter: num(child, 'plants_per_meter') ?? num(child, 'plantas_por_metro'),
                    plants_per_hectare: num(child, 'plants_per_hectare') ?? num(child, 'plantas_por_hectare'),
                    ideal_population: num(child, 'ideal_population') ?? num(child, 'populacao_ideal'),
                    efficiency: num(child, 'efficiency') ?? num(child, 'eficiencia'),
                    observations: str(child, 'observations') ?? str(child, 'observacoes'),
                    photos: json(child.photos, child.fotos ?? []),
                    raw_payload: child,
                }, ['raw_payload', 'photos'], mStand, seen.stand, 'plant_stand_record');
            };
            const processCv = async (child) => {
                const lid = localId(child) || str(child, 'id') || '';
                if (!lid)
                    return;
                await upsertOneChild('planting_cv_records', {
                    local_id: lid,
                    farm_id: farmId,
                    planting_record_id: plantingId,
                    planting_local_id: plocal,
                    plot_local_id: str(child, 'plot_local_id') ?? str(child, 'talhao_id') ?? plotL,
                    plot_cloud_id: uuidStr(str(child, 'plot_cloud_id')),
                    subarea_local_id: str(child, 'subarea_local_id') ?? str(child, 'subarea_id'),
                    subarea_cloud_id: uuidStr(str(child, 'subarea_cloud_id')),
                    deleted_at: iso(child.deleted_at),
                    cv_percent: num(child, 'cv_percent') ?? num(child, 'coeficiente_variacao'),
                    stand_cv_percent: num(child, 'stand_cv_percent'),
                    spacing_between_seeds: num(child, 'spacing_between_seeds'),
                    average_spacing: num(child, 'average_spacing') ?? num(child, 'espacamento_medio'),
                    standard_deviation: num(child, 'standard_deviation') ?? num(child, 'desvio_padrao'),
                    failures_count: num(child, 'failures_count') ?? num(child, 'falhas'),
                    doubles_count: num(child, 'doubles_count') ?? num(child, 'duplas'),
                    triples_count: num(child, 'triples_count') ?? num(child, 'triplas'),
                    failure_percent: num(child, 'failure_percent'),
                    doubles_percent: num(child, 'doubles_percent'),
                    triples_percent: num(child, 'triples_percent'),
                    estimated_population: num(child, 'estimated_population') ?? num(child, 'populacao_estimada_hectare'),
                    classification: str(child, 'classification') ?? str(child, 'classificacao'),
                    comparison_status_population: str(child, 'comparison_status_population'),
                    comparison_status_plants_meter: str(child, 'comparison_status_plants_meter'),
                    detailed_metrics: json(child.detailed_metrics, null),
                    calculation_details: json(child.calculation_details, null),
                    raw_payload: child,
                }, ['raw_payload', 'detailed_metrics', 'calculation_details'], mCv, seen.cv, 'planting_cv_record');
            };
            const processCalib = async (child) => {
                const lid = localId(child) || str(child, 'id') || '';
                if (!lid)
                    return;
                await upsertOneChild('planting_calibration_records', {
                    local_id: lid,
                    farm_id: farmId,
                    planting_record_id: plantingId,
                    planting_local_id: plocal,
                    plot_local_id: str(child, 'plot_local_id') ?? str(child, 'talhao_id') ?? plotL,
                    plot_cloud_id: uuidStr(str(child, 'plot_cloud_id')),
                    subarea_local_id: str(child, 'subarea_local_id') ?? str(child, 'subarea_id'),
                    subarea_cloud_id: uuidStr(str(child, 'subarea_cloud_id')),
                    deleted_at: iso(child.deleted_at),
                    calibration_date: iso(child.calibration_date ?? child.data_calibragem ?? child.data),
                    seeds_per_meter: num(child, 'seeds_per_meter') ?? num(child, 'sementes_por_metro'),
                    seeds_per_hectare: num(child, 'seeds_per_hectare') ?? num(child, 'sementes_por_hectare'),
                    target_seeds_hectare: num(child, 'target_seeds_hectare') ?? num(child, 'meta_sementes_ha'),
                    spacing_cm: num(child, 'spacing_cm') ?? num(child, 'espacamento_cm'),
                    distance_measured: num(child, 'distance_measured') ?? num(child, 'distancia_medida'),
                    transmission_ratio: num(child, 'transmission_ratio') ?? num(child, 'relacao_transmissao'),
                    gear_drive: str(child, 'gear_drive') ?? str(child, 'pinhao'),
                    gear_driven: str(child, 'gear_driven') ?? str(child, 'coroa'),
                    calibration_status: str(child, 'calibration_status') ?? str(child, 'status'),
                    notes: str(child, 'notes') ?? str(child, 'observacoes'),
                    raw_payload: child,
                }, ['raw_payload'], mCalib, seen.calib, 'planting_calibration_record');
            };
            const processPhen = async (child) => {
                const lid = localId(child) || str(child, 'id') || '';
                if (!lid)
                    return;
                await upsertOneChild('phenology_records', {
                    local_id: lid,
                    farm_id: farmId,
                    planting_record_id: plantingId,
                    planting_local_id: plocal,
                    plot_local_id: str(child, 'plot_local_id') ?? str(child, 'talhao_id') ?? plotL,
                    plot_cloud_id: uuidStr(str(child, 'plot_cloud_id')),
                    subarea_local_id: str(child, 'subarea_local_id') ?? str(child, 'subarea_id'),
                    subarea_cloud_id: uuidStr(str(child, 'subarea_cloud_id')),
                    crop_local_id: str(child, 'crop_local_id'),
                    crop_cloud_id: uuidStr(str(child, 'crop_cloud_id')),
                    deleted_at: iso(child.deleted_at),
                    evaluation_date: iso(child.evaluation_date ?? child.data_avaliacao ?? child.date),
                    stage: str(child, 'stage') ?? str(child, 'phenological_stage') ?? str(child, 'estagio'),
                    description: str(child, 'description') ?? str(child, 'descricao'),
                    dae: num(child, 'dae') ?? num(child, 'dias_apos_emergencia'),
                    dap: num(child, 'dap') ?? num(child, 'dias_apos_plantio'),
                    latitude: num(child, 'latitude'),
                    longitude: num(child, 'longitude'),
                    photos: json(child.photos, []),
                    notes: str(child, 'notes') ?? str(child, 'observations') ?? str(child, 'observacoes'),
                    raw_payload: child,
                }, ['raw_payload', 'photos'], mPhen, seen.phen, 'phenology_record');
            };
            const processGeo = async (child) => {
                const lid = localId(child) || str(child, 'id') || '';
                if (!lid)
                    return;
                await upsertOneChild('geo_exports', {
                    local_id: lid,
                    farm_id: farmId,
                    planting_record_id: plantingId,
                    planting_local_id: plocal,
                    plot_local_id: str(child, 'plot_local_id') ?? plotL,
                    plot_cloud_id: uuidStr(str(child, 'plot_cloud_id')),
                    subarea_local_id: str(child, 'subarea_local_id'),
                    subarea_cloud_id: uuidStr(str(child, 'subarea_cloud_id')),
                    deleted_at: iso(child.deleted_at),
                    type: str(child, 'type') ?? 'geojson',
                    file_name: str(child, 'file_name') ?? str(child, 'name'),
                    latitude: num(child, 'latitude'),
                    longitude: num(child, 'longitude'),
                    geojson: child.geojson ?? null,
                    kml_text: str(child, 'kml_text') ?? str(child, 'kml'),
                    notes: str(child, 'notes') ?? str(child, 'observations'),
                    raw_payload: child,
                }, ['raw_payload', 'geojson'], mGeo, seen.geo, 'geo_export');
            };
            const processImg = async (child) => {
                const lid = localId(child) || str(child, 'id') || '';
                if (!lid)
                    return;
                await upsertOneChild('planting_images', {
                    local_id: lid,
                    farm_id: farmId,
                    planting_record_id: plantingId,
                    planting_local_id: plocal,
                    file_name: str(child, 'file_name'),
                    local_path: str(child, 'local_path'),
                    cloud_url: str(child, 'cloud_url'),
                    cloud_storage_key: str(child, 'cloud_storage_key'),
                    cloud_expires_at: iso(child.cloud_expires_at),
                    caption: str(child, 'caption'),
                    taken_at: iso(child.taken_at),
                    latitude: num(child, 'latitude'),
                    longitude: num(child, 'longitude'),
                    raw_payload: child,
                }, ['raw_payload'], mImg, seen.img, 'planting_image');
            };
            const standArr = Array.isArray(record.stand_evaluations) ? record.stand_evaluations : [];
            for (const s of standArr) {
                if (typeof s === 'object' && s !== null && !Array.isArray(s))
                    await processStand(s);
            }
            const cvArr = Array.isArray(record.cv_records) ? record.cv_records : [];
            for (const s of cvArr) {
                if (typeof s === 'object' && s !== null && !Array.isArray(s))
                    await processCv(s);
            }
            const calArr = Array.isArray(record.calibration_records) ? record.calibration_records : [];
            for (const s of calArr) {
                if (typeof s === 'object' && s !== null && !Array.isArray(s))
                    await processCalib(s);
            }
            const phenArr = Array.isArray(record.phenology_records) ? record.phenology_records : [];
            for (const s of phenArr) {
                if (typeof s === 'object' && s !== null && !Array.isArray(s))
                    await processPhen(s);
            }
            const geoArr = Array.isArray(record.geo_exports) ? record.geo_exports : [];
            for (const s of geoArr) {
                if (typeof s === 'object' && s !== null && !Array.isArray(s))
                    await processGeo(s);
            }
            const imgArr = Array.isArray(record.images) ? record.images : [];
            for (const s of imgArr) {
                if (typeof s === 'object' && s !== null && !Array.isArray(s))
                    await processImg(s);
            }
            await logSync(client, farmId, {
                module: 'planting',
                entity: spec.entity,
                local_id: plocal,
                cloud_id: plantingId,
                action: 'push',
                status: 'ok',
                device_id: deviceId,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            failed.push({ local_id: plocal, error: message });
            await logSync(client, farmId, {
                module: 'planting',
                entity: spec.entity,
                local_id: plocal,
                action: 'push',
                status: 'error',
                error_message: message,
                device_id: deviceId,
            });
        }
    }
    const mergeOrphans = async (list, processor) => {
        if (!list)
            return;
        for (const raw of list) {
            if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
                continue;
            const row = raw;
            const pLocal = str(row, 'planting_local_id') ??
                str(row, 'plantio_id') ??
                str(row, 'planting_id') ??
                str(row, 'plantioId');
            const parentId = await resolvePlantingRecordId(client, farmId, pLocal);
            await processor(row, parentId);
        }
    };
    await mergeOrphans(body.stand_evaluations_all, async (row, parentId) => {
        if (!parentId) {
            failed.push({ local_id: localId(row), error: 'stand_evaluations_all: planting pai não encontrado' });
            return;
        }
        const lid = localId(row) || str(row, 'id') || '';
        if (!lid)
            return;
        const plantingLocal = str(row, 'planting_local_id') ?? str(row, 'plantio_id') ?? '';
        await upsertOneChild('plant_stand_records', {
            local_id: lid,
            farm_id: farmId,
            planting_record_id: parentId,
            planting_local_id: plantingLocal,
            plot_local_id: str(row, 'plot_local_id') ?? str(row, 'talhao_id'),
            plot_cloud_id: uuidStr(str(row, 'plot_cloud_id')),
            subarea_local_id: str(row, 'subarea_local_id') ?? str(row, 'subarea_id'),
            subarea_cloud_id: uuidStr(str(row, 'subarea_cloud_id')),
            deleted_at: iso(row.deleted_at),
            evaluation_date: iso(row.evaluation_date ?? row.data_avaliacao),
            emergence_date: dateOnly(row.emergence_date ?? row.data_emergencia),
            phenological_stage: str(row, 'phenological_stage') ?? str(row, 'estagio_fenologico'),
            plants_counted: num(row, 'plants_counted') ?? num(row, 'plantas_contadas'),
            meters_evaluated: num(row, 'meters_evaluated') ?? num(row, 'comprimento_amostrado_m'),
            plants_per_meter: num(row, 'plants_per_meter'),
            plants_per_hectare: num(row, 'plants_per_hectare') ?? num(row, 'plantas_por_hectare'),
            ideal_population: num(row, 'ideal_population'),
            efficiency: num(row, 'efficiency'),
            observations: str(row, 'observations') ?? str(row, 'observacoes'),
            photos: json(row.photos, row.fotos ?? []),
            raw_payload: row,
        }, ['raw_payload', 'photos'], mStand, seen.stand, 'plant_stand_record');
    });
    await mergeOrphans(body.cv_records_all, async (row, parentId) => {
        if (!parentId) {
            failed.push({ local_id: localId(row), error: 'cv_records_all: planting pai não encontrado' });
            return;
        }
        const lid = localId(row) || str(row, 'id') || '';
        if (!lid)
            return;
        const plantingLocal = str(row, 'planting_local_id') ?? str(row, 'plantio_id') ?? '';
        await upsertOneChild('planting_cv_records', {
            local_id: lid,
            farm_id: farmId,
            planting_record_id: parentId,
            planting_local_id: plantingLocal,
            plot_local_id: str(row, 'plot_local_id') ?? str(row, 'talhao_id'),
            plot_cloud_id: uuidStr(str(row, 'plot_cloud_id')),
            subarea_local_id: str(row, 'subarea_local_id') ?? str(row, 'subarea_id'),
            subarea_cloud_id: uuidStr(str(row, 'subarea_cloud_id')),
            deleted_at: iso(row.deleted_at),
            cv_percent: num(row, 'cv_percent') ?? num(row, 'coeficiente_variacao'),
            stand_cv_percent: num(row, 'stand_cv_percent'),
            spacing_between_seeds: num(row, 'spacing_between_seeds'),
            average_spacing: num(row, 'average_spacing'),
            standard_deviation: num(row, 'standard_deviation'),
            failures_count: num(row, 'failures_count'),
            doubles_count: num(row, 'doubles_count'),
            triples_count: num(row, 'triples_count'),
            failure_percent: num(row, 'failure_percent'),
            doubles_percent: num(row, 'doubles_percent'),
            triples_percent: num(row, 'triples_percent'),
            estimated_population: num(row, 'estimated_population') ?? num(row, 'populacao_estimada_hectare'),
            classification: str(row, 'classification') ?? str(row, 'classificacao'),
            comparison_status_population: str(row, 'comparison_status_population'),
            comparison_status_plants_meter: str(row, 'comparison_status_plants_meter'),
            detailed_metrics: json(row.detailed_metrics, null),
            calculation_details: json(row.calculation_details, null),
            raw_payload: row,
        }, ['raw_payload', 'detailed_metrics', 'calculation_details'], mCv, seen.cv, 'planting_cv_record');
    });
    await mergeOrphans(body.calibration_records_all, async (row, parentId) => {
        if (!parentId) {
            failed.push({ local_id: localId(row), error: 'calibration_records_all: planting pai não encontrado' });
            return;
        }
        const lid = localId(row) || str(row, 'id') || '';
        if (!lid)
            return;
        const plantingLocal = str(row, 'planting_local_id') ?? str(row, 'plantio_id') ?? '';
        await upsertOneChild('planting_calibration_records', {
            local_id: lid,
            farm_id: farmId,
            planting_record_id: parentId,
            planting_local_id: plantingLocal,
            plot_local_id: str(row, 'plot_local_id') ?? str(row, 'talhao_id'),
            plot_cloud_id: uuidStr(str(row, 'plot_cloud_id')),
            subarea_local_id: str(row, 'subarea_local_id'),
            subarea_cloud_id: uuidStr(str(row, 'subarea_cloud_id')),
            deleted_at: iso(row.deleted_at),
            calibration_date: iso(row.calibration_date ?? row.data_calibragem ?? row.data),
            seeds_per_meter: num(row, 'seeds_per_meter'),
            seeds_per_hectare: num(row, 'seeds_per_hectare'),
            target_seeds_hectare: num(row, 'target_seeds_hectare'),
            spacing_cm: num(row, 'spacing_cm'),
            distance_measured: num(row, 'distance_measured'),
            transmission_ratio: num(row, 'transmission_ratio'),
            gear_drive: str(row, 'gear_drive'),
            gear_driven: str(row, 'gear_driven'),
            calibration_status: str(row, 'calibration_status'),
            notes: str(row, 'notes') ?? str(row, 'observacoes'),
            raw_payload: row,
        }, ['raw_payload'], mCalib, seen.calib, 'planting_calibration_record');
    });
    await mergeOrphans(body.phenology_records_all, async (row, parentId) => {
        if (!parentId) {
            failed.push({ local_id: localId(row), error: 'phenology_records_all: planting pai não encontrado' });
            return;
        }
        const lid = localId(row) || str(row, 'id') || '';
        if (!lid)
            return;
        const plantingLocal = str(row, 'planting_local_id') ?? str(row, 'plantio_id') ?? '';
        await upsertOneChild('phenology_records', {
            local_id: lid,
            farm_id: farmId,
            planting_record_id: parentId,
            planting_local_id: plantingLocal,
            plot_local_id: str(row, 'plot_local_id') ?? str(row, 'talhao_id'),
            plot_cloud_id: uuidStr(str(row, 'plot_cloud_id')),
            subarea_local_id: str(row, 'subarea_local_id'),
            subarea_cloud_id: uuidStr(str(row, 'subarea_cloud_id')),
            crop_local_id: str(row, 'crop_local_id'),
            crop_cloud_id: uuidStr(str(row, 'crop_cloud_id')),
            deleted_at: iso(row.deleted_at),
            evaluation_date: iso(row.evaluation_date ?? row.data),
            stage: str(row, 'stage') ?? str(row, 'phenological_stage'),
            description: str(row, 'description'),
            dae: num(row, 'dae'),
            dap: num(row, 'dap'),
            latitude: num(row, 'latitude'),
            longitude: num(row, 'longitude'),
            photos: json(row.photos, []),
            notes: str(row, 'notes') ?? str(row, 'observacoes'),
            raw_payload: row,
        }, ['raw_payload', 'photos'], mPhen, seen.phen, 'phenology_record');
    });
    await mergeOrphans(body.geo_exports_all, async (row, parentId) => {
        if (!parentId) {
            failed.push({ local_id: localId(row), error: 'geo_exports_all: planting pai não encontrado' });
            return;
        }
        const lid = localId(row) || str(row, 'id') || '';
        if (!lid)
            return;
        const plantingLocal = str(row, 'planting_local_id') ?? str(row, 'plantio_id') ?? '';
        await upsertOneChild('geo_exports', {
            local_id: lid,
            farm_id: farmId,
            planting_record_id: parentId,
            planting_local_id: plantingLocal,
            plot_local_id: str(row, 'plot_local_id'),
            plot_cloud_id: uuidStr(str(row, 'plot_cloud_id')),
            subarea_local_id: str(row, 'subarea_local_id'),
            subarea_cloud_id: uuidStr(str(row, 'subarea_cloud_id')),
            deleted_at: iso(row.deleted_at),
            type: str(row, 'type') ?? 'geojson',
            file_name: str(row, 'file_name'),
            latitude: num(row, 'latitude'),
            longitude: num(row, 'longitude'),
            geojson: row.geojson ?? null,
            kml_text: str(row, 'kml_text'),
            notes: str(row, 'notes'),
            raw_payload: row,
        }, ['raw_payload', 'geojson'], mGeo, seen.geo, 'geo_export');
    });
    return { mapping, failed };
}
export async function loadPlantingWindowsPayload(client, farmId) {
    await ensurePlantingModuleTables(client);
    const { rows: plantings } = await client.query(`SELECT pr.*,
            p.id::text AS resolved_plot_id,
            p.local_id AS resolved_plot_local_id,
            COALESCE(NULLIF(TRIM(pr.plot_name), ''), NULLIF(TRIM(p.name), '')) AS resolved_plot_name
     FROM planting_records pr
     LEFT JOIN plots p
       ON p.farm_id = pr.farm_id
      AND p.deleted_at IS NULL
      AND (p.id = pr.plot_cloud_id OR (pr.plot_local_id IS NOT NULL AND p.local_id = pr.plot_local_id))
     WHERE pr.farm_id = $1::uuid AND pr.deleted_at IS NULL
     ORDER BY pr.planting_date DESC NULLS LAST, pr.updated_at DESC`, [farmId]);
    if (plantings.length === 0) {
        return {
            farm_id: farmId,
            summary: {
                total_plantings: 0,
                total_stand_evaluations: 0,
                total_cv_records: 0,
                total_phenology_records: 0,
                total_geo_exports: 0,
                total_calibration_records: 0,
                total_images: 0,
                latest_planting_date: null,
            },
            plots: [],
        };
    }
    const ids = plantings.map((r) => String(r.id));
    const localIds = plantings
        .map((r) => (r.local_id != null ? String(r.local_id) : ''))
        .filter((v) => v.length > 0);
    const stands = await loadPlantingChildRows(client, 'plant_stand_records', farmId, ids, localIds);
    const cvs = await loadPlantingChildRows(client, 'planting_cv_records', farmId, ids, localIds);
    const calibs = await loadPlantingChildRows(client, 'planting_calibration_records', farmId, ids, localIds);
    const phens = await loadPlantingChildRows(client, 'phenology_records', farmId, ids, localIds);
    const geos = await loadPlantingChildRows(client, 'geo_exports', farmId, ids, localIds);
    const imgs = await loadPlantingChildRows(client, 'planting_images', farmId, ids, localIds);
    const byPlanting = (pid) => ({
        stand: stands.filter((x) => String(x.planting_record_id) === pid),
        cv: cvs.filter((x) => String(x.planting_record_id) === pid),
        calib: calibs.filter((x) => String(x.planting_record_id) === pid),
        phen: phens.filter((x) => String(x.planting_record_id) === pid),
        geo: geos.filter((x) => String(x.planting_record_id) === pid),
        img: imgs.filter((x) => String(x.planting_record_id) === pid),
    });
    const plotMap = new Map();
    const plotKeyOf = (pr) => String(pr.resolved_plot_id ?? pr.plot_cloud_id ?? pr.plot_local_id ?? 'unknown');
    const latestDates = [];
    for (const pr of plantings) {
        const pid = String(pr.id);
        const rel = byPlanting(pid);
        const plantingOut = {
            ...pr,
            stand_evaluations: rel.stand,
            cv_records: rel.cv,
            calibration_records: rel.calib,
            phenology_records: rel.phen,
            geo_exports: rel.geo,
            images: rel.img,
        };
        const pd = pr.planting_date ? String(pr.planting_date) : null;
        if (pd)
            latestDates.push(pd);
        const pk = plotKeyOf(pr);
        if (!plotMap.has(pk)) {
            plotMap.set(pk, {
                plot_id: pr.resolved_plot_id ?? pr.plot_cloud_id ?? null,
                plot_local_id: pr.plot_local_id ?? pr.resolved_plot_local_id ?? null,
                plot_name: String(pr.resolved_plot_name ?? pr.plot_name ?? 'Talhão'),
                subareas: new Map(),
            });
        }
        const plot = plotMap.get(pk);
        const sk = String(pr.subarea_local_id ?? pr.subarea_cloud_id ?? '_none');
        if (!plot.subareas.has(sk)) {
            plot.subareas.set(sk, {
                subarea_id: pr.subarea_cloud_id ?? null,
                subarea_local_id: pr.subarea_local_id ?? null,
                subarea_name: String(pr.subarea_name ?? (sk === '_none' ? 'Sem subárea' : sk)),
                records: [],
            });
        }
        plot.subareas.get(sk).records.push({
            planting: plantingOut,
            stand_evaluations: rel.stand,
            cv_records: rel.cv,
            calibration_records: rel.calib,
            phenology_records: rel.phen,
            geo_exports: rel.geo,
            images: rel.img,
        });
    }
    const plots = Array.from(plotMap.values()).map((p) => ({
        plot_id: p.plot_id,
        plot_local_id: p.plot_local_id,
        plot_name: p.plot_name,
        subareas: Array.from(p.subareas.values()),
    }));
    const summary = {
        total_plantings: plantings.length,
        total_stand_evaluations: stands.length,
        total_cv_records: cvs.length,
        total_phenology_records: phens.length,
        total_geo_exports: geos.length,
        total_calibration_records: calibs.length,
        total_images: imgs.length,
        latest_planting_date: latestDates.length === 0
            ? null
            : latestDates.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0] ?? null,
    };
    return { farm_id: farmId, summary, plots };
}
//# sourceMappingURL=plantingSync.repository.js.map