import type { TcnStatus, VehicleStateMessage } from '../types/schemas'
import './TcnPanel.css'

interface TcnPanelProps {
  status: TcnStatus | null
  vehicleState: VehicleStateMessage | null
}

// Observer only: shows what the trained TCN predicts from the observed
// telemetry. It never triggers warnings.
export function TcnPanel({ status, vehicleState: v }: TcnPanelProps) {
  if (!status) return <p className="tcn-panel__muted">Join a session to see the model status.</p>
  if (!status.available) return <p className="tcn-panel__muted">TCN unavailable: {status.reason}</p>
  const risk = v?.tcn_risk ?? null
  const pct = risk === null ? null : Math.round(risk * 100)
  const tone = risk === null ? '' : risk > 0.5 ? 'high' : risk > 0.15 ? 'mid' : 'low'
  return (
    <div className="tcn-panel">
      <div className="tcn-panel__gauge">
        <div className={`tcn-panel__fill tcn-panel__fill--${tone}`} style={{ width: `${pct ?? 0}%` }} />
        <span>
          {pct === null ? 'warming up (needs 2.5 s of telemetry)' : `exit risk next ${status.horizon_s} s: ${pct}%`}
        </span>
      </div>
      <dl>
        <dt>Predicted min clearance</dt>
        <dd>{v?.tcn_clearance == null ? '—' : `${v.tcn_clearance.toFixed(2)} m`}</dd>
        <dt>Actual clearance (evaluator)</dt>
        <dd>{v ? `${v.signed_clearance.toFixed(2)} m` : '—'}</dd>
        <dt>Seed disagreement</dt>
        <dd>{v?.tcn_spread == null ? '—' : `±${(v.tcn_spread * 100).toFixed(1)} pts`}</dd>
        <dt>Held-out test</dt>
        <dd>
          PR-AUC {status.test_pr_auc} · Brier {status.test_brier} · MAE {status.test_clearance_mae_m} m
        </dd>
      </dl>
      <p className="tcn-panel__muted">
        {status.ensemble_size}-seed causal TCN on {status.window_s} s of observed telemetry. {status.role}. Probabilities
        come from a toy simulator with a scripted driver.
      </p>
    </div>
  )
}
