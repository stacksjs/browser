/**
 * A space's colours from the one to three a person picks, as Arc's colour
 * picker does: a light and a dark palette, each a gradient behind the sidebar
 * with text that stays readable on it (WCAG contrast of at least 4.5:1).
 */

import type { Palette, SpaceTheme } from './sidebar'

interface Rgb { r: number, g: number, b: number }
interface Hsl { h: number, s: number, l: number }

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([\da-f]{3}|[\da-f]{6})(?:[\da-f]{2})?$/i.exec(hex.trim())
  if (!match) return null
  const digits = match[1]!.length === 3 ? match[1]!.split('').map(d => d + d).join('') : match[1]!
  return { r: Number.parseInt(digits.slice(0, 2), 16), g: Number.parseInt(digits.slice(2, 4), 16), b: Number.parseInt(digits.slice(4, 6), 16) }
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4
  return { h: h * 60, s, l }
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  const hue = ((h % 360) + 360) % 360 / 360
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    return 255 * (x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p)
  }
  return { r: channel(hue + 1 / 3), g: channel(hue), b: channel(hue - 1 / 3) }
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const linear = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(parseHex(a)!), luminance(parseHex(b)!)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

/** The colour at a lightness, keeping its hue and some of its saturation. */
function shade(color: Rgb, lightness: number, saturation = 1): string {
  const hsl = toHsl(color)
  return toHex(fromHsl({ h: hsl.h, s: Math.min(1, hsl.s * saturation), l: lightness }))
}

/** Text for a background: the darkest or lightest tint of the hue that reads, else black or white. */
function readableOn(background: string, hue: Rgb, dark: boolean): string {
  for (const lightness of dark ? [0.96, 0.98, 1] : [0.14, 0.1, 0.06, 0]) {
    const candidate = shade(hue, lightness, 0.5)
    if (contrast(candidate, background) >= 4.5 && contrast(candidate, shade(hue, dark ? 0.24 : 0.82)) >= 4.5) return candidate
  }
  return dark ? '#ffffff' : '#000000'
}

function palette(colors: Rgb[], dark: boolean): Palette {
  const [first, second] = [colors[0]!, colors[1] ?? colors[0]!]
  const background = dark ? shade(first, 0.22, 0.7) : shade(first, 0.86, 0.9)
  const backgroundTo = colors.length > 1 ? (dark ? shade(second, 0.16, 0.7) : shade(second, 0.78, 0.9)) : (dark ? shade(first, 0.15, 0.7) : shade(first, 0.79, 0.9))
  return {
    background,
    backgroundTo,
    foreground: readableOn(background, first, dark),
    hover: dark ? '#ffffff1a' : '#ffffff66',
    selected: dark ? '#ffffff2e' : '#ffffffcc',
  }
}

/** A space's theme from one to three colours; anything unreadable as a colour is skipped. */
export function themeFromColors(colors: string[]): SpaceTheme | null {
  const parsed = colors.slice(0, 3).map(parseHex).filter((color): color is Rgb => color !== null)
  if (!parsed.length) return null
  return { light: palette(parsed, false), dark: palette(parsed, true), colors: parsed.map(toHex) }
}

/** Arc's starting colours, offered when a space is made and in the theme menu. */
export const THEME_PRESETS: Array<{ id: string, title: string, colors: string[] }> = [
  { id: 'lavender', title: 'Lavender', colors: ['#8b93f8'] },
  { id: 'ocean', title: 'Ocean', colors: ['#5aa9e6', '#3d6ee0'] },
  { id: 'mint', title: 'Mint', colors: ['#5fd3a5'] },
  { id: 'sunset', title: 'Sunset', colors: ['#ff9a62', '#ff5f8f'] },
  { id: 'rose', title: 'Rose', colors: ['#f07ab0'] },
  { id: 'sand', title: 'Sand', colors: ['#d8b88a'] },
  { id: 'graphite', title: 'Graphite', colors: ['#8a8f98'] },
]

/** The preset a space gets next: the first no space uses yet, else round again. */
export function nextPreset(used: number): (typeof THEME_PRESETS)[number] {
  return THEME_PRESETS[used % THEME_PRESETS.length]!
}
