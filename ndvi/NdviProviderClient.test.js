import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CopernicusNdviProviderClient,
  GeeNdviProviderClient,
  selectNdviProvider,
} from './NdviProviderClient.js';

describe('NdviProviderClient', () => {
  it('provider_used correto para Copernicus', async () => {
    const provider = new CopernicusNdviProviderClient({
      catalogClient: { searchSentinelScenes: async () => [] },
      processClient: {
        generateNdviLayer: async () => ({ preview_url: 'https://x/preview.png' }),
      },
    });
    const layer = await provider.generateLayer({});
    assert.equal(layer.provider_used, 'copernicus_dataspace');
    assert.equal(layer.processing_engine, 'copernicus_process_api');
  });

  it('provider=gee sem implementação retorna erro claro', async () => {
    assert.throws(
      () => selectNdviProvider({ mode: 'gee', geeClient: new GeeNdviProviderClient() }),
      /desativado por política/,
    );
  });

  it('auto fallback registra provider_used correto', () => {
    const copernicusClient = {};
    const selected = selectNdviProvider({
      mode: 'auto',
      geeClient: new GeeNdviProviderClient(),
      copernicusClient,
    });
    assert.equal(selected.client, copernicusClient);
    assert.equal(selected.fallbackUsed, false);
    assert.equal(selected.provider, 'copernicus_dataspace');
  });

  it('provider=gee exige opt-in antes de permitir o engine', () => {
    const previous = process.env.GEE_ALLOW_USAGE;
    process.env.GEE_ALLOW_USAGE = 'true';
    try {
      assert.throws(
        () => selectNdviProvider({ mode: 'gee', geeClient: new GeeNdviProviderClient() }),
        /not implemented/,
      );
    } finally {
      if (previous === undefined) delete process.env.GEE_ALLOW_USAGE;
      else process.env.GEE_ALLOW_USAGE = previous;
    }
  });
});
