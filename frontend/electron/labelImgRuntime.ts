import path from 'node:path'

export type RuntimeProbe = (executable: string, args: string[]) => string
export type FileCheck = (filename: string) => boolean
export type LabelImgRuntime = { executable: string | null; error: string | null }

const runtimeProbe = `import importlib, json, sys
missing = []
for name in ('PyQt5', 'lxml'):
    try:
        importlib.import_module(name)
    except Exception:
        missing.append(name)
print(json.dumps({'version': list(sys.version_info[:3]), 'missing': missing}))`

export function labelImgVirtualEnvPython(directory: string, platform: NodeJS.Platform): string {
  return path.join(directory, '.venv', platform === 'win32' ? 'Scripts' : 'bin', platform === 'win32' ? 'python.exe' : 'python')
}

export function validateLabelImgRuntime(
  directory: string,
  platform: NodeJS.Platform,
  fileExists: FileCheck,
  probe: RuntimeProbe,
): LabelImgRuntime {
  const executable = labelImgVirtualEnvPython(directory, platform)
  const repair = platform === 'win32'
    ? 'Install Python 3 from https://www.python.org/downloads/windows/. In the LabelImg folder, run: py -3 -m venv .venv; .venv\\Scripts\\python -m pip install PyQt5 lxml.'
    : 'Install Python 3, then in the LabelImg folder run: python3 -m venv .venv; .venv/bin/python -m pip install PyQt5 lxml.'
  if (!fileExists(executable)) {
    return { executable: null, error: `The dedicated LabelImg virtual environment is missing. ${repair}` }
  }
  try {
    const report = JSON.parse(probe(executable, ['-c', runtimeProbe])) as { version?: unknown; missing?: unknown }
    const version = Array.isArray(report.version) ? report.version : []
    if (typeof version[0] !== 'number' || version[0] < 3) {
      return { executable: null, error: `LabelImg requires a Python 3 interpreter. Recreate the dedicated environment. ${repair}` }
    }
    const missing = Array.isArray(report.missing) ? report.missing.filter((item): item is string => typeof item === 'string') : ['PyQt5', 'lxml']
    if (missing.length) {
      return { executable: null, error: `The LabelImg environment cannot import ${missing.join(' and ')}. ${repair}` }
    }
    return { executable, error: null }
  } catch {
    return { executable: null, error: `The dedicated LabelImg Python environment could not run its dependency check. Recreate it and install PyQt5 and lxml. ${repair}` }
  }
}
