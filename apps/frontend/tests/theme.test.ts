import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const themeCss = readFileSync(path.resolve(__dirname, '../src/theme.css'), 'utf-8')

const REQUIRED_TOKENS = [
  '--color-bg-canvas',
  '--color-bg-panel',
  '--color-bg-elevated',
  '--color-border',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-accent',
  '--color-success',
  '--color-error',
  '--color-warning',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--shadow-elevated',
  '--font-ui',
  '--font-mono',
]

describe('theme.css', () => {
  it('defines every required design token on :root', () => {
    for (const token of REQUIRED_TOKENS) {
      expect(themeCss).toMatch(new RegExp(`${token}\\s*:`))
    }
  })
})
