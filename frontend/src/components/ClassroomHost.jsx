import { useState, useEffect, useRef } from 'react'
import * as api from '../api'
import { WS_BASE, API_BASE } from '../api'
import styles from './ClassroomHost.module.css'

const IMG_BASE  = `${API_BASE}/images`
const IMG_VER   = '4'
const LABELS        = ['A', 'B', 'C', 'D']
const COLORS        = ['#e74c3c', '#2980b9', '#f39c12', '#27ae60']  // kept for legacy use
const CORRECT_COLOR = '#27ae60'
const WRONG_COLOR   = '#c0392b'

const MATH_DOMAINS    = ['Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry']
const ENGLISH_DOMAINS = ['Craft and Structure', 'Standard English Conventions', 'Expression of Ideas', 'Information and Ideas']

export default function ClassroomHost({ onClose }) {
  // ── Session setup ────────────────────────────────────────────────────────
  const [session,  setSession]  = useState(null)   // {session_id, join_url, qr_b64}
  const [creating, setCreating] = useState(false)

  // ── WS state ─────────────────────────────────────────────────────────────
  const [hostPhase,  setHostPhase]  = useState('waiting')   // waiting|question|revealed
  const [students,   setStudents]   = useState([])           // [{id,name,score}]
  const [question,   setQuestion]   = useState(null)
  const [breakdown,   setBreakdown]  = useState(null)         // {A:n, B:n, C:n, D:n}
  const [sprResults,  setSprResults] = useState(null)         // [{name, answer, is_correct}]
  const [ansCount,    setAnsCount]   = useState({ done: 0, total: 0 })
  const [leaderboard, setLeaderboard] = useState(null)
  const [timeLeft,   setTimeLeft]   = useState(null)
  const wsRef    = useRef(null)
  const timerRef = useRef(null)

  // ── Question browser ──────────────────────────────────────────────────────
  const [filters,    setFilters]    = useState({ domains: [], skills: [], skills_by_domain: {}, difficulties: [] })
  const [subject,    setSubject]    = useState('')
  const [domain,     setDomain]     = useState('')
  const [skill,      setSkill]      = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [questions,  setQuestions]  = useState([])
  const [loadingQ,   setLoadingQ]   = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const subjectDomains = subject === 'Math'    ? MATH_DOMAINS
                       : subject === 'English' ? ENGLISH_DOMAINS
                       : null

  // ── Question preview ──────────────────────────────────────────────────────
  const [previewId,     setPreviewId]     = useState(null)
  const [previewCache,  setPreviewCache]  = useState({})   // id → detail object
  const [previewLoading, setPreviewLoading] = useState(false)

  function togglePreview(qid) {
    if (previewId === qid) { setPreviewId(null); return }
    setPreviewId(qid)
    if (previewCache[qid]) return
    setPreviewLoading(true)
    api.getQuestion(qid)
      .then(detail => setPreviewCache(c => ({ ...c, [qid]: detail })))
      .finally(() => setPreviewLoading(false))
  }

  useEffect(() => { api.getFilters().then(setFilters) }, [])
  useEffect(() => {
    setLoadingQ(true)
    setSearchQuery('')
    const domainParam = domain || null
    const domainList  = subjectDomains && !domain ? subjectDomains : null
    api.getQuestions(domainParam, skill || null, difficulty || null, domainList)
      .then(setQuestions)
      .finally(() => setLoadingQ(false))
  }, [subject, domain, skill, difficulty])

  const needle = searchQuery.trim().toLowerCase()
  const displayedQuestions = needle
    ? questions.filter(q => q.question_text.toLowerCase().includes(needle))
    : questions

  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }
  function startTimer(limit) {
    clearTimer()
    setTimeLeft(limit)
    const end = Date.now() + limit * 1000
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setTimeLeft(left)
      if (left === 0) clearTimer()
    }, 250)
  }

  useEffect(() => () => { wsRef.current?.close(); clearTimer() }, [])

  async function startSession() {
    setCreating(true)
    try {
      const sess = await api.createClassroomSession()
      setSession(sess)
      openHostWs(sess.session_id)
    } catch (err) {
      alert('Could not create session: ' + err.message)
    } finally {
      setCreating(false)
    }
  }

  function openHostWs(sessionId) {
    const ws = new WebSocket(`${WS_BASE}/${sessionId}/host`)
    wsRef.current = ws

    ws.onmessage = ({ data: raw }) => {
      const msg = JSON.parse(raw)
      switch (msg.type) {
        case 'connected':
          setStudents(msg.students || [])
          if (msg.phase === 'question' && msg.current_question) {
            setQuestion(msg.current_question)
            setBreakdown(msg.breakdown || { A: 0, B: 0, C: 0, D: 0 })
            setAnsCount({ done: msg.answer_count || 0, total: (msg.students || []).length })
            setHostPhase('question')
            if (msg.time_remaining > 0) startTimer(Math.round(msg.time_remaining))
          } else if (msg.phase === 'revealed' && msg.current_question) {
            setQuestion(msg.current_question)
            if (msg.current_question.question_type === 'spr') {
              setSprResults(msg.spr_results || [])
            } else {
              setBreakdown(msg.breakdown || { A: 0, B: 0, C: 0, D: 0 })
            }
            setLeaderboard(msg.leaderboard || null)
            setHostPhase('revealed')
          } else if (msg.phase === 'ended') {
            setHostPhase('ended')
          }
          break
        case 'student_joined':
          setStudents(prev => [...prev.filter(s => s.id !== msg.student_id),
                               { id: msg.student_id, name: msg.name, score: 0 }])
          break
        case 'student_left':
          setStudents(prev => prev.filter(s => s.id !== msg.student_id))
          break
        case 'question_pushed':
          clearTimer()
          setQuestion(msg.question)
          setBreakdown({ A: 0, B: 0, C: 0, D: 0 })
          setSprResults(null)
          setAnsCount({ done: 0, total: 0 })
          setLeaderboard(null)
          setHostPhase('question')
          startTimer(msg.time_limit)
          break
        case 'answer_in':
          setBreakdown(msg.breakdown)
          setAnsCount({ done: msg.count, total: msg.total })
          break
        case 'revealed':
          clearTimer()
          if (msg.question_type === 'spr') {
            setSprResults(msg.spr_results || [])
          } else {
            setBreakdown(msg.breakdown)
          }
          setLeaderboard(msg.leaderboard)
          setHostPhase('revealed')
          break
        case 'leaderboard':
          setLeaderboard(msg.scores)
          break
        case 'ended':
          clearTimer()
          setHostPhase('ended')
          break
        default:
          break
      }
    }
    ws.onerror = () => alert('WebSocket error — try refreshing.')
  }

  function sendToHost(msg) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  function pushQuestion(qid) {
    sendToHost({ type: 'push_question', question_id: qid })
  }

  // ── Render: pre-session ───────────────────────────────────────────────────
  if (!session) return (
    <div className={styles.overlay}>
      <div className={styles.setupCard}>
        <button className={styles.closeBtn} onClick={onClose}>✕</button>
        <h2>Start a Classroom Session</h2>
        <p>Students scan a QR code to join from their phones. You control the pace — push questions one at a time and reveal answers when ready.</p>
        <button className={styles.startBtn} onClick={startSession} disabled={creating}>
          {creating ? 'Creating…' : 'Create Session'}
        </button>
      </div>
    </div>
  )

  // ── Render: live session ──────────────────────────────────────────────────
  const maxCount = breakdown ? Math.max(1, ...Object.values(breakdown)) : 1
  const skillOptions = domain && filters.skills_by_domain[domain]
    ? filters.skills_by_domain[domain]
    : filters.skills

  return (
    <div className={styles.overlay}>
      <div className={styles.hostLayout}>

        {/* ── Left: question browser ───────────────────────────────────── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>Question Bank</span>
            <button className={styles.closeBtn} onClick={onClose}>✕</button>
          </div>

          <div className={styles.subjectRow}>
            {['Math', 'English'].map(s => (
              <button
                key={s}
                className={`${styles.subjectBtn} ${subject === s ? styles.subjectBtnActive : ''}`}
                onClick={() => { setSubject(prev => prev === s ? '' : s); setDomain(''); setSkill('') }}
              >{s}</button>
            ))}
          </div>

          <div className={styles.filterRow}>
            <select value={domain} onChange={e => { setDomain(e.target.value); setSkill('') }} className={styles.sel}>
              <option value="">All domains</option>
              {(subjectDomains || filters.domains).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={skill} onChange={e => setSkill(e.target.value)} className={styles.sel}>
              <option value="">All skills</option>
              {skillOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={difficulty} onChange={e => setDifficulty(e.target.value)} className={styles.sel}>
              <option value="">All difficulties</option>
              {filters.difficulties.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search questions…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className={styles.qList}>
            {loadingQ && <p className={styles.loading}>Loading…</p>}
            {!loadingQ && displayedQuestions.length === 0 && <p className={styles.loading}>No questions found.</p>}
            {!loadingQ && displayedQuestions.map(q => (
              <div
                key={q.id}
                className={`${styles.qRow} ${question?.id === q.id ? styles.qRowActive : ''} ${previewId === q.id ? styles.qRowSelected : ''}`}
                onClick={() => togglePreview(q.id)}
              >
                <div className={styles.qRowMeta}>
                  <span className={styles.qRowSkill}>{q.skill}</span>
                  <span className={`${styles.qRowDiff} ${styles['diff' + q.difficulty]}`}>{q.difficulty}</span>
                </div>
                <p className={styles.qRowText}>{q.question_text.slice(0, 90)}{q.question_text.length > 90 ? '…' : ''}</p>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Right: session panel ─────────────────────────────────────── */}
        <main className={styles.panel}>

          {/* QR + roster always visible at top */}
          <div className={styles.panelTop}>
            <div className={styles.qrBlock}>
              <img src={`data:image/png;base64,${session.qr_b64}`} alt="QR" className={styles.qr} />
              <div className={styles.qrInfo}>
                <p className={styles.qrLabel}>Join at</p>
                <p className={styles.qrUrl}>{session.join_url}</p>
                <p className={styles.qrCount}>
                  <strong>{students.length}</strong> student{students.length !== 1 ? 's' : ''} joined
                </p>
              </div>
            </div>
            {students.length > 0 && (
              <div className={styles.rosterChips}>
                {students.map(s => (
                  <span key={s.id} className={styles.chip}>{s.name}</span>
                ))}
              </div>
            )}
          </div>

          {/* ── Waiting / preview ─────────────────────────────────────── */}
          {hostPhase === 'waiting' && !previewId && (
            <div className={styles.waitHint}>
              <p>Select a question from the bank to preview it.</p>
            </div>
          )}

          {hostPhase === 'waiting' && previewId && (() => {
            const detail = previewCache[previewId]
            return (
              <div className={styles.liveBlock}>
                <div className={styles.liveHeader}>
                  {detail
                    ? <span className={styles.liveSkill}>{detail.skill} · {detail.difficulty}</span>
                    : <span className={styles.liveSkill}>Loading preview…</span>
                  }
                  <span className={styles.previewBadge}>Preview</span>
                </div>

                {!detail && <div className={styles.previewSpinner}>Loading…</div>}

                {detail && (
                  <>
                    {detail.image_url ? (
                      <img src={detail.image_url} alt="Question" className={styles.questionImg} />
                    ) : (
                      <p className={styles.liveQText}>{detail.question_text}</p>
                    )}

                    <div className={styles.previewChoiceList}>
                      {detail.choices.map((c, i) => (
                        <div key={i} className={styles.previewChoiceRow} style={{ borderLeftColor: COLORS[i] }}>
                          <span className={styles.previewChoiceLetter} style={{ color: COLORS[i] }}>{LABELS[i]}</span>
                          <span className={styles.previewChoiceText}>{c.replace(/^[A-D]\)\s*/, '')}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      className={styles.pushLargeBtn}
                      onClick={() => pushQuestion(previewId)}
                    >
                      Push to Students →
                    </button>
                  </>
                )}
              </div>
            )
          })()}

          {/* ── Question live ─────────────────────────────────────────── */}
          {hostPhase === 'question' && question && (
            <div className={styles.liveBlock}>
              <div className={styles.liveHeader}>
                <span className={styles.liveSkill}>{question.skill} · {question.difficulty}</span>
                <span className={styles.liveTimer}>{timeLeft ?? '–'}s</span>
              </div>
              {question.image_path ? (
                <img
                  src={`${IMG_BASE}/${question.image_path}?v=${IMG_VER}`}
                  alt="Question"
                  className={styles.questionImg}
                />
              ) : (
                <p className={styles.liveQText}>{question.question_text.slice(0, 300)}{question.question_text.length > 300 ? '…' : ''}</p>
              )}

              {question.question_type === 'spr' ? (
                <p className={styles.sprHint}>Free response — students type their answer</p>
              ) : (
                <div className={styles.bars}>
                  {LABELS.map((label, i) => {
                    const choiceText = (question.choices[i] || '').replace(/^[A-D]\)\s*/, '')
                    return (
                      <div key={label} className={styles.barRow}>
                        <span className={styles.barLabel}>{label}</span>
                        <div className={styles.barTrack}>
                          <span className={styles.barText}>{choiceText}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              <p className={styles.ansStatus}>
                {ansCount.done} / {ansCount.total} answered
              </p>
              <button className={styles.revealBtn} onClick={() => sendToHost({ type: 'reveal' })}>
                Reveal Answer
              </button>
            </div>
          )}

          {/* ── Revealed ─────────────────────────────────────────────── */}
          {hostPhase === 'revealed' && question && (
            <div className={styles.liveBlock}>
              <p className={styles.revealLabel}>
                Correct answer: <strong style={{ color: CORRECT_COLOR }}>
                  {question.correct_answer}
                </strong>
              </p>

              {question.image_path && (
                <img
                  src={`${IMG_BASE}/${question.image_path}?v=${IMG_VER}`}
                  alt="Question"
                  className={styles.questionImg}
                />
              )}

              {question.question_type === 'spr' ? (
                <div className={styles.sprResultList}>
                  {(sprResults || []).map((r, i) => (
                    <div key={i} className={`${styles.sprResultRow} ${r.is_correct ? styles.sprCorrect : styles.sprWrong}`}>
                      <span className={styles.sprResultName}>{r.name}</span>
                      <span className={styles.sprResultAnswer}>{r.answer ?? <em>no answer</em>}</span>
                      <span className={styles.sprResultMark}>{r.is_correct ? '✓' : '✗'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.bars}>
                  {LABELS.map((label, i) => {
                    const count      = breakdown?.[label] ?? 0
                    const pct        = Math.round(count / maxCount * 100)
                    const isCorrect  = label === question.correct_answer
                    const color      = isCorrect ? CORRECT_COLOR : WRONG_COLOR
                    const choiceText = (question.choices[i] || '').replace(/^[A-D]\)\s*/, '')
                    return (
                      <div key={label} className={styles.barRow}>
                        <span className={styles.barLabel} style={{ color }}>{label}</span>
                        <div className={styles.barTrack}>
                          <div className={styles.barFill} style={{ width: `${pct}%`, background: color }} />
                          <span className={styles.barText}>{choiceText}</span>
                        </div>
                        <span className={styles.barCount} style={{ color }}>{count}{isCorrect ? ' ✓' : ''}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className={styles.revealActions}>
                <button className={styles.boardBtn} onClick={() => sendToHost({ type: 'leaderboard' })}>
                  Show Leaderboard
                </button>
                <button className={styles.nextBtn} onClick={() => {
                  setHostPhase('waiting')
                  setQuestion(null)
                  setBreakdown(null)
                  setLeaderboard(null)
                }}>
                  Next Question
                </button>
              </div>

              {leaderboard && (
                <div className={styles.miniBoard}>
                  <h4>Top students</h4>
                  {leaderboard.slice(0, 5).map((s, i) => (
                    <div key={s.id} className={styles.miniBoardRow}>
                      <span className={styles.miniBoardRank}>{i + 1}</span>
                      <span className={styles.miniBoardName}>{s.name}</span>
                      <span className={styles.miniBoardScore}>{s.score}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Ended ─────────────────────────────────────────────────── */}
          {hostPhase === 'ended' && (
            <div className={styles.waitHint}>
              <p>Session ended. Thanks for using Methodize Classroom!</p>
              <button className={styles.startBtn} onClick={onClose}>Close</button>
            </div>
          )}

          {hostPhase !== 'ended' && (
            <button className={styles.endBtn} onClick={() => {
              if (confirm('End the session for all students?')) sendToHost({ type: 'end' })
            }}>
              End Session
            </button>
          )}
        </main>
      </div>
    </div>
  )
}
