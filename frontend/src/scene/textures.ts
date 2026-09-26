import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

// All textures are drawn at runtime on a canvas: no downloaded assets, no
// network requests, and nothing that imitates a real sponsor's artwork.

const cache = new Map<string, Texture>()

function make(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = true): Texture {
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  draw(ctx)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  if (repeat) {
    tex.wrapS = RepeatWrapping
    tex.wrapT = RepeatWrapping
  }
  tex.anisotropy = 8
  cache.set(key, tex)
  return tex
}

function tangerineMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // a stylised tangerine: orange disc, a leaf, and a segment highlight
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ff7a00'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = r * 0.08
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7)
    ctx.stroke()
  }
  ctx.fillStyle = '#2f9e44'
  ctx.beginPath()
  ctx.ellipse(cx + r * 0.35, cy - r * 0.95, r * 0.45, r * 0.18, -0.5, 0, Math.PI * 2)
  ctx.fill()
}

/** Trackside advertising board: white "tangerine" wordmark on orange. */
export function sponsorBoard(): Texture {
  return make('board', 1024, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128)
    g.addColorStop(0, '#ff8a1a')
    g.addColorStop(1, '#f06a00')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1024, 128)
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.fillRect(0, 118, 1024, 10)
    for (const x0 of [0, 512]) {
      tangerineMark(ctx, x0 + 70, 62, 40)
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 76px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
      ctx.textBaseline = 'middle'
      ctx.fillText('tangerine', x0 + 125, 66)
    }
  })
}

/** Alternate board: "LIMITLAB" on charcoal (keeps the walls from looking copy-pasted). */
export function limitlabBoard(): Texture {
  return make('board2', 1024, 128, (ctx) => {
    ctx.fillStyle = '#17181b'
    ctx.fillRect(0, 0, 1024, 128)
    ctx.fillStyle = '#ff7a00'
    ctx.fillRect(0, 0, 1024, 10)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 70px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    ctx.textBaseline = 'middle'
    for (const x0 of [0, 512]) {
      ctx.fillText('LIMIT', x0 + 70, 68)
      ctx.fillStyle = '#ff7a00'
      ctx.fillText('LAB', x0 + 285, 68)
      ctx.fillStyle = '#ffffff'
    }
  })
}

/** Debris/catch fence: wire mesh with transparency. */
export function fenceTexture(): Texture {
  return make('fence', 128, 128, (ctx) => {
    ctx.clearRect(0, 0, 128, 128)
    ctx.strokeStyle = 'rgba(200,205,210,0.75)'
    ctx.lineWidth = 2
    for (let i = -128; i < 256; i += 16) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i + 128, 128)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(i + 128, 0)
      ctx.lineTo(i, 128)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(90,95,100,0.95)'
    ctx.fillRect(0, 0, 6, 128) // post
  })
}

/** Grandstand crowd: dense speckle of shirt colours on dark rows. */
export function crowdTexture(): Texture {
  return make('crowd', 512, 256, (ctx) => {
    ctx.fillStyle = '#2a2a2e'
    ctx.fillRect(0, 0, 512, 256)
    const colours = ['#d62828', '#f77f00', '#fcbf49', '#eae2b7', '#ffffff', '#1d3557', '#e63946', '#ff7a00', '#2a9d8f']
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let row = 0; row < 16; row++) {
      ctx.fillStyle = row % 2 ? '#34343a' : '#2c2c31'
      ctx.fillRect(0, row * 16, 512, 16)
      for (let x = 0; x < 512; x += 5) {
        if (rnd() < 0.82) {
          ctx.fillStyle = colours[Math.floor(rnd() * colours.length)]
          ctx.fillRect(x + rnd() * 2, row * 16 + 3 + rnd() * 4, 4, 8)
        }
      }
    }
  })
}

/** Building facade: rows of windows, some lit. */
export function windowsTexture(): Texture {
  return make('windows', 256, 512, (ctx) => {
    ctx.fillStyle = '#c9b48c'
    ctx.fillRect(0, 0, 256, 512)
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let y = 12; y < 512; y += 28) {
      for (let x = 10; x < 256; x += 24) {
        ctx.fillStyle = rnd() < 0.15 ? '#f5e6b8' : rnd() < 0.5 ? '#4b6a86' : '#3a5670'
        ctx.fillRect(x, y, 14, 18)
      }
    }
  })
}

function noise(key: string, base: [number, number, number], spread: number, size = 256, streak = false): Texture {
  return make(key, size, size, (ctx) => {
    const img = ctx.createImageData(size, size)
    let seed = key.length * 997
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < size * size; i++) {
      const y = Math.floor(i / size)
      const v = (rnd() - 0.5) * spread + (streak ? Math.sin(y * 0.35) * spread * 0.25 : 0)
      img.data[i * 4] = Math.max(0, Math.min(255, base[0] + v))
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, base[1] + v))
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, base[2] + v))
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  })
}

export const asphaltTexture = () => noise('asphalt', [80, 81, 86], 24)
export const grassTexture = () => noise('grass', [70, 112, 56], 34, 256, true)
export const pavingTexture = () => noise('paving', [150, 142, 128], 26)

/** Wordmark decal (transparent background) for the car and gantry. */
export function wordmark(text: string, colour: string, key = `wm-${text}-${colour}`): Texture {
  return make(key, 512, 128, (ctx) => {
    ctx.clearRect(0, 0, 512, 128)
    ctx.fillStyle = colour
    ctx.font = 'bold 84px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(text, 256, 68)
  }, false)
}
