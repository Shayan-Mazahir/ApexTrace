import './App.css'
import { ActiveSessionProvider } from './app/ActiveSessionContext'
import { DemoProvider } from './app/DemoContext'
import { ErrorProvider } from './app/ErrorContext'
import { GarageProvider } from './app/GarageContext'
import { ScreenProvider, useScreen } from './app/ScreenContext'
import { ScreenNav } from './app/ScreenNav'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ErrorBanner } from './components/ErrorBanner'
import { DemoController } from './demo/DemoController'
import { CompareScreen } from './screens/CompareScreen'
import { DriveScreen } from './screens/DriveScreen'
import { EngineerScreen } from './screens/EngineerScreen'
import { GarageScreen } from './screens/GarageScreen'

function CurrentScreen() {
  const { screen } = useScreen()
  switch (screen) {
    case 'drive':
      return <DriveScreen />
    case 'engineer':
      return <EngineerScreen />
    case 'garage':
      return <GarageScreen />
    case 'compare':
      return <CompareScreen />
  }
}

function AppShell() {
  return (
    <div id="app-root">
      <ErrorBanner />
      <ScreenNav />
      <div id="connection-status-slot">
        <ConnectionStatus />
      </div>
      <CurrentScreen />
      <DemoController />
    </div>
  )
}

function App() {
  return (
    <ErrorProvider>
      <ActiveSessionProvider>
        <GarageProvider>
          <ScreenProvider>
            <DemoProvider>
              <AppShell />
            </DemoProvider>
          </ScreenProvider>
        </GarageProvider>
      </ActiveSessionProvider>
    </ErrorProvider>
  )
}

export default App
