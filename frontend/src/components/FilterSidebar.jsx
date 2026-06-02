import { useState } from 'react'
import styles from './FilterSidebar.module.css'

const SUBJECTS = [
  { value: 'Math',    label: 'Math' },
  { value: 'English', label: 'English' },
]

export default function FilterSidebar({
  filters, subject, subjectDomains, domain, skill, difficulty,
  onSubjectChange, onDomainChange, onSkillChange, onDifficultyChange,
  sessionAttempts, allAttempts, onResetSession,
}) {
  // Domains shown depend on subject selection
  const visibleDomains = subjectDomains
    ? filters.domains?.filter(d => subjectDomains.includes(d))
    : filters.domains ?? []

  // Skills depend on selected domain (or all skills for the current subject)
  const availableSkills = domain
    ? (filters.skills_by_domain?.[domain] ?? [])
    : subjectDomains
      ? Object.entries(filters.skills_by_domain ?? {})
          .filter(([d]) => subjectDomains.includes(d))
          .flatMap(([, ss]) => ss)
          .filter((v, i, a) => a.indexOf(v) === i)
          .sort()
      : (filters.skills ?? [])

  function clearAll() {
    onSubjectChange('')
    onDomainChange('')
    onSkillChange('')
    onDifficultyChange('')
  }

  const hasFilters = subject || domain || skill || difficulty

  return (
    <aside className={styles.sidebar}>

      {/* Subject */}
      <div className={styles.group}>
        <span className={styles.heading}>Subject</span>
        <div className={styles.subjectRow}>
          {SUBJECTS.map(s => (
            <button
              key={s.value}
              className={`${styles.subjectBtn} ${subject === s.value ? styles.subjectActive : ''}`}
              onClick={() => onSubjectChange(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Domain */}
      <label className={styles.label}>
        Domain
        <select
          className={styles.select}
          value={domain}
          onChange={e => onDomainChange(e.target.value)}
        >
          <option value="">All domains</option>
          {visibleDomains.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>

      {/* Skill — filtered by selected domain */}
      <label className={styles.label}>
        Topic
        <select
          className={styles.select}
          value={skill}
          onChange={e => onSkillChange(e.target.value)}
        >
          <option value="">All topics</option>
          {availableSkills.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>

      {/* Difficulty */}
      <label className={styles.label}>
        Difficulty
        <select
          className={styles.select}
          value={difficulty}
          onChange={e => onDifficultyChange(e.target.value)}
        >
          <option value="">All levels</option>
          {filters.difficulties?.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>

      {hasFilters && (
        <button className={styles.clear} onClick={clearAll}>
          Clear filters
        </button>
      )}

      <SessionPanel
        sessionAttempts={sessionAttempts}
        allAttempts={allAttempts}
        onReset={onResetSession}
      />
    </aside>
  )
}

function SessionPanel({ sessionAttempts, allAttempts, onReset }) {
  const [view, setView] = useState('session')  // 'session' | 'alltime'

  const attempts = view === 'session' ? sessionAttempts : allAttempts
  const hasAny   = allAttempts.length > 0 || sessionAttempts.length > 0

  if (!hasAny) return (
    <div className={styles.sessionEmpty}>
      <p>Answer questions to track your score.</p>
    </div>
  )

  const total   = attempts.length
  const correct = attempts.filter(a => a.isCorrect).length
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 0

  const bySkill = {}
  for (const a of attempts) {
    if (!bySkill[a.skill]) bySkill[a.skill] = { correct: 0, total: 0 }
    bySkill[a.skill].total++
    if (a.isCorrect) bySkill[a.skill].correct++
  }

  return (
    <div className={styles.session}>
      {/* toggle */}
      <div className={styles.toggleRow}>
        <div className={styles.togglePill}>
          <button
            className={`${styles.pillBtn} ${view === 'session' ? styles.pillActive : ''}`}
            onClick={() => setView('session')}
          >Session</button>
          <button
            className={`${styles.pillBtn} ${view === 'alltime' ? styles.pillActive : ''}`}
            onClick={() => setView('alltime')}
          >All time</button>
        </div>
        {view === 'session' && sessionAttempts.length > 0 && (
          <button className={styles.resetBtn} onClick={onReset}>Reset</button>
        )}
      </div>

      {total === 0 ? (
        <p className={styles.emptyView}>No attempts this session yet.</p>
      ) : (
        <>
          <div className={styles.scoreRow}>
            <span className={styles.scoreNum}>
              {correct}<span className={styles.scoreDen}>/{total}</span>
            </span>
            <span className={styles.scorePct}>{pct}%</span>
          </div>

          <div className={styles.bar}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
          </div>

          <div className={styles.breakdown}>
            {Object.entries(bySkill).map(([s, { correct, total }]) => (
              <div key={s} className={styles.skillRow}>
                <span className={styles.skillName} title={s}>{s}</span>
                <span className={`${styles.skillScore} ${correct === total ? styles.perfect : correct === 0 ? styles.zero : ''}`}>
                  {correct}/{total}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
