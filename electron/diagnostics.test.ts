import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

vi.mock('electron', () => ({ app: {} }))
import { DesktopDiagnostics, pruneNativeCrashDumps } from './diagnostics'

describe('persistent desktop diagnostics', () => {
  let directory: string
  beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(),'mira-diagnostics-')) })
  afterEach(() => { rmSync(directory,{ recursive: true, force: true }) })

  it('preserves abnormal-exit evidence across launches and clears it after clean shutdown', () => {
    const first = new DesktopDiagnostics(directory,'test')
    first.write('desktop','renderer.process_gone',{ reason: 'crashed',exit_code: 11 }, undefined, 'CRITICAL')
    const second = new DesktopDiagnostics(directory,'test')
    expect(readFileSync(second.logPath,'utf8')).toContain(first.bootId)
    expect(readFileSync(second.logPath,'utf8')).toContain('app.previous_unclean_exit')
    second.markCleanShutdown()
    const third = new DesktopDiagnostics(directory,'test')
    expect(readFileSync(third.logPath,'utf8')).not.toContain('app.previous_unclean_exit')
  })

  it('bounds rotation and exports offline without an available engine', async () => {
    const instance = new DesktopDiagnostics(directory,'test',1200,2)
    for (let count=0; count<80; count+=1) instance.write('desktop','rotation.probe',{ count })
    expect(readdirSync(directory).filter((name)=>name.includes('.jsonl'))).toHaveLength(3)
    const destination = path.join(directory,'diagnostics.zip')
    await instance.exportBundle(destination,{ error: 'engine_collection_failed' })
    const zip = await JSZip.loadAsync(readFileSync(destination))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.omissions).toContain('engine_collection_failed')
    expect(Object.keys(zip.files).some((name)=>name.startsWith('desktop/'))).toBe(true)
  })

  it('excludes sensitive exception messages, user payloads and linked external files', async () => {
    const instance = new DesktopDiagnostics(directory,'test')
    instance.write('renderer','renderer.failed',{ request_id: 'req-1' },new Error('patient-private sk-privatekey'))
    symlinkSync(instance.logPath,path.join(directory,'desktop-999-aaaaaaaa.jsonl'))
    const destination = path.join(directory,'diagnostics.zip')
    await instance.exportBundle(destination)
    const zip = await JSZip.loadAsync(readFileSync(destination))
    const texts = await Promise.all(Object.values(zip.files).filter((file)=>!file.dir).map((file)=>file.async('string')))
    expect(texts.join('\n')).not.toContain('patient-private')
    expect(texts.join('\n')).not.toContain('sk-privatekey')
    expect(JSON.parse(await zip.file('manifest.json')!.async('string')).omissions).toContain('symlink_skipped')
  })

  it('exports despite dangling log links and counts only actual native dumps', async () => {
    const instance = new DesktopDiagnostics(directory,'test')
    symlinkSync(path.join(directory,'missing-target'),path.join(directory,'desktop-998-bbbbbbbb.jsonl'))
    const crashes = path.join(directory,'Crashpad')
    for (const sub of ['completed','pending','new','attachments']) mkdirSync(path.join(crashes,sub),{ recursive: true })
    writeFileSync(path.join(crashes,'settings.dat'),'x')
    writeFileSync(path.join(crashes,'completed','one.dmp'),'x')
    const destination = path.join(directory,'diagnostics.zip')
    await instance.exportBundle(destination,undefined,crashes)
    const zip = await JSZip.loadAsync(readFileSync(destination))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.omissions).toContain('symlink_skipped')
    expect(manifest.files).toContain(path.basename(instance.logPath))
    expect(manifest.native_crash_dump_count).toBe(1)
  })

  it('bounds owned native dumps while preserving unrelated files and symlinks', () => {
    for (let i=0; i<5; i+=1) writeFileSync(path.join(directory,`${i}.dmp`),Buffer.alloc(128))
    writeFileSync(path.join(directory,'important.txt'),'keep')
    symlinkSync(path.join(directory,'important.txt'),path.join(directory,'linked.dmp'))
    expect(pruneNativeCrashDumps(directory,2,256)).toBe(3)
    expect(readFileSync(path.join(directory,'important.txt'),'utf8')).toBe('keep')
    expect(readdirSync(directory).filter((name)=>/^\d\.dmp$/.test(name))).toHaveLength(2)
  })
})
