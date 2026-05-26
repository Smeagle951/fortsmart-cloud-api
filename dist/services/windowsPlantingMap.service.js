import { loadPlantingWindowsPayload } from '../repositories/plantingSync.repository.js';
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function parseGeoJson(value) {
    if (!value)
        return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    return asRecord(value);
}
function collectFeaturesFromGeoJson(geojson) {
    const root = parseGeoJson(geojson);
    if (!root)
        return [];
    const type = String(root.type ?? '');
    if (type === 'FeatureCollection' && Array.isArray(root.features)) {
        return root.features
            .map((f) => asRecord(f))
            .filter((f) => !!f);
    }
    if (type === 'Feature')
        return [root];
    return [];
}
function text(value) {
    if (value == null || value === '')
        return '';
    return String(value).trim();
}
function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
function uniqueStrings(values) {
    return Array.from(new Set(values.filter((v) => v.length > 0)));
}
export async function loadPlantingMapWindowsPayload(pool, farmId) {
    const client = await pool.connect();
    try {
        const planting = await loadPlantingWindowsPayload(client, farmId);
        const { rows: farmRows } = await client.query(`SELECT id, local_id, name, city, state, total_area_ha, updated_at
       FROM farms WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`, [farmId]);
        const farmRow = farmRows[0] ?? { id: farmId };
        const { rows: geoRows } = await client.query(`SELECT geojson, plot_local_id, plot_cloud_id, subarea_local_id, file_name, type, updated_at
       FROM geo_exports
       WHERE farm_id = $1::uuid AND deleted_at IS NULL
       ORDER BY updated_at DESC`, [farmId]);
        const featureSeen = new Set();
        const geo_features = [];
        const pushFeature = (feature, source) => {
            const id = text(feature.id) || text(feature.properties?.talhao_id);
            const key = id || JSON.stringify(feature.geometry ?? feature.properties ?? feature).slice(0, 120);
            if (featureSeen.has(key))
                return;
            featureSeen.add(key);
            const props = asRecord(feature.properties) ?? {};
            if (source) {
                if (!props.plot_cloud_id && source.plot_cloud_id)
                    props.plot_cloud_id = source.plot_cloud_id;
                if (!props.plot_local_id && source.plot_local_id)
                    props.plot_local_id = source.plot_local_id;
            }
            geo_features.push({ ...feature, properties: props });
        };
        for (const row of geoRows) {
            for (const f of collectFeaturesFromGeoJson(row.geojson)) {
                pushFeature(f, row);
            }
        }
        const plantingPlots = Array.isArray(planting.plots) ? planting.plots : [];
        for (const plot of plantingPlots) {
            const pr = plot;
            for (const sub of Array.isArray(pr.subareas) ? pr.subareas : []) {
                const subR = asRecord(sub);
                if (!subR)
                    continue;
                for (const wrapped of Array.isArray(subR.records) ? subR.records : []) {
                    const rec = asRecord(wrapped);
                    if (!rec)
                        continue;
                    for (const geo of Array.isArray(rec.geo_exports) ? rec.geo_exports : []) {
                        const g = asRecord(geo);
                        if (!g)
                            continue;
                        for (const f of collectFeaturesFromGeoJson(g.geojson)) {
                            pushFeature(f, g);
                        }
                    }
                }
            }
        }
        const plots = [];
        const subareas = [];
        const culturas = [];
        const materiais = [];
        let area_total = 0;
        let plantios_ativos = 0;
        for (const feature of geo_features) {
            const props = asRecord(feature.properties) ?? {};
            const tipo = text(props.tipo).toLowerCase();
            const area = number(props.area_ha ?? props.area);
            area_total += area;
            const cultura = text(props.cultura);
            const material = text(props.material || props.variedade || props.hibrido);
            if (cultura)
                culturas.push(cultura);
            if (material)
                materiais.push(material);
            if (text(props.data_plantio) || text(props.plantio_id))
                plantios_ativos += 1;
            if (tipo === 'subarea') {
                subareas.push({
                    id: text(props.subarea_id) || text(feature.id),
                    plot_local_id: text(props.plot_local_id || props.talhao_id),
                    plot_cloud_id: text(props.plot_cloud_id),
                    name: text(props.nome || props.name || props.talhao),
                    area_ha: area,
                    cultura,
                    material,
                    tratamento: text(props.tratamento || props.tipo_manejo || props.subtipo),
                    properties: props,
                    geometry: feature.geometry ?? null,
                });
                continue;
            }
            plots.push({
                id: text(props.talhao_id || props.plot_id || props.plot_local_id) ||
                    text(feature.id),
                plot_local_id: text(props.plot_local_id || props.talhao_id),
                plot_cloud_id: text(props.plot_cloud_id),
                name: text(props.talhao_nome || props.nome || props.name || props.talhao),
                area_ha: area,
                cultura,
                material,
                safra: text(props.safra),
                data_plantio: text(props.data_plantio),
                dae: props.dae ?? null,
                dap: props.dap ?? null,
                estande: props.estande_atual ?? props.estande_pl_ha ?? props.plantas_por_ha ?? null,
                properties: props,
                geometry: feature.geometry ?? null,
            });
        }
        const summary = {
            area_total: Math.round(area_total * 100) / 100,
            total_talhoes: plots.length,
            total_subareas: subareas.length,
            culturas: uniqueStrings(culturas),
            materiais: uniqueStrings(materiais),
            plantios_ativos,
        };
        return {
            farm: {
                id: farmId,
                cloud_id: farmId,
                local_id: farmRow.local_id ?? null,
                name: farmRow.name ?? 'Fazenda',
                city: farmRow.city ?? null,
                state: farmRow.state ?? null,
                total_area_ha: farmRow.total_area_ha ?? summary.area_total,
                ...(asRecord(planting.summary) ?? {}),
            },
            plots,
            subareas,
            geo_features,
            summary,
        };
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=windowsPlantingMap.service.js.map