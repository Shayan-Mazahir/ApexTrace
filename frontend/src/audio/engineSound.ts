// Synthesised 1.6 L V6 turbo-hybrid engine, generated live with Web Audio so
// it follows the car exactly: pitch from the server's rpm, loudness and tone
// from the pedal the driver is pressing right now (no network lag on the
// throttle "bark"), an ignition cut on upshifts, overrun crackle on lift-off,
// turbo whistle with boost, and tyre squeal on lock-up / wheelspin.
//
// Why not a recording: a looped sample pitch-shifted across 4,000-12,000 rpm
// sounds wrong at the ends and can't react to throttle separately from rpm;
// real F1 onboard audio is also copyrighted.

export interface EngineInputs {
  rpm: number
  throttle: number // 0-1, local pedal
  gear: number // -1 reverse, 0 neutral
  speed: number // m/s, signed
  lockup: boolean
  wheelspin: boolean
  live: boolean // session running and connected
}

const IDLE_RPM = 4000
const MAX_RPM = 12500

// A 4-stroke V6 fires 3 times per crank revolution. Build the waveform on the
// camshaft rate (rpm/120): firing orders (every 6th harmonic of it) are strong,
// the rest are the uneven "grit" between firings that makes it sound like an
// engine rather than a synth.
function engineWave(ctx: AudioContext): PeriodicWave {
  const n = 64
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  for (let h = 1; h < n; h++) {
    const firing = h % 6 === 0 ? 1 : h % 3 === 0 ? 0.5 : 0.28
    const amp = (firing / Math.sqrt(h)) * (0.7 + 0.6 * Math.abs(Math.sin(h * 2.3))) // fixed pseudo-random spread
    // scattered phases: a clean, phase-aligned stack is what sounds like a synth
    const phase = h * 2.39996
    real[h] = amp * Math.cos(phase)
    imag[h] = amp * Math.sin(phase)
  }
  return ctx.createPeriodicWave(real, imag)
}

function noiseBuffer(ctx: AudioContext, seconds = 2): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  return curve
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export class EngineSound {
  private ctx: AudioContext
  private master: GainNode
  private engineGain: GainNode
  private cutGain: GainNode
  private filter: BiquadFilterNode
  private oscA: OscillatorNode
  private oscB: OscillatorNode
  private sub: OscillatorNode
  private turbo: OscillatorNode
  private turboGain: GainNode
  private intakeGain: GainNode
  private intakeFilter: BiquadFilterNode
  private squealGain: GainNode
  private squealFilter: BiquadFilterNode
  private noise: AudioBuffer
  private lastGear = 0
  private lastThrottle = 0
  private nextCrackle = 0
  private volume = 0.5

  constructor() {
    const ctx = (this.ctx = new AudioContext())
    this.noise = noiseBuffer(ctx)

    this.master = ctx.createGain()
    this.master.gain.value = 0
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    this.master.connect(comp).connect(ctx.destination)

    // engine body: two slightly detuned oscillators (the beating between them
    // is the "rasp"), a crank-rate sub, soft-clipped, then a throttle filter
    const shaper = ctx.createWaveShaper()
    shaper.curve = softClip(2.2)
    shaper.oversample = '2x'
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.Q.value = 0.5 // no resonant peak: a swept resonance is the classic synth "wah"
    this.engineGain = ctx.createGain()
    this.cutGain = ctx.createGain()
    const wave = engineWave(ctx)
    this.oscA = ctx.createOscillator()
    this.oscB = ctx.createOscillator()
    this.oscA.setPeriodicWave(wave)
    this.oscB.setPeriodicWave(wave)
    this.oscB.detune.value = 9
    this.sub = ctx.createOscillator()
    this.sub.type = 'triangle'
    const subGain = ctx.createGain()
    subGain.gain.value = 0.35
    const mix = ctx.createGain()
    mix.gain.value = 0.38
    this.oscA.connect(mix)
    this.oscB.connect(mix)
    this.sub.connect(subGain).connect(mix)
    mix.connect(shaper).connect(this.filter).connect(this.engineGain).connect(this.cutGain).connect(this.master)

    // combustion: noise chopped into pulses by the engine wave itself, so each
    // firing is a burst of air rather than a pure tone
    const combustion = ctx.createBufferSource()
    combustion.buffer = this.noise
    combustion.loop = true
    const pulse = ctx.createGain()
    pulse.gain.value = 0
    this.oscA.connect(pulse.gain)
    const combustionLevel = ctx.createGain()
    combustionLevel.gain.value = 0.55
    combustion.connect(pulse).connect(combustionLevel).connect(shaper)

    // the revs are never perfectly steady: slow random wobble on the pitch
    const wobble = ctx.createBufferSource()
    wobble.buffer = this.noise
    wobble.loop = true
    wobble.playbackRate.value = 0.02
    const wobbleFilter = ctx.createBiquadFilter()
    wobbleFilter.type = 'lowpass'
    wobbleFilter.frequency.value = 12
    const wobbleDepth = ctx.createGain()
    wobbleDepth.gain.value = 18 // cents
    wobble.connect(wobbleFilter).connect(wobbleDepth)
    wobbleDepth.connect(this.oscA.detune)
    wobbleDepth.connect(this.oscB.detune)

    // intake / exhaust roar: band-passed noise that opens with throttle
    const intake = ctx.createBufferSource()
    intake.buffer = this.noise
    intake.loop = true
    this.intakeFilter = ctx.createBiquadFilter()
    this.intakeFilter.type = 'bandpass'
    this.intakeFilter.Q.value = 0.8
    this.intakeGain = ctx.createGain()
    this.intakeGain.gain.value = 0
    intake.connect(this.intakeFilter).connect(this.intakeGain).connect(this.cutGain)

    // turbo whistle: rises with rpm under load
    this.turbo = ctx.createOscillator()
    this.turbo.type = 'sine'
    this.turboGain = ctx.createGain()
    this.turboGain.gain.value = 0
    this.turbo.connect(this.turboGain).connect(this.master)

    // tyre squeal: narrow noise band, only on lock-up or wheelspin
    const squeal = ctx.createBufferSource()
    squeal.buffer = this.noise
    squeal.loop = true
    this.squealFilter = ctx.createBiquadFilter()
    this.squealFilter.type = 'bandpass'
    this.squealFilter.frequency.value = 1700
    this.squealFilter.Q.value = 9
    this.squealGain = ctx.createGain()
    this.squealGain.gain.value = 0
    squeal.connect(this.squealFilter).connect(this.squealGain).connect(this.master)

    for (const src of [this.oscA, this.oscB, this.sub, this.turbo, intake, squeal, combustion, wobble]) src.start()
  }

  // Browsers only allow sound after a click or key press.
  resume() {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolume(v: number) {
    this.volume = clamp01(v)
  }

  update(s: EngineInputs) {
    const t = this.ctx.currentTime
    const k = 0.04 // smoothing time constant (s): state arrives at 20 Hz
    const rpm = Math.min(MAX_RPM, Math.max(IDLE_RPM, s.rpm))
    const r = (rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM) // 0 idle .. 1 limiter
    const thr = clamp01(s.throttle)

    this.master.gain.setTargetAtTime(s.live ? this.volume : 0, t, 0.15)

    const cam = rpm / 120
    this.oscA.frequency.setTargetAtTime(cam, t, k)
    this.oscB.frequency.setTargetAtTime(cam, t, k)
    this.sub.frequency.setTargetAtTime(rpm / 60 / 2, t, k)

    // on throttle the engine is loud and bright; off throttle it drops to a
    // muffled overrun burble
    this.engineGain.gain.setTargetAtTime(0.25 + 0.55 * thr + 0.2 * r, t, 0.03)
    this.filter.frequency.setTargetAtTime(500 + 900 * r + 4200 * thr * (0.5 + r), t, 0.03)
    this.intakeFilter.frequency.setTargetAtTime(600 + 2400 * r, t, k)
    this.intakeGain.gain.setTargetAtTime(0.16 * thr * (0.3 + r), t, 0.05)

    this.turbo.frequency.setTargetAtTime(2200 + 5200 * r, t, 0.12)
    this.turboGain.gain.setTargetAtTime(0.007 * thr * r, t, 0.2)

    // upshift: ~45 ms ignition cut, the "brap" between gears
    if (s.gear > this.lastGear && this.lastGear > 0) {
      this.cutGain.gain.cancelScheduledValues(t)
      this.cutGain.gain.setValueAtTime(1, t)
      this.cutGain.gain.linearRampToValueAtTime(0.15, t + 0.012)
      this.cutGain.gain.linearRampToValueAtTime(1, t + 0.06)
    }
    this.lastGear = s.gear

    // overrun crackle: a few pops after lifting at high rpm
    const lifted = this.lastThrottle - thr > 0.4
    if (lifted && r > 0.45) this.nextCrackle = t
    if (thr < 0.1 && r > 0.35 && t >= this.nextCrackle && this.nextCrackle > 0) {
      this.crackle(t)
      this.nextCrackle = t + 0.05 + Math.random() * 0.18
    }
    if (thr > 0.3 || r < 0.3) this.nextCrackle = 0
    this.lastThrottle = thr

    const slip = s.lockup || s.wheelspin
    const fast = Math.abs(s.speed) > 5
    this.squealGain.gain.setTargetAtTime(slip && fast ? 0.12 : 0, t, 0.04)
    this.squealFilter.frequency.setTargetAtTime(s.lockup ? 1500 : 1900, t, 0.1)
  }

  private crackle(t: number) {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 500 + Math.random() * 900
    f.Q.value = 2
    const g = this.ctx.createGain()
    const peak = 0.25 + Math.random() * 0.25
    g.gain.setValueAtTime(peak, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03 + Math.random() * 0.04)
    src.connect(f).connect(g).connect(this.master)
    src.start(t, Math.random() * 1.5, 0.08)
  }

  close() {
    void this.ctx.close()
  }
}
