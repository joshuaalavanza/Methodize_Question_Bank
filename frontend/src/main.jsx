import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import StudentJoin from './pages/StudentJoin.jsx'

// Route /join/:sessionId to the student view; everything else is the main app
const joinMatch = window.location.pathname.match(/^\/join\/([^/]+)$/)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {joinMatch
      ? <StudentJoin sessionId={joinMatch[1]} />
      : <App />
    }
  </StrictMode>,
)
