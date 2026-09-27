import { useEffect, useRef } from 'react'
import type { NormalizedControls } from '../input/useInputAdapter'
import type { VehicleStateMessage } from '../types/schemas'
import './TelemetryPanel.css'

const TRACE_SECONDS = 4
const TRACE_HZ = 30
const G_RANGE = 5 // g at the edge of the g-meter

interface TelemetryPanelProps {
  normalized: NormalizedControls
  vehicleState: VehicleStateMessage | null
}

// Input telemetry like a sim overlay: rolling throttle/brake trace, pedal and
// steering bars, and a g-meter from the car's measured accelerations.
export function TelemetryPanel({ normalized, vehicleState: v }: TelemetryPanelProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const inputs = useRef(normalized)
  inputs.current = normalized

  useEffect(() => {
    const n = TRACE_SECONDS * TRACE_HZ
    const throttle: number[] = new Array(n).fill(0)
    const brake: number[] = new Array(n).fill(0)
    const id = setInterval(() => {
      throttle.push(inputs.current.throttle)
      brake.push(inputs.current.brake)
      throttle.shift()
      brake.shift()
      const c = canvas.current
      const ctx = c?.getContext('2d')
      if (!c || !ctx) return
      const { width: w, height: h } = c
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 1
      for (const f of [0.25, 0.5, 0.75]) {
        ctx.beginPath()
        ctx.moveTo(0, h * f)
        ctx.lineTo(w, h * f)
        ctx.stroke()
      }
      const plot = (data: number[], colour: string) => {
        ctx.strokeStyle = colour
        ctx.lineWidth = 2
        ctx.beginPath()
        data.forEach((value, i) => {
          const x = (i / (n - 1)) * w
          const y = h - 2 - value * (h - 4)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }
      plot(throttle, '#22c55e')
      plot(brake, '#ef4444')
    }, 1000 / TRACE_HZ)
    return () => clearInterval(id)
  }, [])

  const gx = Math.max(-1, Math.min(1, (v?.g_lat ?? 0) / G_RANGE))
  const gy = Math.max(-1, Math.min(1, (v?.g_long ?? 0) / G_RANGE))
  const total = Math.hypot(v?.g_lat ?? 0, v?.g_long ?? 0)

  return (
    <div className="telemetry" aria-label="Input telemetry">
      <div className="telemetry__trace">
        <span className="telemetry__label">INPUTS {TRACE_SECONDS}s</span>
        <canvas ref={canvas} width={220} height={64} />
        <div className="telemetry__steer" aria-label={`Steering ${Math.round(normalized.steering * 100)}%`}>
          <div className="telemetry__steer-mark" style={{ left: `${50 + normalized.steering * 50}%` }} />
        </div>
      </div>
      <div className="telemetry__pedals">
        <div className="telemetry__pedal" aria-label={`Throttle ${Math.round(normalized.throttle * 100)}%`}>
          <div className="telemetry__fill telemetry__fill--thr" style={{ height: `${normalized.throttle * 100}%` }} />
          <span>THR</span>
        </div>
        <div className="telemetry__pedal" aria-label={`Brake ${Math.round(normalized.brake * 100)}%`}>
          <div className="telemetry__fill telemetry__fill--brk" style={{ height: `${normalized.brake * 100}%` }} />
          <span>BRK</span>
        </div>
      </div>
      <div className="telemetry__g" aria-label={`${total.toFixed(1)} g`}>
        <svg viewBox="-50 -50 100 100" width={78} height={78}>
          <circle r={48} className="telemetry__ring" />
          <circle r={24} className="telemetry__ring telemetry__ring--inner" />
          <line x1={-48} x2={48} y1={0} y2={0} className="telemetry__axis" />
          <line y1={-48} y2={48} x1={0} x2={0} className="telemetry__axis" />
          {/* braking pushes the dot up (the driver is thrown forward) */}
          <circle cx={-gx * 46} cy={gy * 46} r={5} className="telemetry__dot" />
        </svg>
        <b>{total.toFixed(1)} G</b>
      </div>
    </div>
  )
}
