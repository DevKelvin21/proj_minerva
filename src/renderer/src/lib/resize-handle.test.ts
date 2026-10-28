import { describe, expect, it } from 'vitest'
import { clampResize, dragResizeValue, keyResizeValue, RESIZE_STEP_PX } from './resize-handle'

describe('clampResize', () => {
  it('rounds and keeps the value inside the bounds it has', () => {
    expect(clampResize(300.6, {})).toBe(301)
    expect(clampResize(100, { min: 220 })).toBe(220)
    expect(clampResize(900, { max: 480 })).toBe(480)
    expect(clampResize(300, { min: 220, max: 480 })).toBe(300)
  })

  it('lets min win when the bounds cross (a window narrower than the minimum)', () => {
    expect(clampResize(250, { min: 300, max: 280 })).toBe(300)
  })
})

describe('dragResizeValue', () => {
  it('a right-edge handle follows the pointer', () => {
    expect(dragResizeValue(280, 280, 400, 'right')).toBe(400)
    expect(dragResizeValue(280, 280, 200, 'right')).toBe(200)
  })

  it('a left-edge handle grows as the pointer moves left', () => {
    expect(dragResizeValue(380, 1200, 1100, 'left')).toBe(480)
    expect(dragResizeValue(380, 1200, 1250, 'left')).toBe(330)
  })

  it('clamps to the bounds', () => {
    expect(dragResizeValue(280, 280, 2000, 'right', { max: 480 })).toBe(480)
    expect(dragResizeValue(380, 1200, 1400, 'left', { min: 300 })).toBe(300)
  })
})

describe('keyResizeValue', () => {
  it('arrows move the edge the way they point', () => {
    expect(keyResizeValue('ArrowRight', 280, 'right')).toBe(280 + RESIZE_STEP_PX)
    expect(keyResizeValue('ArrowLeft', 280, 'right')).toBe(280 - RESIZE_STEP_PX)
    expect(keyResizeValue('ArrowLeft', 380, 'left')).toBe(380 + RESIZE_STEP_PX)
    expect(keyResizeValue('ArrowRight', 380, 'left')).toBe(380 - RESIZE_STEP_PX)
  })

  it('clamps arrow steps', () => {
    expect(keyResizeValue('ArrowRight', 470, 'right', { max: 480 })).toBe(480)
    expect(keyResizeValue('ArrowRight', 305, 'left', { min: 300 })).toBe(300)
  })

  it('Home/End jump to a bound only when it is given', () => {
    expect(keyResizeValue('Home', 400, 'right', { min: 220, max: 480 })).toBe(220)
    expect(keyResizeValue('End', 400, 'right', { min: 220, max: 480 })).toBe(480)
    expect(keyResizeValue('Home', 400, 'right')).toBeNull()
    expect(keyResizeValue('End', 400, 'left', { min: 300 })).toBeNull()
  })

  it('ignores every other key', () => {
    expect(keyResizeValue('ArrowUp', 280, 'right')).toBeNull()
    expect(keyResizeValue('Enter', 280, 'right')).toBeNull()
  })
})
