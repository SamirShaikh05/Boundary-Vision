import type { AnnotationFormat } from './types'

const annotationFormats = new Set<string>(['yolo', 'voc', 'createml'])

export function validateAnnotationFormats(value: unknown): AnnotationFormat[] {
  if (!Array.isArray(value) || value.length > 1 || !value.every(format => typeof format === 'string' && annotationFormats.has(format))) {
    throw new Error('Choose at most one annotation format.')
  }
  return value as AnnotationFormat[]
}
