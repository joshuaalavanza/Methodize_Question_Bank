import { useState, useRef, useCallback } from 'react'
import Markdown from 'react-markdown'
import { dropIn, explainQuestion } from '../api'
import styles from './DropInModal.module.css'

const LABELS = ['A', 'B', 'C', 'D']

export default function DropInModal({ onClose }) {
  const [text, setText]           = useState('')
  const [image, setImage]         = useState(null)   // {b64, mediaType, previewUrl}
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [result, setResult]       = useState(null)
  const [aiText, setAiText]       = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const fileRef = useRef()
  const dropRef = useRef()

  // ── image helpers ─────────────────────────────────────────────────────────
  function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = e => {
      const img = new Image()
      img.onload = () => {
        // Resize to max 900px wide — keeps base64 well under 500KB for any screenshot
        const MAX = 900
        const scale = img.width > MAX ? MAX / img.width : 1
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75)
        setImage({ b64: dataUrl.split(',')[1], mediaType: 'image/jpeg', previewUrl: dataUrl })
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }

  // Paste anywhere in the modal captures clipboard images
  const handlePaste = useCallback(e => {
    const items = Array.from(e.clipboardData?.items || [])
    const imgItem = items.find(i => i.type.startsWith('image/'))
    if (imgItem) loadImageFile(imgItem.getAsFile())
  }, [])

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    loadImageFile(file)
  }

  // ── submit ────────────────────────────────────────────────────────────────
  async function handleAnalyze() {
    if (!text.trim() && !image) { setError('Paste a question or upload a screenshot.'); return }
    setLoading(true)
    setError('')
    setResult(null)
    setAiText('')
    try {
      const data = await dropIn({
        text:             text.trim() || null,
        image_b64:        image?.b64 || null,
        image_media_type: image?.mediaType || 'image/png',
      })
      setResult(data)
    } catch (err) {
      const msg = err?.message || ''
      if (msg.includes('401')) setError('Not logged in — please refresh and log in again.')
      else if (msg.includes('413')) setError('Image is too large. Try a smaller screenshot.')
      else if (msg.includes('500')) setError('Server error — make sure uvicorn is running and restart it.')
      else setError(`Error: ${msg || 'Something went wrong — try again.'}`)
    } finally {
      setLoading(false)
    }
  }

  // ── AI explain ────────────────────────────────────────────────────────────
  async function handleExplain() {
    if (!result) return
    setAiLoading(true)
    setAiText('')
    try {
      const res = await explainQuestion({
        question_text:  result.question_text,
        choices:        result.choices,
        correct_answer: result.correct_answer,
        chosen_answer:  null,
        skill:          result.skill,
        domain:         result.domain,
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

  function reset() { setResult(null); setAiText(''); setImage(null); setText('') }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}
         onPaste={handlePaste}>
      <div className={styles.modal}>

        {/* header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Drop in any question</h2>
            <p className={styles.sub}>Paste text, upload a photo, or Ctrl+V a screenshot</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {!result ? (
          /* ── input view ── */
          <div className={styles.inputView}>
            {/* text area */}
            <textarea
              className={styles.textarea}
              placeholder="Paste your SAT question here…"
              value={text}
              onChange={e => setText(e.target.value)}
              rows={5}
            />

            {/* image zone */}
            <div
              ref={dropRef}
              className={`${styles.imageZone} ${image ? styles.imageZoneHasImage : ''}`}
              onClick={() => !image && fileRef.current.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
            >
              {image ? (
                <div className={styles.previewWrap}>
                  <img src={image.previewUrl} alt="Question screenshot" className={styles.preview} />
                  <button className={styles.removeImg} onClick={e => { e.stopPropagation(); setImage(null) }}>
                    ✕ Remove
                  </button>
                </div>
              ) : (
                <div className={styles.imagePrompt}>
                  <span className={styles.imageIcon}>🖼</span>
                  <span>Click to upload, drag & drop, or <strong>Ctrl+V</strong> a screenshot</span>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => loadImageFile(e.target.files[0])}
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button
              className={styles.analyzeBtn}
              onClick={handleAnalyze}
              disabled={loading || (!text.trim() && !image)}
            >
              {loading
                ? <><span className={styles.spinner} /> Analysing…</>
                : '✦ Analyse question'}
            </button>
          </div>

        ) : (
          /* ── results view ── */
          <div className={styles.resultsView}>
            {/* identified question */}
            <div className={styles.identified}>
              <div className={styles.identifiedMeta}>
                <span className={styles.skillBadge}>{result.skill}</span>
                <span className={styles.domainBadge}>{result.domain}</span>
                <button className={styles.resetBtn} onClick={reset}>← New question</button>
              </div>
              {result.question_text && (
                <p className={styles.questionText}>{result.question_text}</p>
              )}
            </div>

            {/* AI explanation */}
            <div className={styles.explainSection}>
              {!aiText && (
                <button className={styles.explainBtn} onClick={handleExplain} disabled={aiLoading}>
                  {aiLoading
                    ? <><span className={styles.spinner} /> Thinking…</>
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

            {/* similar questions */}
            {result.similar.length > 0 && (
              <div className={styles.similarSection}>
                <h3 className={styles.similarHeading}>Similar questions from the bank</h3>
                {result.similar.map(q => <SimilarCard key={q.id} q={q} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SimilarCard({ q }) {
  const [selected, setSelected] = useState(null)
  const answered = selected !== null
  const isGridIn = q.choices.length === 0

  return (
    <div className={styles.simCard}>
      <div className={styles.simMeta}>
        <span className={styles.skillBadge}>{q.skill}</span>
        <span className={styles.diffBadge}>{q.difficulty}</span>
        {q.fallback_used && <span className={styles.fallbackBadge}>broad match</span>}
      </div>

      {q.image_url && (
        <div className={styles.simImage}><img src={q.image_url} alt="Question" /></div>
      )}

      {!isGridIn ? (
        <ul className={styles.simChoices}>
          {q.choices.map((c, i) => {
            const label     = LABELS[i]
            const isCorrect = label === q.correct_answer
            const isChosen  = label === selected
            let cls = styles.simChoice
            if (answered && isCorrect)             cls += ' ' + styles.simCorrect
            if (answered && isChosen && !isCorrect) cls += ' ' + styles.simWrong
            return (
              <li key={i} className={`${cls} ${!answered ? styles.simClickable : ''}`}
                  onClick={() => !answered && setSelected(label)}>
                <span className={styles.simLabel}>{label}</span>
                <span>{c.replace(/^[A-D]\)\s*/, '')}</span>
                {answered && isCorrect   && <span className={styles.simMark}>✓</span>}
                {answered && isChosen && !isCorrect && <span className={styles.simMark}>✗</span>}
              </li>
            )
          })}
        </ul>
      ) : (
        answered ? (
          <p className={styles.gridIn}>Answer: <strong>{q.correct_answer}</strong></p>
        ) : (
          <button className={styles.revealBtn} onClick={() => setSelected('revealed')}>Show answer</button>
        )
      )}

      {answered && q.explanation && (
        <div className={styles.simExplanation}>
          <h4>Explanation</h4>
          <p>{q.explanation}</p>
        </div>
      )}
    </div>
  )
}
