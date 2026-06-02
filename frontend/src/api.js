const BASE = 'http://localhost:8000'

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
