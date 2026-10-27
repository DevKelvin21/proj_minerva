import { describe, expect, it, vi } from 'vitest'
import { dialogText, nativeConfirm, testConfirmAnswer } from './confirm'

const request = { message: 'Retarget PR #1?', detail: 'a → b', confirmLabel: 'Retarget' }

describe('testConfirmAnswer', () => {
  it('scripts the answer only in mock mode', () => {
    expect(testConfirmAnswer({ MINERVA_MOCK: '1', MINERVA_TEST_CONFIRM: 'accept' })).toBe(true)
    expect(testConfirmAnswer({ MINERVA_MOCK: '1', MINERVA_TEST_CONFIRM: 'decline' })).toBe(false)
    expect(testConfirmAnswer({ MINERVA_MOCK: '1', MINERVA_TEST_CONFIRM: 'yes' })).toBeNull()
    expect(testConfirmAnswer({ MINERVA_MOCK: '1' })).toBeNull()
    expect(testConfirmAnswer({ MINERVA_TEST_CONFIRM: 'accept' })).toBeNull()
    expect(testConfirmAnswer({ MINERVA_MOCK: 'true', MINERVA_TEST_CONFIRM: 'accept' })).toBeNull()
  })
})

describe('nativeConfirm', () => {
  it('shows a dialog with Cancel as the default and answers true only for the first button', async () => {
    const show = vi.fn(async () => ({ response: 0 }))
    const confirm = nativeConfirm(null, { env: {}, showMessageBox: show })
    await expect(confirm(request)).resolves.toBe(true)
    expect(show).toHaveBeenCalledWith(null, {
      type: 'question',
      buttons: ['Retarget', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'Minerva',
      message: 'Retarget PR #1?',
      detail: 'a → b',
    })
    show.mockResolvedValue({ response: 1 })
    await expect(confirm(request)).resolves.toBe(false)
  })

  it('never honors MINERVA_TEST_CONFIRM outside mock mode', async () => {
    const show = vi.fn(async () => ({ response: 1 }))
    const confirm = nativeConfirm(null, {
      env: { MINERVA_TEST_CONFIRM: 'accept' },
      showMessageBox: show,
    })
    await expect(confirm(request)).resolves.toBe(false)
    expect(show).toHaveBeenCalledOnce()
  })

  it('skips the dialog with the scripted answer in mock mode', async () => {
    const show = vi.fn(async () => ({ response: 0 }))
    const env = { MINERVA_MOCK: '1', MINERVA_TEST_CONFIRM: 'decline' }
    await expect(nativeConfirm(null, { env, showMessageBox: show })(request)).resolves.toBe(false)
    expect(show).not.toHaveBeenCalled()
  })
})

describe('dialogText', () => {
  it('drops control and bidi characters, collapses whitespace and caps the length', () => {
    expect(dialogText('a‮b\n\tc⁦d')).toBe('a b c d')
    expect(dialogText('x'.repeat(10), 5)).toBe('xxxx…')
  })
})
