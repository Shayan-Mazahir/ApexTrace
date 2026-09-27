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

/** Grandstand crowd: rows of seated/standing people (heads, shoulders, some with raised arms and flags). */
export function crowdTexture(): Texture {
  return make('crowd', 1024, 512, (ctx) => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const shirts = ['#d62828', '#f77f00', '#fcbf49', '#eae2b7', '#f4f4f4', '#1d3557', '#e63946', '#ff7a00', '#2a9d8f', '#264653', '#7b2cbf', '#0b132b']
    const skins = ['#f1c9a5', '#e0ac82', '#c68642', '#8d5524', '#5c3a21', '#f7d7bd']
    const hair = ['#1b1209', '#3b2a1a', '#6b4a2b', '#c9a24b', '#111111', '#7d7d7d']
    ctx.fillStyle = '#26262b'
    ctx.fillRect(0, 0, 1024, 512)
    const ROWS = 16
    const rowH = 512 / ROWS
    for (let row = 0; row < ROWS; row++) {
      const y0 = row * rowH
      ctx.fillStyle = row % 2 ? '#303036' : '#2a2a30' // stepped seating
      ctx.fillRect(0, y0, 1024, rowH)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, y0 + rowH - 3, 1024, 3)
      for (let x = -6 + rnd() * 6; x < 1030; x += 15 + rnd() * 7) {
        if (rnd() < 0.1) continue // empty seat
        const shirt = shirts[Math.floor(rnd() * shirts.length)]
        const skin = skins[Math.floor(rnd() * skins.length)]
        const cx = x + 8
        const base = y0 + rowH - 3
        const headR = 4.2 + rnd() * 0.8
        const bodyH = 11 + rnd() * 3
        // torso with rounded shoulders
        ctx.fillStyle = shirt
        ctx.beginPath()
        ctx.moveTo(cx - 8, base)
        ctx.lineTo(cx - 7, base - bodyH + 3)
        ctx.quadraticCurveTo(cx - 6, base - bodyH, cx, base - bodyH)
        ctx.quadraticCurveTo(cx + 6, base - bodyH, cx + 7, base - bodyH + 3)
        ctx.lineTo(cx + 8, base)
        ctx.closePath()
        ctx.fill()
        // shading on one side for depth
        ctx.fillStyle = 'rgba(0,0,0,0.18)'
        ctx.fillRect(cx + 2, base - bodyH + 3, 6, bodyH - 3)
        if (rnd() < 0.16) { // cheering: an arm up
          ctx.strokeStyle = skin
          ctx.lineWidth = 2.6
          ctx.beginPath()
          const side = rnd() < 0.5 ? -1 : 1
          ctx.moveTo(cx + side * 6, base - bodyH + 4)
          ctx.lineTo(cx + side * 9, base - bodyH - 9)
          ctx.stroke()
          if (rnd() < 0.35) { // small team flag
            ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)]
            ctx.fillRect(cx + side * 9, base - bodyH - 15, 7 * side, 6)
          }
        }
        // head + hair
        ctx.fillStyle = skin
        ctx.beginPath()
        ctx.arc(cx, base - bodyH - headR + 1, headR, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = hair[Math.floor(rnd() * hair.length)]
        ctx.beginPath()
        ctx.arc(cx, base - bodyH - headR - 0.5, headR, Math.PI, Math.PI * 2)
        ctx.fill()
        if (rnd() < 0.18) { // cap
          ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)]
          ctx.fillRect(cx - headR - 1, base - bodyH - headR * 1.5, headR * 2 + 2, 2.5)
        }
      }
    }
  })
}

/** Leaf cluster texture for tree crowns: many small leaves in layered greens with dark gaps. */
export function foliageTexture(): Texture {
  return make('foliage', 256, 256, (ctx) => {
    let seed = 5
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    ctx.fillStyle = '#16321a'
    ctx.fillRect(0, 0, 256, 256)
    const greens = ['#1f4d24', '#2a6a2e', '#37803a', '#4a9645', '#5fa957', '#7dbb63']
    for (let layer = 0; layer < 3; layer++) {
      for (let i = 0; i < 900; i++) {
        const x = rnd() * 256
        const y = rnd() * 256
        ctx.fillStyle = greens[Math.min(greens.length - 1, Math.floor(rnd() * (2 + layer * 2)))]
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rnd() * Math.PI)
        ctx.beginPath()
        ctx.ellipse(0, 0, 3 + rnd() * 4, 1.4 + rnd() * 1.8, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
  })
}

/** Bark: vertical streaks in browns/greys. */
export function barkTexture(): Texture {
  return make('bark', 128, 256, (ctx) => {
    let seed = 9
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    ctx.fillStyle = '#4a3a2b'
    ctx.fillRect(0, 0, 128, 256)
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 128
      const w = 1 + rnd() * 3
      const tone = 40 + Math.floor(rnd() * 50)
      ctx.fillStyle = `rgb(${tone + 22},${tone + 12},${tone})`
      ctx.fillRect(x, rnd() * 256, w, 20 + rnd() * 90)
    }
  })
}

/** Building facade: pale stone with floor slabs and a grid of glass panes, a
 * few lit, the rest reflecting the sky in slightly different blues. */
export function windowsTexture(): Texture {
  return make('windows2', 256, 512, (ctx) => {
    const rnd = seeded(3)
    ctx.fillStyle = '#e4ddcf'
    ctx.fillRect(0, 0, 256, 512)
    const floorH = 26
    for (let y = 0; y < 512; y += floorH) {
      ctx.fillStyle = '#cfc6b4' // slab edge
      ctx.fillRect(0, y, 256, 4)
      for (let x = 6; x < 250; x += 31) {
        const lit = rnd() < 0.08
        const g = ctx.createLinearGradient(0, y + 6, 0, y + floorH - 2)
        if (lit) {
          g.addColorStop(0, '#fff1c9')
          g.addColorStop(1, '#f2d48f')
        } else {
          const t = rnd()
          g.addColorStop(0, t < 0.5 ? '#9cc0dd' : '#86aacb')
          g.addColorStop(1, t < 0.5 ? '#46637f' : '#3c5670')
        }
        ctx.fillStyle = g
        ctx.fillRect(x, y + 7, 25, floorH - 10)
        ctx.fillStyle = 'rgba(255,255,255,0.18)' // mullion highlight
        ctx.fillRect(x + 12, y + 7, 1, floorH - 10)
      }
    }
  })
}

// Seeded so every page load draws the same surfaces.
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
}

/** Track asphalt: dark binder, pale stone chips, and soft patches of wear and repair. */
export function asphaltTexture(): Texture {
  return make('asphalt2', 512, 512, (ctx) => {
    const rnd = seeded(41)
    const img = ctx.createImageData(512, 512)
    for (let i = 0; i < 512 * 512; i++) {
      const v = 60 + (rnd() - 0.5) * 16
      img.data[i * 4] = v
      img.data[i * 4 + 1] = v + 1
      img.data[i * 4 + 2] = v + 5
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    for (let i = 0; i < 14; i++) { // wear/repair patches, drawn tiling-safe (wrapped)
      const x = rnd() * 512
      const y = rnd() * 512
      const r = 40 + rnd() * 110
      const light = rnd() < 0.5
      for (const [dx, dy] of [[0, 0], [-512, 0], [0, -512], [-512, -512]]) {
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
        g.addColorStop(0, light ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.09)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
      }
    }
    for (let i = 0; i < 1800; i++) { // aggregate: faint pale chips and dark pits
      const tone = rnd() < 0.6 ? 84 + rnd() * 26 : 30 + rnd() * 16
      ctx.fillStyle = `rgb(${tone},${tone},${tone + 4})`
      ctx.fillRect(rnd() * 512, rnd() * 512, 1 + rnd(), 1 + rnd())
    }
  })
}

/** Mown grass: a light and a dark stripe per tile (TrackScenery tiles it every
 * 24 m, so the stripes run across the whole infield like a real circuit's),
 * over fine blade noise and a few darker clumps. */
export function grassTexture(): Texture {
  return make('grass3', 512, 512, (ctx) => {
    const rnd = seeded(17)
    const img = ctx.createImageData(512, 512)
    for (let i = 0; i < 512 * 512; i++) {
      const y = Math.floor(i / 512)
      // stripe: smooth light/dark band across the tile
      const band = Math.cos((y / 512) * Math.PI * 2) * 5 // subtle: strong stripes band into lines from overhead
      const blade = (rnd() - 0.5) * 22
      img.data[i * 4] = 58 + band * 0.7 + blade * 0.6
      img.data[i * 4 + 1] = 116 + band + blade
      img.data[i * 4 + 2] = 44 + band * 0.4 + blade * 0.4
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    for (let i = 0; i < 60; i++) {
      const x = rnd() * 512
      const y = rnd() * 512
      const r = 8 + rnd() * 26
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, rnd() < 0.5 ? 'rgba(20,50,10,0.16)' : 'rgba(180,200,90,0.08)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
  })
}

/** City paving (Baku): laid stone slabs in running bond with dark joints and
 * slightly different tones, instead of flat noise. */
export function pavingTexture(): Texture {
  return make('paving2', 512, 512, (ctx) => {
    const rnd = seeded(29)
    ctx.fillStyle = '#5d5a55'
    ctx.fillRect(0, 0, 512, 512)
    const rows = 8
    const h = 512 / rows
    for (let r = 0; r < rows; r++) {
      const w = 128
      for (let c = -1; c < 5; c++) {
        const x = c * w + (r % 2 ? w / 2 : 0)
        const tone = 150 + (rnd() - 0.5) * 26
        ctx.fillStyle = `rgb(${tone + 4},${tone - 2},${tone - 12})`
        ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4)
      }
    }
    const img = ctx.getImageData(0, 0, 512, 512)
    for (let i = 0; i < 512 * 512; i++) {
      const v = (rnd() - 0.5) * 14
      for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.max(0, Math.min(255, img.data[i * 4 + k] + v))
    }
    ctx.putImageData(img, 0, 0)
  })
}

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
