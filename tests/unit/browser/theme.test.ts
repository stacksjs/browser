import { describe, expect, it } from 'bun:test'
import { contrast, nextPreset, parseHex, THEME_PRESETS, themeFromColors, toHex } from '../../../resources/functions/browser/theme'

describe('space themes', () => {
  it('read colours in every hex spelling, and refuse the rest', () => {
    expect(parseHex('#abc')).toEqual({ r: 170, g: 187, b: 204 })
    expect(toHex(parseHex('3b5bfd')!)).toBe('#3b5bfd')
    expect(toHex(parseHex('#3b5bfdcc')!)).toBe('#3b5bfd')
    expect(parseHex('blue')).toBeNull()
    expect(themeFromColors(['nope'])).toBeNull()
  })

  it('give every preset readable text on its sidebar, light and dark', () => {
    for (const preset of THEME_PRESETS) {
      const theme = themeFromColors(preset.colors)!
      for (const palette of [theme.light, theme.dark]) {
        expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(palette.foreground, palette.backgroundTo!)).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(theme.light.background, '#ffffff')).toBeLessThan(contrast(theme.dark.background, '#ffffff'))
    }
  })

  it('keep the hue that was picked, and use a second colour for the gradient', () => {
    const one = themeFromColors(['#ff0000'])!
    const rgb = parseHex(one.light.background)!
    expect(rgb.r).toBeGreaterThan(rgb.g)
    const two = themeFromColors(['#ff0000', '#0000ff'])!
    const to = parseHex(two.light.backgroundTo!)!
    expect(to.b).toBeGreaterThan(to.r)
  })

  it('hands new spaces the presets in turn', () => {
    expect(nextPreset(0).id).toBe('lavender')
    expect(nextPreset(THEME_PRESETS.length + 1).id).toBe('ocean')
  })
})
