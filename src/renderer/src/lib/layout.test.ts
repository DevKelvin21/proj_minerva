import { describe, expect, it } from 'vitest'
import {
  clampDidacticWidth,
  clampSidebarWidth,
  dockedSidebarWidth,
  DRAWER_WIDTH,
  drawerWidth,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  sidebarFootprint,
} from './layout'

describe('docked sidebar width', () => {
  it("keeps the tier's default until the user drags", () => {
    expect(dockedSidebarWidth(null, 1600)).toBe(280)
    expect(dockedSidebarWidth(null, 1200)).toBe(240)
  })

  it('docks only the rail on the drawer tiers, whatever was dragged or folded', () => {
    expect(dockedSidebarWidth(400, 900)).toBe(0)
    expect(sidebarFootprint(400, true, 900)).toBe(SIDEBAR_RAIL_WIDTH)
    expect(sidebarFootprint(400, false, 900)).toBe(SIDEBAR_RAIL_WIDTH)
    expect(sidebarFootprint(null, false, 560)).toBe(SIDEBAR_RAIL_WIDTH)
  })

  it('clamps a dragged width between the minimum and 32% of the window (480px max)', () => {
    expect(clampSidebarWidth(100, 1600)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(900, 1600)).toBe(480)
    expect(clampSidebarWidth(900, 1100)).toBe(352)
    expect(clampSidebarWidth(333.6, 1600)).toBe(334)
  })

  it('shrinks with the window but keeps the preference for when it widens', () => {
    expect(dockedSidebarWidth(450, 1100)).toBe(352)
    expect(dockedSidebarWidth(450, 1800)).toBe(450)
  })

  it('takes the rail width when folded', () => {
    expect(sidebarFootprint(450, true, 1600)).toBe(SIDEBAR_RAIL_WIDTH)
    expect(sidebarFootprint(450, false, 1600)).toBe(450)
  })
})

describe('clampDidacticWidth', () => {
  it("leaves the center its minimum next to the sidebar's real width", () => {
    // 1600 - 280 (default sidebar) - 420 (center) = 900, under 60% of the window.
    expect(clampDidacticWidth(2000, 1600)).toBe(900)
    expect(clampDidacticWidth(2000, 1600, 480)).toBe(700)
    expect(clampDidacticWidth(2000, 1600, SIDEBAR_RAIL_WIDTH)).toBe(960)
  })

  it('next to the rail on the drawer tiers, keeps the tier fraction or the 300px floor', () => {
    // 960x540 (quarter of 1080p, md): 45% = 432 is under 960 - 56 - 420 = 484.
    expect(clampDidacticWidth(2000, 960, sidebarFootprint(null, false, 960))).toBe(432)
    // 800 (md): 800 - 56 - 420 = 324 beats 45% = 360.
    expect(clampDidacticWidth(2000, 800, sidebarFootprint(null, false, 800))).toBe(324)
    // The 560px window minimum (sm): never under the panel's 300px floor.
    expect(clampDidacticWidth(2000, 560, sidebarFootprint(null, false, 560))).toBe(300)
  })
})

describe('drawerWidth', () => {
  it('keeps the preferred width while the container has room', () => {
    expect(drawerWidth(DRAWER_WIDTH.sidebar, 900)).toBe(300)
  })

  it('never covers more than 85% of its container', () => {
    expect(drawerWidth(DRAWER_WIDTH.didactic, 400)).toBe(340)
    expect(drawerWidth(DRAWER_WIDTH.files, 280)).toBe(238)
  })

  it('uses the preferred width before the container is measured', () => {
    expect(drawerWidth(DRAWER_WIDTH.files, null)).toBe(260)
  })
})
