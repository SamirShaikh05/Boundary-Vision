import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type RegistryModelVersion = {
  version: string
  format: string
  classes?: string[]
  changeSummary?: string
  checkpointFilename: string
  expectedSizeBytes: number
  sha256: string
  downloadUrl: string | null
  developmentSource: string | null
}

export type RegistryModel = {
  id: string
  name: string
  description: string
  classes: string[]
  latestVersion: string
  versions: RegistryModelVersion[]
}

export type ModelVersionCard = RegistryModelVersion & {
  status: 'installed' | 'available' | 'not-configured' | 'corrupt'
  source: 'managed' | 'development' | 'remote' | 'none'
  canInstall: boolean
  canRemove: boolean
  detail: string
  formatSupported: boolean
}

export type ModelCard = Omit<RegistryModel, 'versions'> & {
  selected: boolean
  selectedVersion: string | null
  versions: ModelVersionCard[]
  status: ModelVersionCard['status']
  source: ModelVersionCard['source']
  detail: string
  formatSupported: boolean
  updateAvailable: boolean
}

type Progress = { modelId: string; version: string; stage: 'download' | 'verify' | 'validate' | 'install'; receivedBytes: number; totalBytes: number }
type ManagerPaths = { registryPath: string; developmentModelsDir: string; managedModelsDir: string; settingsPath: string }
type ModelJobEvent = (progress: Progress) => void
type ModelValidator = (model: RegistryModel, version: RegistryModelVersion, checkpointPath: string) => Promise<void>

const safeId = /^[a-z0-9][a-z0-9._-]{0,63}$/
const safeVersion = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const safeFilename = /^[a-zA-Z0-9._-]+\.pt$/
const supportedFormats = new Set(['ultralytics-yolo'])

export function modelHasUpdate(latestVersion: string, installedVersions: string[]): boolean {
  return installedVersions.some(version => version !== latestVersion)
}

export function validateModelVersionRequest(modelId: unknown, version: unknown): { modelId: string; version: string } {
  if (typeof modelId !== 'string' || !safeId.test(modelId) || typeof version !== 'string' || !safeVersion.test(version)) throw new Error('Invalid model ID or version.')
  return { modelId, version }
}

export class ModelManager {
  private registryPromise: Promise<RegistryModel[]> | null = null
  private registryCache: RegistryModel[] | null = null
  private registryCheckedAt = 0
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly installingModels = new Set<string>()
  private activeInference: { id: string; version: string } | null = null

  constructor(private readonly paths: ManagerPaths, private readonly validateCheckpoint: ModelValidator) {}

  async refreshRegistry(): Promise<{ models: ModelCard[]; selectedId: string | null; selectedVersion: string | null; storagePath: string }> {
    this.registryPromise = null
    this.registryCheckedAt = 0
    return this.list()
  }
  hasActiveWork(): boolean { return !!this.activeInference || this.installingModels.size > 0 }
  beginInference(modelId: string, version: string): void {
    if (this.activeInference) throw new Error('Another inference task is already using a model.')
    if (this.installingModels.size) throw new Error('Wait for model verification and installation to finish before starting inference.')
    this.activeInference = { id: modelId, version }
  }
  setActiveInferenceModel(modelId: string | null, version?: string) { this.activeInference = modelId && version ? { id: modelId, version } : null }
  async getSelectedModelId(): Promise<string | null> {
    const id = (await this.readSettings()).selectedModelId
    return typeof id === 'string' ? id : null
  }
  async getSelectedModel(): Promise<{ id: string; version: string } | null> {
    const catalog = await this.list()
    return catalog.selectedId && catalog.selectedVersion
      ? { id: catalog.selectedId, version: catalog.selectedVersion }
      : null
  }

  private async registry(): Promise<RegistryModel[]> {
    if (!this.registryPromise || Date.now() - this.registryCheckedAt > 15 * 60 * 1000) {
      this.registryCheckedAt = Date.now()
      const previousRegistry = this.registryCache
      this.registryPromise = (async () => {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 8000)
          try {
            const response = await fetch('https://raw.githubusercontent.com/SamirShaikh05/Boundary-Vision/main/models/registry.json', { signal: controller.signal, headers: { accept: 'application/json' } })
            if (!response.ok) throw new Error(`Remote model registry returned HTTP ${response.status}.`)
            const models = validateRegistry(JSON.parse(await response.text()))
            this.registryCache = models
            return models
          } finally { clearTimeout(timeout) }
        } catch {
          // Offline or invalid remote metadata must never prevent local inference.
          if (previousRegistry) return previousRegistry
          try {
            const models = await this.readBundledRegistry()
            this.registryCache = models
            return models
          } catch { throw new Error('The remote and bundled model registries are unavailable or invalid.') }
        }
      })()
    }
    return this.registryPromise
  }

  private async readBundledRegistry(): Promise<RegistryModel[]> {
    return fs.promises.readFile(this.paths.registryPath, 'utf8').then(raw => {
      return validateRegistry(JSON.parse(raw))
    })
  }

  async list(): Promise<{ models: ModelCard[]; selectedId: string | null; selectedVersion: string | null; storagePath: string }> {
    const settings = await this.readSettings()
    const selectedId = typeof settings.selectedModelId === 'string' ? settings.selectedModelId : null
    const models = await Promise.all((await this.registry()).map(async model => {
      const selectedVersion = selectedId === model.id
        ? typeof settings.selectedModelVersion === 'string' ? settings.selectedModelVersion : model.latestVersion
        : null
      const versions = await Promise.all(model.versions.map(version => this.versionCard(model, version, selectedId, selectedVersion)))
      const latest = versions.find(item => item.version === model.latestVersion)!
      const hasOlderInstalled = modelHasUpdate(model.latestVersion, versions.filter(item => item.status === 'installed').map(item => item.version))
      return { ...model, classes: latest.classes ?? model.classes, versions, selected: !!selectedVersion, selectedVersion, status: latest.status,
        source: latest.source, detail: latest.detail, formatSupported: latest.formatSupported,
        updateAvailable: hasOlderInstalled && latest.canInstall }
    }))
    return { models, selectedId, selectedVersion: typeof settings.selectedModelVersion === 'string' ? settings.selectedModelVersion : selectedId ? models.find(item => item.id === selectedId)?.latestVersion ?? null : null, storagePath: this.paths.managedModelsDir }
  }

  private async versionCard(model: RegistryModel, version: RegistryModelVersion, selectedId: string | null, selectedVersion: string | null): Promise<ModelVersionCard> {
    const managedPath = this.managedPath(model, version)
    const legacyPath = this.legacyManagedPath(model, version)
    for (const candidate of [managedPath, legacyPath]) {
      if (!(await exists(candidate))) continue
      const safeParent = candidate === managedPath
        ? await this.ensureManagedDirectory(model, version, false).then(() => true).catch(() => false)
        : await this.safeLegacyDirectory(model)
      const valid = safeParent && await this.validFile(candidate, version)
      const source: ModelVersionCard['source'] = 'managed'
      const result = versionCard(version, valid ? 'installed' : 'corrupt', source, valid
        ? 'Verified in Boundary Vision storage.' : 'The stored checkpoint failed size or SHA-256 verification.')
      result.formatSupported = this.isFormatSupported(version)
      result.canInstall = !valid && result.formatSupported && (!!version.downloadUrl || !!version.developmentSource && await this.validFile(this.developmentPath(version), version))
      result.canRemove = valid && source === 'managed' && !(model.id === selectedId && version.version === selectedVersion)
      return result
    }
    if (version.developmentSource) {
      const sourcePath = this.developmentPath(version)
      if (await exists(sourcePath)) {
        const valid = await this.validFile(sourcePath, version)
        const result = versionCard(version, valid ? 'installed' : 'corrupt', 'development', valid
          ? 'Using the verified local development checkpoint.' : 'The local development checkpoint failed size or SHA-256 verification.')
        result.formatSupported = this.isFormatSupported(version)
        result.canInstall = valid && result.formatSupported
        result.canRemove = false
        return result
      }
    }
    const status = version.downloadUrl ? 'available' : 'not-configured'
    const result = versionCard(version, status, version.downloadUrl ? 'remote' : 'none', version.downloadUrl
      ? 'A download source is configured.' : 'No download source is configured for this version.')
    result.formatSupported = this.isFormatSupported(version)
    result.canInstall = status === 'available' && result.formatSupported
    result.canRemove = false
    return result
  }

  async select(modelId: string, versionName: string): Promise<void> {
    const { model, version } = await this.getVersion(modelId, versionName)
    if (!this.isFormatSupported(version)) throw new Error(`Model format "${version.format}" is not supported by this application.`)
    const checkpoint = await this.resolveInstalledPath(model, version)
    if (!checkpoint || !(await this.validFile(checkpoint, version))) throw new Error(`Install and verify ${model.name} ${version.version} before selecting it.`)
    await this.validateCheckpoint(model, version, checkpoint)
    const settings = await this.readSettings()
    settings.selectedModelId = model.id
    settings.selectedModelVersion = version.version
    await this.writeSettings(settings)
  }

  async resolveForInference(modelId: string, versionName: string): Promise<{ id: string; version: string; path: string; classes: string[]; sha256: string; sizeBytes: number }> {
    const { model, version } = await this.getVersion(modelId, versionName)
    if (!this.isFormatSupported(version)) throw new Error(`Model format "${version.format}" is not supported by this application.`)
    const checkpoint = await this.resolveInstalledPath(model, version)
    if (!checkpoint || !(await this.validFile(checkpoint, version))) throw new Error(`${model.name} ${version.version} is not installed or failed integrity verification. Open Model Manager to repair it.`)
    return { id: model.id, version: version.version, path: checkpoint, classes: version.classes ?? model.classes, sha256: version.sha256, sizeBytes: version.expectedSizeBytes }
  }

  async install(modelId: string, versionName: string, onProgress: ModelJobEvent): Promise<void> {
    const key = `${modelId}@${versionName}`
    if (this.installingModels.has(key)) throw new Error('This model version is already being installed.')
    if (this.activeInference) throw new Error('Wait for the current inference job to finish before updating a model.')
    this.installingModels.add(key)
    try {
      const { model, version } = await this.getVersion(modelId, versionName)
      if (!this.isFormatSupported(version)) throw new Error(`Model format "${version.format}" is not supported by this application.`)
      const sourcePath = version.developmentSource ? this.developmentPath(version) : null
      const sourceReady = sourcePath ? await this.validFile(sourcePath, version) : false
      if (!sourceReady && !version.downloadUrl) throw new Error(`No download source is configured for ${model.name} ${version.version}.`)
      const existingManaged = [this.managedPath(model, version), this.legacyManagedPath(model, version)]
      const existingManagedValid = await Promise.all(existingManaged.map(async file => (await exists(file)) && await this.validFile(file, version)))
      if (existingManagedValid.some(Boolean)) {
        throw new Error(`${model.name} ${version.version} is already installed and verified.`)
      }

      const controller = new AbortController()
      this.abortControllers.set(key, controller)
      const directory = await this.ensureManagedDirectory(model, version, true)
      const target = this.managedPath(model, version)
      const temporary = path.join(directory, `.${model.id}-${version.version}-${randomUUID()}.partial.pt`)
      try {
        await fs.promises.mkdir(directory, { recursive: true })
        let source: Readable
        if (sourceReady && sourcePath) source = fs.createReadStream(sourcePath)
        else {
          const url = new URL(version.downloadUrl!)
          if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Model download URLs must use HTTPS and cannot contain credentials.')
          const response = await fetchModelAsset(url, controller.signal)
          if (!response.ok || !response.body) throw new Error(`Model download failed with HTTP ${response.status}.`)
          source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
        }
        const hash = createHash('sha256')
        let receivedBytes = 0
        const progressStream = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            if (controller.signal.aborted) return callback(new Error('Model installation cancelled.'))
            if (receivedBytes + chunk.length > version.expectedSizeBytes) return callback(new Error('Model download exceeded its declared file size; incomplete data was discarded.'))
            hash.update(chunk)
            receivedBytes += chunk.length
            onProgress({ modelId, version: version.version, stage: 'download', receivedBytes, totalBytes: version.expectedSizeBytes })
            callback(null, chunk)
          },
        })
        await pipeline(source, progressStream, createWriteStream(temporary, { flags: 'wx' }), { signal: controller.signal })
        onProgress({ modelId, version: version.version, stage: 'verify', receivedBytes, totalBytes: version.expectedSizeBytes })
        if (receivedBytes !== version.expectedSizeBytes) throw new Error(`Downloaded size mismatch: expected ${version.expectedSizeBytes} bytes, received ${receivedBytes}.`)
        if (hash.digest('hex') !== version.sha256) throw new Error('SHA-256 verification failed. The staged checkpoint was discarded.')
        if (controller.signal.aborted) throw new Error('Model installation cancelled.')
        onProgress({ modelId, version: version.version, stage: 'validate', receivedBytes, totalBytes: version.expectedSizeBytes })
        await this.validateCheckpoint(model, version, temporary)
        if (controller.signal.aborted) throw new Error('Model installation cancelled.')
        onProgress({ modelId, version: version.version, stage: 'install', receivedBytes, totalBytes: version.expectedSizeBytes })
        await this.commitVerifiedFile(temporary, target)
      } catch (error) {
        await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
        if (controller.signal.aborted) throw new Error('Model installation cancelled; incomplete data was removed.')
        throw error
      } finally {
        this.abortControllers.delete(key)
      }
    } finally {
      this.installingModels.delete(key)
    }
  }

  cancelInstall(modelId: string, versionName: string): void { this.abortControllers.get(`${modelId}@${versionName}`)?.abort() }

  async remove(modelId: string, versionName: string): Promise<void> {
    if (this.installingModels.has(`${modelId}@${versionName}`)) throw new Error('Wait for this model version installation to finish before removing it.')
    if (this.activeInference?.id === modelId && this.activeInference.version === versionName) throw new Error('This model version is in use by an inference job and cannot be removed.')
    const settings = await this.readSettings()
    if (settings.selectedModelId === modelId && (settings.selectedModelVersion ?? (await this.getModel(modelId)).latestVersion) === versionName) {
      throw new Error('Select another installed model version before removing the selected version.')
    }
    const { model, version } = await this.getVersion(modelId, versionName)
    const targets = [this.managedPath(model, version), this.legacyManagedPath(model, version)]
    let removed = false
    for (const candidate of targets) {
      if (!(await exists(candidate))) continue
      const safeParent = candidate === targets[0]
        ? await this.ensureManagedDirectory(model, version, false).then(() => true).catch(() => false)
        : await this.safeLegacyDirectory(model)
      if (!safeParent) throw new Error('Refusing to remove a model from an unsafe managed directory.')
      const stat = await fs.promises.lstat(candidate)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Managed model asset is not a regular file.')
      const managedRoot = path.resolve(this.paths.managedModelsDir)
      if (!path.resolve(candidate).startsWith(managedRoot + path.sep)) throw new Error('Refusing to remove a path outside managed model storage.')
      await fs.promises.rm(candidate)
      removed = true
    }
    if (!removed) throw new Error('There is no Boundary Vision managed copy of this version to remove.')
  }

  private async commitVerifiedFile(temporary: string, target: string): Promise<void> {
    const backup = `${target}.${randomUUID()}.backup`
    let movedOld = false
    try {
      if (await exists(target)) {
        await fs.promises.rename(target, backup)
        movedOld = true
      }
      await fs.promises.rename(temporary, target)
      if (movedOld) await fs.promises.rm(backup, { force: true }).catch(() => undefined)
    } catch (error) {
      if (movedOld && !(await exists(target)) && await exists(backup)) await fs.promises.rename(backup, target).catch(() => undefined)
      throw error
    }
  }

  private async getModel(modelId: string): Promise<RegistryModel> {
    const model = (await this.registry()).find(item => item.id === modelId)
    if (!model) throw new Error(`Unknown model ID: ${modelId}`)
    return model
  }

  private async getVersion(modelId: string, versionName: string): Promise<{ model: RegistryModel; version: RegistryModelVersion }> {
    const model = await this.getModel(modelId)
    const version = model.versions.find(item => item.version === versionName)
    if (!version) throw new Error(`Unknown version ${versionName} for model ${modelId}.`)
    return { model, version }
  }

  private isFormatSupported(version: RegistryModelVersion): boolean {
    return supportedFormats.has(version.format)
  }

  private developmentPath(version: RegistryModelVersion): string { return path.resolve(this.paths.developmentModelsDir, version.developmentSource!) }
  private managedPath(model: RegistryModel, version: RegistryModelVersion): string { return path.resolve(this.paths.managedModelsDir, model.id, version.version, version.checkpointFilename) }
  private legacyManagedPath(model: RegistryModel, version: RegistryModelVersion): string { return path.resolve(this.paths.managedModelsDir, model.id, version.checkpointFilename) }

  private async resolveInstalledPath(model: RegistryModel, version: RegistryModelVersion): Promise<string | null> {
    const versioned = this.managedPath(model, version)
    if (await exists(versioned) && await this.ensureManagedDirectory(model, version, false).then(() => true).catch(() => false)) return versioned
    const legacy = this.legacyManagedPath(model, version)
    if (await exists(legacy) && await this.safeLegacyDirectory(model)) return legacy
    if (version.developmentSource) {
      const development = this.developmentPath(version)
      if (await exists(development)) return development
    }
    return null
  }

  private async ensureManagedDirectory(model: RegistryModel, version: RegistryModelVersion, create: boolean): Promise<string> {
    const root = path.resolve(this.paths.managedModelsDir)
    const idDirectory = path.join(root, model.id)
    const directory = path.join(idDirectory, version.version)
    if (create) await fs.promises.mkdir(root, { recursive: true })
    const rootStat = await fs.promises.lstat(root).catch(() => null)
    if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Managed model storage must be a regular directory.')
    if (create) await fs.promises.mkdir(idDirectory, { recursive: true })
    const idStat = await fs.promises.lstat(idDirectory).catch(() => null)
    if (!idStat?.isDirectory() || idStat.isSymbolicLink() || path.dirname(idDirectory) !== root) throw new Error('Model ID folder is unsafe.')
    if (create) await fs.promises.mkdir(directory, { recursive: true })
    const dirStat = await fs.promises.lstat(directory).catch(() => null)
    if (!dirStat?.isDirectory() || dirStat.isSymbolicLink() || path.dirname(directory) !== idDirectory) throw new Error('Model version folder is unsafe.')
    return directory
  }

  private async safeLegacyDirectory(model: RegistryModel): Promise<boolean> {
    const root = path.resolve(this.paths.managedModelsDir)
    const idDirectory = path.join(root, model.id)
    const rootStat = await fs.promises.lstat(root).catch(() => null)
    const idStat = await fs.promises.lstat(idDirectory).catch(() => null)
    return !!rootStat?.isDirectory() && !rootStat.isSymbolicLink() && !!idStat?.isDirectory() && !idStat.isSymbolicLink() && path.dirname(idDirectory) === root
  }

  private async validFile(filePath: string, version: RegistryModelVersion): Promise<boolean> {
    try {
      const stat = await fs.promises.lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== version.expectedSizeBytes) return false
      const hash = createHash('sha256')
      for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
      return hash.digest('hex') === version.sha256
    } catch { return false }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.paths.settingsPath, 'utf8'))
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch { return {} }
  }

  private async writeSettings(settings: Record<string, unknown>): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.paths.settingsPath), { recursive: true })
    const temporary = `${this.paths.settingsPath}.${randomUUID()}.tmp`
    await fs.promises.writeFile(temporary, JSON.stringify(settings, null, 2), { flag: 'wx' })
    await fs.promises.rename(temporary, this.paths.settingsPath)
  }
}

function validateRegistryModel(value: unknown): RegistryModel {
  if (!value || typeof value !== 'object') throw new Error('The model registry contains an invalid entry.')
  const model = value as Record<string, unknown>
  if (typeof model.id !== 'string' || !safeId.test(model.id)) throw new Error('The model registry contains an unsafe model ID.')
  if (typeof model.name !== 'string' || typeof model.description !== 'string' || !model.name) throw new Error(`Registry metadata is incomplete for ${model.id}.`)
  if (!Array.isArray(model.classes) || model.classes.length === 0 || !model.classes.every(item => typeof item === 'string' && item.length > 0) || new Set(model.classes).size !== model.classes.length) throw new Error(`Class metadata is invalid for ${model.id}.`)
  if (!Array.isArray(model.versions) || model.versions.length === 0) throw new Error(`Version metadata is missing for ${model.id}.`)
  const versions = model.versions.map(validateRegistryVersion)
  if (new Set(versions.map(item => item.version)).size !== versions.length || typeof model.latestVersion !== 'string' || !versions.some(item => item.version === model.latestVersion)) throw new Error(`Latest version is missing or ambiguous for ${model.id}.`)
  return { id: model.id, name: model.name, description: model.description, classes: model.classes as string[], latestVersion: model.latestVersion, versions }
}

export function validateRegistry(value: unknown): RegistryModel[] {
  if (!value || typeof value !== 'object') throw new Error('The model registry has an unsupported format.')
  const registry = value as { schemaVersion?: unknown; models?: unknown }
  if (registry.schemaVersion !== 2 || !Array.isArray(registry.models) || registry.models.length === 0) throw new Error('The model registry has an unsupported format.')
  const models = registry.models.map(validateRegistryModel)
  if (new Set(models.map(item => item.id)).size !== models.length) throw new Error('The model registry contains duplicate model IDs.')
  return models
}

function validateRegistryVersion(value: unknown): RegistryModelVersion {
  if (!value || typeof value !== 'object') throw new Error('The model registry contains invalid version metadata.')
  const version = value as Record<string, unknown>
  if (typeof version.version !== 'string' || !safeVersion.test(version.version)) throw new Error('The model registry contains an unsafe version string.')
  if (typeof version.format !== 'string') throw new Error(`Model format is missing for version ${version.version}.`)
  if (version.classes !== undefined && (!Array.isArray(version.classes) || version.classes.length === 0 || !version.classes.every(item => typeof item === 'string' && item.length > 0) || new Set(version.classes).size !== version.classes.length)) throw new Error(`Class metadata is invalid for version ${version.version}.`)
  if (version.changeSummary !== undefined && typeof version.changeSummary !== 'string') throw new Error(`Version change summary is invalid for ${version.version}.`)
  if (typeof version.checkpointFilename !== 'string' || !safeFilename.test(version.checkpointFilename)) throw new Error(`Checkpoint filename is invalid for version ${version.version}.`)
  if (typeof version.expectedSizeBytes !== 'number' || !Number.isSafeInteger(version.expectedSizeBytes) || version.expectedSizeBytes < 1) throw new Error(`Expected file size is invalid for version ${version.version}.`)
  if (typeof version.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(version.sha256)) throw new Error(`SHA-256 is invalid for version ${version.version}.`)
  if (version.downloadUrl !== null && version.downloadUrl !== undefined) {
    if (typeof version.downloadUrl !== 'string') throw new Error(`Download URL is invalid for version ${version.version}.`)
    let url: URL
    try { url = new URL(version.downloadUrl) } catch { throw new Error(`Download URL is invalid for version ${version.version}.`) }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`Download URL must use HTTPS and omit credentials for version ${version.version}.`)
  }
  if (version.developmentSource !== null && version.developmentSource !== undefined && (typeof version.developmentSource !== 'string' || !safeFilename.test(version.developmentSource))) throw new Error(`Development source is invalid for version ${version.version}.`)
  delete version.minimumPython
  return version as unknown as RegistryModelVersion
}

function versionCard(version: RegistryModelVersion, status: ModelVersionCard['status'], source: ModelVersionCard['source'], detail: string): ModelVersionCard {
  return { ...version, status, source, canInstall: false, canRemove: false, detail, formatSupported: supportedFormats.has(version.format) }
}

async function exists(filePath: string): Promise<boolean> {
  try { await fs.promises.access(filePath); return true } catch { return false }
}

async function fetchModelAsset(initialUrl: URL, signal: AbortSignal): Promise<Response> {
  let url = initialUrl
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Every model download URL and redirect must use HTTPS without credentials.')
    const response = await fetch(url, { signal, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (!location) throw new Error('Model download redirect did not include a destination.')
    if (redirects === 5) throw new Error('Model download exceeded the redirect limit.')
    url = new URL(location, url)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Model download redirects must remain on HTTPS and cannot contain credentials.')
    await response.body?.cancel().catch(() => undefined)
  }
  throw new Error('Model download exceeded the redirect limit.')
}
