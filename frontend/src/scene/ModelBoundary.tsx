import { Component, type ReactNode } from 'react'

// If the optional car model is missing (fresh clone: public/models/car.glb is
// not committed) or fails to load, render the built-in car instead of crashing.
export class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
