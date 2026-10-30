import { contextBridge, ipcRenderer } from 'electron'
import type { ModelInstallProgress, ModelId, ProcessOptions, ProgressUpdate, UpdateState, VideoOptions, VideoProgressUpdate } from './types'

contextBridge.exposeInMainWorld('boundaryVision', {
  getCapabilities: () => ipcRenderer.invoke('backend:capabilities'),
  getModelCatalog: () => ipcRenderer.invoke('model:list'),
  refreshModelCatalog: () => ipcRenderer.invoke('model:refresh'),
  selectModel: (modelId: ModelId, version: string) => ipcRenderer.invoke('model:select', modelId, version),
  installModel: (modelId: ModelId, version: string) => ipcRenderer.invoke('model:install', modelId, version),
  removeModel: (modelId: ModelId, version: string) => ipcRenderer.invoke('model:remove', modelId, version),
  cancelModelInstall: (modelId: ModelId, version: string) => ipcRenderer.invoke('model:cancel-install', modelId, version),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('update:download'),
  installAppUpdate: () => ipcRenderer.invoke('update:install'),
  getLabelImgConfig: () => ipcRenderer.invoke('labelimg:config'),
  chooseLabelImgFolder: () => ipcRenderer.invoke('labelimg:choose-folder'),
  launchLabelImg: () => ipcRenderer.invoke('labelimg:launch'),
  openLabelImg: (results: unknown[], format: 'yolo' | 'voc', initialDirectory: string | null) => ipcRenderer.invoke('labelimg:open', results, format, initialDirectory),
  chooseImages: () => ipcRenderer.invoke('dialog:images'),
  chooseVideo: () => ipcRenderer.invoke('dialog:video'),
  chooseOutputDirectory: () => ipcRenderer.invoke('dialog:output-directory'),
  previewImage: (path: string) => ipcRenderer.invoke('result:preview', path),
  previewVideo: (path: string) => ipcRenderer.invoke('result:video-url', path),
  processImages: (paths: string[], outputDir: string, options: ProcessOptions) =>
    ipcRenderer.invoke('backend:process-images', { paths, outputDir, options }),
  processVideo: (filePath: string, outputDir: string, options: VideoOptions) =>
    ipcRenderer.invoke('backend:process-video', { filePath, outputDir, options }),
  cancelProcessing: () => ipcRenderer.invoke('backend:cancel'),
  onProgress: (callback: (value: ProgressUpdate) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: ProgressUpdate) => callback(value)
    ipcRenderer.on('backend:progress', listener)
    return () => ipcRenderer.removeListener('backend:progress', listener)
  },
  onVideoProgress: (callback: (value: VideoProgressUpdate) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: VideoProgressUpdate) => callback(value)
    ipcRenderer.on('backend:video-progress', listener)
    return () => ipcRenderer.removeListener('backend:video-progress', listener)
  },
  onStatus: (callback: (value: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: string) => callback(value)
    ipcRenderer.on('backend:status', listener)
    return () => ipcRenderer.removeListener('backend:status', listener)
  },
  onModelInstallProgress: (callback: (value: ModelInstallProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: ModelInstallProgress) => callback(value)
    ipcRenderer.on('model:install-progress', listener)
    return () => ipcRenderer.removeListener('model:install-progress', listener)
  },
  onUpdateState: (callback: (value: UpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: UpdateState) => callback(value)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
})
