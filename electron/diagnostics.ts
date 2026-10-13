import { app } from 'electron'
import { appendFileSync, chmodSync, closeSync, existsSync, fsyncSync, lstatSync,
  mkdirSync, openSync, readFileSync, readdirSync, readSync, renameSync, statSync,
  unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { safeDiagnosticError, sanitizeDiagnosticEvent, type DiagnosticEvent,
  type DiagnosticLevel } from '../src/lib/diagnosticPrivacy'

const MAX_BYTES = 2 * 1024 * 1024
const BACKUPS = 3
const MAX_FILES = 32
const TAIL_BYTES = 128 * 1024
let active: DesktopDiagnostics | null = null

export class DesktopDiagnostics {
  readonly bootId = randomUUID()
  readonly logPath: string
  writeErrors = 0
  private readonly statePath: string
  private readonly identity: Record<string, unknown>

  constructor(readonly directory: string, version: string, private maxBytes = MAX_BYTES,
    private backups = BACKUPS) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.logPath = path.join(directory, `desktop-${process.pid}-${this.bootId}.jsonl`)
    this.statePath = path.join(directory, 'last-session.json')
    this.identity = { schema_version: 1, version, boot_id: this.bootId, pid: process.pid,
      platform: process.platform, electron_version: process.versions.electron ?? null,
      chrome_version: process.versions.chrome ?? null }
    try {
      const previous = JSON.parse(readFileSync(this.statePath, 'utf8'))
      if (previous.clean === false && typeof previous.boot_id === 'string') {
        this.write('desktop', 'app.previous_unclean_exit', { previous_boot_id: previous.boot_id }, undefined, 'WARNING')
      }
    } catch { /* first run / missing state */ }
    this.saveSession(false)
    this.prune()
    this.write('desktop', 'app.started')
  }

  private saveSession(clean: boolean): void {
    try {
      const tmp = `${this.statePath}.${this.bootId}.tmp`
      writeFileSync(tmp, JSON.stringify({ boot_id: this.bootId, clean, timestamp: new Date().toISOString() }), { mode: 0o600 })
      renameSync(tmp, this.statePath)
    } catch { this.writeErrors += 1 }
  }

  markCleanShutdown(): void {
    this.write('desktop', 'app.quit_requested', { count: this.writeErrors })
    this.saveSession(true)
  }

  private prune(): void {
    try {
      const files = readdirSync(this.directory).filter((name) => /^desktop-\d+-[a-f0-9-]+\.jsonl(?:\.\d+)?$/.test(name))
        .map((name) => path.join(this.directory, name)).filter((file) => !lstatSync(file).isSymbolicLink())
        .sort((a,b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      for (const file of files.slice(MAX_FILES)) unlinkSync(file)
    } catch { this.writeErrors += 1 }
  }

  write(component: 'desktop' | 'renderer', event: string, fields: DiagnosticEvent['fields'] = {},
    error?: unknown, level: DiagnosticLevel = error ? 'ERROR' : 'INFO'): void {
    const record = sanitizeDiagnosticEvent({ event, level, fields,
      ...(error !== undefined ? { error: safeDiagnosticError(error) } : {}) })
    if (record) this.append(component, record)
  }

  append(component: 'desktop' | 'renderer', record: DiagnosticEvent): void {
    try {
      const line = JSON.stringify({ ...this.identity, component, ...record }) + '\n'
      if (existsSync(this.logPath) && statSync(this.logPath).size + Buffer.byteLength(line) > this.maxBytes) {
        for (let i = this.backups; i >= 1; i -= 1) {
          const from = i === 1 ? this.logPath : `${this.logPath}.${i-1}`
          const to = `${this.logPath}.${i}`
          if (existsSync(to)) unlinkSync(to)
          if (existsSync(from)) renameSync(from,to)
        }
      }
      appendFileSync(this.logPath, line, { mode: 0o600 })
      chmodSync(this.logPath, 0o600)
      if (record.level === 'ERROR' || record.level === 'CRITICAL') {
        const fd = openSync(this.logPath, 'r+')
        try { fsyncSync(fd) } finally { closeSync(fd) }
      }
    } catch { this.writeErrors += 1 }
  }

  async exportBundle(destination: string, engine?: { path?: string; error?: string },
    crashDirectory?: string): Promise<void> {
    const zip = new JSZip()
    const files: string[] = []
    const omissions: string[] = []
    for (const name of readdirSync(this.directory)
      .filter((item) => /^desktop-\d+-[a-f0-9-]+\.jsonl(?:\.\d+)?$/.test(item))
      .sort((a,b) => statSync(path.join(this.directory,b)).mtimeMs - statSync(path.join(this.directory,a)).mtimeMs).slice(0,16)) {
      const file = path.join(this.directory,name)
      try {
        if (lstatSync(file).isSymbolicLink()) { omissions.push('symlink_skipped'); continue }
        const fd = openSync(file, 'r')
        let data: Buffer
        try {
          const offset = Math.max(0, statSync(file).size - TAIL_BYTES)
          const buffer = Buffer.alloc(TAIL_BYTES)
          const count = readSync(fd,buffer,0,buffer.length,offset)
          data = buffer.subarray(0,count)
          if (offset) data = data.subarray(data.indexOf(10) + 1)
        } finally { closeSync(fd) }
        zip.file(`desktop/${name}.tail`,data)
        files.push(name)
      } catch { omissions.push('log_read_failed') }
    }
    if (engine?.path) {
      try {
        if (lstatSync(engine.path).isSymbolicLink() || statSync(engine.path).size > 4 * 1024 * 1024) {
          omissions.push('engine_bundle_too_large_or_symlink')
        } else zip.file('engine-diagnostics.zip', readFileSync(engine.path))
      } catch { omissions.push('engine_bundle_unavailable') }
    }
    if (engine?.error) omissions.push(engine.error)
    // Native minidumps may contain process memory. List only counts, never include
    // their bytes in ordinary support exports.
    let nativeFiles = 0
    try { if (crashDirectory) nativeFiles = readdirSync(crashDirectory).length } catch { /* unavailable */ }
    zip.file('manifest.json', JSON.stringify({ ...this.identity, created_at: new Date().toISOString(),
      files, omissions, write_errors: this.writeErrors, native_crash_directory_entries: nativeFiles,
      privacy: 'Metadata and stack locations only. No config, conversations, tool arguments or native minidumps.',
      engine_scope: engine ? 'Local engine only' : 'Engine not collected; remote engines require server-side export.',
      max_tail_bytes_per_file: TAIL_BYTES },null,2))
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    const temporary = `${destination}.${this.bootId}.tmp`
    try {
      writeFileSync(temporary,buffer,{ mode: 0o600 })
      renameSync(temporary,destination)
      chmodSync(destination,0o600)
    } finally { if (existsSync(temporary)) unlinkSync(temporary) }
    this.write('desktop','diagnostics.exported',{ count: files.length })
  }
}

export function initializeDesktopDiagnostics(): DesktopDiagnostics | null {
  try {
    active = new DesktopDiagnostics(path.join(app.getPath('userData'),'diagnostics'),app.getVersion())
  } catch { process.stderr.write('MIRA desktop diagnostics unavailable.\n') }
  return active
}

export function logDesktopEvent(event: string, fields: DiagnosticEvent['fields'] = {},
  error?: unknown, level?: DiagnosticLevel): void {
  active?.write('desktop',event,fields,error,level)
}

export function recordRendererDiagnostic(input: unknown): void {
  const record = sanitizeDiagnosticEvent(input)
  if (record) active?.append('renderer',record)
}

export function pruneNativeCrashDumps(directory: string, maxFiles = 10,
  maxBytes = 64 * 1024 * 1024): number {
  const files: Array<{ path: string; size: number; modified: number }> = []
  let visited = 0
  const visit = (current: string, depth: number) => {
    if (depth > 4 || !existsSync(current)) return
    for (const name of readdirSync(current)) {
      if (++visited > 500) return
      const file = path.join(current,name)
      const info = lstatSync(file)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) visit(file,depth+1)
      else if (info.isFile() && name.endsWith('.dmp')) files.push({ path: file,size: info.size,modified: info.mtimeMs })
    }
  }
  try {
    visit(directory,0)
    let retained = 0
    let bytes = 0
    let removed = 0
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    for (const file of files.sort((a,b)=>b.modified-a.modified)) {
      if (file.modified < cutoff || retained >= maxFiles || bytes + file.size > maxBytes) {
        unlinkSync(file.path); removed += 1
      } else { retained += 1; bytes += file.size }
    }
    return removed
  } catch { logDesktopEvent('diagnostics.native_retention_failed',{},undefined,'WARNING'); return 0 }
}
