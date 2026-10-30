export type ModelId = string
export type AnnotationFormat = 'yolo' | 'voc' | 'createml'
export type DeviceOption = { id: string; label: string }
export type Detection = {
  class_id: number; class_name: string; confidence: number
  x1: number; y1: number; x2: number; y2: number
}
export type ImageResult = {
  source_path: string; output_image_path: string | null; annotation_paths: string[]
  width: number; height: number; model: ModelId; device: string; detections: Detection[]
}
export type ProcessOptions = {
  modelId: ModelId; modelVersion: string; confidence: number; device: string; batchSize: number | null
  outputImage: boolean; formats: AnnotationFormat[]
}
export type VideoOptions = {
  modelId: ModelId; modelVersion: string; confidence: number; device: string
  inferenceFps: number; outputFps: number; formats: AnnotationFormat[]
}
export type VideoResult = {
  source_path: string; output_video_path: string; frame_annotation_dir: string | null
  duration: number; inference_fps: number; output_fps: number
  decoded_frames: number; inferred_frames: number; output_frames: number
  model: ModelId; device: string; annotation_formats: AnnotationFormat[]
}
export type VideoProgressUpdate = {
  currentTime: number; duration: number; percent: number
  decodedFrames: number; inferredFrames: number; outputFrames: number
}
export type ProgressUpdate = { completed: number; total: number; current: string; result: ImageResult }
export type ModelCard = {
  id: ModelId; name: string; description: string; latestVersion: string; classes: string[]
  selected: boolean; selectedVersion: string | null
  status: ModelVersionCard['status']; source: ModelVersionCard['source']; detail: string; formatSupported: boolean; updateAvailable: boolean
  versions: ModelVersionCard[]
}
export type ModelVersionCard = {
  version: string; format: string; classes?: string[]; changeSummary?: string; checkpointFilename: string; expectedSizeBytes: number; sha256: string
  downloadUrl: string | null; developmentSource: string | null
  status: 'installed' | 'available' | 'not-configured' | 'corrupt'
  source: 'managed' | 'development' | 'remote' | 'none'
  canInstall: boolean; canRemove: boolean; detail: string; formatSupported: boolean
}
export type ModelCatalog = { models: ModelCard[]; selectedId: ModelId | null; selectedVersion: string | null; storagePath: string }
export type ModelInstallProgress = {
  modelId: ModelId; version: string; stage: 'download' | 'verify' | 'validate' | 'install'; receivedBytes: number; totalBytes: number
}
export type UpdateState = {
  currentVersion: string
  status: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error'
  configured: boolean
  availableVersion?: string
  percent?: number
  transferred?: number
  total?: number
  releaseNotes?: string
  message?: string
}
export type LabelImgConfig = { path: string | null; available: boolean; message: string }
export type LabelImgResult = Pick<ImageResult, 'source_path' | 'width' | 'height' | 'detections'>

declare global {
  interface Window {
    boundaryVision: {
      getCapabilities: () => Promise<{ devices: DeviceOption[]; pythonVersion: string }>
      getModelCatalog: () => Promise<ModelCatalog>
      refreshModelCatalog: () => Promise<ModelCatalog>
      selectModel: (modelId: ModelId, version: string) => Promise<ModelCatalog>
      installModel: (modelId: ModelId, version: string) => Promise<ModelCatalog>
      removeModel: (modelId: ModelId, version: string) => Promise<ModelCatalog>
      cancelModelInstall: (modelId: ModelId, version: string) => Promise<void>
      getUpdateState: () => Promise<UpdateState>
      checkForUpdates: () => Promise<UpdateState>
      downloadAppUpdate: () => Promise<UpdateState>
      installAppUpdate: () => Promise<void>
      getLabelImgConfig: () => Promise<LabelImgConfig>
      chooseLabelImgFolder: () => Promise<LabelImgConfig>
      launchLabelImg: () => Promise<LabelImgConfig>
      openLabelImg: (results: LabelImgResult[], format: 'yolo' | 'voc', initialDirectory: string | null) => Promise<string | null>
      chooseImages: () => Promise<string[]>
      chooseVideo: () => Promise<string | null>
      chooseOutputDirectory: () => Promise<string | null>
      previewImage: (path: string) => Promise<string>
      previewVideo: (path: string) => Promise<string>
      processImages: (paths: string[], outputDir: string, options: ProcessOptions) => Promise<ImageResult[]>
      processVideo: (path: string, outputDir: string, options: VideoOptions) => Promise<VideoResult>
      cancelProcessing: () => Promise<void>
      onProgress: (callback: (value: ProgressUpdate) => void) => () => void
      onVideoProgress: (callback: (value: VideoProgressUpdate) => void) => () => void
      onStatus: (callback: (value: string) => void) => () => void
      onModelInstallProgress: (callback: (value: ModelInstallProgress) => void) => () => void
      onUpdateState: (callback: (value: UpdateState) => void) => () => void
    }
  }
}
