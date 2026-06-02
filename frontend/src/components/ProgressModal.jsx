import { useState, useEffect } from 'react'
import { getProgress } from '../api'
import styles from './ProgressModal.module.css'

export default function ProgressModal({ onClose }) {
  const [history, setHistory] = useState(null)

  useEffect(() => {
    getProgress().then(setHistory).catch(() => setHistory([]))
  }, [])

  // Close on backdrop click
  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose()
  }

  if (!history) {
    return (
      <div className={styles.overlay} onClick={handleBackdrop}>
        <div className={styles.modal}>
          <ModalHeader onClose={onClose} />
          <p className={styles.empty}>Loading…</p>
        </div>
      </div>
    )
  }

  const total   = history.length
  const correct = history.filter(a => a.is_correct).length
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0

  // Aggregate by domain and skill
  const byDomain = aggregate(history, 'domain')
  const bySkill  = aggregate(history, 'skill')

  const domainRows = Object.entries(byDomain).sort((a, b) => b[1].total - a[1].total)
  const skillRows  = Object.entries(bySkill).sort((a, b) => b[1].total - a[1].total)

  return (
    <div className={styles.overlay} onClick={handleBackdrop}>
      <div className={styles.modal}>
        <ModalHeader onClose={onClose} />

        {total === 0 ? (
          <p className={styles.empty}>No attempts yet — start practising to see your progress here.</p>
        ) : (
          <>
            {/* Overall */}
            <div className={styles.overall}>
              <div className={styles.overallScore}>
                <span className={styles.bigNum}>{correct}</span>
                <span className={styles.bigDen}>/{total} correct</span>
                <span className={styles.bigPct}>{pct}%</span>
              </div>
              <div className={styles.bar}>
                <div className={styles.barFill} style={{ width: `${pct}%` }} />
              </div>
            </div>

            {/* By domain */}
            <Section title="By Domain" rows={domainRows} />

            {/* By skill */}
            <Section title="By Skill" rows={skillRows} />
          </>
        )}
      </div>
    </div>
  )
}

function ModalHeader({ onClose }) {
  return (
    <div className={styles.header}>
      <h2 className={styles.title}>Your Progress</h2>
      <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
    </div>
  )
}

function Section({ title, rows }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.rows}>
        {rows.map(([name, { correct, total }]) => (
          <SkillRow key={name} name={name} correct={correct} total={total} />
        ))}
      </div>
    </div>
  )
}

function SkillRow({ name, correct, total }) {
  const pct   = Math.round((correct / total) * 100)
  const color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626'
  return (
    <div className={styles.skillRow}>
      <span className={styles.skillName} title={name}>{name}</span>
      <div className={styles.skillBar}>
        <div className={styles.skillFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.skillScore} style={{ color }}>
        {correct}/{total}
      </span>
    </div>
  )
}

function aggregate(history, key) {
  const map = {}
  for (const a of history) {
    const k = a[key] || 'Unknown'
    if (!map[k]) map[k] = { correct: 0, total: 0 }
    map[k].total++
    if (a.is_correct) map[k].correct++
  }
  return map
}
