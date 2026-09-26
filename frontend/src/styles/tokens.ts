// TS mirror of tokens.css, for contexts that need raw values (e.g. Three.js
// materials, which can't read CSS variables). Keep both files in sync by hand.

export const COLORS = {
  charcoal: '#1a1a1a',
  charcoalLight: '#242424',
  white: '#ffffff',
  orange: '#ff8c00',
  teal: '#2dd4bf',
  amber: '#f59e0b',
  red: '#ef4444',
  neutral: '#9ca3af',
} as const

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const

export const FONT = {
  base: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "ui-monospace, 'SF Mono', Consolas, monospace",
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 28,
    display: 48,
  },
} as const
