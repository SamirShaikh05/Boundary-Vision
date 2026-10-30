import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ModelManager, modelHasUpdate, validateModelVersionRequest, validateRegistry } from '../dist-electron/modelManager.js'
import { isAllowedUpdateTransition } from '../dist-electron/updateState.js'

const checkpoint = Buffer.from('verified model bytes')
const digest = createHash('sha256').update(checkpoint).digest('hex')
function registryData(sha256 = digest) {
  return { schemaVersion: 2, models: [{
    id: 'sample-model', name: 'Sample model', description: 'Test fixture', classes: ['Ball'], latestVersion: '2.0',
    versions: [{ version: '2.0', format: 'ultralytics-yolo', checkpointFilename: 'sample.pt', expectedSizeBytes: checkpoint.length,
      sha256, downloadUrl: 'https://assets.example/sample.pt', developmentSource: null }],
  }] }
}

test('model update comparison is version-specific', () => {
  assert.equal(modelHasUpdate('2.0', ['1.0']), true)
  assert.equal(modelHasUpdate('2.0', ['2.0']), false)
  assert.equal(modelHasUpdate('2.0', []), false)
})

test('application updater accepts valid state transitions and rejects impossible jumps', () => {
  assert.equal(isAllowedUpdateTransition('checking', 'available'), true)
  assert.equal(isAllowedUpdateTransition('available', 'downloading'), true)
  assert.equal(isAllowedUpdateTransition('downloading', 'downloaded'), true)
  assert.equal(isAllowedUpdateTransition('error', 'checking'), true)
  assert.equal(isAllowedUpdateTransition('idle', 'downloaded'), false)
  assert.equal(isAllowedUpdateTransition('downloaded', 'checking'), false)
})

test('remote registry validation accepts schema 2 and rejects unsafe or ambiguous data', () => {
  assert.equal(validateRegistry(registryData())[0].latestVersion, '2.0')
  assert.throws(() => validateRegistry({ ...registryData(), schemaVersion: 1 }), /unsupported format/i)
  assert.throws(() => validateRegistry({ ...registryData(), models: [registryData().models[0], registryData().models[0]] }), /duplicate model IDs/i)
  const invalid = registryData()
  invalid.models[0].versions[0].downloadUrl = 'http://assets.example/sample.pt'
  assert.throws(() => validateRegistry(invalid), /HTTPS/i)
})

test('legacy minimumPython metadata does not gate model availability', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bv-model-python-metadata-'))
  const originalFetch = globalThis.fetch
  try {
    const registry = registryData()
    registry.models[0].versions[0].minimumPython = '99.0'
    globalThis.fetch = async () => new Response(JSON.stringify(registry), { status: 200 })
    const parsed = validateRegistry(JSON.parse(JSON.stringify(registry)))
    assert.equal('minimumPython' in parsed[0].versions[0], false)
    const manager = new ModelManager({ registryPath: path.join(directory, 'bundled-registry.json'), developmentModelsDir: directory,
      managedModelsDir: path.join(directory, 'managed'), settingsPath: path.join(directory, 'settings.json') }, async () => undefined)
    const catalog = await manager.list()
    assert.equal(catalog.models[0].versions[0].formatSupported, true)
    assert.equal(catalog.models[0].versions[0].canInstall, true)
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('bundled registry is used when the remote registry is unavailable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bv-model-registry-fallback-'))
  const originalFetch = globalThis.fetch
  try {
    const bundledPath = path.join(directory, 'bundled-registry.json')
    await writeFile(bundledPath, JSON.stringify(registryData()))
    globalThis.fetch = async () => { throw new Error('offline') }
    const manager = new ModelManager({ registryPath: bundledPath, developmentModelsDir: directory,
      managedModelsDir: path.join(directory, 'managed'), settingsPath: path.join(directory, 'settings.json') }, async () => undefined)
    const catalog = await manager.list()
    assert.equal(catalog.models[0].id, 'sample-model')
    assert.equal(catalog.models[0].versions[0].formatSupported, true)
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('model IPC request validation rejects non-string and unsafe identifiers', () => {
  assert.deepEqual(validateModelVersionRequest('sample-model', '2.0'), { modelId: 'sample-model', version: '2.0' })
  assert.throws(() => validateModelVersionRequest('../outside', '2.0'), /invalid model ID/i)
  assert.throws(() => validateModelVersionRequest('sample-model', 2), /invalid model ID/i)
})

test('model install verifies size and SHA-256 before activating staged data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bv-model-update-'))
  const originalFetch = globalThis.fetch
  try {
    const registry = registryData()
    globalThis.fetch = async url => String(url).includes('registry.json')
      ? new Response(JSON.stringify(registry), { status: 200 })
      : new Response(checkpoint, { status: 200 })
    const manager = new ModelManager({ registryPath: path.join(directory, 'bundled-registry.json'), developmentModelsDir: directory,
      managedModelsDir: path.join(directory, 'managed'), settingsPath: path.join(directory, 'settings.json') }, async () => undefined)
    await manager.install('sample-model', '2.0', () => undefined)
    const installed = path.join(directory, 'managed', 'sample-model', '2.0', 'sample.pt')
    assert.equal((await stat(installed)).size, checkpoint.length)
    assert.deepEqual(await readFile(installed), checkpoint)
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('invalid model download is discarded and never activated', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bv-model-update-bad-'))
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async url => String(url).includes('registry.json')
      ? new Response(JSON.stringify(registryData('0'.repeat(64))), { status: 200 })
      : new Response(checkpoint, { status: 200 })
    const manager = new ModelManager({ registryPath: path.join(directory, 'bundled-registry.json'), developmentModelsDir: directory,
      managedModelsDir: path.join(directory, 'managed'), settingsPath: path.join(directory, 'settings.json') }, async () => undefined)
    await assert.rejects(manager.install('sample-model', '2.0', () => undefined), /SHA-256 verification failed/i)
    await assert.rejects(stat(path.join(directory, 'managed', 'sample-model', '2.0', 'sample.pt')))
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test('short and oversized model downloads fail the declared-size check', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const fixture of [
      { expectedSizeBytes: checkpoint.length + 1, responseBytes: checkpoint, error: /Downloaded size mismatch/i },
      { expectedSizeBytes: checkpoint.length - 1, responseBytes: checkpoint, error: /exceeded its declared file size/i },
    ]) {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'bv-model-size-mismatch-'))
      try {
        const registry = registryData()
        registry.models[0].versions[0].expectedSizeBytes = fixture.expectedSizeBytes
        globalThis.fetch = async url => String(url).includes('registry.json')
          ? new Response(JSON.stringify(registry), { status: 200 })
          : new Response(fixture.responseBytes, { status: 200 })
        const manager = new ModelManager({ registryPath: path.join(directory, 'bundled-registry.json'), developmentModelsDir: directory,
          managedModelsDir: path.join(directory, 'managed'), settingsPath: path.join(directory, 'settings.json') }, async () => undefined)
        const target = path.join(directory, 'managed', 'sample-model', '2.0', 'sample.pt')
        await assert.rejects(manager.install('sample-model', '2.0', () => undefined), fixture.error)
        await assert.rejects(stat(target))
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    }
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('checkpoint load failure leaves the previously selected model untouched', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bv-model-validation-failure-'))
  const originalFetch = globalThis.fetch
  const previousBytes = Buffer.from('previous active model')
  const previousDigest = createHash('sha256').update(previousBytes).digest('hex')
  try {
    const registry = registryData()
    registry.models[0].latestVersion = '2.0'
    registry.models[0].versions.unshift({ version: '1.0', format: 'ultralytics-yolo', checkpointFilename: 'sample.pt',
      expectedSizeBytes: previousBytes.length, sha256: previousDigest, downloadUrl: 'https://assets.example/old.pt', developmentSource: null })
    globalThis.fetch = async url => String(url).includes('registry.json')
      ? new Response(JSON.stringify(registry), { status: 200 })
      : new Response(checkpoint, { status: 200 })
    const manager = new ModelManager({ registryPath: path.join(directory, 'bundled-registry.json'), developmentModelsDir: directory,
      managedModelsDir: path.join(directory, 'managed'), settingsPath: path.join(directory, 'settings.json') }, async () => {
      throw new Error('torch dependency could not import')
    })
    const previousPath = path.join(directory, 'managed', 'sample-model', '1.0', 'sample.pt')
    await mkdir(path.dirname(previousPath), { recursive: true })
    await writeFile(previousPath, previousBytes)
    await writeFile(path.join(directory, 'settings.json'), JSON.stringify({ selectedModelId: 'sample-model', selectedModelVersion: '1.0' }))

    await assert.rejects(manager.install('sample-model', '2.0', () => undefined), /torch dependency could not import/)
    assert.deepEqual(await readFile(previousPath), previousBytes)
    assert.deepEqual(await manager.getSelectedModel(), { id: 'sample-model', version: '1.0' })
    await assert.rejects(stat(path.join(directory, 'managed', 'sample-model', '2.0', 'sample.pt')))
  } finally {
    globalThis.fetch = originalFetch
    await rm(directory, { recursive: true, force: true })
  }
})
