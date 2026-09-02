/**
 * Timeline unificada NDVI — permite ver onde os minutos somem.
 *
 * Exemplo de log:
 * [NDVI_TIMING] requestId=abc plotId=... sceneId=...
 * [00:00.000] request_started
 * [00:01.230] scene_found
 * [00:02.100] cdse_auth_ok
 * [00:48.500] process_download_done
 * [00:51.200] ndvi_calculated
 * [00:53.000] raster_saved
 * [00:53.400] response_ready TOTAL=53400ms
 */

function pad(ms) {
  const total = Math.max(0, Math.round(ms));
  const sec = Math.floor(total / 1000);
  const rem = String(total % 1000).padStart(3, '0');
  return `${String(sec).padStart(2, '0')}:${rem}`;
}

export function createNdviTimingTrace({
  requestId,
  plotId = '-',
  sceneId = '-',
  farmId = '-',
  mode = '-',
  source = 'backend',
} = {}) {
  const startedAt = Date.now();
  const marks = [];

  function mark(stage, extra = {}) {
    const at = Date.now();
    const elapsedMs = at - startedAt;
    const entry = { stage, elapsedMs, ...extra };
    marks.push(entry);
    const extraStr = Object.keys(extra).length
      ? ` ${Object.entries(extra)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`
      : '';
    console.log(
      `[NDVI_TIMING][${source}] [${pad(elapsedMs)}] ${stage}` +
        ` requestId=${requestId || '-'} plotId=${plotId} sceneId=${sceneId}` +
        ` farmId=${farmId} mode=${mode}${extraStr}`,
    );
    return entry;
  }

  function summary(finalStatus = 'done') {
    const totalMs = Date.now() - startedAt;
    const lines = marks
      .map((m) => `  [${pad(m.elapsedMs)}] ${m.stage}`)
      .join('\n');
    console.log(
      `[NDVI_TIMING][${source}] SUMMARY requestId=${requestId || '-'} ` +
        `plotId=${plotId} sceneId=${sceneId} mode=${mode} ` +
        `status=${finalStatus} TOTAL=${totalMs}ms\n${lines}`,
    );
    return { requestId, totalMs, marks, status: finalStatus };
  }

  return {
    requestId,
    startedAt,
    mark,
    summary,
    elapsedMs: () => Date.now() - startedAt,
  };
}

export function newNdviRequestId(prefix = 'ndvi') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function safeErrorMessage(error) {
  if (!error) return 'unknown';
  return String(error.message || error).slice(0, 500);
}

export function logGenerateStart(meta) {
  console.log(
    `ℹ️ [NDVI][generate] start plotId=${meta.plotId} farmId=${meta.farmId} ` +
      `campaignId=${meta.campaignId || '-'} sceneId=${meta.sceneId || '-'} ` +
      `imageDate=${meta.imageDate || '-'}`,
  );
}

export function logGenerateStage(meta, stage, extra = '') {
  const suffix = extra ? ` ${extra}` : '';
  console.log(
    `ℹ️ [NDVI][generate] stage=${stage} plotId=${meta.plotId} farmId=${meta.farmId}${suffix}`,
  );
}

export function logGenerateFail(meta, stage, error) {
  console.error(
    `❌ [NDVI][generate] failed stage=${stage} plotId=${meta.plotId} ` +
      `farmId=${meta.farmId} code=${error?.code || 'unknown'} ` +
      `msg=${safeErrorMessage(error)}`,
  );
  if (error?.stack) {
    console.error(error.stack.split('\n').slice(0, 8).join('\n'));
  }
}

export function logGenerateOk(meta, layer, extra = {}) {
  const suffix = Object.entries(extra)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  console.log(
    `✅ [NDVI][generate] ok plotId=${meta.plotId} farmId=${meta.farmId} ` +
      `sceneId=${meta.sceneId || '-'} imageDate=${meta.imageDate || '-'} ` +
      `layerId=${layer?.layer_id || layer?.id || '-'} status=${layer?.status || '-'} ` +
      `ndviMean=${layer?.ndvi_mean ?? '-'} ndviMin=${layer?.ndvi_min ?? '-'} ` +
      `ndviMax=${layer?.ndvi_max ?? '-'} preview=${layer?.preview_url ? 'yes' : 'no'} ` +
      `tile=${layer?.tile_url ? 'yes' : 'no'} raster=${layer?.raster_url ? 'yes' : 'no'} ` +
      `veryLow=${layer?.very_low_percent ?? '-'}% low=${layer?.low_percent ?? '-'}% ` +
      `medium=${layer?.medium_percent ?? '-'}% high=${layer?.high_percent ?? '-'}%` +
      (suffix ? ` ${suffix}` : ''),
  );
}
