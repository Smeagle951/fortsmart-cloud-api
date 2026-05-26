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

export function logGenerateOk(meta, layer) {
  console.log(
    `✅ [NDVI][generate] ok plotId=${meta.plotId} layerId=${layer?.layer_id || layer?.id || '-'} ` +
      `status=${layer?.status || '-'} preview=${layer?.preview_url ? 'yes' : 'no'}`,
  );
}
