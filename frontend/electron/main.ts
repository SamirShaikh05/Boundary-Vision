import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { autoUpdater } from 'electron-updater'
import type { LabelImgConfig, LabelImgResult, ProcessOptions } from './types'
import { ModelManager, type RegistryModel, type RegistryModelVersion } from './modelManager'
import type { UpdateState } from './types'

protocol.registerSchemesAsPrivileged([{ scheme: 'bvmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])

const here = __dirname
const projectRoot = path.resolve(here, '..', '..')
const backendDir = path.join(projectRoot, 'backend')
const frontendDir = path.resolve(here, '..')
const pythonExe = process.platform === 'win32'
  ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
  : path.join(backendDir, '.venv', 'bin', 'python')
const workerExe = path.join(process.resourcesPath, 'backend', 'boundary-worker', process.platform === 'win32' ? 'boundary-worker.exe' : 'boundary-worker')
const ffmpegPath = app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : findExecutable('ffmpeg')
const ffprobePath = app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : findExecutable('ffprobe')
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff'])
const videoExtensions = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.3gp'])
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
let mainWindow: BrowserWindow | null = null
let activeWorker: ChildProcessWithoutNullStreams | null = null
const previewableOutputs = new Set<string>()
const previewableVideoOutputs = new Set<string>()
const imageResultsBySource = new Map<string, LabelImgResult>()
const imageClassesBySource = new Map<string, string[]>()
const videoTokens = new Map<string, string>()
let cancellationRequested = false
let cancellationTimer: NodeJS.Timeout | undefined
let modelManager: ModelManager
let updateInstallationRequested = false
let updateState: UpdateState = { currentVersion: app.getVersion(), status: 'disabled', configured: false, message: 'Application updates are available in packaged release builds.' }

type LabelImgPreference = { path?: string; kind?: 'executable' | 'script' | 'python'; pythonPath?: string }
function readLabelImgPreference(): LabelImgPreference {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')).labelImg ?? {} } catch { return {} }
}
function writeLabelImgPreference(value: LabelImgPreference) {
  let settings: Record<string, unknown> = {}
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) } catch { /* First launch. */ }
  settings.labelImg = value
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  const temporary = `${settingsPath}.${randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(settings, null, 2), 'utf8')
  fs.renameSync(temporary, settingsPath)
}
function getLabelImgConfig(message?: string): LabelImgConfig {
  const preference = readLabelImgPreference()
  const configured = !!preference.path && !!preference.kind
  const launchExists = configured && fs.existsSync(preference.path!) && fs.statSync(preference.path!).isFile()
    && (preference.kind !== 'script' || (!!preference.pythonPath && fs.existsSync(preference.pythonPath)))
  return { path: preference.path ?? null, kind: preference.kind ?? null, pythonPath: preference.pythonPath ?? null,
    available: !!launchExists, message: message ?? (launchExists ? `Configured ${preference.kind}: ${preference.path}` : configured ? 'The configured LabelImg path is missing or incomplete.' : 'LabelImg is optional and is not configured.') }
}
function fileExists(file: string) { try { return fs.statSync(file).isFile() } catch { return false } }
function candidatesInFolder(folder: string): Array<{ path: string; kind: 'executable' | 'script' | 'python'; pythonPath?: string }> {
  const possible: Array<{ path: string; kind: 'executable' | 'script' | 'python'; pythonPath?: string }> = []
  const known = ['labelImg.exe', 'labelimg.exe', 'labelImg.py', 'labelimg.py']
  for (const name of known) {
    const candidate = path.join(folder, name)
    if (fileExists(candidate)) possible.push({ path: candidate, kind: name.endsWith('.py') ? 'script' : 'executable' })
  }
  for (const scripts of [path.join(folder, 'Scripts'), path.join(folder, 'bin')]) {
    for (const name of ['labelImg.exe', 'labelimg.exe', 'labelImg', 'labelimg', 'labelImg.py', 'labelimg.py']) {
      const candidate = path.join(scripts, name)
      if (fileExists(candidate)) possible.push({ path: candidate, kind: name.toLowerCase().endsWith('.py') ? 'script' : 'executable' })
    }
  }
  for (const name of ['python.exe', 'python']) {
    const candidate = path.join(folder, name)
    const packageEntry = path.join(folder, 'Lib', 'site-packages', 'labelImg', 'labelImg.py')
    if (fileExists(candidate) && fileExists(packageEntry)) possible.push({ path: candidate, kind: 'python' })
  }
  return possible
}
function saveLabelImgChoice(choice: { path: string; kind: 'executable' | 'script' | 'python'; pythonPath?: string }) {
  writeLabelImgPreference(choice)
  return getLabelImgConfig('LabelImg location saved.')
}
function escapeXml(value: string) { return value.replace(/[<>&'\"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '\"': '&quot;' })[character]!) }

function findExecutable(name: string): string {
  const executable = process.platform === 'win32' ? `${name}.exe` : name
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, executable)
    try { if (fs.statSync(candidate).isFile()) return candidate } catch { /* Continue searching PATH. */ }
  }
  return ''
}

function registerVideoProtocol() { protocol.handle('bvmedia', async request => {
    const token = new URL(request.url).pathname.replace(/^\//, '')
    const filePath = videoTokens.get(token)
    if (!filePath || !previewableVideoOutputs.has(path.resolve(filePath))) return new Response('Not found', { status: 404 })
    try {
      const stat = await fs.promises.stat(filePath)
      const range = request.headers.get('range')
      const match = range?.match(/^bytes=(\d*)-(\d*)$/)
      let start = 0, end = stat.size - 1, status = 200
      if (match) {
        start = match[1] ? Number(match[1]) : 0
        end = match[2] ? Number(match[2]) : end
        if (start > end || start >= stat.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
        end = Math.min(end, stat.size - 1); status = 206
      }
      const length = end - start + 1
      const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream
      return new Response(stream, { status, headers: {
        'Content-Type': 'video/mp4', 'Content-Length': String(length), 'Accept-Ranges': 'bytes',
        ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
      } })
    } catch { return new Response('Not found', { status: 404 }) }
}) }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420, height: 960, minWidth: 1100, minHeight: 760,
    backgroundColor: '#101511', title: 'Boundary Vision',
    webPreferences: { preload: path.join(here, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  if (!app.isPackaged) void mainWindow.loadURL('http://127.0.0.1:5173')
  else void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  mainWindow.webContents.on('will-navigate', (event, destination) => {
    const packagedIndex = path.join(app.getAppPath(), 'dist', 'index.html')
    const allowed = app.isPackaged
      ? destination === pathToFileURL(packagedIndex).href
      : destination.startsWith('http://127.0.0.1:5173/')
    if (!allowed) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.on('closed', () => { mainWindow = null })
}

function publishUpdateState(next: UpdateState) {
  updateState = next
  mainWindow?.webContents.send('update:state', updateState)
}

function setupApplicationUpdater() {
  if (!app.isPackaged) {
    publishUpdateState({ currentVersion: app.getVersion(), status: 'disabled', configured: false, message: 'Updates are disabled in development builds.' })
    return
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    publishUpdateState({ currentVersion: app.getVersion(), status: 'disabled', configured: false, message: 'This release channel supports Windows x64 updates only.' })
    return
  }
  if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) {
    publishUpdateState({ currentVersion: app.getVersion(), status: 'disabled', configured: false, message: 'GitHub Releases are not configured for this build. A release owner and repository must be supplied when packaging.' })
    return
  }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  publishUpdateState({ currentVersion: app.getVersion(), status: 'idle', configured: true, message: 'Ready to check the configured GitHub Releases feed.' })
  autoUpdater.on('checking-for-update', () => publishUpdateState({ currentVersion: app.getVersion(), status: 'checking', configured: true, message: 'Checking GitHub Releases…' }))
  autoUpdater.on('update-available', info => publishUpdateState({ currentVersion: app.getVersion(), status: 'available', configured: true, availableVersion: info.version, message: `Version ${info.version} is available. Download when you are ready.` }))
  autoUpdater.on('update-not-available', info => publishUpdateState({ currentVersion: app.getVersion(), status: 'up-to-date', configured: true, availableVersion: info.version, message: 'This installation is up to date.' }))
  autoUpdater.on('download-progress', progress => publishUpdateState({
    currentVersion: app.getVersion(), status: 'downloading', configured: true,
    availableVersion: updateState.availableVersion, percent: Math.min(100, Math.max(0, progress.percent)),
    transferred: progress.transferred, total: progress.total, message: 'Downloading the verified application update…',
  }))
  autoUpdater.on('update-downloaded', info => publishUpdateState({ currentVersion: app.getVersion(), status: 'downloaded', configured: true, availableVersion: info.version, percent: 100, message: `Version ${info.version} is downloaded and ready to install.` }))
  autoUpdater.on('error', error => publishUpdateState({ currentVersion: app.getVersion(), status: 'error', configured: true, availableVersion: updateState.availableVersion, message: `Update check or download failed: ${error.message || 'network or release error'}` }))
  setTimeout(() => { void checkForApplicationUpdate() }, 3500)
}

async function checkForApplicationUpdate(): Promise<UpdateState> {
  if (!updateState.configured) return updateState
  if (['checking', 'downloading', 'downloaded'].includes(updateState.status)) return updateState
  publishUpdateState({ currentVersion: app.getVersion(), status: 'checking', configured: true, message: 'Checking GitHub Releases…' })
  try {
    const result = await autoUpdater.checkForUpdates()
    if (result && updateState.status === 'checking') {
      const available = result.updateInfo.version !== app.getVersion()
      publishUpdateState({ currentVersion: app.getVersion(), status: available ? 'available' : 'up-to-date', configured: true,
        availableVersion: result.updateInfo.version, message: available ? `Version ${result.updateInfo.version} is available.` : 'This installation is up to date.' })
    }
  } catch (error) {
    publishUpdateState({ currentVersion: app.getVersion(), status: 'error', configured: true,
      message: `Could not check GitHub Releases. Check your connection and try again. ${error instanceof Error ? error.message : ''}`.trim() })
  }
  return updateState
}

function sendStatus(value: string) { mainWindow?.webContents.send('backend:status', value) }
function assertPythonAvailable() {
  if (app.isPackaged) {
    if (!fs.existsSync(workerExe)) throw new Error('The bundled Python inference runtime is missing. Repair or reinstall Boundary Vision.')
    return
  }
  if (!fs.existsSync(pythonExe)) throw new Error(`Python environment not found at ${pythonExe}. Create backend/.venv and install backend/requirements.txt first.`)
  if (!fs.existsSync(path.join(backendDir, 'app', 'worker.py'))) throw new Error('Python inference worker is missing from backend/app.')
}

function runWorker(request: object, onProgress?: (value: unknown) => void): Promise<any> {
  assertPythonAvailable()
  if (activeWorker) throw new Error('Another inference task is already running.')
  return new Promise((resolve, reject) => {
    const packaged = app.isPackaged
    const command = packaged ? workerExe : pythonExe
    const args = packaged ? [] : ['-u', '-m', 'app.worker']
    const child = spawn(command, args, { cwd: packaged ? path.dirname(workerExe) : backendDir, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, YOLO_AUTOINSTALL: 'false' }, stdio: ['pipe', 'pipe', 'pipe'] })
    activeWorker = child
    cancellationRequested = false
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return
      settled = true
      if (cancellationTimer) clearTimeout(cancellationTimer)
      cancellationTimer = undefined
      activeWorker = null
      child.stdin.end()
      if (error) reject(error)
      else resolve(value)
    }
    child.stdout.on('data', (buffer: Buffer) => {
      stdout += buffer.toString('utf8')
      const lines = stdout.split(/\r?\n/)
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('@@BOUNDARY_VISION@@')) continue
        try {
          const message = JSON.parse(line.slice('@@BOUNDARY_VISION@@'.length))
          if (message.event === 'progress' || message.event === 'video_progress') onProgress?.(message)
          if (message.event === 'capabilities' || message.event === 'complete' || message.event === 'model_validated') finish(undefined, message)
          if (message.event === 'error') finish(new Error(message.message))
        } catch { /* Ignore malformed worker protocol lines. */ }
      }
    })
    child.stderr.on('data', (buffer: Buffer) => { stderr = (stderr + buffer.toString('utf8')).slice(-8000) })
    child.on('error', error => finish(error))
    child.on('close', code => {
      if (!settled) finish(new Error(cancellationRequested ? 'Processing cancelled. Finished outputs were kept.' : stderr.trim() || `Inference worker exited with code ${code}.`))
    })
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}

function killWorkerTree(child: ChildProcessWithoutNullStreams) {
  if (process.platform === 'win32' && child.pid) {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => undefined)
  } else if (child.pid) {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  } else child.kill()
}

function requestWorkerCancellation() {
  const child = activeWorker
  if (!child) return
  cancellationRequested = true
  try { child.stdin.write('{"action":"cancel"}\n') } catch { /* The worker may already be closing. */ }
  if (cancellationTimer) clearTimeout(cancellationTimer)
  cancellationTimer = setTimeout(() => { if (activeWorker === child) killWorkerTree(child) }, 8000)
}

function validateOptions(value: unknown): ProcessOptions {
  if (!value || typeof value !== 'object') throw new Error('Processing settings are missing.')
  const o = value as Record<string, unknown>
  if (typeof o.modelId !== 'string' || !o.modelId.trim() || typeof o.modelVersion !== 'string' || !o.modelVersion.trim()) throw new Error('Choose an installed model version.')
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence) || o.confidence < 0.01 || o.confidence > 1) throw new Error('Confidence must be from 0.01 to 1.00.')
  if (typeof o.device !== 'string' || !['cpu', 'cuda:0'].includes(o.device)) throw new Error('Choose a supported processing device.')
  if (o.batchSize !== null && ![1, 2, 4].includes(o.batchSize as number)) throw new Error('Batch size must be Auto, 1, 2, or 4.')
  if (typeof o.outputImage !== 'boolean' || !Array.isArray(o.formats) || !(o.formats as unknown[]).every(f => ['yolo', 'voc', 'createml'].includes(String(f)))) throw new Error('Invalid output settings.')
  if (!o.outputImage && (o.formats as unknown[]).length === 0) throw new Error('Choose annotated images or at least one annotation format.')
  return o as unknown as ProcessOptions
}

app.whenReady().then(() => {
  registerVideoProtocol()
  const assetRoot = app.isPackaged ? process.resourcesPath : projectRoot
  modelManager = new ModelManager({
    registryPath: path.join(assetRoot, 'models', 'registry.json'),
    developmentModelsDir: app.isPackaged ? path.join(assetRoot, 'models') : path.join(projectRoot, 'models'),
    managedModelsDir: path.join(app.getPath('userData'), 'models'),
    settingsPath: path.join(app.getPath('userData'), 'settings.json'),
  }, async (model: RegistryModel, version: RegistryModelVersion, checkpointPath: string) => {
    const result = await runWorker({ action: 'validate_model', modelId: model.id, modelVersion: version.version,
      modelPath: checkpointPath, modelClasses: version.classes ?? model.classes, modelSha256: version.sha256, modelSizeBytes: version.expectedSizeBytes })
    if (result.event !== 'model_validated') throw new Error(`The checkpoint ${version.version} could not be validated with this runtime.`)
  })
  createWindow()
  setupApplicationUpdater()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { activeWorker?.kill() })

ipcMain.handle('dialog:images', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: [...imageExtensions].map(ext => ext.slice(1)) }] })
  return result.canceled ? [] : result.filePaths
})
ipcMain.handle('dialog:video', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [{ name: 'Videos', extensions: [...videoExtensions].map(ext => ext.slice(1)) }] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('dialog:output-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('labelimg:config', () => getLabelImgConfig())
ipcMain.handle('labelimg:choose', async (_event, mode: unknown) => {
  if (!['file', 'folder', 'python'].includes(String(mode))) throw new Error('Choose a LabelImg executable, script, or Python environment.')
  if (mode === 'folder') {
    const selected = await dialog.showOpenDialog(mainWindow!, { title: 'Locate the LabelImg installation folder', properties: ['openDirectory'] })
    if (selected.canceled) return getLabelImgConfig()
    const candidates = candidatesInFolder(selected.filePaths[0])
    if (!candidates.length) return getLabelImgConfig('No supported LabelImg launcher was found in that folder. Choose a launcher file or a Python environment containing LabelImg.')
    let choice = candidates[0]
    if (candidates.length > 1) {
      const answer = await dialog.showMessageBox(mainWindow!, { type: 'question', title: 'Choose a LabelImg launcher', message: 'More than one supported launch option was found. Choose the one to configure.', buttons: [...candidates.map(item => `${item.kind}: ${path.relative(selected.filePaths[0], item.path)}`), 'Cancel'], cancelId: candidates.length })
      if (answer.response >= candidates.length) return getLabelImgConfig()
      choice = candidates[answer.response]
    }
    if (choice.kind === 'script') {
      const python = await dialog.showOpenDialog(mainWindow!, { title: 'Choose the Python environment for LabelImg', properties: ['openFile'], filters: [{ name: 'Python', extensions: ['exe'] }] })
      if (python.canceled) return getLabelImgConfig('LabelImg script selected; choose its Python environment to finish setup.')
      return saveLabelImgChoice({ ...choice, pythonPath: python.filePaths[0] })
    }
    return saveLabelImgChoice(choice)
  }
  const selected = await dialog.showOpenDialog(mainWindow!, { title: mode === 'python' ? 'Choose the Python executable for a LabelImg environment' : 'Choose LabelImg executable or launch script', properties: ['openFile'], filters: mode === 'python'
    ? [{ name: 'Python executable', extensions: ['exe'] }]
    : [{ name: 'LabelImg launchers', extensions: ['exe', 'py'] }, { name: 'All files', extensions: ['*'] }] })
  if (selected.canceled) return getLabelImgConfig()
  const selectedPath = selected.filePaths[0]
  if (!fileExists(selectedPath)) return getLabelImgConfig('The selected path is not a file.')
  if (mode === 'python') return saveLabelImgChoice({ path: selectedPath, kind: 'python' })
  if (path.extname(selectedPath).toLowerCase() === '.py') {
    const python = await dialog.showOpenDialog(mainWindow!, { title: 'Choose the Python environment for LabelImg', properties: ['openFile'], filters: [{ name: 'Python', extensions: ['exe'] }] })
    if (python.canceled) return getLabelImgConfig('LabelImg script selected; choose its Python environment to finish setup.')
    return saveLabelImgChoice({ path: selectedPath, kind: 'script', pythonPath: python.filePaths[0] })
  }
  return saveLabelImgChoice({ path: selectedPath, kind: 'executable' })
})
function launchLabelImg(datasetDirectory?: string, classesPath?: string): Promise<void> {
  const preference = readLabelImgPreference()
  const config = getLabelImgConfig()
  if (!config.available || !preference.path || !preference.kind) throw new Error(config.message)
  const args = datasetDirectory ? [datasetDirectory, ...(classesPath ? [classesPath] : [])] : []
  const executable = preference.kind === 'python' ? preference.path : preference.kind === 'script' ? preference.pythonPath! : preference.path
  const launchArgs = preference.kind === 'python' ? ['-m', 'labelImg', ...args] : preference.kind === 'script' ? [preference.path, ...args] : args
  return new Promise((resolve, reject) => {
    const child = spawn(executable, launchArgs, { cwd: datasetDirectory ?? path.dirname(preference.path!), windowsHide: true, detached: true, stdio: 'ignore', shell: false })
    let settled = false
    let startupTimer: NodeJS.Timeout | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (startupTimer) clearTimeout(startupTimer)
      if (error) reject(error)
      else { child.unref(); resolve() }
    }
    child.once('error', error => finish(new Error(`Could not launch LabelImg: ${error.message}`)))
    child.once('spawn', () => { startupTimer = setTimeout(() => finish(), 800) })
    child.once('close', code => { if (!settled) finish(new Error(`LabelImg exited during startup${code === null ? '' : ` (code ${code})`}. Check its Python environment and dependencies.`)) })
  })
}
ipcMain.handle('labelimg:test', async () => {
  try { await launchLabelImg(); return getLabelImgConfig('LabelImg launch process started successfully.') }
  catch (error) { return getLabelImgConfig(error instanceof Error ? error.message : 'Could not launch LabelImg.') }
})
ipcMain.handle('labelimg:open', async (_event, values: unknown, format: unknown, initialDirectory: unknown) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 500 || !['yolo', 'voc'].includes(String(format))) throw new Error('Choose completed image results and a supported LabelImg format.')
  const results: LabelImgResult[] = values.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Invalid image result.')
    const candidate = value as LabelImgResult
    const known = imageResultsBySource.get(path.resolve(candidate.source_path))
    if (!known || !fs.existsSync(candidate.source_path) || !fs.statSync(candidate.source_path).isFile()) throw new Error('This result is no longer available in the current session. Run image inference again to export it.')
    if (!Number.isSafeInteger(candidate.width) || candidate.width < 1 || !Number.isSafeInteger(candidate.height) || candidate.height < 1 || !Array.isArray(candidate.detections)) throw new Error('Image result metadata is invalid.')
    return known
  })
  let preference = readLabelImgPreference()
  if (!getLabelImgConfig().available) {
    const configure = await dialog.showMessageBox(mainWindow!, { type: 'info', title: 'Set up LabelImg', message: 'LabelImg is not configured. Locate the application now?', buttons: ['Locate LabelImg', 'Cancel'], cancelId: 1 })
    if (configure.response !== 0) return null
    const located = await dialog.showOpenDialog(mainWindow!, { title: 'Locate LabelImg', properties: ['openFile'], filters: [{ name: 'LabelImg launchers', extensions: ['exe', 'py'] }, { name: 'All files', extensions: ['*'] }] })
    if (located.canceled) return null
    const launcher = located.filePaths[0]
    if (!fileExists(launcher)) throw new Error('The selected LabelImg path is not a file.')
    if (path.extname(launcher).toLowerCase() === '.py') {
      const python = await dialog.showOpenDialog(mainWindow!, { title: 'Choose the Python environment for LabelImg', properties: ['openFile'], filters: [{ name: 'Python', extensions: ['exe'] }] })
      if (python.canceled) return null
      preference = { path: launcher, kind: 'script', pythonPath: python.filePaths[0] }
    } else preference = { path: launcher, kind: 'executable' }
    writeLabelImgPreference(preference)
  }
  const configured = getLabelImgConfig()
  if (!configured.available || !preference.path) throw new Error(configured.message)
  const selectedFormat = String(format) as 'yolo' | 'voc'
  const initial = typeof initialDirectory === 'string' && path.isAbsolute(initialDirectory) && fs.existsSync(initialDirectory) && fs.statSync(initialDirectory).isDirectory() ? initialDirectory : app.getPath('pictures')
  const selected = await dialog.showOpenDialog(mainWindow!, { title: 'Choose a parent folder for a LabelImg dataset', defaultPath: initial, properties: ['openDirectory', 'createDirectory'] })
  if (selected.canceled) return null
  const parent = selected.filePaths[0]
  let datasetDirectory = path.join(parent, 'boundary-vision-labelimg')
  let suffix = 1
  while (fs.existsSync(datasetDirectory)) datasetDirectory = path.join(parent, `boundary-vision-labelimg-${suffix++}`)
  await fs.promises.mkdir(datasetDirectory)
  try {
  const usedNames = new Set<string>()
  const classNames = new Map<number, string>()
  for (const result of results) for (const [classId, name] of (imageClassesBySource.get(path.resolve(result.source_path)) ?? []).entries()) {
    const current = classNames.get(classId)
    if (current && current !== name) throw new Error('Inconsistent model class metadata was returned for LabelImg export.')
    classNames.set(classId, name)
  }
  for (const result of results) for (const detection of result.detections) {
    if (!Number.isSafeInteger(detection.class_id) || detection.class_id < 0 || typeof detection.class_name !== 'string') throw new Error('Detection class metadata is invalid.')
    const old = classNames.get(detection.class_id)
    if (old && old !== detection.class_name) throw new Error('Inconsistent class names were returned for the same class ID.')
    classNames.set(detection.class_id, detection.class_name)
  }
  const names = Array.from({ length: Math.max(-1, ...classNames.keys()) + 1 }, (_, index) => classNames.get(index) ?? `class_${index}`)
  for (const result of results) {
    const source = path.resolve(result.source_path)
    const ext = path.extname(source)
    const stem = path.basename(source, ext)
    let imageName = `${stem}${ext}`
    let duplicate = 1
    while (usedNames.has(imageName.toLowerCase())) imageName = `${stem}_${duplicate++}${ext}`
    usedNames.add(imageName.toLowerCase())
    await fs.promises.copyFile(source, path.join(datasetDirectory, imageName), fs.constants.COPYFILE_EXCL)
    const labelPath = path.join(datasetDirectory, `${path.basename(imageName, ext)}.${selectedFormat === 'yolo' ? 'txt' : 'xml'}`)
    if (selectedFormat === 'yolo') {
      const lines = result.detections.map(detection => {
        const x = (detection.x1 + detection.x2) / 2 / result.width
        const y = (detection.y1 + detection.y2) / 2 / result.height
        const w = (detection.x2 - detection.x1) / result.width
        const h = (detection.y2 - detection.y1) / result.height
        if (![x, y, w, h, detection.confidence].every(Number.isFinite) || w < 0 || h < 0) throw new Error('Detection coordinates are invalid.')
        return `${detection.class_id} ${x} ${y} ${w} ${h}`
      })
      await fs.promises.writeFile(labelPath, lines.join('\n') + (lines.length ? '\n' : ''), { flag: 'wx' })
    } else {
      const objects = result.detections.map(detection => `<object><name>${escapeXml(detection.class_name)}</name><pose>Unspecified</pose><truncated>0</truncated><difficult>0</difficult><bndbox><xmin>${Math.max(1, Math.floor(detection.x1) + 1)}</xmin><ymin>${Math.max(1, Math.floor(detection.y1) + 1)}</ymin><xmax>${Math.min(result.width, Math.floor(detection.x2))}</xmax><ymax>${Math.min(result.height, Math.floor(detection.y2))}</ymax></bndbox></object>`).join('')
      const xml = `<?xml version="1.0" encoding="UTF-8"?><annotation><folder>${escapeXml(path.basename(datasetDirectory))}</folder><filename>${escapeXml(imageName)}</filename><path>${escapeXml(path.join(datasetDirectory, imageName))}</path><source><database>Unknown</database></source><size><width>${result.width}</width><height>${result.height}</height><depth>3</depth></size><segmented>0</segmented>${objects}</annotation>`
      await fs.promises.writeFile(labelPath, xml, { flag: 'wx' })
    }
  }
  const classesPath = path.join(datasetDirectory, 'classes.txt')
  await fs.promises.writeFile(classesPath, names.join('\n') + '\n', { flag: 'wx' })
  await launchLabelImg(datasetDirectory, selectedFormat === 'yolo' ? classesPath : undefined)
  return datasetDirectory
  } catch (error) {
    await fs.promises.rm(datasetDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
})
ipcMain.handle('result:preview', async (_event, value: unknown) => {
  if (typeof value !== 'string' || !previewableOutputs.has(path.resolve(value))) throw new Error('That preview is not a generated result.')
  const extension = path.extname(value).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tif', '.tiff'].includes(extension)) throw new Error('Unsupported preview image.')
  const contents = await fs.promises.readFile(value)
  const mime = extension === '.jpg' ? 'image/jpeg' : extension === '.tif' || extension === '.tiff' ? 'image/tiff' : `image/${extension.slice(1)}`
  return `data:${mime};base64,${contents.toString('base64')}`
})
ipcMain.handle('result:video-url', async (_event, value: unknown) => {
  if (typeof value !== 'string' || !previewableVideoOutputs.has(path.resolve(value))) throw new Error('That video is not a generated result.')
  const token = randomUUID()
  videoTokens.set(token, path.resolve(value))
  return `bvmedia://video/${token}`
})
ipcMain.handle('backend:capabilities', async () => {
  sendStatus('Checking Python runtime and available devices…')
  const capabilities = await runWorker({ action: 'capabilities' })
  if (typeof capabilities.pythonVersion === 'string') modelManager.setPythonVersion(capabilities.pythonVersion)
  return capabilities
})
ipcMain.handle('backend:process-images', async (_event, payload: unknown) => {
  if (updateInstallationRequested) throw new Error('The application is preparing to install an update. Try again after it restarts.')
  if (!payload || typeof payload !== 'object') throw new Error('Processing request is invalid.')
  const p = payload as Record<string, unknown>
  if (!Array.isArray(p.paths) || p.paths.length < 1 || p.paths.length > 500 || !(p.paths as unknown[]).every(item => typeof item === 'string')) throw new Error('Choose between 1 and 500 image files.')
  const paths = (p.paths as string[]).map(value => path.resolve(value))
  if (paths.some(file => !fs.existsSync(file) || !fs.statSync(file).isFile() || !imageExtensions.has(path.extname(file).toLowerCase()))) throw new Error('A selected input is missing or is not a supported image.')
  if (typeof p.outputDir !== 'string' || !path.isAbsolute(p.outputDir) || !fs.existsSync(p.outputDir) || !fs.statSync(p.outputDir).isDirectory()) throw new Error('Choose an existing output folder.')
  const options = validateOptions(p.options)
  const selected = await modelManager.getSelectedModel()
  if (!selected) throw new Error('Select an installed model in Model Manager before running detection.')
  if (options.modelId !== selected.id || options.modelVersion !== selected.version) throw new Error('The selected model version changed. Select it again before starting inference.')
  modelManager.beginInference(selected.id, selected.version)
  try {
    const model = await modelManager.resolveForInference(selected.id, selected.version)
    sendStatus('Starting image inference…')
    const response = await runWorker({
      action: 'process_images', paths, outputDir: path.resolve(p.outputDir), ...options,
      modelId: model.id, modelPath: model.path, modelClasses: model.classes,
      modelSha256: model.sha256, modelSizeBytes: model.sizeBytes,
    }, update => {
      const imagePath = (update as { result?: { output_image_path?: string | null } }).result?.output_image_path
      if (imagePath) previewableOutputs.add(path.resolve(imagePath))
      mainWindow?.webContents.send('backend:progress', update)
    })
    for (const result of response.results as Array<{ output_image_path?: string | null }>) {
      if (result.output_image_path) previewableOutputs.add(path.resolve(result.output_image_path))
      const typedResult = result as unknown as LabelImgResult
      imageResultsBySource.set(path.resolve(typedResult.source_path), { ...typedResult, detections: typedResult.detections.map(detection => ({ ...detection })) })
      imageClassesBySource.set(path.resolve(typedResult.source_path), [...model.classes])
    }
    sendStatus('Processing complete')
    return response.results
  } finally {
    modelManager.setActiveInferenceModel(null)
  }
})
ipcMain.handle('backend:process-video', async (_event, payload: unknown) => {
  if (updateInstallationRequested) throw new Error('The application is preparing to install an update. Try again after it restarts.')
  if (!payload || typeof payload !== 'object') throw new Error('Video processing request is invalid.')
  const p = payload as Record<string, unknown>
  if (typeof p.filePath !== 'string') throw new Error('Choose a video file.')
  const filePath = path.resolve(p.filePath)
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || !videoExtensions.has(path.extname(filePath).toLowerCase())) throw new Error('The selected file is missing or is not a supported video.')
  if (typeof p.outputDir !== 'string' || !path.isAbsolute(p.outputDir) || !fs.existsSync(p.outputDir) || !fs.statSync(p.outputDir).isDirectory()) throw new Error('Choose an existing output folder.')
  if (!p.options || typeof p.options !== 'object') throw new Error('Video settings are missing.')
  const options = p.options as Record<string, unknown>
  if (typeof options.modelId !== 'string' || !options.modelId.trim()) throw new Error('Choose an installed model.')
  if (typeof options.confidence !== 'number' || !Number.isFinite(options.confidence) || options.confidence < 0.01 || options.confidence > 1) throw new Error('Confidence must be from 0.01 to 1.00.')
  if (typeof options.device !== 'string' || !['cpu', 'cuda:0'].includes(options.device)) throw new Error('Choose a supported processing device.')
  if (typeof options.inferenceFps !== 'number' || !Number.isFinite(options.inferenceFps) || options.inferenceFps < 0.1 || options.inferenceFps > 120) throw new Error('Inference FPS must be from 0.1 to 120.')
  if (typeof options.outputFps !== 'number' || !Number.isFinite(options.outputFps) || options.outputFps < 1 || options.outputFps > 60) throw new Error('Output FPS must be from 1 to 60.')
  if (!Array.isArray(options.formats) || !(options.formats as unknown[]).every(format => ['yolo', 'voc', 'createml'].includes(String(format)))) throw new Error('Invalid frame annotation settings.')
  if (!ffmpegPath || !ffprobePath || !fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) throw new Error('FFmpeg and FFprobe are required. Install a matching FFmpeg build with both executables available on PATH.')
  const selected = await modelManager.getSelectedModel()
  if (!selected || options.modelId !== selected.id || options.modelVersion !== selected.version) throw new Error('Select an installed model version in Model Manager before processing video.')
  modelManager.beginInference(selected.id, selected.version)
  sendStatus('Preparing timestamped video processing…')
  try {
    const model = await modelManager.resolveForInference(selected.id, selected.version)
    const response = await runWorker({
      action: 'process_video', filePath, outputDir: path.resolve(p.outputDir),
      modelId: model.id, modelPath: model.path, modelClasses: model.classes,
      modelSha256: model.sha256, modelSizeBytes: model.sizeBytes,
      ffmpegPath, ffprobePath, confidence: options.confidence, device: options.device,
      inferenceFps: options.inferenceFps, outputFps: options.outputFps, formats: options.formats,
    }, update => {
      const progress = update as { event?: string; currentTime?: number; duration?: number; percent?: number; decodedFrames?: number; inferredFrames?: number; outputFrames?: number }
      if (progress.event === 'video_progress') mainWindow?.webContents.send('backend:video-progress', progress)
    })
    const result = response.result as { output_video_path: string }
    previewableVideoOutputs.add(path.resolve(result.output_video_path))
    sendStatus('Video processing complete')
    return response.result
  } finally {
    modelManager.setActiveInferenceModel(null)
  }
})
ipcMain.handle('backend:cancel', async () => { if (activeWorker) { requestWorkerCancellation(); sendStatus('Cancelling and cleaning up temporary video files…') } })
ipcMain.handle('model:list', async () => await modelManager.list())
ipcMain.handle('model:select', async (_event, modelId: unknown, version: unknown) => {
  if (updateInstallationRequested) throw new Error('The application is preparing to install an update. Try again after it restarts.')
  if (typeof modelId !== 'string' || typeof version !== 'string') throw new Error('Invalid model ID or version.')
  await modelManager.select(modelId, version)
  return await modelManager.list()
})
ipcMain.handle('model:install', async (_event, modelId: unknown, version: unknown) => {
  if (updateInstallationRequested) throw new Error('The application is preparing to install an update. Try again after it restarts.')
  if (typeof modelId !== 'string' || typeof version !== 'string') throw new Error('Invalid model ID or version.')
  await modelManager.install(modelId, version, progress => mainWindow?.webContents.send('model:install-progress', progress))
  return await modelManager.list()
})
ipcMain.handle('model:remove', async (_event, modelId: unknown, version: unknown) => {
  if (updateInstallationRequested) throw new Error('The application is preparing to install an update. Try again after it restarts.')
  if (typeof modelId !== 'string' || typeof version !== 'string') throw new Error('Invalid model ID or version.')
  await modelManager.remove(modelId, version)
  return await modelManager.list()
})
ipcMain.handle('model:cancel-install', async (_event, modelId: unknown, version: unknown) => {
  if (typeof modelId === 'string' && typeof version === 'string') modelManager.cancelInstall(modelId, version)
})

ipcMain.handle('update:state', () => updateState)
ipcMain.handle('update:check', () => checkForApplicationUpdate())
ipcMain.handle('update:download', async () => {
  if (!updateState.configured || updateState.status !== 'available') return updateState
  if (activeWorker) throw new Error('Finish or cancel the current processing job before downloading an application update.')
  try {
    publishUpdateState({ ...updateState, status: 'downloading', percent: 0, transferred: 0, message: 'Starting update download…' })
    await autoUpdater.downloadUpdate()
  } catch (error) {
    publishUpdateState({ ...updateState, status: 'error', message: `Update download failed. You can retry when online. ${error instanceof Error ? error.message : ''}`.trim() })
  }
  return updateState
})
ipcMain.handle('update:install', async () => {
  if (activeWorker || modelManager.hasActiveWork()) throw new Error('Finish or cancel the current processing or model update job before restarting to install the application update.')
  if (updateState.status !== 'downloaded') throw new Error('No verified application update is ready to install.')
  updateInstallationRequested = true
  autoUpdater.quitAndInstall(false, true)
})
