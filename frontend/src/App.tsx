import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ConsultationPage } from './pages/ConsultationPage'
import { HomePage } from './pages/HomePage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/consultation/:sessionId" element={<ConsultationPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
