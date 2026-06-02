import { useState } from 'react'
import { login } from '../api'
import styles from './AuthModal.module.css'

export default function AuthModal({ onLogin }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    const name = username.trim()
    if (!name) return
    setLoading(true)
    setError('')
    try {
      const data = await login(name)
      localStorage.setItem('quarry_token', data.token)
      onLogin({ userId: data.user_id, username: data.username, is_admin: data.is_admin ?? false })
    } catch {
      setError('Something went wrong — try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2 className={styles.title}>Welcome to Quarry</h2>
        <p className={styles.subtitle}>Enter a username to save your progress across sessions.</p>
        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            className={styles.input}
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Choose a username"
            autoFocus
            maxLength={30}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button
            className={styles.btn}
            type="submit"
            disabled={loading || !username.trim()}
          >
            {loading ? 'Loading…' : 'Start practising'}
          </button>
        </form>
      </div>
    </div>
  )
}
