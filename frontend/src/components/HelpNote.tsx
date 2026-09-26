import type { ReactNode } from 'react'
import './HelpNote.css'

/** Collapsible plain-language explainer, open by default for first-time users. */
export function HelpNote({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="help-note" open={open}>
      <summary>{title}</summary>
      <div className="help-note__body">{children}</div>
    </details>
  )
}
