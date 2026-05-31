import { access } from 'node:fs/promises';
import path from 'node:path';

let initialized = false;
let initializing = null;

function readGeeCredentials() {
  const rawJson =
    process.env.GEE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    '';
  if (rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        project_id: parsed.project_id,
      };
    } catch (error) {
      const err = new Error(`GEE_SERVICE_ACCOUNT_JSON inválido: ${error.message}`);
      err.code = 'gee_json_invalid';
      err.status = 500;
      throw err;
    }
  }

  let privateKey =
    process.env.GEE_PRIVATE_KEY ||
    process.env.GEE_PRIVATE_KEY_B64 ||
    '';
  if (process.env.GEE_PRIVATE_KEY_B64 && !process.env.GEE_PRIVATE_KEY) {
    privateKey = Buffer.from(process.env.GEE_PRIVATE_KEY_B64, 'base64').toString('utf8');
  }

  return {
    client_email: process.env.GEE_CLIENT_EMAIL,
    private_key: privateKey,
    project_id: process.env.GEE_PROJECT_ID,
  };
}

async function loadEarthEngine() {
  try {
    const mod = await import('@google/earthengine');
    return mod.default || mod;
  } catch (error) {
    const err = new Error('@google/earthengine não está instalado ou não pôde ser carregado.');
    err.code = 'gee_sdk_missing';
    err.status = 500;
    err.details = { cause: error.message };
    throw err;
  }
}

function getInfo(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.getInfo((value, error) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

async function ensureGeeInitialized(ee) {
  if (initialized) return true;
  if (initializing) return initializing;

  const credentials = readGeeCredentials();
  const clientEmail = String(credentials.client_email || '').trim();
  const privateKey = String(credentials.private_key || '').replace(/\\n/g, '\n').trim();
  const projectId = String(credentials.project_id || process.env.GEE_PROJECT_ID || '').trim();

  if (!clientEmail || !privateKey) {
    const err = new Error(
      'Credenciais GEE ausentes: configure GEE_SERVICE_ACCOUNT_JSON ou GEE_CLIENT_EMAIL/GEE_PRIVATE_KEY.',
    );
    err.code = 'gee_not_configured';
    err.status = 503;
    throw err;
  }

  initializing = new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      {
        client_email: clientEmail,
        private_key: privateKey,
      },
      () => {
        if (projectId && ee.data.setCloudApiUserProject) {
          ee.data.setCloudApiUserProject(projectId);
        }
        ee.initialize(
          null,
          null,
          () => {
            initialized = true;
            resolve(true);
          },
          (error) => reject(error),
        );
      },
      (error) => reject(error),
    );
  }).catch((error) => {
    initializing = null;
    const err = new Error(error?.message || String(error || 'Falha ao inicializar GEE'));
    err.code = 'gee_auth_failed';
    err.status = 502;
    throw err;
  });

  return initializing;
}

async function geeEngineExists() {
  try {
    await access(path.join(process.cwd(), 'ndvi', 'gee', 'geeNdviEngine.js'));
    return true;
  } catch {
    return false;
  }
}

export async function runGeeSmokeTest() {
  const ee = await loadEarthEngine();
  await ensureGeeInitialized(ee);

  const point = ee.Geometry.Point([-54.43, -15.33]);
  const image = ee
    .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(point)
    .sort('system:time_start', false)
    .first();

  const imageId = await getInfo(image.get('system:index'));

  return {
    success: true,
    gee: true,
    image: imageId,
    gee_engine_exists: await geeEngineExists(),
    gee_engine_loaded: false,
  };
}

export async function geeSmokeFailurePayload(error) {
  return {
    success: false,
    gee: false,
    code: error?.code || 'gee_test_failed',
    message: error?.message || String(error || 'Falha no teste GEE'),
    gee_engine_exists: await geeEngineExists(),
    gee_engine_loaded: false,
    details: error?.details || undefined,
  };
}
