import './BrakeWarning.css'

export function BrakeWarning({ active }: { active: boolean }) {
  if (!active) return null
  return (
    <div className="brake-warning" role="alert">
      BRAKE
    </div>
  )
}
