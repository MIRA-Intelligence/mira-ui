#!/usr/bin/env node
// Validate compatibility.json schema, optionally asserting that the
// `ui` field satisfies a release tag.
//
// Usage:
//   node scripts/validate-compatibility.mjs --file compatibility.json
//   node scripts/validate-compatibility.mjs --file compatibility.json --require-ui 0.3.0rc2
//
// Exit codes:
//   0 -> file is valid (and matches --require-ui if supplied)
//   1 -> validation failed (one or more errors printed to stderr)
//   2 -> usage error (bad CLI arguments)
//
// Ported from the original Python validator that lived in the mira repo
// (scripts/validate_compatibility.py) when the source of truth moved here.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { argv, exit } from 'node:process'

const VERSION_SPEC_RE = /^(?:\d+\.\d+\.x|\d+\.\d+\.\d+(?:rc\d+)?)$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:rc\d+)?$/
const API_CONTRACT_RE = /^v\d+$/
const RELEASE_TRAIN_RE = /^\d{4}\.\d{2}(?:rc\d+)?$/

const REQUIRED_KEYS = ['release_train', 'ui', 'agent', 'api_contract', 'min_agent_for_ui']

function parseArgs(rawArgs) {
  const args = { file: null, requireUi: null }
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i]
    if (arg === '--file' || arg === '-f') {
      args.file = rawArgs[i + 1]
      i += 1
    } else if (arg === '--require-ui') {
      args.requireUi = rawArgs[i + 1]
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      printUsage()
      exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      printUsage()
      exit(2)
    }
  }
  if (!args.file) {
    console.error('Error: --file is required')
    printUsage()
    exit(2)
  }
  return args
}

function printUsage() {
  console.error(
    [
      'Usage:',
      '  validate-compatibility.mjs --file <path> [--require-ui <version>]',
      '',
      'Options:',
      '  --file, -f      Path to compatibility.json',
      '  --require-ui    Assert that compatibility.json#ui covers this version.',
      '                  Pass the bare version (the leading "v" of a release tag',
      '                  must already be stripped by the caller).',
      '  --help, -h      Show this message',
    ].join('\n'),
  )
}

function validateSchema(payload) {
  const errors = []

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    errors.push('compatibility.json must be a JSON object.')
    return errors
  }

  const missing = REQUIRED_KEYS.filter((key) => !(key in payload))
  if (missing.length > 0) {
    errors.push(`Missing required keys: ${missing.sort().join(', ')}.`)
  }

  const releaseTrain = payload.release_train
  if (typeof releaseTrain !== 'string' || !RELEASE_TRAIN_RE.test(releaseTrain)) {
    errors.push('release_train must match YYYY.MM or YYYY.MMrcN (e.g. 2026.04, 2026.04rc2).')
  }

  const ui = payload.ui
  if (typeof ui !== 'string' || !VERSION_SPEC_RE.test(ui)) {
    errors.push('ui must match major.minor.x or major.minor.patch[rcN] (e.g. 2.3.x, 2.3.0rc1).')
  }

  const agent = payload.agent
  if (typeof agent !== 'string' || !VERSION_SPEC_RE.test(agent)) {
    errors.push('agent must match major.minor.x or major.minor.patch[rcN] (e.g. 1.6.x, 1.6.0rc1).')
  }

  const apiContract = payload.api_contract
  if (typeof apiContract !== 'string' || !API_CONTRACT_RE.test(apiContract)) {
    errors.push('api_contract must match v<number> (e.g. v1).')
  }

  const minAgent = payload.min_agent_for_ui
  if (typeof minAgent !== 'string' || !SEMVER_RE.test(minAgent)) {
    errors.push('min_agent_for_ui must be a concrete major.minor.patch[rcN] version (e.g. 1.6.0, 0.2.0rc4).')
  }

  return errors
}

function checkUiMatchesTag(payload, requireUi) {
  const errors = []

  if (!SEMVER_RE.test(requireUi)) {
    errors.push(
      `--require-ui must be a concrete version (major.minor.patch[rcN]); got "${requireUi}". ` +
        'Strip the leading "v" of the tag before passing it.',
    )
    return errors
  }

  const ui = payload.ui
  if (typeof ui !== 'string') {
    errors.push('compatibility.json#ui is missing or not a string; cannot compare against tag.')
    return errors
  }

  if (ui.endsWith('.x')) {
    const prefix = ui.slice(0, -1)
    if (!requireUi.startsWith(prefix)) {
      errors.push(
        `Tag "${requireUi}" is outside the minor range declared in compatibility.json#ui ("${ui}"). ` +
          `Expected the tag to start with "${prefix}".`,
      )
    }
  } else if (ui !== requireUi) {
    errors.push(
      `Tag "${requireUi}" does not match the exact pin in compatibility.json#ui ("${ui}"). ` +
        'Either bump compatibility.json#ui to match the tag, or change it to a minor range like ' +
        `"${requireUi.replace(/\.\d+(rc\d+)?$/, '.x')}" if you want a range.`,
    )
  }

  return errors
}

function main() {
  const args = parseArgs(argv.slice(2))
  const filePath = resolve(args.file)

  let payload
  try {
    const raw = readFileSync(filePath, 'utf8')
    payload = JSON.parse(raw)
  } catch (err) {
    console.error(`Failed to read or parse ${filePath}: ${err.message}`)
    exit(1)
  }

  const errors = validateSchema(payload)
  if (errors.length === 0 && args.requireUi !== null) {
    errors.push(...checkUiMatchesTag(payload, args.requireUi))
  }

  if (errors.length > 0) {
    console.error(`compatibility.json validation failed (${filePath}):`)
    for (const msg of errors) {
      console.error(`  - ${msg}`)
    }
    exit(1)
  }

  const checked = args.requireUi ? ` (matches tag ${args.requireUi})` : ''
  console.log(`compatibility.json OK${checked}: ${filePath}`)
  exit(0)
}

main()
