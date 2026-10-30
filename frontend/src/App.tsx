import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDownToLine,
  Boxes,
  Check,
  ChevronDown,
  CircleHelp,
  Cpu,
  DownloadCloud,
  ExternalLink,
  FileImage,
  Film,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  Play,
  Plus,
  RotateCw,
  ScanLine,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type {
  AnnotationFormat,
  DeviceOption,
  ImageResult,
  LabelImgConfig,
  ModelCatalog,
  ModelId,
  ModelInstallProgress,
  ProgressUpdate,
  UpdateState,
  VideoProgressUpdate,
  VideoResult
} from '../electron/types'
import { toggleExportFormat } from './exportSelection'

type Mode = 'images' | 'video'
type View = 'detect' | 'models' | 'about'

const formatLabels: Record<AnnotationFormat, string> = {
  yolo: 'YOLO TXT',
  voc: 'Pascal VOC XML',
  createml: 'CreateML JSON'
}

export default function App() {
  const [mode, setMode] = useState<Mode>('images')
  const [view, setView] = useState<View>('detect')
  const [files, setFiles] = useState<string[]>([])
  const [videoFile, setVideoFile] = useState<string | null>(null)
  const [videoResult, setVideoResult] = useState<VideoResult | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoProgress, setVideoProgress] = useState<VideoProgressUpdate | null>(null)
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [model, setModel] = useState<ModelId | null>(null)
  const [modelVersion, setModelVersion] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null)
  const [modelProgress, setModelProgress] = useState<ModelInstallProgress | null>(null)
  const [modelBusy, setModelBusy] = useState<string | null>(null)
  const [modelErrors, setModelErrors] = useState<Record<string, string>>({})
  const [checkingModelUpdates, setCheckingModelUpdates] = useState(false)
  const [confidence, setConfidence] = useState(0.35)
  const [device, setDevice] = useState('cpu')
  const [devices, setDevices] = useState<DeviceOption[]>([{ id: 'cpu', label: 'CPU' }])
  const [batchSize, setBatchSize] = useState<number | null>(null)
  const [inferenceFps, setInferenceFps] = useState(2)
  const [outputFps, setOutputFps] = useState(30)
  const [outputImage, setOutputImage] = useState(true)
  const [formats, setFormats] = useState<AnnotationFormat[]>([])
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('Ready for inference')
  const [progress, setProgress] = useState<ProgressUpdate | null>(null)
  const [results, setResults] = useState<ImageResult[]>([])
  const [error, setError] = useState('')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [updateState, setUpdateState] = useState<UpdateState>({
    currentVersion: '',
    status: 'idle',
    configured: false,
    message: 'Checking update service…'
  })
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(null)
  const [labelImgConfig, setLabelImgConfig] = useState<LabelImgConfig>({
    path: null,
    available: false,
    message: 'Loading LabelImg status…'
  })
  const [labelImgFormat, setLabelImgFormat] = useState<'yolo' | 'voc'>('yolo')
  const [labelImgBusy, setLabelImgBusy] = useState(false)
  const [activePreviewModal, setActivePreviewModal] = useState<string | null>(null)

  useEffect(() => {
    window.boundaryVision.getCapabilities()
      .then(async result => {
        setDevices(result.devices)
        if (result.devices.length) setDevice(result.devices[0].id)
        const value = await window.boundaryVision.getModelCatalog()
        setCatalog(value)
        setModel(value.selectedId)
        setModelVersion(value.selectedVersion)
        if (!value.selectedId) setView('models')
      })
      .catch(async reason => {
        setError(reason instanceof Error ? reason.message : 'Could not start the inference worker.')
        setView('models')
        try {
          setCatalog(await window.boundaryVision.getModelCatalog())
        } catch {
          /* Shown when Model Manager loads */
        }
      })

    const unsubscribeProgress = window.boundaryVision.onProgress(update => {
      setProgress(update)
      setResults(current => [...current.filter(item => item.source_path !== update.result.source_path), update.result])
      setStatus(`Processed ${update.completed} of ${update.total} images`)
    })

    const unsubscribeVideoProgress = window.boundaryVision.onVideoProgress(update => {
      setVideoProgress(update)
      setStatus(`Video ${update.percent}% · ${formatTime(update.currentTime)} / ${formatTime(update.duration)}`)
    })

    const unsubscribeModelProgress = window.boundaryVision.onModelInstallProgress(update => setModelProgress(update))
    const unsubscribeUpdateState = window.boundaryVision.onUpdateState(value => setUpdateState(value))

    window.boundaryVision.getUpdateState().then(setUpdateState).catch(() => undefined)
    window.boundaryVision.getLabelImgConfig().then(setLabelImgConfig).catch(() => undefined)

    return () => {
      unsubscribeProgress()
      unsubscribeVideoProgress()
      unsubscribeModelProgress()
      unsubscribeUpdateState()
    }
  }, [])

  useEffect(() => {
    const pending = results.filter(result => result.output_image_path && !previews[result.output_image_path])
    pending.forEach(result => {
      if (!result.output_image_path) return
      window.boundaryVision.previewImage(result.output_image_path)
        .then(data => setPreviews(current => ({ ...current, [result.output_image_path!]: data })))
        .catch(() => undefined)
    })
  }, [results, previews])

  useEffect(() => {
    if (!activePreviewModal) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActivePreviewModal(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePreviewModal])

  const selectedModelCompatible = !!model && !!modelVersion && catalog?.models.some(
    item => item.id === model && item.versions.some(v => v.version === modelVersion && v.status === 'installed' && v.formatSupported)
  )

  const validVideoRates = Number.isFinite(inferenceFps) && inferenceFps >= 0.1 && inferenceFps <= 120 && Number.isFinite(outputFps) && outputFps >= 1 && outputFps <= 60
  const isReady = view === 'detect' && selectedModelCompatible && !!outputDir && !running && (mode === 'images' ? files.length > 0 && (outputImage || formats.length > 0) : !!videoFile && validVideoRates)
  const completedCount = progress?.completed ?? 0
  const totalCount = progress?.total ?? files.length
  const modelUpdates = catalog?.models.filter(item => item.updateAvailable) ?? []

  const counts = useMemo(() => results.reduce((acc, result) => {
    for (const detection of result.detections) {
      acc[detection.class_name] = (acc[detection.class_name] ?? 0) + 1
    }
    return acc
  }, {} as Record<string, number>), [results])

  const activeModelDetails = useMemo(() => {
    if (!catalog || !model) return null
    return catalog.models.find(m => m.id === model) ?? null
  }, [catalog, model])

  async function selectImages() {
    const selected = await window.boundaryVision.chooseImages()
    if (selected.length) {
      setFiles(current => [...new Set([...current, ...selected])])
      setError('')
      setResults([])
      setProgress(null)
    }
  }

  function removeFile(target: string) {
    setFiles(current => current.filter(item => item !== target))
  }

  async function selectVideo() {
    const selected = await window.boundaryVision.chooseVideo()
    if (selected) {
      setVideoFile(selected)
      setVideoResult(null)
      setVideoUrl(null)
      setVideoProgress(null)
      setError('')
      setStatus('Video ready for processing')
    }
  }

  async function chooseOutput() {
    const selected = await window.boundaryVision.chooseOutputDirectory()
    if (selected) setOutputDir(selected)
  }

  function toggleFormat(format: AnnotationFormat) {
    setFormats(current => {
      const selected = toggleExportFormat(current[0] ?? null, format)
      return selected ? [selected] : []
    })
  }

  async function startProcessing() {
    if (!isReady || !outputDir || !model) return
    setRunning(true)
    setError('')
    setProgress(null)
    setResults([])
    setStatus('Loading checkpoint and preparing images…')
    try {
      if (!modelVersion) throw new Error('Choose an installed model version.')
      await window.boundaryVision.processImages(files, outputDir, {
        modelId: model,
        modelVersion,
        confidence,
        device,
        batchSize,
        outputImage,
        formats
      })
      setStatus('Image detection complete')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Image processing failed.'
      setError(message)
      setStatus(message.toLowerCase().includes('cancel') ? 'Detection cancelled' : 'Detection stopped')
    } finally {
      setRunning(false)
    }
  }

  async function startVideoProcessing() {
    if (!isReady || !outputDir || !model || !videoFile) return
    setRunning(true)
    setError('')
    setVideoProgress(null)
    setVideoResult(null)
    setVideoUrl(null)
    setStatus('Inspecting timestamps and initializing video engine…')
    try {
      if (!modelVersion) throw new Error('Choose an installed model version.')
      const result = await window.boundaryVision.processVideo(videoFile, outputDir, {
        modelId: model,
        modelVersion,
        confidence,
        device,
        inferenceFps,
        outputFps,
        formats
      })
      setVideoResult(result)
      setVideoUrl(await window.boundaryVision.previewVideo(result.output_video_path))
      setStatus('Video processing complete')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Video processing failed.'
      setError(message)
      setStatus(message.toLowerCase().includes('cancel') ? 'Video processing cancelled' : 'Video processing stopped')
    } finally {
      setRunning(false)
    }
  }

  async function cancel() {
    await window.boundaryVision.cancelProcessing()
  }

  async function refreshCatalog() {
    const value = await window.boundaryVision.getModelCatalog()
    setCatalog(value)
    setModel(value.selectedId)
    setModelVersion(value.selectedVersion)
  }

  async function checkModelUpdates() {
    setCheckingModelUpdates(true)
    try {
      const value = await window.boundaryVision.refreshModelCatalog()
      setCatalog(value)
      setModel(value.selectedId)
      setModelVersion(value.selectedVersion)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh the model registry.')
    } finally { setCheckingModelUpdates(false) }
  }

  async function chooseModel(modelId: ModelId, version: string) {
    setModelBusy(`${modelId}@${version}`)
    setError('')
    try {
      const value = await window.boundaryVision.selectModel(modelId, version)
      setCatalog(value)
      setModel(value.selectedId)
      setModelVersion(value.selectedVersion)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not select that model.')
    } finally {
      setModelBusy(null)
    }
  }

  async function installModel(modelId: ModelId, version: string) {
    const key = `${modelId}@${version}`
    setModelBusy(`${modelId}@${version}`)
    setModelErrors(current => { const next = { ...current }; delete next[key]; return next })
    setModelProgress(null)
    setError('')
    try {
      const value = await window.boundaryVision.installModel(modelId, version)
      setCatalog(value)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Model installation failed.'
      setModelErrors(current => ({ ...current, [key]: message }))
      setError(message)
    } finally {
      setModelBusy(null)
      setModelProgress(null)
      await refreshCatalog()
    }
  }

  async function updateAllModels() {
    const targets = modelUpdates.map(item => ({ id: item.id, version: item.latestVersion }))
    const failures: string[] = []
    for (const target of targets) {
      setModelBusy(`${target.id}@${target.version}`)
      setModelProgress(null)
      try {
        await window.boundaryVision.installModel(target.id, target.version)
        setModelErrors(current => { const next = { ...current }; delete next[`${target.id}@${target.version}`]; return next })
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'update failed'
        setModelErrors(current => ({ ...current, [`${target.id}@${target.version}`]: message }))
        failures.push(`${target.id}: ${message}`)
      }
    }
    setModelBusy(null)
    setModelProgress(null)
    await refreshCatalog()
    if (failures.length) setError(`Some model updates could not be installed. ${failures.join(' ')}`)
  }

  async function removeModel(modelId: ModelId, version: string) {
    setModelBusy(`${modelId}@${version}`)
    setError('')
    try {
      const value = await window.boundaryVision.removeModel(modelId, version)
      setCatalog(value)
      setModel(value.selectedId)
      setModelVersion(value.selectedVersion)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove that model.')
    } finally {
      setModelBusy(null)
    }
  }

  async function checkForUpdates() {
    try {
      setUpdateState(await window.boundaryVision.checkForUpdates())
    } catch (reason) {
      setUpdateState(current => ({ ...current, status: 'error', message: reason instanceof Error ? reason.message : 'Could not check for updates.' }))
    }
  }

  async function downloadUpdate() {
    try {
      setUpdateState(await window.boundaryVision.downloadAppUpdate())
    } catch (reason) {
      setUpdateState(current => ({ ...current, status: 'error', message: reason instanceof Error ? reason.message : 'Could not download the update.' }))
    }
  }

  async function installUpdate() {
    try {
      await window.boundaryVision.installAppUpdate()
    } catch (reason) {
      setUpdateState(current => ({ ...current, status: 'error', message: reason instanceof Error ? reason.message : 'Could not restart to install the update.' }))
    }
  }

  async function configureLabelImg() {
    try {
      setLabelImgConfig(await window.boundaryVision.chooseLabelImgFolder())
    } catch (reason) {
      setLabelImgConfig(current => ({ ...current, message: reason instanceof Error ? reason.message : 'Could not select the LabelImg folder.' }))
    }
  }

  async function startLabelImg() {
    setLabelImgBusy(true)
    try {
      setLabelImgConfig(await window.boundaryVision.launchLabelImg())
    } catch (reason) {
      setLabelImgConfig(current => ({ ...current, message: reason instanceof Error ? reason.message : 'Could not launch LabelImg.' }))
    } finally {
      setLabelImgBusy(false)
    }
  }

  async function openInLabelImg() {
    if (!results.length) return
    setLabelImgBusy(true)
    setError('')
    try {
      const directory = await window.boundaryVision.openLabelImg(results, labelImgFormat, outputDir)
      if (directory) {
        setStatus(`LabelImg opened with ${labelImgFormat === 'yolo' ? 'YOLO' : 'Pascal VOC'} dataset: ${directory}`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not export or open the LabelImg dataset.')
    } finally {
      setLabelImgBusy(false)
      window.boundaryVision.getLabelImgConfig().then(setLabelImgConfig).catch(() => undefined)
    }
  }

  function clearFiles() {
    setFiles([])
    setVideoFile(null)
    setVideoResult(null)
    setVideoUrl(null)
    setResults([])
    setProgress(null)
    setVideoProgress(null)
    setError('')
    setStatus('Ready for inference')
  }

  return (
    <main className="app-shell">
      {/* SIDEBAR NAVIGATION RAIL */}
      <aside className="rail" aria-label="Application Navigation">
        <div className="brand-mark" title="Boundary Vision Studio">
          <span className="brand-orbit" />
          <ScanLine size={22} />
        </div>

        <div className="rail-divider" />

        <nav className="rail-nav">
          <button
            className={`rail-item ${view === 'detect' && mode === 'images' ? 'selected' : ''}`}
            title="Image Detection"
            onClick={() => { setView('detect'); setMode('images') }}
            disabled={running}
          >
            <div className="rail-item-icon-wrap">
              <FileImage size={20} />
            </div>
            <span className="rail-item-label">Images</span>
          </button>

          <button
            className={`rail-item ${view === 'detect' && mode === 'video' ? 'selected' : ''}`}
            title="Video Detection"
            onClick={() => { setView('detect'); setMode('video') }}
            disabled={running}
          >
            <div className="rail-item-icon-wrap">
              <Film size={20} />
            </div>
            <span className="rail-item-label">Video</span>
          </button>

          <button
            className={`rail-item ${view === 'models' ? 'selected' : ''}`}
            title="Model Manager"
            onClick={() => setView('models')}
            disabled={running}
          >
            <div className="rail-item-icon-wrap">
              <Boxes size={20} />
              {!!modelUpdates.length && <span className="rail-count-badge">{modelUpdates.length}</span>}
            </div>
            <span className="rail-item-label">Models</span>
          </button>

          <button
            className={`rail-item ${view === 'about' ? 'selected' : ''}`}
            title="Settings & About"
            onClick={() => setView('about')}
            disabled={running}
          >
            <div className="rail-item-icon-wrap">
              <Settings size={20} />
              {['available', 'downloading', 'downloaded'].includes(updateState.status) && <span className="rail-update-dot" />}
            </div>
            <span className="rail-item-label">Settings</span>
          </button>
        </nav>

        <div className="rail-bottom">
          <span className="online-dot pulsing" />
          <span className="rail-badge-status">LOCAL</span>
        </div>
      </aside>

      {/* MAIN WORKSPACE AREA */}
      <section className="workspace">
        {/* TOPBAR */}
        <header className="topbar">
          <div className="crumb">
            <span className="crumb-muted">BOUNDARY VISION</span>
            <span className="crumb-slash">/</span>
            <span>
              {view === 'detect'
                ? mode === 'images' ? 'Image Detection Studio' : 'Video Detection Studio'
                : view === 'models' ? 'Model Manager' : 'Settings & About'}
            </span>
          </div>

          {view === 'detect' && (
            <div className="mode-switcher" role="tablist" aria-label="Detection Modes">
              <button
                className={`mode-tab ${mode === 'images' ? 'active' : ''}`}
                onClick={() => setMode('images')}
                disabled={running}
                role="tab"
                aria-selected={mode === 'images'}
              >
                <FileImage size={14} /> Images
              </button>
              <button
                className={`mode-tab ${mode === 'video' ? 'active' : ''}`}
                onClick={() => setMode('video')}
                disabled={running}
                role="tab"
                aria-selected={mode === 'video'}
              >
                <Film size={14} /> Video
              </button>
            </div>
          )}

          <div className="top-meta">
            {activeModelDetails && (
              <button
                className="meta-chip interactive"
                title="Active Model - Click to Manage"
                onClick={() => setView('models')}
                disabled={running}
              >
                <Boxes size={13} />
                <span>{activeModelDetails.name}</span>
                {modelVersion && <span className="version-chip">{modelVersion}</span>}
              </button>
            )}
            <div className="meta-chip">
              <span className="online-dot" />
              <span>On-device</span>
            </div>
            <span className="version-chip">v{updateState.currentVersion || '0.1.0'}</span>
          </div>
        </header>

        {['available', 'downloading', 'downloaded'].includes(updateState.status) && updateState.availableVersion && dismissedUpdateVersion !== updateState.availableVersion && (
          <section className="app-update-banner" aria-live="polite">
            <div className="app-update-banner-copy">
              <strong>Boundary Vision {updateState.status === 'downloaded' ? `v${updateState.availableVersion} is ready` : `v${updateState.availableVersion} is available`}</strong>
              <span>{updateState.status === 'downloading' ? 'Downloading the application update…' : updateState.releaseNotes || updateState.message}</span>
              {updateState.status === 'downloading' && <div className="progress-track"><div style={{ width: `${Math.min(100, updateState.percent ?? 0)}%` }} /></div>}
            </div>
            {updateState.status === 'available' && <button className="model-action primary" onClick={() => void downloadUpdate()} disabled={running}>Download update</button>}
            {updateState.status === 'downloaded' && <button className="model-action primary" onClick={() => void installUpdate()} disabled={running || modelBusy !== null}>Restart and install</button>}
            {updateState.status === 'downloaded' && <button className="model-action" onClick={() => setDismissedUpdateVersion(updateState.availableVersion ?? null)}>Later</button>}
            {updateState.status !== 'downloaded' && <button className="icon-button" aria-label="Dismiss update notice" onClick={() => setDismissedUpdateVersion(updateState.availableVersion ?? null)}><X size={16} /></button>}
          </section>
        )}

        {/* ==========================================================================
            VIEW: SETTINGS & ABOUT
            ========================================================================== */}
        {view === 'about' && (
          <div className="page-content">
            {error && (
              <div className="error-banner" role="alert">
                <X size={16} />
                <span>{error}</span>
                <button onClick={() => setError('')} aria-label="Dismiss error">
                  <X size={14} />
                </button>
              </div>
            )}

            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="eyebrow-line" /> SYSTEM &amp; UPDATES
                </div>
                <h1>Settings &amp; <em>Preferences.</em></h1>
                <p>Manage application release channels, on-device storage, and external annotation integrations.</p>
              </div>
              <div className="hero-stats-badge">
                <span className="hero-pill-badge">
                  <ShieldCheck size={14} /> 100% On-Device Inference
                </span>
                <span className="hero-telemetry-note">LOCAL RUNTIME · ZERO CLOUD</span>
              </div>
            </section>

            <div className="section-heading">
              <div>
                <span className="step-number">01</span>
                <h2>Application Updates</h2>
              </div>
              <span className="section-note">Current version: v{updateState.currentVersion || '0.1.0'}</span>
            </div>

            <section className="panel update-panel">
              <div className="update-status-row">
                <span className={`update-indicator ${updateState.status}`}>
                  <DownloadCloud size={20} />
                </span>
                <div>
                  <strong>{updateStatusLabel(updateState.status, updateState.availableVersion)}</strong>
                  <span>{updateState.message}</span>
                </div>
              </div>

              {updateState.status === 'downloading' && (
                <div className="model-transfer update-transfer">
                  <div>
                    <span>{formatBytes(updateState.transferred ?? 0)} of {formatBytes(updateState.total ?? 0)}</span>
                    <span>{Math.round(updateState.percent ?? 0)}%</span>
                  </div>
                  <div className="progress-track">
                    <div style={{ width: `${Math.min(100, updateState.percent ?? 0)}%` }} />
                  </div>
                </div>
              )}

              <div className="model-card-actions">
                <button
                  className="model-action"
                  onClick={() => void checkForUpdates()}
                  disabled={!updateState.configured || updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'downloaded'}
                >
                  <RotateCw size={14} className={updateState.status === 'checking' ? 'spin' : ''} />
                  {updateState.status === 'checking' ? 'Checking for updates…' : 'Check for updates'}
                </button>
                {updateState.status === 'available' && (
                  <button className="model-action primary" onClick={() => void downloadUpdate()} disabled={running}>
                    <DownloadCloud size={14} />
                    {running ? 'Finish processing first' : `Download v${updateState.availableVersion}`}
                  </button>
                )}
                {updateState.status === 'downloaded' && (
                  <button className="model-action primary" onClick={() => void installUpdate()} disabled={running || modelBusy !== null}>
                    <RotateCw size={14} />
                    {running || modelBusy ? 'Finish active work first' : 'Restart to install'}
                  </button>
                )}
              </div>
              {(running || modelBusy) && updateState.status === 'downloaded' && (
                <p className="update-note" style={{ color: 'var(--color-warning)', marginTop: 12, fontSize: 12 }}>
                  The update is ready. Finish active processing or model tasks before restarting; Boundary Vision will not interrupt your work.
                </p>
              )}
            </section>

            <div className="section-heading">
              <div>
                <span className="step-number">02</span>
                <h2>Update Policy &amp; Security</h2>
              </div>
              <span className="section-note">User-controlled releases</span>
            </div>

            <section className="model-storage-note">
              <strong>Guaranteed Local Control</strong>
              <p>
                Boundary Vision checks the configured release feed at startup and from this page. It downloads only when you choose Download, and installs only when you choose Restart. Settings and installed models stay in your per-user data folder across app updates.
              </p>
              <div>
                <button className="text-button" onClick={() => setView('models')}>
                  <Boxes size={14} /> Open Model Manager
                </button>
              </div>
            </section>

            <div className="section-heading">
              <div>
                <span className="step-number">03</span>
                <h2>External Tools · LabelImg</h2>
              </div>
              <span className="section-note">Image dataset annotation editor</span>
            </div>

            <section className="panel update-panel labelimg-panel">
              <div className="update-status-row">
                <span className={`update-indicator ${labelImgConfig.available ? 'downloaded' : 'error'}`}>
                  <ExternalLink size={20} />
                </span>
                <div>
                  <strong>{labelImgConfig.available ? 'Folder configured and ready' : labelImgConfig.path ? 'Folder needs attention' : 'Not configured'}</strong>
                  <span>{labelImgConfig.message}</span>
                </div>
              </div>

              {labelImgConfig.path && (
                <div className="labelimg-path">
                  <span>LabelImg folder</span>
                  <strong>{labelImgConfig.path}</strong>
                </div>
              )}

              <div className="model-card-actions">
                <button className="model-action" onClick={() => void configureLabelImg()} disabled={labelImgBusy}>
                  {labelImgConfig.path ? 'Change LabelImg Folder' : 'Select LabelImg Folder'}
                </button>
                <button className="model-action primary" onClick={() => void startLabelImg()} disabled={labelImgBusy}>
                  {labelImgBusy ? 'Opening…' : labelImgConfig.available ? 'Open LabelImg' : 'Locate and Open LabelImg'}
                </button>
              </div>

              <p className="labelimg-help">
                Select the directory containing <code>labelImg.py</code>. Boundary Vision uses only that folder's <code>.venv</code>; create it and install PyQt5 and lxml if the status above reports setup is needed.
              </p>
            </section>

            <footer className="footer">
              <span>BOUNDARY VISION <i>SETTINGS &amp; ABOUT</i></span>
              <span>{updateState.configured ? 'GITHUB RELEASE FEED CONFIGURED' : 'UPDATE FEED NOT CONFIGURED'}</span>
            </footer>
          </div>
        )}

        {/* ==========================================================================
            VIEW: MODEL MANAGER
            ========================================================================== */}
        {view === 'models' && (
          <div className="page-content">
            {error && (
              <div className="error-banner" role="alert">
                <X size={16} />
                <span>{error}</span>
                <button onClick={() => setError('')} aria-label="Dismiss error">
                  <X size={14} />
                </button>
              </div>
            )}

            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="eyebrow-line" /> INFERENCE ENGINE REGISTRY
                </div>
                <h1>Model <em>Manager.</em></h1>
                <p>Manage on-device neural network checkpoints. Checksums and runtime integrity are verified prior to execution.</p>
              </div>
              <div className="hero-stats-badge">
                <span className="hero-pill-badge">
                  <ShieldCheck size={14} /> SHA-256 Verified Storage
                </span>
                <span className="hero-telemetry-note">MANAGED ON-DEVICE CHECKPOINTS</span>
              </div>
            </section>

            <div className="section-heading">
              <div>
                <span className="step-number">01</span>
                <h2>Available Models</h2>
              </div>
              <span className="section-note">Select an installed model to activate for detection</span>
              <button className="model-action" onClick={() => void checkModelUpdates()} disabled={checkingModelUpdates || !!modelBusy || running}>
                <RotateCw size={14} className={checkingModelUpdates ? 'spin' : ''} />
                {checkingModelUpdates ? 'Checking registry…' : 'Check for model updates'}
              </button>
              {!!modelUpdates.length && <button className="model-action primary" onClick={() => void updateAllModels()} disabled={!!modelBusy || running || checkingModelUpdates}>Update all ({modelUpdates.length})</button>}
            </div>

            {catalog?.models.length ? (
              <div className="model-library">
                {catalog.models.map(item => {
                  const busy = item.versions.some(version => modelBusy === `${item.id}@${version.version}`)
                  const transfer = modelProgress?.modelId === item.id ? modelProgress : null

                  return (
                    <article className="model-card" key={item.id}>
                      <div className="model-card-top">
                        <span className="model-card-icon">
                          <Boxes size={20} />
                        </span>
                        <span className={`model-status ${item.updateAvailable ? 'available' : item.formatSupported ? item.status : 'corrupt'}`}>
                          {item.updateAvailable ? 'UPDATE AVAILABLE' : !item.formatSupported
                            ? 'UNSUPPORTED FORMAT'
                            : item.status === 'installed'
                            ? item.source === 'managed' ? 'INSTALLED · MANAGED' : 'INSTALLED · DEV'
                            : item.status === 'not-configured' ? 'NOT CONFIGURED' : item.status.toUpperCase()}
                        </span>
                      </div>

                      <h3>{item.name}</h3>
                      <p>{item.description}</p>

                      <div className="model-facts">
                        <span>Latest Checkpoint <strong>{item.latestVersion}</strong></span>
                        <span>Installed Versions <strong>{item.versions.filter(v => v.status === 'installed').map(v => v.version).join(', ') || 'None'}</strong></span>
                        <span>Target Classes <strong>{item.classes.join(', ')}</strong></span>
                      </div>

                      <div className="model-detail">{item.detail}</div>

                      {item.versions.map(version => {
                        const versionBusy = modelBusy === `${item.id}@${version.version}`
                        const versionError = modelErrors[`${item.id}@${version.version}`]
                        const versionTransfer = transfer?.version === version.version ? transfer : null
                        const selected = catalog?.selectedId === item.id && catalog.selectedVersion === version.version

                        return (
                          <div className="model-version-row" key={version.version}>
                            <div className="model-version-heading">
                              <strong>{version.version}</strong>
                              <span className={`model-version-state ${versionError ? 'corrupt' : version.status}`}>
                                {versionError ? 'UPDATE FAILED'
                                  : !version.formatSupported
                                  ? `UNSUPPORTED FORMAT · ${version.format}`
                                  : version.status === 'installed'
                                  ? `INSTALLED · ${version.source.toUpperCase()}`
                                  : version.status === 'available'
                                  ? version.version === item.latestVersion && item.updateAvailable ? 'MODEL UPDATE AVAILABLE' : 'DOWNLOAD AVAILABLE'
                                  : version.status === 'corrupt'
                                  ? 'CORRUPT CHECKSUM'
                                  : 'NOT CONFIGURED'}
                              </span>
                            </div>

                            <span className="model-version-detail">
                              {versionError ? `${versionError} · Retry is available. ` : ''}{version.changeSummary || 'No release notes.'} · {version.detail} · {formatBytes(version.expectedSizeBytes)} · {version.format} · {(version.classes ?? item.classes).join(', ')}
                            </span>

                            {versionTransfer && (
                              <div className="model-transfer">
                                <div>
                                  <span>
                                    {versionTransfer.stage === 'verify'
                                      ? 'Verifying SHA-256 checksum'
                                      : versionTransfer.stage === 'validate'
                                      ? 'Validating runtime classes'
                                      : versionTransfer.stage === 'install'
                                      ? 'Activating checkpoint'
                                      : 'Downloading model checkpoint'}
                                  </span>
                                  <span>
                                    {versionTransfer.totalBytes
                                      ? Math.min(100, Math.round(versionTransfer.receivedBytes / versionTransfer.totalBytes * 100))
                                      : 0}%
                                  </span>
                                </div>
                                <div className="progress-track">
                                  <div style={{ width: `${versionTransfer.totalBytes ? Math.min(100, versionTransfer.receivedBytes / versionTransfer.totalBytes * 100) : 0}%` }} />
                                </div>
                              </div>
                            )}

                            <div className="model-card-actions">
                              {version.status === 'installed' && (
                                <button
                                  className={`model-action ${selected ? 'chosen' : ''}`}
                                  onClick={() => void chooseModel(item.id, version.version)}
                                  disabled={versionBusy || selected || !version.formatSupported}
                                >
                                  {selected ? <><Check size={14} /> Selected for inference</> : `Use ${version.version}`}
                                </button>
                              )}
                              {version.canInstall && (
                                <button
                                  className="model-action primary"
                                  onClick={() => void installModel(item.id, version.version)}
                                  disabled={busy || running}
                                >
                                  {versionBusy ? (
                                    <><LoaderCircle className="spin" size={14} /> Installing…</>
                                  ) : version.source === 'development' ? (
                                    `Copy ${version.version} to app storage`
                                  ) : (
                                    version.version === item.latestVersion && item.updateAvailable
                                      ? `Update to ${version.version}`
                                      : `Install ${version.version}`
                                  )}
                                </button>
                              )}
                              {version.canRemove && (
                                <button
                                  className="model-action danger"
                                  onClick={() => void removeModel(item.id, version.version)}
                                  disabled={versionBusy || running}
                                >
                                  Remove {version.version}
                                </button>
                              )}
                              {versionBusy && (
                                <button
                                  className="model-action"
                                  onClick={() => void window.boundaryVision.cancelModelInstall(item.id, version.version)}
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="panel model-empty">
                <LoaderCircle className="spin" size={24} style={{ margin: '0 auto 12px' }} />
                <span>Loading model registry from local storage…</span>
              </div>
            )}

            <section className="model-storage-note">
              <strong>Managed storage</strong>
              <span>{catalog?.storagePath ?? 'Loading…'}</span>
              <p>
                Development checkpoints in the project’s models folder remain untouched. Managed copies are verified against their registry size and SHA-256 before use.
              </p>
            </section>

            <footer className="footer">
              <span>BOUNDARY VISION <i>OPTIONAL MODEL LIBRARY</i></span>
              <span>INSTALL · SELECT · REMOVE</span>
            </footer>
          </div>
        )}

        {/* ==========================================================================
            VIEW: DETECTION WORKSPACE (IMAGE & VIDEO)
            ========================================================================== */}
        {view === 'detect' && (
          <div className="page-content">
            {error && (
              <div className="error-banner" role="alert">
                <X size={16} />
                <span>{error}</span>
                <button onClick={() => setError('')} aria-label="Dismiss error">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* HERO BANNER */}
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="eyebrow-line" /> {mode === 'images' ? 'CRICKET IMAGE INFERENCE' : 'VIDEO TEMPORAL INFERENCE'}
                </div>
                <h1>
                  {mode === 'images' ? (
                    <>Analyze cricket imagery <em>with precision.</em></>
                  ) : (
                    <>Track every frame <em>and delivery.</em></>
                  )}
                </h1>
                <p>
                  {mode === 'images'
                    ? 'Detect bats, balls, and wickets with confidence-calibrated neural network models.'
                    : 'Process recorded match footage at target inference cadence and export frame-synchronized detections.'}
                </p>
              </div>
              <div className="hero-stats-badge">
                <span className="hero-pill-badge">
                  <Sparkles size={14} /> 3 Target Classes: Bat · Ball · Stump
                </span>
                <span className="hero-telemetry-note">HARDWARE: {device.toUpperCase()} ACCELERATED</span>
              </div>
            </section>

            {/* WORKFLOW STEP 01: INPUT & SETTINGS */}
            <div className="section-heading">
              <div>
                <span className="step-number">01</span>
                <h2>Configure Detection Studio</h2>
              </div>
              <span className="section-note">Select inputs, output folder, and inference parameters</span>
            </div>

            <div className="main-grid">
              {/* LEFT COLUMN: INPUT MEDIA & DESTINATION */}
              <div className="left-column">
                <section className="panel input-panel">
                  <div className="panel-heading">
                    <div className="panel-icon">
                      <ImagePlus size={18} />
                    </div>
                    <div>
                      <h3>Input Media</h3>
                      <p>{mode === 'video' ? 'Select match video file' : 'Select one or more cricket images'}</p>
                    </div>
                    <span className="panel-step">SOURCE</span>
                  </div>

                  {mode === 'video' ? (
                    <>
                      <button
                        className={`dropzone ${videoFile ? 'has-files' : ''}`}
                        onClick={selectVideo}
                        disabled={running}
                      >
                        <span className="upload-icon">
                          <Film size={20} />
                        </span>
                        <span className="drop-title">{videoFile ? 'Replace selected video' : 'Choose a video file'}</span>
                        <span className="drop-caption">MP4, MOV, MKV, AVI, WebM and standard video containers</span>
                        <span className="browse-label">
                          <FolderOpen size={14} /> Browse video
                        </span>
                      </button>

                      {videoFile && (
                        <div className="file-list">
                          <div className="file-list-top">
                            <span>1 video selected</span>
                            <button className="file-list-clear-btn" onClick={clearFiles} disabled={running}>
                              Clear
                            </button>
                          </div>
                          <div className="file-row">
                            <Film size={14} />
                            <span title={videoFile}>{videoFile.split(/[\\/]/).pop()}</span>
                            <Check size={14} className="file-check" />
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        className={`dropzone ${files.length ? 'has-files' : ''}`}
                        onClick={selectImages}
                        disabled={running}
                      >
                        <span className="upload-icon">
                          <Plus size={20} />
                        </span>
                        <span className="drop-title">{files.length ? 'Add more images' : 'Choose image files'}</span>
                        <span className="drop-caption">Select single or multiple match photos (JPG, PNG, WebP)</span>
                        <span className="browse-label">
                          <FolderOpen size={14} /> Browse images
                        </span>
                      </button>

                      {files.length > 0 && (
                        <div className="file-list">
                          <div className="file-list-top">
                            <span>{files.length} {files.length === 1 ? 'image' : 'images'} selected</span>
                            <button className="file-list-clear-btn" onClick={clearFiles} disabled={running}>
                              Clear all
                            </button>
                          </div>
                          <div className="file-list-scroll">
                            {files.map(file => (
                              <div className="file-row" key={file}>
                                <FileImage size={14} />
                                <span title={file}>{file.split(/[\\/]/).pop()}</span>
                                <button
                                  className="file-remove-btn"
                                  onClick={(e) => { e.stopPropagation(); removeFile(file) }}
                                  disabled={running}
                                  title="Remove image"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </section>

                {/* DESTINATION FOLDER */}
                <section className="panel output-panel">
                  <div className="panel-heading">
                    <div className="panel-icon">
                      <FolderOpen size={18} />
                    </div>
                    <div>
                      <h3>Save Results To</h3>
                      <p>Designate directory for annotated media and labels</p>
                    </div>
                    <span className="panel-step">EXPORT</span>
                  </div>

                  <button className="output-picker" onClick={chooseOutput} disabled={running}>
                    <span className="folder-square">
                      <FolderOpen size={16} />
                    </span>
                    <span className="output-path" title={outputDir ?? ''}>
                      {outputDir ?? 'Choose an output directory…'}
                    </span>
                    <span className="change-label">{outputDir ? 'CHANGE' : 'BROWSE'}</span>
                  </button>
                </section>
              </div>

              {/* RIGHT COLUMN: INFERENCE SETTINGS & EXPORT FORMATS */}
              <div className="right-column">
                <section className="panel settings-panel">
                  <div className="panel-heading">
                    <div className="panel-icon">
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <h3>Inference Settings</h3>
                      <p>Fine-tune hardware, confidence, and sampling</p>
                    </div>
                  </div>

                  {/* MODEL SELECTION */}
                  <div className="setting-block">
                    <div className="setting-title-row">
                      <label>Detection Model</label>
                      <button className="tiny-tag" onClick={() => setView('models')}>
                        MANAGE MODELS
                      </button>
                    </div>

                    <div className="model-options">
                      {catalog?.models.flatMap(item =>
                        item.versions
                          .filter(version => version.status === 'installed' && version.formatSupported)
                          .map(version => (
                            <button
                              key={`${item.id}@${version.version}`}
                              className={`model-option ${model === item.id && modelVersion === version.version ? 'active' : ''}`}
                              onClick={() => void chooseModel(item.id, version.version)}
                              disabled={running || modelBusy !== null}
                            >
                              <span className="radio-dot" />
                              <span className="model-option-text">
                                <strong>{item.name}</strong>
                                <small>{version.version} · {item.classes.join(' · ')}</small>
                              </span>
                              <span className="model-size">{formatBytes(version.expectedSizeBytes)}</span>
                            </button>
                          ))
                      )}

                      {!catalog?.models.some(item => item.versions.some(version => version.status === 'installed' && version.formatSupported)) && (
                        <button className="model-option no-model" onClick={() => setView('models')}>
                          <span className="model-option-text">
                            <strong>No supported model format installed</strong>
                            <small>Open Model Manager to review available models</small>
                          </span>
                          <ArrowDownToLine size={16} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* CONFIDENCE THRESHOLD */}
                  <div className="settings-row">
                    <div className="setting-label">
                      <label htmlFor="confidence">Confidence Threshold</label>
                      <span>Minimum detector score to accept detections</span>
                    </div>
                    <div className="confidence-control">
                      <input
                        id="confidence"
                        type="range"
                        min="0.05"
                        max="0.95"
                        step="0.05"
                        value={confidence}
                        onChange={event => setConfidence(Number(event.target.value))}
                        disabled={running}
                      />
                      <strong>{Math.round(confidence * 100)}%</strong>
                    </div>
                  </div>

                  {/* HARDWARE DEVICE SELECT */}
                  <div className="settings-row">
                    <div className="setting-label">
                      <label>Processing Device</label>
                      <span>Selected acceleration runtime</span>
                    </div>
                    <div className="select-wrap">
                      <Cpu size={15} />
                      <select value={device} onChange={event => setDevice(event.target.value)} disabled={running}>
                        {devices.map(option => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} />
                    </div>
                  </div>

                  {/* BATCH SIZE OR FPS CONTROLS */}
                  {mode === 'images' ? (
                    <div className="settings-row">
                      <div className="setting-label">
                        <label>Batch Size</label>
                        <span>Concurrent image processing batch</span>
                      </div>
                      <div className="select-wrap">
                        <select
                          value={batchSize ?? 'auto'}
                          onChange={event => setBatchSize(event.target.value === 'auto' ? null : Number(event.target.value))}
                          disabled={running}
                        >
                          <option value="auto">Automatic (1)</option>
                          <option value="1">1 image</option>
                          <option value="2">2 images</option>
                          <option value="4">4 images</option>
                        </select>
                        <ChevronDown size={13} />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="settings-row">
                        <div className="setting-label">
                          <label htmlFor="inference-fps">Inference Sampling FPS</label>
                          <span>Model evaluation rate; detections held across frames</span>
                        </div>
                        <div className="fps-control">
                          <input
                            id="inference-fps"
                            type="number"
                            min="0.1"
                            max="120"
                            step="0.1"
                            value={inferenceFps}
                            onChange={event => setInferenceFps(Number(event.target.value))}
                            disabled={running}
                          />
                          <small>FPS</small>
                        </div>
                      </div>

                      <div className="settings-row">
                        <div className="setting-label">
                          <label htmlFor="output-fps">Output Video FPS</label>
                          <span>Rendered video cadence, independent of sampling</span>
                        </div>
                        <div className="fps-control">
                          <input
                            id="output-fps"
                            type="number"
                            min="1"
                            max="60"
                            step="1"
                            value={outputFps}
                            onChange={event => setOutputFps(Number(event.target.value))}
                            disabled={running}
                          />
                          <small>FPS</small>
                        </div>
                      </div>
                    </>
                  )}
                </section>

                {/* OUTPUT FORMATS */}
                <section className="panel exports-panel">
                  <div className="export-heading">
                    <div>
                      <h3>Output Formats</h3>
                      <p>{mode === 'video' ? 'Annotated video is always generated; frame labels are optional' : 'Select outputs to generate during inference'}</p>
                    </div>
                    <CircleHelp size={16} />
                  </div>

                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={mode === 'video' || outputImage}
                      onChange={event => setOutputImage(event.target.checked)}
                      disabled={running || mode === 'video'}
                    />
                    <span className="custom-check">
                      <Check size={12} />
                    </span>
                    <span>
                      <strong>{mode === 'video' ? 'Annotated Video' : 'Annotated Images'}</strong>
                      <small>{mode === 'video' ? 'MP4 output with preserved source audio' : 'Bounding boxes rendered on output files'}</small>
                    </span>
                    <span className="format-pill">{mode === 'video' ? 'MP4' : 'PNG / JPG'}</span>
                  </label>

                  {(Object.keys(formatLabels) as AnnotationFormat[]).map(format => (
                    <label className="check-row" key={format}>
                      <input
                        type="checkbox"
                        checked={formats[0] === format}
                        onChange={() => toggleFormat(format)}
                        disabled={running}
                      />
                      <span className="custom-check">
                        <Check size={12} />
                      </span>
                      <span>
                        <strong>{formatLabels[format]}</strong>
                        <small>
                          {mode === 'video'
                            ? 'One annotation file per inference sample'
                            : format === 'yolo'
                            ? 'Normalized center coordinates in text files'
                            : format === 'voc'
                            ? 'Pixel coordinates in Pascal VOC XML'
                            : 'Pixel coordinates in Apple CreateML JSON'}
                        </small>
                      </span>
                      <span className="format-pill">
                        {format === 'yolo' ? '.TXT' : format === 'voc' ? '.XML' : '.JSON'}
                      </span>
                    </label>
                  ))}
                  {mode === 'images' && !outputImage && formats.length === 0 && (
                    <p className="labelimg-help" role="alert">Select one annotation format or enable annotated images before running inference.</p>
                  )}
                </section>
              </div>
            </div>

            {/* RUN STRIP ACTION BAR */}
            <section className="run-strip">
              <div className="run-summary">
                <span className={`run-indicator ${running ? 'busy' : ''}`}>
                  {running ? <LoaderCircle className="spin" size={18} /> : <Activity size={18} />}
                </span>
                <div>
                  <strong>
                    {running
                      ? status
                      : mode === 'video'
                      ? videoFile ? `${videoFile.split(/[\\/]/).pop()} ready to process` : 'Select a video file to begin'
                      : files.length ? `${files.length} ${files.length === 1 ? 'image' : 'images'} ready for inference` : 'Ready to analyze'}
                  </strong>
                  <span>
                    {running
                      ? 'Local inference in progress · CPU/GPU isolated'
                      : outputDir
                      ? `Saving to ${outputDir.split(/[\\/]/).pop()}`
                      : 'Please choose an output directory above'}
                  </span>
                </div>
              </div>

              <div className="run-actions">
                {running && (
                  <button className="cancel-button" onClick={cancel}>
                    <X size={15} /> Cancel
                  </button>
                )}
                <button
                  className="run-button"
                  disabled={!isReady}
                  onClick={mode === 'video' ? startVideoProcessing : startProcessing}
                >
                  {running ? (
                    <><LoaderCircle className="spin" size={16} /> Processing…</>
                  ) : (
                    <><Play size={15} fill="currentColor" /> {mode === 'video' ? 'Process Video' : 'Run Detection'}</>
                  )}
                </button>
              </div>
            </section>

            {/* VIDEO PROGRESS LIVE TELEMETRY */}
            {mode === 'video' && running && videoProgress && (
              <section className="video-progress">
                <div className="results-top">
                  <div>
                    <span className="step-number">02</span>
                    <h2>Video Processing Status</h2>
                  </div>
                  <span className="result-status">
                    {videoProgress.percent}% · {videoProgress.inferredFrames} inference frames
                  </span>
                </div>
                <div className="progress-track">
                  <div style={{ width: `${videoProgress.percent}%` }} />
                </div>
                <div className="video-progress-stats">
                  <span>Source Time <strong>{formatTime(videoProgress.currentTime)} / {formatTime(videoProgress.duration)}</strong></span>
                  <span>Decoded <strong>{videoProgress.decodedFrames.toLocaleString()}</strong> frames</span>
                  <span>Rendered <strong>{videoProgress.outputFrames.toLocaleString()}</strong> frames</span>
                </div>
              </section>
            )}

            {/* VIDEO RESULT CARD */}
            {mode === 'video' && videoResult && (
              <section className="results-section">
                <div className="results-top">
                  <div>
                    <span className="step-number">03</span>
                    <h2>Processed Video Results</h2>
                  </div>
                  <span className="result-status">
                    {videoResult.duration.toFixed(2)}s · {videoResult.inferred_frames} inference frames
                  </span>
                </div>

                <div className="video-result-card">
                  {videoUrl ? (
                    <video controls preload="metadata" src={videoUrl} />
                  ) : (
                    <div className="preview-wrap">
                      <LoaderCircle className="spin" size={24} />
                    </div>
                  )}
                  <div className="video-result-info">
                    <strong>{videoResult.output_video_path.split(/[\\/]/).pop()}</strong>
                    <span>
                      {videoResult.output_fps} output FPS · {videoResult.inference_fps} inference FPS · {videoResult.output_frames.toLocaleString()} rendered frames
                    </span>
                    <span>Model {videoResult.model.toUpperCase()} · {videoResult.device.toUpperCase()}</span>
                    {videoResult.frame_annotation_dir && (
                      <span>Frame annotations saved to {videoResult.frame_annotation_dir}</span>
                    )}
                    <span>Saved in {outputDir}</span>
                    <span>Video frame annotations are not opened as an image dataset. Export selected frames separately before using LabelImg.</span>
                  </div>
                </div>
              </section>
            )}

            {/* IMAGE DETECTION RESULTS & PROGRESS */}
            {(running || results.length > 0) && mode === 'images' && (
              <section className="results-section">
                <div className="results-top">
                  <div>
                    <span className="step-number">02</span>
                    <h2>Detection Results</h2>
                  </div>
                  <span className="result-status">{status}</span>
                </div>

                {progress && (
                  <div className="progress-track">
                    <div style={{ width: `${Math.round(completedCount / Math.max(totalCount, 1) * 100)}%` }} />
                  </div>
                )}

                {/* CRICKET DETECTION BREAKDOWN CHIPS */}
                {results.length > 0 && (
                  <div className="count-chips">
                    <span className="count-chip">
                      Total Detections
                      <strong>{Object.values(counts).reduce((a, b) => a + b, 0)}</strong>
                    </span>
                    {Object.entries(counts).map(([name, count]) => (
                      <span key={name} className="count-chip">
                        <i className={`class-dot ${name.toLowerCase()}`} />
                        {name}
                        <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                )}

                {/* RESULTS GRID */}
                <div className="result-grid">
                  {results.map(result => (
                    <article className="result-card" key={result.source_path}>
                      <div
                        className="preview-wrap"
                        style={{ cursor: result.output_image_path ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (result.output_image_path && previews[result.output_image_path]) {
                            setActivePreviewModal(previews[result.output_image_path])
                          }
                        }}
                      >
                        {result.output_image_path && previews[result.output_image_path] ? (
                          <img
                            src={previews[result.output_image_path]}
                            alt={`Detections for ${result.source_path.split(/[\\/]/).pop()}`}
                          />
                        ) : (
                          <div className="preview-placeholder">
                            {result.output_image_path ? (
                              <LoaderCircle className="spin" size={24} />
                            ) : (
                              <span>Image preview not selected</span>
                            )}
                          </div>
                        )}
                        <span className="detection-badge">
                          {result.detections.length} {result.detections.length === 1 ? 'object' : 'objects'}
                        </span>
                      </div>

                      <div className="result-card-info">
                        <strong title={result.source_path}>{result.source_path.split(/[\\/]/).pop()}</strong>
                        <span>{result.width} × {result.height} · {result.model.toUpperCase()}</span>
                        <div className="result-objects">
                          {result.detections.length ? (
                            result.detections.map((detection, index) => (
                              <span key={`${detection.class_id}-${index}`}>
                                {detection.class_name} <i>{Math.round(detection.confidence * 100)}%</i>
                              </span>
                            ))
                          ) : (
                            <span style={{ opacity: 0.6 }}>No objects above threshold</span>
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {results.length > 0 && (
                  <>
                    <div className="saved-note">
                      <Check size={16} />
                      <span>Results saved in <strong>{outputDir}</strong></span>
                    </div>

                    {/* LABELIMG INTEGRATION ROW */}
                    <div className="labelimg-open-row">
                      <label>
                        Export format for LabelImg
                        <select
                          value={labelImgFormat}
                          onChange={event => setLabelImgFormat(event.target.value as 'yolo' | 'voc')}
                        >
                          <option value="yolo">YOLO TXT</option>
                          <option value="voc">Pascal VOC XML</option>
                        </select>
                      </label>
                      <span>Creates a new dataset in the selected output folder, then opens it in LabelImg</span>
                      <button
                        className="model-action primary"
                        onClick={() => void openInLabelImg()}
                        disabled={running || labelImgBusy}
                      >
                        <ExternalLink size={14} />
                        {labelImgBusy ? 'Preparing dataset…' : 'Open in LabelImg'}
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* LIVE BATCH PROCESSING STATUS LINE */}
            {running && mode === 'images' && (
              <div className="working-line">
                <span className="working-dot" />
                <span>{progress ? `Analyzing ${progress.current} · ${completedCount}/${totalCount}` : 'Loading checkpoint and preparing batch'}</span>
                <span className="working-percent">{progress ? Math.round(completedCount / Math.max(totalCount, 1) * 100) : '—'}%</span>
              </div>
            )}

            <footer className="footer">
              <span>BOUNDARY VISION <i>LOCAL INFERENCE STUDIO</i></span>
              <span>{model ? catalog?.models.find(item => item.id === model)?.classes.join(' / ').toUpperCase() : 'NO MODEL SELECTED'}</span>
            </footer>
          </div>
        )}
      </section>

      {/* FULL-SIZE IMAGE PREVIEW MODAL */}
      {activePreviewModal && (
        <div
          className="preview-modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setActivePreviewModal(null)}
        >
          <div
            className="preview-modal-dialog"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="preview-modal-close"
              onClick={() => setActivePreviewModal(null)}
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
            <img
              className="preview-modal-img"
              src={activePreviewModal}
              alt="Full size detection"
            />
          </div>
        </div>
      )}
    </main>
  )
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function updateStatusLabel(status: UpdateState['status'], availableVersion?: string): string {
  if (status === 'disabled') return 'Updates are not configured'
  if (status === 'checking') return 'Checking for an application update'
  if (status === 'available') return `Version ${availableVersion ?? ''} is available`
  if (status === 'downloading') return `Downloading version ${availableVersion ?? ''}`
  if (status === 'downloaded') return `Version ${availableVersion ?? ''} is ready to install`
  if (status === 'up-to-date') return 'Boundary Vision is up to date'
  if (status === 'error') return 'Update check needs attention'
  return 'Application update status'
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = Math.floor(seconds % 60)
  return hours
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}
