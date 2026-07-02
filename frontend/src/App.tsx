import { useCallback, useState } from 'react'
import { ConsultationPage } from './pages/ConsultationPage'
import { HomePage } from './pages/HomePage'
import { clearIdentity, loadIdentity, saveIdentity, type StoredIdentity } from './lib/identity'

function App() {
  const [identity, setIdentity] = useState<StoredIdentity | null>(() => loadIdentity())

  const handleEnter = useCallback((next: StoredIdentity) => {
    saveIdentity(next)
    setIdentity(next)
  }, [])

  const handleLeave = useCallback(() => {
    clearIdentity()
    setIdentity(null)
  }, [])

  if (!identity) {
    return <HomePage onEnter={handleEnter} />
  }

  return <ConsultationPage identity={identity} onLeave={handleLeave} />
}

export default App
