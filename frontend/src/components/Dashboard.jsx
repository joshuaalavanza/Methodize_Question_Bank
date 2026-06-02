import { useState, useEffect } from 'react'
import { getDashboard, getStudentDetail } from '../api'
import styles from './Dashboard.module.css'

export default function Dashboard() {
  const [students, setStudents]     = useState(null)
  const [selected, setSelected]     = useState(null)  // user_id
  const [detail, setDetail]         = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    getDashboard().then(setStudents).catch(() => setStudents([]))
  }, [])

  function selectStudent(userId) {
    if (selected === userId) { setSelected(null); setDetail(null); return }
    setSelected(userId)
    setDetail(null)
    setLoadingDetail(true)
    getStudentDetail(userId)
      .then(setDetail)
      .finally(() => setLoadingDetail(false))
  }

  if (!students) return <div className={styles.loading}>Loading dashboard…</div>

  // Summary stats
  const total    = students.length
  const avgAcc   = total > 0 ? Math.round(students.reduce((s, r) => s + r.accuracy, 0) / total) : 0
  const struggling = students.filter(s => s.accuracy < 50).length

  return (
    <div className={styles.dashboard}>
      <div className={styles.topBar}>
        <h2 className={styles.title}>Tutor Dashboard</h2>
        <div className={styles.stats}>
          <Stat label="Students" value={total} />
          <Stat label="Avg accuracy" value={`${avgAcc}%`} />
          <Stat label="Need attention" value={struggling} accent={struggling > 0} />
        </div>
      </div>

      {total === 0 ? (
        <div className={styles.empty}>
          No students have answered questions yet. Share the app and check back here.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Student</th>
                <th>Attempted</th>
                <th>Accuracy</th>
                <th>Weakest skill</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {students.map(s => (
                <>
                  <tr
                    key={s.user_id}
                    className={`${styles.row} ${selected === s.user_id ? styles.rowSelected : ''}`}
                    onClick={() => selectStudent(s.user_id)}
                  >
                    <td className={styles.username}>{s.username}</td>
                    <td>{s.attempted}</td>
                    <td>
                      <AccuracyBadge pct={s.accuracy} />
                    </td>
                    <td className={styles.weakSkill}>{s.weakest_skill ?? '—'}</td>
                    <td className={styles.lastActive}>{relativeTime(s.last_active)}</td>
                  </tr>

                  {selected === s.user_id && (
                    <tr key={`${s.user_id}-detail`} className={styles.detailRow}>
                      <td colSpan={5}>
                        {loadingDetail ? (
                          <div className={styles.detailLoading}>Loading…</div>
                        ) : detail ? (
                          <StudentDetail detail={detail} />
                        ) : null}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statValue} ${accent ? styles.statAccent : ''}`}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}

function AccuracyBadge({ pct }) {
  const cls = pct >= 70 ? styles.green : pct >= 40 ? styles.amber : styles.red
  return <span className={`${styles.badge} ${cls}`}>{pct}%</span>
}

function StudentDetail({ detail }) {
  const [tab, setTab] = useState('history')

  const domainEntries = Object.entries(detail.by_domain)
  const skillEntries  = Object.entries(detail.by_skill)

  return (
    <div className={styles.detail}>
      {/* tab bar */}
      <div className={styles.tabBar}>
        <button
          className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`}
          onClick={() => setTab('history')}
        >
          Question History
          <span className={styles.tabCount}>{detail.history.length}</span>
        </button>
        <button
          className={`${styles.tab} ${tab === 'breakdown' ? styles.tabActive : ''}`}
          onClick={() => setTab('breakdown')}
        >
          Breakdown
        </button>
      </div>

      {tab === 'history' ? (
        <div className={styles.historyList}>
          {detail.history.length === 0 && (
            <p className={styles.emptyTab}>No attempts recorded yet.</p>
          )}
          {detail.history.map((a, i) => (
            <HistoryItem key={i} attempt={a} />
          ))}
        </div>
      ) : (
        <div className={styles.detailCols}>
          <div>
            <h4 className={styles.detailHeading}>By Domain</h4>
            {domainEntries.map(([d, v]) => (
              <BreakdownRow key={d} name={d} correct={v.correct} total={v.total} pct={v.accuracy} />
            ))}
          </div>
          <div>
            <h4 className={styles.detailHeading}>By Skill</h4>
            {skillEntries.map(([s, v]) => (
              <BreakdownRow key={s} name={s} correct={v.correct} total={v.total} pct={v.accuracy} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const LABELS = ['A', 'B', 'C', 'D']

function HistoryItem({ attempt }) {
  const [expanded, setExpanded] = useState(false)
  const text    = attempt.question_text || ''
  const preview = text.length > 120 ? text.slice(0, 120) + '…' : text

  return (
    <div className={styles.historyItem}>
      <div className={`${styles.resultDot} ${attempt.is_correct ? styles.dotCorrect : styles.dotWrong}`}>
        {attempt.is_correct ? '✓' : '✗'}
      </div>
      <div className={styles.historyBody}>
        <p className={styles.historyQ}>
          {preview}
          {' '}
          <button className={styles.expandBtn} onClick={() => setExpanded(e => !e)}>
            {expanded ? 'show less' : 'show more'}
          </button>
        </p>
        <div className={styles.historyMeta}>
          <span className={styles.historySkill}>{attempt.skill}</span>
          <span className={styles.historyDot}>·</span>
          <span className={styles.historyTime}>{relativeTime(attempt.created_at)}</span>
        </div>

        {expanded && <QuestionView attempt={attempt} />}
      </div>
    </div>
  )
}

function QuestionView({ attempt }) {
  const isGridIn = !attempt.choices || attempt.choices.length === 0

  return (
    <div className={styles.qv}>
      {/* PDF crop */}
      {attempt.image_url && (
        <div className={styles.qvImage}>
          <img src={attempt.image_url} alt="Question" />
        </div>
      )}

      {/* Choices */}
      {isGridIn ? (
        <div className={styles.qvGridIn}>
          <span>Correct answer: <strong className={styles.qvCorrectText}>{attempt.correct_answer}</strong></span>
        </div>
      ) : (
        <ul className={styles.qvChoices}>
          {attempt.choices.map((c, i) => {
            const label      = LABELS[i]
            const isCorrect  = label === attempt.correct_answer
            const isChosen   = label === attempt.chosen_answer
            const wrongPick  = isChosen && !isCorrect
            return (
              <li
                key={i}
                className={`${styles.qvChoice} ${isCorrect ? styles.qvCorrect : ''} ${wrongPick ? styles.qvWrong : ''}`}
              >
                <span className={styles.qvLabel}>{label}</span>
                <span className={styles.qvText}>{c.replace(/^[A-D]\)\s*/, '')}</span>
                {isCorrect && <span className={styles.qvMark}>✓</span>}
                {wrongPick && <span className={styles.qvMark}>✗ your answer</span>}
              </li>
            )
          })}
        </ul>
      )}

      {/* Explanation */}
      {attempt.explanation && (
        <div className={styles.qvExplanation}>
          <h4>Explanation</h4>
          <p>{attempt.explanation}</p>
        </div>
      )}
    </div>
  )
}

function BreakdownRow({ name, correct, total, pct }) {
  const color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626'
  return (
    <div className={styles.breakRow}>
      <span className={styles.breakName} title={name}>{name}</span>
      <div className={styles.breakBar}>
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 99 }} />
      </div>
      <span className={styles.breakScore} style={{ color }}>{correct}/{total}</span>
    </div>
  )
}

function relativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7)   return `${days} days ago`
  return new Date(isoString).toLocaleDateString()
}
