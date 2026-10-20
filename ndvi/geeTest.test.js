import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { geeSmokeFailurePayload, validateGeeNdviStats } from './geeTest.js';

describe('geeTest', () => {
  it('aceita somente estatísticas NDVI completas e fisicamente válidas', () => {
    assert.deepEqual(
      validateGeeNdviStats({
        NDVI_mean: 0.54,
        NDVI_min: 0.12,
        NDVI_max: 0.83,
        NDVI_count: 987,
      }),
      {
        valid: true,
        mean: 0.54,
        min: 0.12,
        max: 0.83,
        validPixelCount: 987,
      },
    );
  });

  it('rejeita resposta sem pixels válidos ou fora da faixa NDVI', () => {
    assert.equal(
      validateGeeNdviStats({
        NDVI_mean: 0,
        NDVI_min: -1.2,
        NDVI_max: 1.1,
        NDVI_count: 0,
      }).valid,
      false,
    );
  });

  it('rejeita estatísticas nulas em vez de tratá-las como zero', () => {
    assert.equal(
      validateGeeNdviStats({
        NDVI_mean: 0.2,
        NDVI_min: null,
        NDVI_max: 0.7,
        NDVI_count: 100,
      }).valid,
      false,
    );
  });

  it('não inclui credenciais no payload de falha', async () => {
    const error = new Error('Falha controlada: private_key=secret-value');
    error.code = 'gee_processing_failed';
    error.details = {
      stage: 'ndvi_statistics',
      timings_ms: { total: 123 },
      cause: 'https://signed.example/secret-value',
    };
    const payload = await geeSmokeFailurePayload(error);

    assert.equal(payload.success, false);
    assert.equal(payload.code, 'gee_processing_failed');
    assert.equal(payload.details.stage, 'ndvi_statistics');
    assert.equal(JSON.stringify(payload).includes('private_key'), false);
    assert.equal(JSON.stringify(payload).includes('client_email'), false);
    assert.equal(JSON.stringify(payload).includes('secret-value'), false);
  });
});
