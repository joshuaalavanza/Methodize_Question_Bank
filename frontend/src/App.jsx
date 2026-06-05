import { useState, useEffect } from 'react'
import * as api from './api'
import FilterSidebar from './components/FilterSidebar'
import QuestionCard from './components/QuestionCard'
import AuthModal from './components/AuthModal'
import ProgressModal from './components/ProgressModal'
import Dashboard from './components/Dashboard'
import DropInModal from './components/DropInModal'
import styles from './App.module.css'

const MATH_DOMAINS    = ['Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry']
const ENGLISH_DOMAINS = ['Craft and Structure', 'Standard English Conventions', 'Expression of Ideas', 'Information and Ideas']

export default function App() {
  // ── auth ──────────────────────────────────────────────────────────────────
  const [user, setUser]           = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [showProgress, setShowProgress]   = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)
  const [showDropIn, setShowDropIn]       = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('quarry_token')
    if (!token) { setAuthReady(true); return }
    api.getMe()
      .then(data => {
        setUser({ userId: data.user_id, username: data.username, is_admin: data.is_admin ?? false })
        return api.getProgress()
      })
      .then(history => {
        setAllAttempts(history.map(a => ({
          questionId: a.question_id,
          skill:      a.skill,
          isCorrect:  a.is_correct,
        })))
      })
      .catch(() => localStorage.removeItem('quarry_token'))
      .finally(() => setAuthReady(true))
  }, [])

  function handleLogin(userData) {
    setUser(userData)   // userData now includes is_admin
    // Load existing attempt history from DB
    api.getProgress().then(history => {
      setAllAttempts(history.map(a => ({
        questionId: a.question_id,
        skill:      a.skill,
        isCorrect:  a.is_correct,
      })))
    })
  }

  function handleLogout() {
    localStorage.removeItem('quarry_token')
    setUser(null)
    setAllAttempts([])
    setSessionAttempts([])
  }

  // ── filters ───────────────────────────────────────────────────────────────
  const [filters, setFilters]           = useState({ domains: [], skills: [], skills_by_domain: {}, difficulties: [] })
  const [subject, setSubject]           = useState('')
  const [domain, setDomain]             = useState('')
  const [skill, setSkill]               = useState('')
  const [difficulty, setDifficulty]     = useState('')
  const [progressFilter, setProgressFilter] = useState('')  // '' | 'hide-done' | 'done-only'

  const subjectDomains = subject === 'Math'    ? MATH_DOMAINS
                       : subject === 'English' ? ENGLISH_DOMAINS
                       : null

  useEffect(() => { api.getFilters().then(setFilters) }, [])

  useEffect(() => {
    setLoadingQ(true)
    setExpandedId(null)
    const domainParam = domain || (subjectDomains?.length === 1 ? subjectDomains[0] : null)
    const domainList  = subjectDomains && !domain ? subjectDomains : null
    api.getQuestions(domainParam, skill, difficulty, domainList)
      .then(setQuestions)
      .finally(() => setLoadingQ(false))
  }, [subject, domain, skill, difficulty])

  function handleSubjectChange(v) {
    setSubject(prev => prev === v ? '' : v)
    setDomain(''); setSkill(''); setExpandedId(null)
  }
  function handleDomainChange(v) { setDomain(v); setSkill(''); setExpandedId(null) }

  // ── questions ─────────────────────────────────────────────────────────────
  const [questions, setQuestions]   = useState([])
  const [loadingQ, setLoadingQ]     = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [detailMap, setDetailMap]   = useState({})
  const [similarMap, setSimilarMap] = useState({})
  const [loadingSim, setLoadingSim] = useState(null)

  function toggle(id) {
    setExpandedId(prev => {
      if (prev === id) return null
      if (!detailMap[id]) {
        api.getQuestion(id).then(detail => setDetailMap(p => ({ ...p, [id]: detail })))
      }
      return id
    })
  }
  function loadSimilar(id) {
    if (similarMap[id]) return
    setLoadingSim(id)
    api.getSimilar(id)
      .then(r => setSimilarMap(p => ({ ...p, [id]: r })))
      .finally(() => setLoadingSim(null))
  }

  // ── attempts ─────────────────────────────────────────────────────────────
  // allAttempts: full history loaded from DB on login + anything answered this session
  // sessionAttempts: only what's been answered since the page loaded
  const [allAttempts, setAllAttempts]         = useState([])
  const [sessionAttempts, setSessionAttempts] = useState([])

  const attempts = allAttempts
  const doneIds  = new Set(allAttempts.map(a => a.questionId))
  const displayedQuestions = progressFilter === 'hide-done'
    ? questions.filter(q => !doneIds.has(q.id))
    : progressFilter === 'done-only'
      ? questions.filter(q => doneIds.has(q.id))
      : questions

  function handleAnswer(questionId, questionSkill, questionDomain, isCorrect, chosenAnswer) {
    if (allAttempts.some(a => a.questionId === questionId)) return
    const entry = { questionId, skill: questionSkill, isCorrect }
    setAllAttempts(prev => [...prev, entry])
    setSessionAttempts(prev => [...prev, entry])
    if (user) {
      api.saveAttempt({
        question_id:   questionId,
        skill:         questionSkill,
        domain:        questionDomain,
        is_correct:    isCorrect,
        chosen_answer: chosenAnswer ?? null,
      }).catch(() => {})
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  if (!authReady) return null   // brief flash while token is checked

  return (
    <div className={styles.app}>
      {!user && <AuthModal onLogin={handleLogin} />}
      {showProgress && <ProgressModal onClose={() => setShowProgress(false)} />}
      {showDropIn   && <DropInModal   onClose={() => setShowDropIn(false)} />}

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <h1>Quarry</h1>
          <span className={styles.subtitle}>SAT · Hard</span>
        </div>
        {user && (
          <div className={styles.userRow}>
            <button className={styles.dropInBtn} onClick={() => setShowDropIn(true)}>
              Drop in a question
            </button>
            <span className={styles.userName}>{user.username}</span>
            {user.is_admin && (
              <button
                className={`${styles.progressBtn} ${showDashboard ? styles.progressBtnActive : ''}`}
                onClick={() => setShowDashboard(v => !v)}
              >
                {showDashboard ? '← Practice' : 'Dashboard'}
              </button>
            )}
            <button className={styles.progressBtn} onClick={() => setShowProgress(true)}>Progress</button>
            <button className={styles.logoutBtn} onClick={handleLogout}>Log out</button>
          </div>
        )}
      </header>

      {showDashboard ? (
        <Dashboard />
      ) : (
      <div className={styles.layout}>
        <FilterSidebar
          filters={filters}
          subject={subject}
          subjectDomains={subjectDomains}
          domain={domain}
          skill={skill}
          difficulty={difficulty}
          onSubjectChange={handleSubjectChange}
          onDomainChange={handleDomainChange}
          onSkillChange={v => { setSkill(v); setExpandedId(null) }}
          onDifficultyChange={v => { setDifficulty(v); setExpandedId(null) }}
          progressFilter={progressFilter}
          onProgressFilterChange={setProgressFilter}
          sessionAttempts={sessionAttempts}
          allAttempts={allAttempts}
          onResetSession={() => setSessionAttempts([])}
        />

        <main className={styles.main}>
          <p className={styles.count}>
            {loadingQ ? 'Loading…' : `${displayedQuestions.length} question${displayedQuestions.length !== 1 ? 's' : ''}`}
          </p>
          {!loadingQ && displayedQuestions.map(q => (
            <QuestionCard
              key={q.id}
              summary={q}
              detail={detailMap[q.id] ?? null}
              expanded={expandedId === q.id}
              similar={similarMap[q.id] ?? null}
              loadingSimilar={loadingSim === q.id}
              onToggle={() => toggle(q.id)}
              onMoreLikeThis={() => loadSimilar(q.id)}
              onAnswer={(isCorrect, chosenAnswer) => handleAnswer(q.id, q.skill, q.domain, isCorrect, chosenAnswer)}
              alreadyAnswered={attempts.some(a => a.questionId === q.id)}
              onSimilarAnswer={handleAnswer}
              doneIds={doneIds}
            />
          ))}
        </main>
      </div>
      )}
    </div>
  )
}
