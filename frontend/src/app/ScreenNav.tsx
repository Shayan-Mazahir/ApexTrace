import { SCREENS, useScreen } from './ScreenContext'
import './ScreenNav.css'

const LABEL: Record<string, string> = {
  home: 'Home',
  drive: 'Drive',
  engineer: 'Engineer',
  garage: 'Garage',
  compare: 'Compare',
}

export function ScreenNav() {
  const { screen, setScreen } = useScreen()

  return (
    <nav className="screen-nav">
      {SCREENS.map((s) => (
        <button
          key={s}
          type="button"
          className={`screen-nav__button ${s === screen ? 'screen-nav__button--active' : ''}`}
          onClick={() => setScreen(s)}
        >
          {LABEL[s]}
        </button>
      ))}
    </nav>
  )
}
