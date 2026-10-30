import type { UpdateState } from './types'

const allowedTransitions: Record<UpdateState['status'], ReadonlySet<UpdateState['status']>> = {
  disabled: new Set(['disabled', 'idle']),
  idle: new Set(['idle', 'checking', 'disabled']),
  checking: new Set(['checking', 'available', 'up-to-date', 'error']),
  available: new Set(['available', 'checking', 'downloading', 'error']),
  downloading: new Set(['downloading', 'downloaded', 'error']),
  downloaded: new Set(['downloaded', 'error']),
  'up-to-date': new Set(['up-to-date', 'checking', 'error']),
  error: new Set(['error', 'checking', 'disabled']),
}

export function isAllowedUpdateTransition(from: UpdateState['status'], to: UpdateState['status']): boolean {
  return allowedTransitions[from].has(to)
}
