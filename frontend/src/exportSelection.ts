export type ExportFormat = 'yolo' | 'voc' | 'createml'

export function toggleExportFormat(current: ExportFormat | null, selected: ExportFormat): ExportFormat | null {
  return current === selected ? null : selected
}
