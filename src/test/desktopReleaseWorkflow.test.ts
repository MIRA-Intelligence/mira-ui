import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/desktop-release.yml', 'utf8')

describe('desktop release workflow', () => {
  for (const kind of ['standalone', 'bundle']) {
    it(`preserves dotted electron-builder arguments on Windows ${kind}`, () => {
      const step = workflow.split(`- name: Build Windows ${kind} artifacts`)[1]?.split('\n      - name:')[0]
      expect(step).toBeDefined()
      expect(step).toContain('shell: pwsh')
      for (const option of ['provider=github', 'owner=MIRA-Intelligence', 'repo=mira-ui', 'channel=${{ env.RELEASE_CHANNEL }}']) {
        expect(step).toContain(`'-c.publish.${option}'`)
      }
    })
  }

  it('allows build rehearsal without publishing a release', () => {
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('RELEASE_TAG: ${{ inputs.release_tag || github.ref_name }}')
    const publisher = workflow.split('\n  publish-release:')[1]
    expect(publisher).toContain("if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')")
    expect(workflow).toContain('--require-ui "${RELEASE_TAG#v}"')
  })

  it('publishes one installer per platform: macOS dmg, Windows setup zip', () => {
    const files = workflow.split('\n  publish-release:')[1]?.split('files: |')[1]
    expect(files).toBeDefined()
    const globs = files!.trim().split('\n').map((line) => line.trim())
    expect(globs).toEqual(['release-assets/*.dmg', 'release-assets/*-setup.zip'])
    for (const upload of workflow.split('uses: actions/upload-artifact@v4').slice(1)) {
      const path = upload.split('path: ')[1]?.split('\n')[0]
      expect(path).toMatch(/-mac-\*\.dmg$|-win-\*-setup\.zip$/)
    }
  })
})
