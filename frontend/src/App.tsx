import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowDownToLine, Boxes, Check, ChevronDown, CircleHelp, Cpu, DownloadCloud, ExternalLink, FileImage, Film, FolderOpen, ImagePlus, LoaderCircle, Play, Plus, RotateCw, ScanLine, Settings, Sparkles, X } from 'lucide-react'
import type { AnnotationFormat, DeviceOption, ImageResult, LabelImgConfig, ModelCatalog, ModelId, ModelInstallProgress, ProgressUpdate, UpdateState, VideoProgressUpdate, VideoResult } from '../electron/types'

type Mode = 'images' | 'video'
type View = 'detect' | 'models' | 'about'
const formatLabels: Record<AnnotationFormat, string> = { yolo: 'YOLO TXT', voc: 'Pascal VOC XML', createml: 'CreateML JSON' }

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
  const [confidence, setConfidence] = useState(0.35)
  const [device, setDevice] = useState('cpu')
  const [devices, setDevices] = useState<DeviceOption[]>([{ id: 'cpu', label: 'CPU' }])
  const [batchSize, setBatchSize] = useState<number | null>(null)
  const [inferenceFps, setInferenceFps] = useState(2)
  const [outputFps, setOutputFps] = useState(30)
  const [outputImage, setOutputImage] = useState(true)
  const [formats, setFormats] = useState<AnnotationFormat[]>([])
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('Ready when you are')
  const [progress, setProgress] = useState<ProgressUpdate | null>(null)
  const [results, setResults] = useState<ImageResult[]>([])
  const [error, setError] = useState('')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [updateState, setUpdateState] = useState<UpdateState>({ currentVersion: '', status: 'idle', configured: false, message: 'Loading update status…' })
  const [labelImgConfig, setLabelImgConfig] = useState<LabelImgConfig>({ path: null, kind: null, pythonPath: null, available: false, message: 'Loading LabelImg status…' })
  const [labelImgFormat, setLabelImgFormat] = useState<'yolo' | 'voc'>('yolo')
  const [labelImgBusy, setLabelImgBusy] = useState(false)

  useEffect(() => {
    window.boundaryVision.getCapabilities()
      .then(async result => {
        setDevices(result.devices); if (result.devices.length) setDevice(result.devices[0].id)
        const value = await window.boundaryVision.getModelCatalog()
        setCatalog(value); setModel(value.selectedId); setModelVersion(value.selectedVersion)
        if (!value.selectedId) setView('models')
      })
      .catch(async reason => {
        setError(reason instanceof Error ? reason.message : 'Could not start the Python runtime.')
        setView('models')
        try { setCatalog(await window.boundaryVision.getModelCatalog()) } catch { /* The registry error is shown when Model Manager loads. */ }
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
    return () => { unsubscribeProgress(); unsubscribeVideoProgress(); unsubscribeModelProgress(); unsubscribeUpdateState() }
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

  const selectedModelCompatible = !!model && !!modelVersion && catalog?.models.some(item => item.id === model && item.versions.some(version => version.version === modelVersion && version.status === 'installed' && version.runtimeCompatible))
  const validVideoRates = Number.isFinite(inferenceFps) && inferenceFps >= 0.1 && inferenceFps <= 120 && Number.isFinite(outputFps) && outputFps >= 1 && outputFps <= 60
  const isReady = view === 'detect' && selectedModelCompatible && !!outputDir && !running && (mode === 'images' ? files.length > 0 && (outputImage || formats.length > 0) : !!videoFile && validVideoRates)
  const completedCount = progress?.completed ?? 0
  const totalCount = progress?.total ?? files.length
  const counts = useMemo(() => results.reduce((acc, result) => {
    for (const detection of result.detections) acc[detection.class_name] = (acc[detection.class_name] ?? 0) + 1
    return acc
  }, {} as Record<string, number>), [results])

  async function selectImages() {
    const selected = await window.boundaryVision.chooseImages()
    if (selected.length) { setFiles(current => [...new Set([...current, ...selected])]); setError(''); setResults([]); setProgress(null) }
  }
  async function selectVideo() {
    const selected = await window.boundaryVision.chooseVideo()
    if (selected) { setVideoFile(selected); setVideoResult(null); setVideoUrl(null); setVideoProgress(null); setError(''); setStatus('Video ready to process') }
  }
  async function chooseOutput() {
    const selected = await window.boundaryVision.chooseOutputDirectory()
    if (selected) setOutputDir(selected)
  }
  function toggleFormat(format: AnnotationFormat) {
    setFormats(current => current.includes(format) ? current.filter(item => item !== format) : [...current, format])
  }
  async function startProcessing() {
    if (!isReady || !outputDir || !model) return
    setRunning(true); setError(''); setProgress(null); setResults([]); setStatus('Loading model and preparing imagesâ€¦')
    try {
      if (!modelVersion) throw new Error('Choose an installed model version.')
      await window.boundaryVision.processImages(files, outputDir, { modelId: model, modelVersion, confidence, device, batchSize, outputImage, formats })
      setStatus('All selected images processed')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Image processing failed.'
      setError(message)
      setStatus(message.toLowerCase().includes('cancel') ? 'Processing cancelled' : 'Processing stopped')
    } finally { setRunning(false) }
  }
  async function startVideoProcessing() {
    if (!isReady || !outputDir || !model || !videoFile) return
    setRunning(true); setError(''); setVideoProgress(null); setVideoResult(null); setVideoUrl(null); setStatus('Inspecting video timestamps and loading model…')
    try {
      if (!modelVersion) throw new Error('Choose an installed model version.')
      const result = await window.boundaryVision.processVideo(videoFile, outputDir, { modelId: model, modelVersion, confidence, device, inferenceFps, outputFps, formats })
      setVideoResult(result); setVideoUrl(await window.boundaryVision.previewVideo(result.output_video_path)); setStatus('Video processing complete')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Video processing failed.'
      setError(message); setStatus(message.toLowerCase().includes('cancel') ? 'Video processing cancelled' : 'Video processing stopped')
    } finally { setRunning(false) }
  }
  async function cancel() { await window.boundaryVision.cancelProcessing() }
  async function refreshCatalog() { const value = await window.boundaryVision.getModelCatalog(); setCatalog(value); setModel(value.selectedId); setModelVersion(value.selectedVersion) }
  async function chooseModel(modelId: ModelId, version: string) {
    setModelBusy(`${modelId}@${version}`); setError('')
    try { const value = await window.boundaryVision.selectModel(modelId, version); setCatalog(value); setModel(value.selectedId); setModelVersion(value.selectedVersion) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not select that model.') }
    finally { setModelBusy(null) }
  }
  async function installModel(modelId: ModelId, version: string) {
    setModelBusy(`${modelId}@${version}`); setModelProgress(null); setError('')
    try { const value = await window.boundaryVision.installModel(modelId, version); setCatalog(value) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Model installation failed.') }
    finally { setModelBusy(null); setModelProgress(null); await refreshCatalog() }
  }
  async function removeModel(modelId: ModelId, version: string) {
    setModelBusy(`${modelId}@${version}`); setError('')
    try { const value = await window.boundaryVision.removeModel(modelId, version); setCatalog(value); setModel(value.selectedId); setModelVersion(value.selectedVersion) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not remove that model.') }
    finally { setModelBusy(null) }
  }
  async function checkForUpdates() {
    try { setUpdateState(await window.boundaryVision.checkForUpdates()) }
    catch (reason) { setUpdateState(current => ({ ...current, status: 'error', message: reason instanceof Error ? reason.message : 'Could not check for updates.' })) }
  }
  async function downloadUpdate() {
    try { setUpdateState(await window.boundaryVision.downloadAppUpdate()) }
    catch (reason) { setUpdateState(current => ({ ...current, status: 'error', message: reason instanceof Error ? reason.message : 'Could not download the update.' })) }
  }
  async function installUpdate() {
    try { await window.boundaryVision.installAppUpdate() }
    catch (reason) { setUpdateState(current => ({ ...current, status: 'error', message: reason instanceof Error ? reason.message : 'Could not restart to install the update.' })) }
  }
  async function configureLabelImg(mode: 'file' | 'folder' | 'python') {
    try { setLabelImgConfig(await window.boundaryVision.chooseLabelImg(mode)) }
    catch (reason) { setLabelImgConfig(current => ({ ...current, message: reason instanceof Error ? reason.message : 'Could not configure LabelImg.' })) }
  }
  async function testLabelImg() {
    setLabelImgBusy(true)
    try { setLabelImgConfig(await window.boundaryVision.testLabelImg()) }
    catch (reason) { setLabelImgConfig(current => ({ ...current, message: reason instanceof Error ? reason.message : 'Could not launch LabelImg.' })) }
    finally { setLabelImgBusy(false) }
  }
  async function openInLabelImg() {
    if (!results.length) return
    setLabelImgBusy(true); setError('')
    try {
      const directory = await window.boundaryVision.openLabelImg(results, labelImgFormat, outputDir)
      if (directory) setStatus(`LabelImg opened with ${labelImgFormat === 'yolo' ? 'YOLO' : 'Pascal VOC'} dataset: ${directory}`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not export or open the LabelImg dataset.') }
    finally { setLabelImgBusy(false); window.boundaryVision.getLabelImgConfig().then(setLabelImgConfig).catch(() => undefined) }
  }
  function clearFiles() { setFiles([]); setVideoFile(null); setVideoResult(null); setVideoUrl(null); setResults([]); setProgress(null); setVideoProgress(null); setError(''); setStatus('Ready when you are') }

  if (view === 'about') return <main className="app-shell">
    <aside className="rail">
      <div className="brand-mark"><span className="brand-orbit"/><ScanLine size={20}/></div><div className="rail-divider"/>
      <button className="rail-item" title="Images" onClick={() => { setView('detect'); setMode('images') }}><FileImage size={19}/></button>
      <button className="rail-item" title="Video" onClick={() => { setView('detect'); setMode('video') }}><Film size={19}/></button>
      <button className="rail-item" title="Model Manager" onClick={() => setView('models')}><Boxes size={19}/></button>
      <button className="rail-item selected" title="Settings and About"><Settings size={19}/></button>
      <div className="rail-bottom"><span className="online-dot"/><span>LOCAL</span></div>
    </aside>
    <section className="workspace"><header className="topbar"><div className="crumb"><span className="crumb-muted">BOUNDARY VISION</span><span className="crumb-slash">/</span><span>Settings &amp; About</span></div><div className="top-meta"><span className="version">v{updateState.currentVersion || '…'}</span></div></header>
      <div className="page-content">
        <section className="hero model-hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> APPLICATION</div><h1>Boundary<br/><em>Vision.</em></h1><p>Local cricket image and video inference, with model and application updates managed separately.</p></div><div className="hero-art" aria-hidden="true"><div className="hero-ring ring-one"/><div className="hero-ring ring-two"/><div className="hero-ring ring-three"/><Settings className="manager-art-icon" size={44}/><span className="art-label">APPLICATION RELEASES <i> / GITHUB</i></span></div></section>
        <div className="section-heading"><div><span className="step-number">01</span><h2>Application updates</h2></div><span className="section-note">Current version {updateState.currentVersion || 'unknown'}</span></div>
        <section className="panel update-panel">
          <div className="update-status-row"><span className={`update-indicator ${updateState.status}`}><DownloadCloud size={18}/></span><div><strong>{updateStatusLabel(updateState.status, updateState.availableVersion)}</strong><span>{updateState.message}</span></div></div>
          {updateState.status === 'downloading' && <div className="model-transfer update-transfer"><div><span>{formatBytes(updateState.transferred ?? 0)} of {formatBytes(updateState.total ?? 0)}</span><span>{Math.round(updateState.percent ?? 0)}%</span></div><div className="progress-track"><div style={{ width: `${Math.min(100, updateState.percent ?? 0)}%` }}/></div></div>}
          <div className="model-card-actions">
            <button className="model-action" onClick={() => void checkForUpdates()} disabled={!updateState.configured || updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'downloaded'}><RotateCw size={14}/>{updateState.status === 'checking' ? 'Checking…' : 'Check for updates'}</button>
            {updateState.status === 'available' && <button className="model-action primary" onClick={() => void downloadUpdate()} disabled={running}><DownloadCloud size={14}/>{running ? 'Finish processing first' : `Download v${updateState.availableVersion}`}</button>}
            {updateState.status === 'downloaded' && <button className="model-action primary" onClick={() => void installUpdate()} disabled={running || modelBusy !== null}><RotateCw size={14}/>{running || modelBusy ? 'Finish active work first' : 'Restart to install'}</button>}
          </div>
          {(running || modelBusy) && updateState.status === 'downloaded' && <p className="update-note">The update is ready. Finish the active processing or model update before restarting; Boundary Vision will not interrupt it.</p>}
        </section>
        <div className="section-heading"><div><span className="step-number">02</span><h2>Update policy</h2></div><span className="section-note">User controlled</span></div>
        <section className="model-storage-note update-policy"><strong>No forced updates or restarts</strong><p>Boundary Vision checks the configured release feed at startup and from this page. It downloads only after you choose Download, and installs only after you choose Restart. Settings and installed models stay in your per-user data folder across app updates. Model versions are managed separately in Model Manager.</p><button className="text-button" onClick={() => setView('models')}><Boxes size={14}/> Open Model Manager</button></section>
        <div className="section-heading"><div><span className="step-number">03</span><h2>External Tools · LabelImg</h2></div><span className="section-note">Optional image annotation editor</span></div>
        <section className="panel update-panel labelimg-panel">
          <div className="update-status-row"><span className={`update-indicator ${labelImgConfig.available ? 'downloaded' : 'error'}`}><ExternalLink size={18}/></span><div><strong>{labelImgConfig.available ? 'Configured and available' : labelImgConfig.path ? 'Configured path needs attention' : 'Not configured'}</strong><span>{labelImgConfig.message}</span></div></div>
          {labelImgConfig.path && <div className="labelimg-path"><span>Launcher</span><strong>{labelImgConfig.path}</strong>{labelImgConfig.pythonPath && <><span>Python environment</span><strong>{labelImgConfig.pythonPath}</strong></>}</div>}
          <div className="model-card-actions"><button className="model-action" onClick={() => void configureLabelImg('file')}>Choose launcher file</button><button className="model-action" onClick={() => void configureLabelImg('folder')}>Choose installation folder</button><button className="model-action" onClick={() => void configureLabelImg('python')}>Choose Python environment</button><button className="model-action primary" onClick={() => void testLabelImg()} disabled={!labelImgConfig.available || labelImgBusy}>{labelImgBusy ? 'Working…' : 'Test launch'}</button></div>
          <p className="labelimg-help">Supported: LabelImg .exe, .py launch script (with an explicitly selected Python interpreter), or a Python environment folder with a LabelImg launcher/module. Boundary Vision never installs packages or opens LabelImg automatically.</p>
        </section>
        <footer className="footer"><span>BOUNDARY VISION <i>SETTINGS &amp; ABOUT</i></span><span>{updateState.configured ? 'GITHUB RELEASE FEED CONFIGURED' : 'UPDATE FEED NOT CONFIGURED'}</span></footer>
      </div>
    </section>
  </main>

  if (view === 'models') return <main className="app-shell">
    <aside className="rail">
      <div className="brand-mark"><span className="brand-orbit"/><ScanLine size={20}/></div><div className="rail-divider"/>
      <button className="rail-item" title="Images" onClick={() => { setView('detect'); setMode('images') }}><FileImage size={19}/></button>
      <button className="rail-item" title="Video" onClick={() => { setView('detect'); setMode('video') }}><Film size={19}/></button>
      <button className="rail-item selected" title="Model Manager"><Boxes size={19}/></button>
      <button className="rail-item" title="Settings and About" onClick={() => setView('about')}><Settings size={19}/></button>
      <div className="rail-bottom"><span className="online-dot"/><span>LOCAL</span></div>
    </aside>
    <section className="workspace"><header className="topbar"><div className="crumb"><span className="crumb-muted">WORKSPACE</span><span className="crumb-slash">/</span><span>Model Manager</span></div><div className="top-meta"><span className="local-badge"><span className="online-dot"/> On-device</span><span className="top-separator"/><span className="version">v{updateState.currentVersion || '…'}</span></div></header>
      <div className="page-content">
        <section className="hero model-hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> MODEL LIBRARY</div><h1>Choose your<br/><em>inference engine.</em></h1><p>Models are optional. Install only the checkpoints you want to use.</p></div><div className="hero-art" aria-hidden="true"><div className="hero-ring ring-one"/><div className="hero-ring ring-two"/><div className="hero-ring ring-three"/><Boxes className="manager-art-icon" size={44}/><span className="art-label">LOCAL MODEL STORAGE <i> / SHA-256</i></span></div></section>
        <div className="section-heading"><div><span className="step-number">01</span><h2>Available models</h2></div><span className="section-note">Select an installed model for detection</span></div>
        {catalog?.models.length ? <div className="model-library">{catalog.models.map(item => {
          const busy = item.versions.some(version => modelBusy === `${item.id}@${version.version}`)
          const transfer = modelProgress?.modelId === item.id ? modelProgress : null
          return <article className="model-card" key={item.id}>
            <div className="model-card-top"><span className="model-card-icon"><Boxes size={19}/></span><span className={`model-status ${item.runtimeCompatible ? item.status : 'corrupt'}`}>{!item.runtimeCompatible ? 'LATEST VERSION INCOMPATIBLE' : item.status === 'installed' ? item.source === 'managed' ? 'VERSION INSTALLED · APP STORAGE' : 'VERSION INSTALLED · DEVELOPMENT' : item.status === 'not-configured' ? 'SOURCE NOT CONFIGURED' : item.status.toUpperCase()}</span></div>
            <h3>{item.name}</h3><p>{item.description}</p>
            <div className="model-facts"><span>Available version <strong>{item.latestVersion}</strong></span><span>Installed versions <strong>{item.versions.filter(version => version.status === 'installed').map(version => version.version).join(', ') || 'None'}</strong></span><span>Classes <strong>{item.classes.join(', ')}</strong></span></div>
            <div className="model-detail">{item.detail}</div>
            {item.versions.map(version => {
              const versionBusy = modelBusy === `${item.id}@${version.version}`
              const versionTransfer = transfer?.version === version.version ? transfer : null
              const selected = catalog?.selectedId === item.id && catalog.selectedVersion === version.version
              return <div className="model-version-row" key={version.version}>
                <div className="model-version-heading"><strong>{version.version}</strong><span className={`model-version-state ${version.status}`}>{!version.runtimeCompatible ? `INCOMPATIBLE · ${version.format} / PYTHON ${version.minimumPython ?? 'N/A'}` : version.status === 'installed' ? `INSTALLED · ${version.source}` : version.status === 'available' ? 'UPDATE AVAILABLE' : version.status === 'corrupt' ? 'INTEGRITY ERROR' : 'HOST NOT CONFIGURED'}</span></div>
                <span className="model-version-detail">{version.changeSummary || 'No version notes supplied by the model publisher.'} · {version.detail} · {formatBytes(version.expectedSizeBytes)} · {version.format} · {(version.classes ?? item.classes).join(', ')}</span>
                {versionTransfer && <div className="model-transfer"><div><span>{versionTransfer.stage === 'verify' ? 'Verifying checksum' : versionTransfer.stage === 'validate' ? 'Checking runtime and class mapping' : versionTransfer.stage === 'install' ? 'Activating verified version' : 'Downloading model version'}</span><span>{versionTransfer.totalBytes ? Math.min(100, Math.round(versionTransfer.receivedBytes / versionTransfer.totalBytes * 100)) : 0}%</span></div><div className="progress-track"><div style={{ width: `${versionTransfer.totalBytes ? Math.min(100, versionTransfer.receivedBytes / versionTransfer.totalBytes * 100) : 0}%` }}/></div></div>}
                <div className="model-card-actions">
                  {version.status === 'installed' && <button className={`model-action ${selected ? 'chosen' : ''}`} onClick={() => void chooseModel(item.id, version.version)} disabled={versionBusy || selected || !version.runtimeCompatible}>{selected ? <><Check size={14}/> Selected for inference</> : `Use ${version.version}`}</button>}
                  {version.canInstall && <button className="model-action primary" onClick={() => void installModel(item.id, version.version)} disabled={busy || running}>{versionBusy ? <><LoaderCircle className="spin" size={14}/> Working</> : version.source === 'development' ? `Copy ${version.version} to app storage` : `Install ${version.version}`}</button>}
                  {version.canRemove && <button className="model-action danger" onClick={() => void removeModel(item.id, version.version)} disabled={versionBusy || running}>Remove {version.version}</button>}
                  {versionBusy && <button className="model-action" onClick={() => void window.boundaryVision.cancelModelInstall(item.id, version.version)}>Cancel</button>}
                </div>
              </div>
            })}
          </article>
        })}</div> : <div className="panel model-empty">Loading the model registry…</div>}
        <section className="model-storage-note"><strong>Managed storage</strong><span>{catalog?.storagePath ?? 'Loading…'}</span><p>Development checkpoints in the project’s models folder remain untouched. Managed copies are verified against their registry size and SHA-256 before use.</p></section>
        {error && <div className="error-banner"><X size={16}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={14}/></button></div>}
        <footer className="footer"><span>BOUNDARY VISION <i>OPTIONAL MODEL LIBRARY</i></span><span>INSTALL · SELECT · REMOVE</span></footer>
      </div>
    </section>
  </main>

  return <main className="app-shell">
    <aside className="rail">
      <div className="brand-mark"><span className="brand-orbit"/><ScanLine size={20}/></div>
      <div className="rail-divider"/>
      <button className={`rail-item ${view === 'detect' && mode === 'images' ? 'selected' : ''}`} title="Images" onClick={() => { setView('detect'); setMode('images') }} disabled={running}><FileImage size={19}/></button>
      <button className={`rail-item ${view === 'detect' && mode === 'video' ? 'selected' : ''}`} title="Video" onClick={() => { setView('detect'); setMode('video') }} disabled={running}><Film size={19}/></button>
      <button className="rail-item" title="Model Manager" onClick={() => setView('models')}><Boxes size={19}/></button>
      <button className="rail-item" title="Settings and About" onClick={() => setView('about')}><Settings size={19}/></button>
      <div className="rail-bottom"><span className="online-dot"/><span>LOCAL</span></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div className="crumb"><span className="crumb-muted">WORKSPACE</span><span className="crumb-slash">/</span><span>{mode === 'images' ? 'Image detection' : 'Video detection'}</span></div>
        <div className="top-meta"><span className="local-badge"><span className="online-dot"/> On-device</span><span className="top-separator"/><span className="version">v{updateState.currentVersion || '…'}</span></div>
      </header>

      <div className="page-content">
        <section className="hero">
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> CRICKET OBJECT DETECTION</div><h1>{mode === 'images' ? <>See the game<br/><em>in every detail.</em></> : <>Bring every frame<br/><em>into focus.</em></>}</h1><p>{mode === 'images' ? 'Find the moments that matter. Detect bats, balls, and stumps in your cricket imagery.' : 'Sample for inference, then render at an independent output frame rate.'}</p></div>
          <div className="hero-art" aria-hidden="true"><div className="hero-ring ring-one"/><div className="hero-ring ring-two"/><div className="hero-ring ring-three"/><div className="hero-ball"/><div className="hero-cross cross-a"/><div className="hero-cross cross-b"/><span className="art-label">BOUNDARY VISION <i> / 001</i></span></div>
        </section>

        <div className="section-heading"><div><span className="step-number">01</span><h2>Set up your detection</h2></div><span className="section-note">Choose input and inference settings</span></div>
        <div className="main-grid">
          <div className="left-column">
            <section className="panel input-panel">
              <div className="panel-heading"><div className="panel-icon"><ImagePlus size={17}/></div><div><h3>Input media</h3><p>Choose cricket images to analyze</p></div><span className="panel-step">INPUT</span></div>
              {mode === 'video' ? <>
                <button className={`dropzone ${videoFile ? 'has-files' : ''}`} onClick={selectVideo} disabled={running}>
                  <span className="upload-icon"><Film size={18}/></span><span className="drop-title">{videoFile ? 'Choose another video' : 'Choose a video file'}</span><span className="drop-caption">MP4, MOV, MKV, AVI, WebM and other common formats</span><span className="browse-label"><FolderOpen size={14}/> Browse videos</span>
                </button>
                {videoFile && <div className="file-list"><div className="file-list-top"><span>1 video selected</span><button onClick={clearFiles} disabled={running}>Clear</button></div><div className="file-row"><Film size={14}/><span>{videoFile.split(/[\\/]/).pop()}</span><Check size={13} className="file-check"/></div></div>}
              </> : <>
                <button className={`dropzone ${files.length ? 'has-files' : ''}`} onClick={selectImages} disabled={running}>
                  <span className="upload-icon"><Plus size={19}/></span><span className="drop-title">{files.length ? 'Add more images' : 'Choose image files'}</span><span className="drop-caption">Select one or multiple images from your computer</span><span className="browse-label"><FolderOpen size={14}/> Browse files</span>
                </button>
                {files.length > 0 && <div className="file-list"><div className="file-list-top"><span>{files.length} {files.length === 1 ? 'image' : 'images'} selected</span><button onClick={clearFiles} disabled={running}>Clear all</button></div>{files.slice(0, 4).map(file => <div className="file-row" key={file}><FileImage size={14}/><span>{file.split(/[\\/]/).pop()}</span><Check size={13} className="file-check"/></div>)}{files.length > 4 && <div className="more-files">+ {files.length - 4} more files</div>}</div>}
              </>}
            </section>

            <section className="panel output-panel">
              <div className="panel-heading"><div className="panel-icon"><FolderOpen size={17}/></div><div><h3>Save results to</h3><p>Choose where processed files are saved</p></div></div>
              <button className="output-picker" onClick={chooseOutput} disabled={running}><span className="folder-square"><FolderOpen size={16}/></span><span className="output-path">{outputDir ?? 'Choose an output folder'}</span><span className="change-label">{outputDir ? 'CHANGE' : 'BROWSE'}</span></button>
            </section>
          </div>

          <div className="right-column">
            <section className="panel settings-panel">
              <div className="panel-heading"><div className="panel-icon"><Sparkles size={17}/></div><div><h3>Inference settings</h3><p>Fine-tune how objects are detected</p></div></div>
              <div className="setting-block"><div className="setting-title-row"><label>Detection model</label><button className="tiny-tag manager-link" onClick={() => setView('models')}>MANAGE MODELS</button></div><div className="model-options">
                {catalog?.models.flatMap(item => item.versions.filter(version => version.status === 'installed' && version.runtimeCompatible).map(version => <button key={`${item.id}@${version.version}`} className={`model-option ${model === item.id && modelVersion === version.version ? 'active' : ''}`} onClick={() => void chooseModel(item.id, version.version)} disabled={running || modelBusy !== null}><span className="radio-dot"/><span className="model-option-text"><strong>{item.name}</strong><small>{version.version} · {item.classes.join(' · ')}</small></span><span className="model-size">{formatBytes(version.expectedSizeBytes)}</span></button>))}
                {!catalog?.models.some(item => item.versions.some(version => version.status === 'installed' && version.runtimeCompatible)) && <button className="model-option no-model" onClick={() => setView('models')}><span className="model-option-text"><strong>No compatible model installed</strong><small>Open Model Manager to review model requirements</small></span><ArrowDownToLine size={14}/></button>}
              </div></div>
              <div className="settings-row"><div className="setting-label"><label htmlFor="confidence">Confidence threshold</label><span>Minimum score to keep a detection</span></div><div className="confidence-control"><input id="confidence" type="range" min="0.05" max="0.95" step="0.05" value={confidence} onChange={event => setConfidence(Number(event.target.value))} disabled={running}/><strong>{Math.round(confidence * 100)}<small>%</small></strong></div></div>
              <div className="settings-row"><div className="setting-label"><label>Processing device</label><span>Detected from your Python runtime</span></div><div className="select-wrap"><Cpu size={15}/><select value={device} onChange={event => setDevice(event.target.value)} disabled={running}>{devices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={13}/></div></div>
              {mode === 'images' ? <div className="settings-row"><div className="setting-label"><label>Image batch size</label><span>Automatic uses a conservative batch of one</span></div><div className="select-wrap"><select value={batchSize ?? 'auto'} onChange={event => setBatchSize(event.target.value === 'auto' ? null : Number(event.target.value))} disabled={running}><option value="auto">Automatic</option><option value="1">1 image</option><option value="2">2 images</option><option value="4">4 images</option></select><ChevronDown size={13}/></div></div> : <>
                <div className="settings-row"><div className="setting-label"><label htmlFor="inference-fps">Inference sampling FPS</label><span>Run the model at this rate; detections hold until updated</span></div><div className="fps-control"><input id="inference-fps" type="number" min="0.1" max="120" step="0.1" value={inferenceFps} onChange={event => setInferenceFps(Number(event.target.value))} disabled={running}/><small>FPS</small></div></div>
                <div className="settings-row"><div className="setting-label"><label htmlFor="output-fps">Output FPS</label><span>Rendered video cadence, independent of inference</span></div><div className="fps-control"><input id="output-fps" type="number" min="1" max="60" step="1" value={outputFps} onChange={event => setOutputFps(Number(event.target.value))} disabled={running}/><small>FPS</small></div></div>
              </>}
            </section>

            <section className="panel exports-panel"><div className="export-heading"><div><h3>Output files</h3><p>{mode === 'video' ? 'Annotated video is always generated; frame labels are optional' : 'Choose the files to generate'}</p></div><CircleHelp size={15}/></div><label className="check-row"><input type="checkbox" checked={mode === 'video' || outputImage} onChange={event => setOutputImage(event.target.checked)} disabled={running || mode === 'video'}/><span className="custom-check"><Check size={12}/></span><span><strong>{mode === 'video' ? 'Annotated video' : 'Annotated images'}</strong><small>{mode === 'video' ? 'MP4 output with source audio when available' : 'Preview and save with drawn detections'}</small></span><span className="format-pill">{mode === 'video' ? 'MP4' : 'PNG / JPG'}</span></label>{(Object.keys(formatLabels) as AnnotationFormat[]).map(format => <label className="check-row" key={format}><input type="checkbox" checked={formats.includes(format)} onChange={() => toggleFormat(format)} disabled={running}/><span className="custom-check"><Check size={12}/></span><span><strong>{formatLabels[format]}</strong><small>{mode === 'video' ? 'One annotation file per inference sample' : format === 'yolo' ? 'Normalized center coordinates' : format === 'voc' ? 'Pixel coordinates in XML' : 'Pixel center coordinates in JSON'}</small></span><span className="format-pill">{format === 'yolo' ? '.TXT' : format === 'voc' ? '.XML' : '.JSON'}</span></label>)}</section>
          </div>
        </div>

        <section className="run-strip"><div className="run-summary"><span className={`run-indicator ${running ? 'busy' : ''}`}>{running ? <LoaderCircle size={15}/> : <Activity size={15}/>}</span><div><strong>{running ? status : mode === 'video' ? videoFile ? `${videoFile.split(/[\\/]/).pop()} ready to process` : 'Choose a video to begin' : files.length ? `${files.length} ${files.length === 1 ? 'image' : 'images'} ready to process` : 'Ready to analyze'}</strong><span>{running ? 'Inference runs locally on this device' : 'Your files stay on your computer'}</span></div></div><div className="run-actions">{running && <button className="cancel-button" onClick={cancel}><X size={14}/> Cancel</button>}<button className="run-button" disabled={!isReady} onClick={mode === 'video' ? startVideoProcessing : startProcessing}>{running ? <><LoaderCircle className="spin" size={16}/> Processing</> : <><Play size={15} fill="currentColor"/> {mode === 'video' ? 'Process video' : 'Run detection'}</>}</button></div></section>

        {mode === 'video' && running && videoProgress && <section className="video-progress"><div className="results-top"><div><span className="step-number">02</span><h2>Video processing</h2></div><span className="result-status">{videoProgress.percent}% · {videoProgress.inferredFrames} inference frames</span></div><div className="progress-track"><div style={{ width: `${videoProgress.percent}%` }}/></div><div className="video-progress-stats"><span>Source time <strong>{formatTime(videoProgress.currentTime)} / {formatTime(videoProgress.duration)}</strong></span><span>Decoded <strong>{videoProgress.decodedFrames.toLocaleString()}</strong></span><span>Rendered <strong>{videoProgress.outputFrames.toLocaleString()}</strong></span></div></section>}
        {mode === 'video' && videoResult && <section className="results-section"><div className="results-top"><div><span className="step-number">03</span><h2>Processed video</h2></div><span className="result-status">{videoResult.duration.toFixed(2)} sec · {videoResult.inferred_frames} inference frames</span></div><div className="video-result-card">{videoUrl ? <video controls preload="metadata" src={videoUrl}/> : <div className="preview-placeholder"><LoaderCircle className="spin" size={20}/></div>}<div className="video-result-info"><strong>{videoResult.output_video_path.split(/[\\/]/).pop()}</strong><span>{videoResult.output_fps} output FPS · {videoResult.inference_fps} inference FPS · {videoResult.output_frames.toLocaleString()} rendered frames</span><span>Model {videoResult.model.toUpperCase()} · {videoResult.device.toUpperCase()}</span>{videoResult.frame_annotation_dir && <span>Frame annotations saved to {videoResult.frame_annotation_dir}</span>}<span>Saved in {outputDir}</span><span>Video frame annotations are not opened as an image dataset. Export selected frames separately before using LabelImg.</span></div></div></section>}
        {error && <div className="error-banner"><X size={16}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={14}/></button></div>}
        {(running || results.length > 0) && <section className="results-section"><div className="results-top"><div><span className="step-number">02</span><h2>Detection results</h2></div><span className="result-status">{status}</span></div>{progress && <div className="progress-track"><div style={{ width: `${Math.round(completedCount / Math.max(totalCount, 1) * 100)}%` }}/></div>}{results.length > 0 && <div className="count-chips">{Object.entries(counts).map(([name, count]) => <span key={name} className="count-chip"><i className={`class-dot ${name.toLowerCase()}`}/>{name}<strong>{count}</strong></span>)}</div>}<div className="result-grid">{results.map(result => <article className="result-card" key={result.source_path}><div className="preview-wrap">{result.output_image_path && previews[result.output_image_path] ? <img src={previews[result.output_image_path]} alt={`Detections for ${result.source_path.split(/[\\/]/).pop()}`}/>:<div className="preview-placeholder">{result.output_image_path ? <LoaderCircle className="spin" size={20}/> : <span>Image preview not selected</span>}</div>}<span className="detection-badge">{result.detections.length} detected</span></div><div className="result-card-info"><strong>{result.source_path.split(/[\\/]/).pop()}</strong><span>{result.width} Ã— {result.height} Â· {result.model.toUpperCase()}</span><div className="result-objects">{result.detections.length ? result.detections.map((detection,index)=><span key={`${detection.class_id}-${index}`}>{detection.class_name} <i>{Math.round(detection.confidence*100)}%</i></span>) : <span>No objects above threshold</span>}</div></div></article>)}</div>{results.length > 0 && <><div className="saved-note"><Check size={14}/> Results saved in <strong>{outputDir}</strong></div><div className="labelimg-open-row"><label>Export format for LabelImg <select value={labelImgFormat} onChange={event => setLabelImgFormat(event.target.value as 'yolo' | 'voc')}><option value="yolo">YOLO TXT</option><option value="voc">Pascal VOC XML</option></select></label><span>Copies original images and creates matching labels in a new folder</span><button className="model-action primary" onClick={() => void openInLabelImg()} disabled={running || labelImgBusy}><ExternalLink size={14}/>{labelImgBusy ? 'Preparing dataset…' : 'Open in LabelImg'}</button></div></>}</section>}
        {running && mode === 'images' && <div className="working-line"><span className="working-dot"/>{progress ? `Analyzing ${progress.current} Â· ${completedCount}/${totalCount}` : 'Loading checkpoint and preparing batch'}<span className="working-percent">{progress ? Math.round(completedCount / Math.max(totalCount,1) * 100) : 'â€”'}%</span></div>}
        <footer className="footer"><span>BOUNDARY VISION <i>LOCAL INFERENCE STUDIO</i></span><span>{model ? catalog?.models.find(item => item.id === model)?.classes.join(' / ').toUpperCase() : 'NO MODEL SELECTED'}</span></footer>
      </div>
    </section>
  </main>
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
  const minutes = Math.floor(seconds % 3600 / 60)
  const remainder = Math.floor(seconds % 60)
  return hours ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}
