import { useState, useEffect, useRef } from 'react'
import styles from './StudentJoin.module.css'
import { WS_BASE } from '../api'
const LABELS  = ['A', 'B', 'C', 'D']
const COLORS  = ['#e74c3c', '#2980b9', '#f39c12', '#27ae60']

const STORAGE_KEY = (sid) => `quarry_sid_${sid}`
const MAX_RETRIES = 6

export default function StudentJoin({ sessionId }) {
  const storedId = sessionStorage.getItem(STORAGE_KEY(sessionId))

  const [phase,     setPhase]   = useState(storedId ? 'reconnecting' : 'join')
  const [name,      setName]    = useState('')
  const [error,     setError]   = useState('')
  const [data,      setData]    = useState({})        // current phase payload
  const [timeLeft,  setTime]    = useState(null)
  const [sprAnswer, setSprAnswer] = useState('')
  const wsRef      = useRef(null)
  const timerRef   = useRef(null)
  const retryRef   = useRef(0)
  const intentional = useRef(false)   // true when we close on purpose (ended / error code)

  function clearTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  function startTimer(limit) {
    clearTimer()
    setTime(limit)
    const end = Date.now() + limit * 1000
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setTime(left)
      if (left === 0) clearTimer()
    }, 250)
  }

  useEffect(() => () => {
    intentional.current = true
    wsRef.current?.close()
    clearTimer()
  }, [])

  // Auto-rejoin on mount if we have a stored student_id (page was reloaded by browser)
  useEffect(() => {
    const sid = sessionStorage.getItem(STORAGE_KEY(sessionId))
    if (sid) openWs({ type: 'rejoin', student_id: sid })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleMessages(ws) {
    ws.onmessage = ({ data: raw }) => {
      const msg = JSON.parse(raw)
      switch (msg.type) {
        case 'joined':
          retryRef.current = 0
          sessionStorage.setItem(STORAGE_KEY(sessionId), msg.student_id)
          setPhase('waiting')
          setData({ name: msg.name })
          break
        case 'rejoined':
          retryRef.current = 0
          setData(d => ({ ...d, name: msg.name, score: msg.score }))
          setPhase('waiting')   // follow-up message from server will override to correct phase
          break
        case 'question':
          clearTimer()
          setSprAnswer('')
          setData({ question: msg.question, timeLimit: msg.time_limit })
          setPhase('question')
          startTimer(msg.time_limit)
          break
        case 'answered':
          clearTimer()
          setData(d => ({ ...d, submitted: msg.answer, ...(msg.question && { question: msg.question }) }))
          setPhase('answered')
          break
        case 'revealed':
          clearTimer()
          setData(msg)
          setPhase('revealed')
          break
        case 'leaderboard':
          setData(msg)
          setPhase('leaderboard')
          break
        case 'ended':
          intentional.current = true
          sessionStorage.removeItem(STORAGE_KEY(sessionId))
          setPhase('ended')
          break
        default:
          break
      }
    }
  }

  function openWs(firstMsg) {
    intentional.current = false
    const ws = new WebSocket(`${WS_BASE}/${sessionId}/student`)
    wsRef.current = ws

    ws.onopen = () => ws.send(JSON.stringify(firstMsg))
    handleMessages(ws)
    ws.onerror = () => { /* onclose fires right after, handle there */ }
    ws.onclose = (e) => {
      if (intentional.current) return
      // Hard errors — don't retry
      if (e.code === 4004) { setError('Session not found. Check the code and try again.'); return }
      if (e.code === 4000) { setError('Connection rejected. Refresh and try again.'); return }
      // 4001 means stored student_id is gone (server restarted) — fall back to the join form
      if (e.code === 4001) { sessionStorage.removeItem(STORAGE_KEY(sessionId)); setPhase('join'); return }

      if (retryRef.current >= MAX_RETRIES) {
        setError('Lost connection. Refresh to rejoin.')
        return
      }

      const delay = Math.min(500 * 2 ** retryRef.current, 8000)
      retryRef.current += 1
      setTimeout(() => {
        if (intentional.current) return
        const storedId = sessionStorage.getItem(STORAGE_KEY(sessionId))
        openWs(storedId
          ? { type: 'rejoin', student_id: storedId }
          : { type: 'join', name: name || 'Student' }
        )
      }, delay)
    }
  }

  function connect(displayName) {
    openWs({ type: 'join', name: displayName })
  }

  function handleJoin(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    connect(trimmed)
  }

  function sendAnswer(label) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'answer', answer: label }))
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (error) return (
    <div className={styles.screen}>
      <div className={styles.errorBox}>
        <p>{error}</p>
        <button className={styles.retryBtn} onClick={() => window.location.reload()}>Refresh</button>
      </div>
    </div>
  )

  if (phase === 'reconnecting') return (
    <div className={styles.screen}>
      <div className={styles.waitCard}>
        <h1 className={styles.brand}>Methodize</h1>
        <p className={styles.waitMsg}>Reconnecting…</p>
        <div className={styles.dots}><span /><span /><span /></div>
      </div>
    </div>
  )

  if (phase === 'join') return (
    <div className={styles.screen}>
      <div className={styles.joinCard}>
        <h1 className={styles.brand}>Methodize</h1>
        <p className={styles.joinSub}>Session <strong>{sessionId}</strong></p>
        <form onSubmit={handleJoin} className={styles.joinForm}>
          <input
            className={styles.nameInput}
            placeholder="Your name"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={30}
            autoFocus
          />
          <button className={styles.joinBtn} type="submit" disabled={!name.trim()}>
            Join
          </button>
        </form>
      </div>
    </div>
  )

  if (phase === 'waiting') return (
    <div className={styles.screen}>
      <div className={styles.waitCard}>
        <h1 className={styles.brand}>Methodize</h1>
        <p className={styles.waitName}>Hi, {data.name}!</p>
        <p className={styles.waitMsg}>Waiting for the teacher to start…</p>
        <div className={styles.dots}>
          <span /><span /><span />
        </div>
      </div>
    </div>
  )

  if (phase === 'question') {
    const { question, timeLimit } = data
    const progress = timeLeft != null ? timeLeft / timeLimit : 1
    const isSpr = question.question_type === 'spr'
    return (
      <div className={styles.screen}>
        <div className={styles.timerBar}>
          <div
            className={styles.timerFill}
            style={{ width: `${progress * 100}%`, background: progress > 0.4 ? '#27ae60' : '#e74c3c' }}
          />
        </div>
        <div className={styles.qMeta}>
          <span className={styles.qSkill}>{question.skill}</span>
          <span className={styles.qTime}>{timeLeft ?? timeLimit}s</span>
        </div>
        <div className={styles.qText}>{question.question_text}</div>
        {isSpr ? (
          <form className={styles.sprForm} onSubmit={e => { e.preventDefault(); if (sprAnswer.trim()) sendAnswer(sprAnswer.trim()) }}>
            <input
              className={styles.sprInput}
              type="text"
              inputMode="decimal"
              placeholder="Enter your answer"
              value={sprAnswer}
              onChange={e => setSprAnswer(e.target.value)}
              autoFocus
            />
            <button className={styles.sprSubmit} type="submit" disabled={!sprAnswer.trim()}>
              Submit
            </button>
          </form>
        ) : (
          <div className={styles.choiceGrid}>
            {question.choices.map((c, i) => (
              <button
                key={i}
                className={styles.choiceBtn}
                style={{ background: COLORS[i] }}
                onClick={() => sendAnswer(LABELS[i])}
              >
                <span className={styles.choiceLetter}>{LABELS[i]}</span>
                <span className={styles.choiceText}>{c.replace(/^[A-D]\)\s*/, '')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (phase === 'answered') {
    const { question, submitted } = data
    const isSpr = question?.question_type === 'spr'
    return (
      <div className={styles.screen}>
        <div className={styles.qMeta}>
          <span className={styles.qSkill}>{question?.skill}</span>
          <span className={styles.waitBadge}>Submitted</span>
        </div>
        <div className={styles.qText}>{question?.question_text}</div>
        {isSpr ? (
          <div className={styles.sprAnswered}>
            <p className={styles.sprAnsweredLabel}>Your answer</p>
            <p className={styles.sprAnsweredValue}>{submitted}</p>
          </div>
        ) : (
          <div className={styles.choiceGrid}>
            {(question?.choices || []).map((c, i) => {
              const isChosen = LABELS[i] === submitted
              return (
                <button
                  key={i}
                  className={styles.choiceBtn}
                  style={{
                    background: COLORS[i],
                    opacity: isChosen ? 1 : 0.35,
                    outline: isChosen ? '3px solid #fff' : 'none',
                    outlineOffset: '2px',
                    cursor: 'default',
                  }}
                  disabled
                >
                  <span className={styles.choiceLetter}>{LABELS[i]}</span>
                  <span className={styles.choiceText}>{c.replace(/^[A-D]\)\s*/, '')}</span>
                </button>
              )
            })}
          </div>
        )}
        <p className={styles.waitMsg} style={{ textAlign: 'center', marginTop: 16 }}>
          Waiting for the teacher to reveal…
        </p>
      </div>
    )
  }

  if (phase === 'revealed') {
    const { correct_answer, your_answer, is_correct, points_earned, total_score } = data
    return (
      <div className={styles.screen}>
        <div className={`${styles.revealCard} ${is_correct ? styles.correct : styles.wrong}`}>
          <div className={styles.revealIcon}>{is_correct ? '✓' : '✗'}</div>
          <p className={styles.revealVerdict}>{is_correct ? 'Correct!' : 'Wrong'}</p>
          {!is_correct && your_answer && (
            <p className={styles.revealSub}>You chose <strong>{your_answer}</strong> · Correct: <strong>{correct_answer}</strong></p>
          )}
          {!is_correct && !your_answer && (
            <p className={styles.revealSub}>You didn't answer · Correct: <strong>{correct_answer}</strong></p>
          )}
          <div className={styles.pts}>+{points_earned} pts</div>
          <div className={styles.total}>Total: {total_score}</div>
        </div>
      </div>
    )
  }

  if (phase === 'leaderboard') {
    const { scores } = data
    return (
      <div className={styles.screen}>
        <div className={styles.boardCard}>
          <h2 className={styles.boardTitle}>Leaderboard</h2>
          <ol className={styles.boardList}>
            {scores.map((s, i) => (
              <li key={s.id} className={`${styles.boardRow} ${i === 0 ? styles.first : ''}`}>
                <span className={styles.boardRank}>{i + 1}</span>
                <span className={styles.boardName}>{s.name}</span>
                <span className={styles.boardScore}>{s.score}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  }

  if (phase === 'ended') return (
    <div className={styles.screen}>
      <div className={styles.waitCard}>
        <div className={styles.submittedIcon}>🎉</div>
        <p className={styles.waitName}>Session ended</p>
        <p className={styles.waitMsg}>Thanks for playing!</p>
      </div>
    </div>
  )

  return null
}
