import { createHash, randomUUID } from 'node:crypto';

export const IMAGERY_JOB_STATES = Object.freeze({
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const TERMINAL_STATES = new Set([
  IMAGERY_JOB_STATES.READY,
  IMAGERY_JOB_STATES.FAILED,
  IMAGERY_JOB_STATES.CANCELLED,
]);

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableObject(value[key])]),
  );
}

export function imageryJobIdempotencyKey(payload = {}) {
  const relevant = {
    farmId: payload.farmId,
    plotId: payload.plotId,
    campaignId: payload.campaignId || null,
    sceneId: payload.sceneId || null,
    imageDate: payload.imageDate || null,
    polygon: payload.polygon || null,
    modes: Array.isArray(payload.modes) ? [...payload.modes].sort() : null,
    resolutionKind: payload.resolutionKind || 'preview',
    provider: payload.preferredProvider || 'gee',
    algorithmVersion: payload.algorithmVersion || 'spectral_objective_v1',
    maskVersion: payload.maskVersion || 'cloud_score_plus_v1',
    force: payload.force === true,
  };
  return createHash('sha256')
    .update(JSON.stringify(stableObject(relevant)))
    .digest('hex');
}

function modeArtifact(layer, status = {}) {
  const previewUrl = layer?.preview_url || layer?.previewUrl || null;
  const tileUrl = layer?.tile_url || layer?.tileUrl || null;
  const rasterUrl = layer?.raster_url || layer?.rasterUrl || null;
  const stats = layer?.agronomic_stats || layer?.agronomicStats || null;
  const statsReady =
    (stats && typeof stats === 'object' && Object.keys(stats).length > 0) ||
    layer?.ndvi_mean != null ||
    layer?.ndviMean != null;
  const bbox = layer?.bbox || stats?.bbox || stats?.provenance?.bbox;
  const crs = layer?.crs || stats?.crs || stats?.provenance?.crs;
  const hasGeoreference =
    Array.isArray(bbox) &&
    bbox.length === 4 &&
    bbox.every((value) => Number.isFinite(Number(value))) &&
    Number(bbox[0]) >= -180 &&
    Number(bbox[2]) <= 180 &&
    Number(bbox[1]) >= -90 &&
    Number(bbox[3]) <= 90 &&
    Number(bbox[0]) < Number(bbox[2]) &&
    Number(bbox[1]) < Number(bbox[3]) &&
    typeof crs === 'string' &&
    crs.trim().length > 0;
  return {
    numericRaster: Boolean(rasterUrl || layer?.raster_cache_path || layer?.rasterCachePath),
    visualization: Boolean(previewUrl || tileUrl),
    thumbnail: Boolean(previewUrl),
    statistics: Boolean(statsReady),
    export: Boolean(previewUrl || rasterUrl),
    soilCollectionLayer: Boolean(
      (layer?.layer_id || layer?.layerId || layer?.id || status?.layerResultId) &&
        hasGeoreference &&
        status?.status === 'ready',
    ),
  };
}

function readinessFromArtifacts(artifacts = {}) {
  const modes = Object.values(artifacts).filter((item) => item && typeof item === 'object');
  const any = (key) => modes.some((item) => item[key] === true);
  return {
    previewReady: any('thumbnail') || any('visualization'),
    mapReady: any('visualization'),
    analyticsReady: any('statistics'),
    exportReady: any('export'),
    soilCollectionReady: any('soilCollectionLayer'),
  };
}

function publicJob(job, { includeResult = false } = {}) {
  const readiness = readinessFromArtifacts(job.artifacts);
  const response = {
    jobId: job.id,
    idempotencyKey: job.idempotencyKey,
    status: job.status,
    progress: { ...job.progress },
    artifacts: job.artifacts,
    ...readiness,
    heartbeatAt: job.updatedAt,
    providerRequested: job.payload.preferredProvider || 'gee',
    providerUsed: job.providerUsed,
    attempt: job.attempt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
  };
  const canExposePartial =
    includeResult && job.result && (job.status === IMAGERY_JOB_STATES.READY || readiness.previewReady);
  if (canExposePartial) {
    response.result = job.result;
  }
  return response;
}

export class NdviImageryJobStore {
  constructor({ service, now = () => new Date(), schedule = queueMicrotask } = {}) {
    this.service = service;
    this.now = now;
    this.schedule = schedule;
    this.jobs = new Map();
    this.jobsByKey = new Map();
  }

  create(payload) {
    // Chave calculada no servidor: cliente não pode contornar deduplicação.
    const key = imageryJobIdempotencyKey(payload);
    const existingId = this.jobsByKey.get(key);
    const existing = existingId ? this.jobs.get(existingId) : null;
    if (existing && existing.status !== IMAGERY_JOB_STATES.CANCELLED) {
      return { created: false, job: publicJob(existing) };
    }

    const timestamp = this.now().toISOString();
    const job = {
      id: randomUUID(),
      idempotencyKey: key,
      payload: { ...payload },
      ownerFarmId: payload.ownerFarmId || payload.farmId || null,
      status: IMAGERY_JOB_STATES.QUEUED,
      progress: { stage: 'queued', percent: 0, updatedAt: timestamp },
      artifacts: {},
      providerUsed: null,
      attempt: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    this.jobsByKey.set(key, job.id);
    this._schedule(job);
    return { created: true, job: publicJob(job) };
  }

  get(jobId, { ownerFarmId = null } = {}) {
    const job = this.jobs.get(String(jobId));
    if (job && ownerFarmId && String(job.ownerFarmId) !== String(ownerFarmId)) return null;
    if (job) this._markStaleIfAbandoned(job);
    return job ? publicJob(job) : null;
  }

  result(jobId, { ownerFarmId = null } = {}) {
    const job = this.jobs.get(String(jobId));
    if (job && ownerFarmId && String(job.ownerFarmId) !== String(ownerFarmId)) return null;
    return job ? publicJob(job, { includeResult: true }) : null;
  }

  retry(jobId, { ownerFarmId = null } = {}) {
    const job = this.jobs.get(String(jobId));
    if (job && ownerFarmId && String(job.ownerFarmId) !== String(ownerFarmId)) return null;
    if (!job) return null;
    if (!TERMINAL_STATES.has(job.status)) return publicJob(job);
    if (job.status === IMAGERY_JOB_STATES.READY) return publicJob(job);
    if (job.status === IMAGERY_JOB_STATES.FAILED && job.error?.retryable !== true) {
      return publicJob(job);
    }
    const timestamp = this.now().toISOString();
    job.status = IMAGERY_JOB_STATES.QUEUED;
    job.progress = { stage: 'queued_for_retry', percent: 0, updatedAt: timestamp };
    job.updatedAt = timestamp;
    job.startedAt = null;
    job.completedAt = null;
    job.result = null;
    job.error = null;
    job.attempt += 1;
    job.payload = { ...job.payload, force: true };
    this._schedule(job);
    return publicJob(job);
  }

  _schedule(job) {
    this.schedule(() => {
      void this._run(job);
    });
  }

  _progress(job, stage, percent) {
    const timestamp = this.now().toISOString();
    job.progress = { stage, percent, updatedAt: timestamp };
    job.updatedAt = timestamp;
  }

  _markStaleIfAbandoned(job) {
    if (job.status !== IMAGERY_JOB_STATES.PROCESSING && job.status !== IMAGERY_JOB_STATES.QUEUED) {
      return;
    }
    const updated = Date.parse(job.updatedAt || '') || 0;
    if (!updated || this.now().getTime() - updated < 12 * 60 * 1000) return;
    job.status = IMAGERY_JOB_STATES.FAILED;
    job.completedAt = this.now().toISOString();
    job.error = {
      code: 'imagery_job_stale',
      message: 'Trabalho sem progresso. Toque para tentar novamente.',
      retryable: true,
    };
    this._progress(job, 'failed', 100);
  }

  async _run(job) {
    if (job.status !== IMAGERY_JOB_STATES.QUEUED) return;
    job.status = IMAGERY_JOB_STATES.PROCESSING;
    job.startedAt = this.now().toISOString();
    this._progress(job, 'provider_processing', 15);
    const startedMs = this.now().getTime();
    console.info('[NDVI_JOB]', {
      jobId: job.id,
      sceneId: job.payload?.sceneId || null,
      fieldId: job.payload?.plotId || null,
      stage: 'provider_processing',
      startedAt: job.startedAt,
    });
    const heartbeat = setInterval(() => {
      if (job.status !== IMAGERY_JOB_STATES.PROCESSING) return;
      job.updatedAt = this.now().toISOString();
    }, 15000);
    try {
      const result = await this.service.generateLayerPackage(job.payload);
      this._progress(job, 'validating_artifacts', 85);
      const layers = result?.layersByMode || {};
      const statuses = result?.statusesByMode || {};
      job.artifacts = Object.fromEntries(
        Object.entries(layers).map(([mode, layer]) => [
          mode,
          modeArtifact(layer, statuses[mode]),
        ]),
      );
      const requestedModes = Array.isArray(job.payload.modes)
        ? job.payload.modes
        : Object.keys(layers);
      const isFinal = job.payload.resolutionKind === 'final';
      const missingRequired = requestedModes.filter((mode) => {
        const artifact = job.artifacts[mode];
        if (!artifact?.visualization && !artifact?.thumbnail) return true;
        if (!isFinal) return false;
        return !artifact.numericRaster || !artifact.soilCollectionLayer;
      });
      job.result = result;
      job.providerUsed = result?.provider || null;
      if (missingRequired.length > 0) {
        const error = new Error(
          `Artefatos obrigatórios ausentes para: ${missingRequired.join(', ')}`,
        );
        error.code = 'required_artifact_missing';
        error.details = { missingModes: missingRequired, statusesByMode: statuses };
        throw error;
      }
      job.status = IMAGERY_JOB_STATES.READY;
      job.completedAt = this.now().toISOString();
      this._progress(job, 'ready', 100);
      console.info('[NDVI_JOB]', {
        jobId: job.id,
        sceneId: job.payload?.sceneId || null,
        fieldId: job.payload?.plotId || null,
        stage: 'ready',
        durationMs: this.now().getTime() - startedMs,
        previewReady: readinessFromArtifacts(job.artifacts).previewReady,
        mapReady: readinessFromArtifacts(job.artifacts).mapReady,
      });
    } catch (error) {
      job.status = IMAGERY_JOB_STATES.FAILED;
      job.completedAt = this.now().toISOString();
      job.error = {
        code: error?.code || 'imagery_job_failed',
        message: error?.message || 'Falha ao processar imagem.',
        retryable: isRecoverableProviderFailure(error),
        details: error?.details || null,
      };
      this._progress(job, 'failed', 100);
      console.info('[NDVI_JOB]', {
        jobId: job.id,
        sceneId: job.payload?.sceneId || null,
        fieldId: job.payload?.plotId || null,
        stage: 'failed',
        durationMs: this.now().getTime() - startedMs,
        error: job.error?.code,
      });
    } finally {
      clearInterval(heartbeat);
    }
  }
}

export function isRecoverableProviderFailure(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || 0);
  if (
    code.includes('credential') ||
    code.includes('auth') ||
    code.includes('permission') ||
    code.includes('not_configured') ||
    code === 'empty_scenes' ||
    code === 'insufficient_coverage' ||
    code === 'invalid_geometry' ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 422 ||
    code === 'gee_operation_failed' ||
    /credential|service account|unauthori[sz]ed|permission|forbidden/.test(message)
  ) {
    return false;
  }
  return status === 408 || status === 429 || status >= 500 || code.includes('timeout');
}
