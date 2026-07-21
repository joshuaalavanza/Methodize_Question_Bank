// In local dev both servers run separately (Vite :5173, uvicorn :8000).
// When served via ngrok or production, FastAPI serves the built frontend too,
// so everything is same-origin and we don't append a port.
function _apiBase() {
  const h = window.location.hostname
  const isLocal = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h)
  return isLocal ? `http://${h}:8000` : window.location.origin
}

export const API_BASE = _apiBase()
export const WS_BASE  = API_BASE.replace(/^http/, 'ws') + '/classroom'

const BASE = API_BASE

function authHeaders() {
  const token = localStorage.getItem('quarry_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: authHeaders() })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `${res.status}`
    try { const j = await res.json(); detail = j.detail || detail } catch {}
    throw new Error(detail)
  }
  return res.json()
}

// Returns the raw Response so the caller can read the stream
export const explainQuestion = (body) =>
  fetch(BASE + '/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })

export const login           = (username)  => post('/auth/login', { username })
export const getMe           = ()           => get('/auth/me')
export const getProgress     = ()           => get('/progress/me')
export const saveAttempt     = (attempt)    => post('/attempts', attempt)
export const dropIn          = (body)       => post('/drop-in', body)
export const getDashboard    = ()           => get('/dashboard')
export const getStudentDetail = (userId)   => get(`/dashboard/${userId}`)

export const createClassroomSession = () => post('/classroom/sessions', {})

export const getFilters    = ()           => get('/filters')
export const getQuestions  = (domain, skill, difficulty, domainList) => {
  const params = new URLSearchParams()
  if (domain)     params.set('domain', domain)
  if (skill)      params.set('skill', skill)
  if (difficulty) params.set('difficulty', difficulty)
  // domainList: filter to multiple domains (subject-level filtering)
  if (domainList) domainList.forEach(d => params.append('domains', d))
  const qs = params.toString()
  return get('/questions' + (qs ? '?' + qs : ''))
}
export const getQuestion   = (id)         => get(`/questions/${id}`)
export const getSimilar    = (id)         => get(`/questions/${id}/similar`)
