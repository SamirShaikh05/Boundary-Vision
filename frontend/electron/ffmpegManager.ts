import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { Readable, Transform, type Readable as NodeReadable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const FFmpegSetup = {
  version: '9.0.2',
  archiveUrl: 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip',
  archiveSha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
  archiveRoot: 'ffmpeg-9.0.2-essentials_build',
}
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024
const MAX_EXECUTABLE_BYTES = 300 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 20_000
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024

type ZipEntry = {
  path: string
  type: string
  uncompressedSize: number
  stream(): NodeReadable
}

type ZipModule = {
  Open: {
    file(filePath: string): Promise<{ files: ZipEntry[] }>
  }
}

type SetupPrompt = (error: Error | null, retry: boolean) => Promise<boolean>
export type ManagedFfmpegTools = { ffmpegPath: string; ffprobePath: string }

const unzipper = require('unzipper') as ZipModule
let setupInProgress: Promise<ManagedFfmpegTools> | null = null
let activeSetupController: AbortController | null = null

export function cancelManagedFfmpegSetup(): boolean {
  if (!activeSetupController) return false
  activeSetupController.abort(new Error('FFmpeg setup was cancelled by the user.'))
  return true
}

export function ensureManagedFfmpegTools(userDataPath: string, prompt: SetupPrompt): Promise<ManagedFfmpegTools> {
  if (setupInProgress) return setupInProgress
  const pending = resolveManagedFfmpegTools(userDataPath, prompt)
  setupInProgress = pending
  return pending.finally(() => {
    if (setupInProgress === pending) setupInProgress = null
  })
}

async function resolveManagedFfmpegTools(userDataPath: string, prompt: SetupPrompt): Promise<ManagedFfmpegTools> {
  const toolsRoot = path.join(userDataPath, 'tools', 'ffmpeg')
  const installDirectory = path.join(toolsRoot, FFmpegSetup.version)
  await ensureManagedDirectory(toolsRoot)
  let existingError: Error | null = null

  try {
    return await validateTools(installDirectory)
  } catch (error) {
    existingError = error instanceof Error ? error : new Error(String(error))
  }

  if (!(await prompt(existingError, false))) {
    throw new Error('FFmpeg and FFprobe setup was cancelled. Retry video processing to try again.')
  }

  const controller = new AbortController()
  activeSetupController = controller
  try {
    while (true) {
      try {
        return await downloadAndInstall(toolsRoot, installDirectory, controller.signal)
      } catch (error) {
        if (controller.signal.aborted) throw new Error('FFmpeg and FFprobe setup was cancelled. Retry video processing to try again.')
        const installError = error instanceof Error ? error : new Error(String(error))
        if (!(await prompt(installError, true))) {
          throw new Error(`FFmpeg and FFprobe setup failed and was cancelled: ${installError.message}`)
        }
      }
    }
  } finally {
    if (activeSetupController === controller) activeSetupController = null
  }
}

async function validateTools(directory: string): Promise<ManagedFfmpegTools> {
  let directoryStat: fs.Stats
  try {
    directoryStat = await fs.promises.lstat(directory)
  } catch {
    throw new Error('FFmpeg and FFprobe are not installed in Boundary Vision managed storage.')
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('The managed FFmpeg directory is not a safe regular directory.')
  }
  const tools = {
    ffmpegPath: path.join(directory, 'ffmpeg.exe'),
    ffprobePath: path.join(directory, 'ffprobe.exe'),
  }
  await Promise.all([
    verifyExecutable(tools.ffmpegPath, 'ffmpeg'),
    verifyExecutable(tools.ffprobePath, 'ffprobe'),
  ])
  return tools
}

async function verifyExecutable(executable: string, name: 'ffmpeg' | 'ffprobe'): Promise<void> {
  let stat: fs.Stats
  try {
    stat = await fs.promises.lstat(executable)
  } catch {
    throw new Error(`${name}.exe is missing from managed FFmpeg storage.`)
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > MAX_EXECUTABLE_BYTES) {
    throw new Error(`${name}.exe in managed FFmpeg storage is not a valid regular executable file.`)
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['-version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    let timer: NodeJS.Timeout
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        child.kill()
        reject(error)
      } else {
        resolve()
      }
    }
    const capture = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-8192)
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    child.once('error', error => finish(new Error(`Could not run ${name}.exe: ${error.message}`)))
    child.once('close', code => {
      const hasVersion = output.split(/\r?\n/).some(line => line.toLowerCase().startsWith(`${name} version `))
      finish(code === 0 && hasVersion ? undefined : new Error(`${name}.exe failed its version check.`))
    })
    timer = setTimeout(() => finish(new Error(`${name}.exe did not respond to its version check.`)), 15_000)
  })
}

async function downloadAndInstall(toolsRoot: string, installDirectory: string, signal: AbortSignal): Promise<ManagedFfmpegTools> {
  await ensureManagedDirectory(toolsRoot)
  const stagingDirectory = await fs.promises.mkdtemp(path.join(toolsRoot, '.ffmpeg-setup-'))
  const archivePath = path.join(stagingDirectory, 'ffmpeg.zip')
  const stagedTools = path.join(stagingDirectory, 'tools')
  const backupDirectory = path.join(toolsRoot, `.ffmpeg-backup-${randomUUID()}`)
  let movedOldDirectory = false

  try {
    await downloadArchive(archivePath, signal)
    signal.throwIfAborted()
    await verifyArchiveHash(archivePath, signal)
    await extractExecutables(archivePath, stagedTools, signal)
    signal.throwIfAborted()
    await validateTools(stagedTools)

    await fs.promises.rm(archivePath)
    if (await pathExists(installDirectory)) {
      await fs.promises.rename(installDirectory, backupDirectory)
      movedOldDirectory = true
    }
    try {
      await fs.promises.rename(stagedTools, installDirectory)
    } catch (error) {
      if (movedOldDirectory) {
        await fs.promises.rename(backupDirectory, installDirectory)
        movedOldDirectory = false
      }
      throw error
    }
    if (movedOldDirectory) await fs.promises.rm(backupDirectory, { recursive: true })
    return validateTools(installDirectory)
  } finally {
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true })
  }
}

async function downloadArchive(destination: string, signal: AbortSignal): Promise<void> {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(new Error('FFmpeg download timed out.')), 10 * 60 * 1000)
  const abortOnSetupCancellation = () => timeoutController.abort(signal.reason)
  signal.addEventListener('abort', abortOnSetupCancellation, { once: true })
  const downloadSignal = AbortSignal.any([signal, timeoutController.signal])
  try {
    let url = new URL(FFmpegSetup.archiveUrl)
    let response: Response | null = null
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (url.protocol !== 'https:' || url.hostname !== 'www.gyan.dev' || url.username || url.password) {
        throw new Error('FFmpeg download redirected to an untrusted destination.')
      }
      response = await fetch(url, { signal: downloadSignal, redirect: 'manual' })
      if (response.status < 300 || response.status >= 400) break
      const location = response.headers.get('location')
      if (!location) throw new Error('FFmpeg download redirect did not include a destination.')
      if (redirects === 5) throw new Error('FFmpeg download exceeded the redirect limit.')
      url = new URL(location, url)
      await response.body?.cancel()
    }
    if (!response?.ok || !response.body) {
      throw new Error(`FFmpeg download failed${response ? ` with HTTP ${response.status}` : ''}.`)
    }
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) {
      await response.body.cancel()
      throw new Error('The FFmpeg archive exceeds the download size limit.')
    }

    let receivedBytes = 0
    const sizeLimit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        receivedBytes += chunk.length
        if (receivedBytes > MAX_ARCHIVE_BYTES) return callback(new Error('The FFmpeg archive exceeds the download size limit.'))
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), sizeLimit, createWriteStream(destination, { flags: 'wx' }), { signal: downloadSignal })
    if (!receivedBytes) throw new Error('The FFmpeg download was empty.')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not download FFmpeg from Gyan.dev: ${detail}`)
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abortOnSetupCancellation)
  }
}

async function verifyArchiveHash(archivePath: string, signal: AbortSignal): Promise<void> {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(archivePath)) {
    signal.throwIfAborted()
    hash.update(chunk as Buffer)
  }
  if (hash.digest('hex') !== FFmpegSetup.archiveSha256) {
    throw new Error('The downloaded FFmpeg archive failed SHA-256 verification; it was not extracted.')
  }
}

async function extractExecutables(archivePath: string, destination: string, signal: AbortSignal): Promise<void> {
  const archive = await unzipper.Open.file(archivePath)
  if (archive.files.length > MAX_ARCHIVE_ENTRIES) throw new Error('The FFmpeg archive contains too many entries.')

  let declaredTotal = 0
  const targets = new Map<string, ZipEntry>()
  const safePath = /^[A-Za-z0-9._/-]+$/
  for (const entry of archive.files) {
    if (!safePath.test(entry.path) || entry.path.startsWith('/') || entry.path.includes('//')) {
      throw new Error('The FFmpeg archive contains an unsafe entry path.')
    }
    const segments = entry.path.split('/').filter(Boolean)
    if (segments.some(segment => segment === '.' || segment === '..' || segment.includes(':')) || entry.type === 'SymbolicLink') {
      throw new Error('The FFmpeg archive contains an unsafe path or symbolic link.')
    }
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
      throw new Error('The FFmpeg archive contains an invalid entry size.')
    }
    declaredTotal += entry.uncompressedSize
    if (declaredTotal > MAX_UNCOMPRESSED_BYTES) throw new Error('The FFmpeg archive exceeds the extraction size limit.')

    const name = entry.path === `${FFmpegSetup.archiveRoot}/bin/ffmpeg.exe`
      ? 'ffmpeg.exe'
      : entry.path === `${FFmpegSetup.archiveRoot}/bin/ffprobe.exe` ? 'ffprobe.exe' : null
    if (!name) continue
    if (entry.type !== 'File' || entry.uncompressedSize === 0 || entry.uncompressedSize > MAX_EXECUTABLE_BYTES) {
      throw new Error(`The FFmpeg archive contains an invalid ${name} entry.`)
    }
    if (targets.has(name)) throw new Error(`The FFmpeg archive contains duplicate ${name} entries.`)
    targets.set(name, entry)
  }
  if (targets.size !== 2) throw new Error('The FFmpeg archive must contain exactly one ffmpeg.exe and one ffprobe.exe.')

  await fs.promises.mkdir(destination)
  await Promise.all([...targets].map(async ([name, entry]) => {
    let extractedBytes = 0
    const sizeLimit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        extractedBytes += chunk.length
        if (extractedBytes > entry.uncompressedSize || extractedBytes > MAX_EXECUTABLE_BYTES) {
          return callback(new Error(`The extracted ${name} exceeds its declared size.`))
        }
        callback(null, chunk)
      },
    })
    await pipeline(entry.stream(), sizeLimit, createWriteStream(path.join(destination, name), { flags: 'wx' }), { signal })
    if (extractedBytes !== entry.uncompressedSize) throw new Error(`The extracted ${name} does not match its declared size.`)
  }))
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.lstat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function ensureManagedDirectory(directory: string): Promise<void> {
  await fs.promises.mkdir(directory, { recursive: true })
  const stat = await fs.promises.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Boundary Vision FFmpeg storage is not a safe regular directory.')
  }
}
