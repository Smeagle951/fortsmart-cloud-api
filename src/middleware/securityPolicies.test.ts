import assert from 'node:assert/strict';
import test from 'node:test';
import { createCorsOptions } from './corsPolicy.js';
import { assertAllowedImageMimeType } from './imageUploadPolicy.js';

type OriginCallback = (error: Error | null, allow?: boolean) => void;
type OriginFunction = (origin: string | undefined, callback: OriginCallback) => void;

function originDelegate(options: ReturnType<typeof createCorsOptions>): OriginFunction {
  assert.equal(typeof options.origin, 'function');
  return options.origin as OriginFunction;
}

test('cloud api CORS keeps localhost only outside production', () => {
  const options = createCorsOptions({
    NODE_ENV: 'development',
    CORS_ALLOWED_ORIGINS: 'https://reports.fortsmart-agro.com.br',
  });

  let allowed = false;
  originDelegate(options)('http://localhost:3000', (error, result) => {
    assert.equal(error, null);
    allowed = result === true;
  });

  assert.equal(allowed, true);
});

test('cloud api CORS blocks implicit localhost in production', () => {
  const options = createCorsOptions({
    NODE_ENV: 'production',
    CORS_ALLOWED_ORIGINS: 'https://reports.fortsmart-agro.com.br',
  });

  originDelegate(options)('http://localhost:3000', (error) => {
    assert.match(String(error?.message), /CORS origin not allowed/);
  });
});

test('image upload policy accepts field photos and rejects executable payloads', () => {
  assert.doesNotThrow(() => assertAllowedImageMimeType('image/jpeg'));
  assert.doesNotThrow(() => assertAllowedImageMimeType('image/png'));
  assert.doesNotThrow(() => assertAllowedImageMimeType('image/webp'));
  assert.throws(
    () => assertAllowedImageMimeType('application/x-msdownload'),
    /Tipo de arquivo não permitido/,
  );
});
