import { describe, expect, it } from 'vitest'
import { errorText } from './error-text'

describe('errorText', () => {
  it('drops the Electron wrapper and the SCM marker', () => {
    expect(
      errorText(
        new Error(
          "Error invoking remote method 'scm:getFileContent': Error: [SCM:NOT_FOUND] No se encontró el archivo: a.ts",
        ),
      ),
    ).toBe('No se encontró el archivo: a.ts')
    expect(errorText(new Error("Error invoking remote method 'ai:x': Error: boom"))).toBe('boom')
  })

  it('passes plain messages and non-errors through', () => {
    expect(errorText(new Error('plain'))).toBe('plain')
    expect(errorText('text')).toBe('text')
  })
})
