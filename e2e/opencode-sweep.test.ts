import { describe, expect, it } from 'vitest'
import { describeTest, isSweepable, parsePsEnvLine } from './opencode-sweep'

describe('parsePsEnvLine (macOS `ps -E` output)', () => {
  it('extracts pid, ppid and the environment pairs', () => {
    const info = parsePsEnvLine(
      '  4242     1 /opt/homebrew/bin/opencode serve --port=0 PLAYWRIGHT_TEST=1 HOME=/Users/x MINERVA_USER_DATA_DIR=/w/test-results/a-test/user-data',
    )
    expect(info).toMatchObject({ pid: 4242, ppid: 1 })
    expect(info?.environ).toContain('PLAYWRIGHT_TEST=1')
    expect(info?.environ).toContain('HOME=/Users/x')
  })

  it('keeps env values that contain spaces in one piece', () => {
    const info = parsePsEnvLine(
      '10 1 opencode serve MINERVA_USER_DATA_DIR=/My Projects/minerva/test-results/t/user-data TERM=xterm',
    )
    expect(info?.environ).toContain('MINERVA_USER_DATA_DIR=/My Projects/minerva/test-results/t/user-data')
    expect(info?.environ).toContain('TERM=xterm')
  })

  it('returns null for an empty or malformed line', () => {
    expect(parsePsEnvLine('')).toBeNull()
    expect(parsePsEnvLine('not a ps line')).toBeNull()
  })
})

describe('isSweepable (selection rule)', () => {
  it('sweeps an orphan started by the suite', () => {
    expect(isSweepable({ pid: 5, ppid: 1, environ: ['PLAYWRIGHT_TEST=1'] })).toBe(true)
  })

  it('never touches a server whose app is still alive', () => {
    expect(isSweepable({ pid: 5, ppid: 900, environ: ['PLAYWRIGHT_TEST=1'] })).toBe(false)
  })

  it("never touches the user's own opencode (no PLAYWRIGHT_TEST)", () => {
    expect(isSweepable({ pid: 5, ppid: 1, environ: ['HOME=/Users/x'] })).toBe(false)
    expect(isSweepable({ pid: 5, ppid: 1, environ: ['PLAYWRIGHT_TEST=10'] })).toBe(false)
  })
})

describe('describeTest', () => {
  it('derives the test name from MINERVA_USER_DATA_DIR', () => {
    expect(describeTest(['MINERVA_USER_DATA_DIR=/w/test-results/pr-list-a1b2/user-data'])).toBe(
      'pr-list-a1b2',
    )
  })

  it('falls back when the variable is missing', () => {
    expect(describeTest(['PLAYWRIGHT_TEST=1'])).toBe('(unknown)')
  })
})
