import './PlaceholderScreen.css'

export function PlaceholderScreen({ title }: { title: string }) {
  return (
    <div className="placeholder-screen">
      <h1>{title}</h1>
      <p>Not built yet.</p>
    </div>
  )
}
