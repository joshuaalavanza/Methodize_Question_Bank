import { useState } from 'react'
import Markdown from 'react-markdown'
import { explainQuestion } from '../api'
import styles from './QuestionCard.module.css'

const LABELS = ['A', 'B', 'C', 'D']

export default function QuestionCard({
  summary, detail, expanded, similar, loadingSimilar,
  onToggle, onMoreLikeThis, onAnswer, alreadyAnswered,
}) {
  return (
    <article className={`${styles.card} ${expanded ? styles.expanded : ''}`}>
      <button className={styles.toggle} onClick={onToggle} aria-expanded={expanded}>
        <div className={styles.meta}>
          <span className={styles.skill}>{summary.skill}</span>
          <span className={styles.difficulty}>{summary.difficulty}</span>
          <span className={styles.id}>#{summary.id}</span>
          {alreadyAnswered && <span className={styles.done}>✓ done</span>}
        </div>
        {!expanded && <p className={styles.questionText}>{summary.question_text}</p>}
        <span className={styles.chevron}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        detail
          ? <Detail
              detail={detail}
              similar={similar}
              loadingSimilar={loadingSimilar}
              onMoreLikeThis={onMoreLikeThis}
              onAnswer={onAnswer}
            />
          : <div className={styles.detailLoading}>Loading…</div>
      )}
    </article>
  )
}

function Detail({ detail, similar, loadingSimilar, onMoreLikeThis, onAnswer }) {
  const [selected, setSelected]     = useState(null)
  const [selfReport, setSelfReport]  = useState(null)
  const [aiText, setAiText]          = useState('')
  const [aiLoading, setAiLoading]    = useState(false)
  const answered = selected !== null
  const isGridIn = detail.choices.length === 0
  const reported = selfReport !== null

  async function handleExplain() {
    setAiLoading(true)
    setAiText('')
    try {
      const res = await explainQuestion({
        question_text:  detail.question_text,
        choices:        detail.choices,
        correct_answer: detail.correct_answer,
        chosen_answer:  isGridIn ? null : selected,
        skill:          detail.skill,
        domain:         detail.domain,
      })
      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setAiText(prev => prev + decoder.decode(value, { stream: true }))
      }
    } finally {
      setAiLoading(false)
    }
  }

  function pick(label) {
    if (answered) return
    setSelected(label)
    onAnswer?.(label === detail.correct_answer, label)
  }

  function revealGridIn() {
    setSelected('revealed')
  }

  function reportGridIn(got) {
    setSelfReport(got)
    onAnswer?.(got, null)   // grid-in: no specific choice label
  }

  return (
    <div className={styles.detail}>
      {detail.image_url && (
        <div className={styles.pdfCrop}>
          <img src={detail.image_url} alt="Question" />
        </div>
      )}

      {isGridIn ? (
        !answered ? (
          <button className={styles.revealBtn} onClick={revealGridIn}>
            Show answer
          </button>
        ) : (
          <>
            <p className={styles.gridIn}>
              Answer: <strong>{detail.correct_answer}</strong>
            </p>
            {!reported && (
              <div className={styles.selfReport}>
                <span>Did you get it?</span>
                <button className={styles.gotIt}    onClick={() => reportGridIn(true)}>✓ Yes</button>
                <button className={styles.missedIt} onClick={() => reportGridIn(false)}>✗ No</button>
              </div>
            )}
            {reported && (
              <p className={styles.reportedMsg}>
                {selfReport ? '✓ Marked correct' : '✗ Marked incorrect'}
              </p>
            )}
          </>
        )
      ) : (
        <ul className={styles.choices}>
          {detail.choices.map((c, i) => {
            const label = LABELS[i]
            const isCorrect  = label === detail.correct_answer
            const isSelected = label === selected
            let mod = ''
            if (answered) {
              if (isCorrect)       mod = styles.correct
              else if (isSelected) mod = styles.wrong
            }
            return (
              <li
                key={i}
                className={`${styles.choice} ${mod} ${!answered ? styles.clickable : ''}`}
                onClick={() => pick(label)}
              >
                <span className={styles.choiceLabel}>{label}</span>
                <span>{c.replace(/^[A-D]\)\s*/, '')}</span>
                {answered && isCorrect   && <span className={styles.mark}> ✓</span>}
                {answered && isSelected && !isCorrect && <span className={styles.mark}> ✗</span>}
              </li>
            )
          })}
        </ul>
      )}

      {(answered && (isGridIn ? reported : true)) && (
        <>
          {detail.explanation && (
            <div className={styles.explanation}>
              <h4>Explanation</h4>
              <p>{detail.explanation}</p>
            </div>
          )}

          {/* AI Explain */}
          <div className={styles.aiSection}>
            {!aiText && (
              <button
                className={`${styles.explainBtn} ${!answered || (isGridIn && !reported) ? styles.explainDisabled : ''}`}
                onClick={handleExplain}
                disabled={aiLoading || !!aiText}
              >
                {aiLoading
                  ? <><span className={styles.aiSpinner} />Thinking…</>
                  : '✦ Explain with AI'}
              </button>
            )}
            {(aiLoading || aiText) && (
              <div className={styles.aiBox}>
                <div className={styles.aiHeader}>
                  <span className={styles.aiLabel}>✦ AI Tutor</span>
                  {aiText && !aiLoading && (
                    <button className={styles.aiReset} onClick={() => setAiText('')}>✕</button>
                  )}
                </div>
                <div className={styles.aiText}>
                  <Markdown>{aiText}</Markdown>
                  {aiLoading && <span className={styles.aiCursor} />}
                </div>
              </div>
            )}
          </div>

          <div className={styles.similarSection}>
            <button
              className={styles.moreLikeThis}
              onClick={onMoreLikeThis}
              disabled={loadingSimilar || similar !== null}
            >
              {loadingSimilar ? 'Finding similar…' : similar ? 'Similar questions ↓' : 'More like this'}
            </button>
            {similar && (
              <div className={styles.similarList}>
                <h4>Similar questions</h4>
                {similar.map(r => <SimilarCard key={r.id} r={r} />)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SimilarCard({ r }) {
  const [selected, setSelected]     = useState(null)
  const [selfReport, setSelfReport]  = useState(null)
  const answered = selected !== null
  const isGridIn = r.choices.length === 0

  return (
    <div className={styles.similarCard}>
      <div className={styles.similarMeta}>
        <span className={styles.skill}>{r.skill}</span>
        {r.fallback_used && <span className={styles.fallback}>broad match</span>}
        <span className={styles.dist}>dist {r.distance}</span>
      </div>

      {r.image_url && (
        <div className={styles.pdfCropSm}>
          <img src={r.image_url} alt="Question" />
        </div>
      )}

      {isGridIn ? (
        !answered ? (
          <button className={styles.revealBtn} onClick={() => setSelected('revealed')}>Show answer</button>
        ) : (
          <>
            <p className={styles.gridIn}>Answer: <strong>{r.correct_answer}</strong></p>
            {selfReport === null && (
              <div className={styles.selfReport}>
                <span>Did you get it?</span>
                <button className={styles.gotIt}    onClick={() => setSelfReport(true)}>✓ Yes</button>
                <button className={styles.missedIt} onClick={() => setSelfReport(false)}>✗ No</button>
              </div>
            )}
          </>
        )
      ) : (
        <ul className={styles.choices}>
          {r.choices.map((c, i) => {
            const label = LABELS[i]
            const isCorrect  = label === r.correct_answer
            const isSelected = label === selected
            let mod = ''
            if (answered) {
              if (isCorrect)       mod = styles.correct
              else if (isSelected) mod = styles.wrong
            }
            return (
              <li
                key={i}
                className={`${styles.choice} ${mod} ${!answered ? styles.clickable : ''}`}
                onClick={() => !answered && setSelected(label)}
              >
                <span className={styles.choiceLabel}>{label}</span>
                <span>{c.replace(/^[A-D]\)\s*/, '')}</span>
                {answered && isCorrect   && <span className={styles.mark}> ✓</span>}
                {answered && isSelected && !isCorrect && <span className={styles.mark}> ✗</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
