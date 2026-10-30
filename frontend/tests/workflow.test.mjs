import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { toggleExportFormat } from '../src/exportSelection.ts'
import { validateAnnotationFormats } from '../dist-electron/requestValidation.js'
import { labelImgVirtualEnvPython, validateLabelImgRuntime } from '../dist-electron/labelImgRuntime.js'

test('export format can be selected, switched, and cleared', () => {
  assert.equal(toggleExportFormat(null, 'yolo'), 'yolo')
  assert.equal(toggleExportFormat('yolo', 'voc'), 'voc')
  assert.equal(toggleExportFormat('voc', 'voc'), null)
})

test('Electron format validation accepts zero or one and rejects multiple formats', () => {
  assert.deepEqual(validateAnnotationFormats([]), [])
  assert.deepEqual(validateAnnotationFormats(['createml']), ['createml'])
  assert.throws(() => validateAnnotationFormats(['yolo', 'voc']), /at most one/i)
  assert.throws(() => validateAnnotationFormats(['unknown']), /at most one/i)
})

test('LabelImg runtime uses only its configured folder virtual environment', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'bv-labelimg-'))
  try {
    const executable = labelImgVirtualEnvPython(directory, 'win32')
    mkdirSync(path.dirname(executable), { recursive: true })
    writeFileSync(executable, '')
    const calls = []
    const runtime = validateLabelImgRuntime(directory, 'win32', candidate => candidate === executable, (candidate, args) => {
      calls.push({ candidate, args })
      return JSON.stringify({ version: [3, 15, 2], missing: [] })
    })
    assert.deepEqual(runtime, { executable, error: null })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].candidate, executable)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('LabelImg runtime reports missing environment and dependencies with recovery steps', () => {
  const directory = path.join(os.tmpdir(), 'bv-labelimg-missing')
  const absent = validateLabelImgRuntime(directory, 'win32', () => false, () => assert.fail('must not probe missing environment'))
  assert.match(absent.error, /virtual environment is missing/i)
  assert.match(absent.error, /PyQt5 lxml/)

  const missing = validateLabelImgRuntime(directory, 'win32', () => true, () => JSON.stringify({ version: [3, 15, 2], missing: ['PyQt5'] }))
  assert.match(missing.error, /cannot import PyQt5/i)
  assert.match(missing.error, /\.venv/)
})

test('LabelImg runtime reports an unusable interpreter without exposing raw errors', () => {
  const result = validateLabelImgRuntime(path.join(os.tmpdir(), 'bv-labelimg-broken'), 'win32', () => true, () => {
    throw new Error('opaque process failure')
  })
  assert.match(result.error, /could not run its dependency check/i)
  assert.doesNotMatch(result.error, /opaque process failure/)
})
