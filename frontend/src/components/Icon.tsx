// Small stroke icons for toolbars (24x24 grid, currentColor), drawn here so
// there is no icon font or network request.
const PATHS: Record<string, string> = {
  pause: 'M9 5v14M15 5v14',
  play: 'M8 5l11 7-11 7z',
  reset: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5',
  camera: 'M3 8h3l2-3h8l2 3h3v11H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8',
  gamepad: 'M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.6 1.5L15 14H9l-1.4 1.5A3 3 0 0 1 2 14v-1a4 4 0 0 1 4-4zM7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  report: 'M6 3h9l4 4v14H6zM15 3v4h4M9 13h6M9 17h6M9 9h2',
  exit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  ghost: 'M5 20V10a7 7 0 0 1 14 0v10l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2zM9.5 11h.01M14.5 11h.01',
}

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  )
}
