import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import {
  assertApiKeyCanAccessFarm,
  assertPlotBelongsToFarm,
  assertSeasonBelongsToFarm,
} from './resourceAccessGuard.js';

const FARM_A = '11111111-1111-4111-8111-111111111111';
const FARM_B = '22222222-2222-4222-8222-222222222222';

function requestForFarm(farmId: string | null): Request {
  return {
    cloudAuth: farmId
      ? {
          apiKeyId: 'key-1',
          farmId,
          apiKeyHash: 'hash',
          deviceId: 'device-1',
        }
      : undefined,
  } as Request;
}

function fakeDb(hasMatch: boolean) {
  return {
    async query() {
      return {
        rows: hasMatch ? [{ id: 'resource-id' }] : [],
        command: 'SELECT',
        rowCount: hasMatch ? 1 : 0,
        oid: 0,
        fields: [],
      };
    },
  } as never;
}

test('api key linked to Farm A cannot access Farm B', () => {
  assert.equal(assertApiKeyCanAccessFarm(requestForFarm(FARM_A), FARM_A), FARM_A);
  assert.throws(
    () => assertApiKeyCanAccessFarm(requestForFarm(FARM_A), FARM_B),
    /Forbidden/,
  );
});

test('plot guard returns 403 when plot is not found in the requested farm', async () => {
  await assert.doesNotReject(
    assertPlotBelongsToFarm(fakeDb(true), {
      farmId: FARM_A,
      plotLocalId: 'plot-a',
      required: true,
    }),
  );

  await assert.rejects(
    assertPlotBelongsToFarm(fakeDb(false), {
      farmId: FARM_A,
      plotLocalId: 'plot-from-farm-b',
      required: true,
    }),
    /plot does not belong to this farm/,
  );
});

test('season guard returns 403 when season is not found in the requested farm', async () => {
  await assert.doesNotReject(
    assertSeasonBelongsToFarm(fakeDb(true), {
      farmId: FARM_A,
      seasonLocalId: 'safra-a',
    }),
  );

  await assert.rejects(
    assertSeasonBelongsToFarm(fakeDb(false), {
      farmId: FARM_A,
      seasonLocalId: 'safra-from-farm-b',
    }),
    /season does not belong to this farm/,
  );
});
