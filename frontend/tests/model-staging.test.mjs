import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('electron-builder copies only the staged bundled registry file', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const modelResources = packageJson.build.extraResources.filter(resource => resource.to.startsWith('models/'))
  assert.deepEqual(modelResources, [{ from: 'build-resources/models/registry.json', to: 'models/registry.json' }])
})
