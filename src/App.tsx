import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { anonymizeEnv, type Options, type Overrides } from './anonymize'

const SETTINGS_KEY = 'env-anonimizer:settings'
type Settings = Options & { advanced: boolean }
const DEFAULTS: Settings = {
  hideUrls: false,
  maskAll: false,
  maskUsernames: true,
  maskEmails: true,
  visible: 3,
  advanced: false,
}

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    // Oude instelling (één vinkje voor beide) omzetten
    if (typeof saved.maskIdentity === 'boolean') {
      saved.maskUsernames ??= saved.maskIdentity
      saved.maskEmails ??= saved.maskIdentity
      delete saved.maskIdentity
    }
    return { ...DEFAULTS, ...saved }
  } catch {
    return DEFAULTS
  }
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="track" aria-hidden />
      <span className="toggle-text">
        {props.label}
        {props.hint && <small>{props.hint}</small>}
      </span>
    </label>
  )
}

function Group(props: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="group">
      <div className="group-head">
        <h3>{props.title}</h3>
        {props.aside}
      </div>
      {props.children}
    </div>
  )
}

export default function App() {
  // De env zelf wordt nergens opgeslagen, alleen de instellingen
  const [input, setInput] = useState('')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [overrides, setOverrides] = useState<Overrides>({})
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))

  const { output, stats, entries } = useMemo(
    () => anonymizeEnv(input, settings, settings.advanced ? overrides : {}),
    [input, settings, overrides],
  )

  const overrideCount = entries.filter((e) => overrides[e.key] !== undefined).length

  const toggleKey = (key: string, show: boolean, autoMasked: boolean) =>
    setOverrides((o) => {
      const next = { ...o }
      // Terug naar de automatische keuze? Dan de override weghalen
      if (show === !autoMasked) delete next[key]
      else next[key] = show
      return next
    })

  const copy = async () => {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="10" width="16" height="11" rx="2.5" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <div>
            <h1>Env anonimizer</h1>
            <p>Lokaal in je browser, niks wordt opgeslagen of verstuurd.</p>
          </div>
        </div>

        <Group title="Maskeren">
          <Toggle
            checked={settings.hideUrls}
            onChange={(v) => set('hideUrls', v)}
            label="URL's en hosts weghalen"
            hint="Alleen het schema blijft staan"
          />
          <Toggle
            checked={settings.maskUsernames}
            onChange={(v) => set('maskUsernames', v)}
            label="Gebruikersnamen"
            hint="*_USERNAME, *_USER, *_LOGIN, user in URL"
          />
          <Toggle
            checked={settings.maskEmails}
            onChange={(v) => set('maskEmails', v)}
            label="E-mailadressen"
            hint="Overal, ook midden in waarden"
          />
          <Toggle
            checked={settings.maskAll}
            onChange={(v) => set('maskAll', v)}
            label="Alle waarden"
            hint="Ook onschuldige als APP_ENV"
          />
        </Group>

        <Group title="Zichtbare tekens">
          <div className="stepper">
            <button onClick={() => set('visible', Math.max(0, settings.visible - 1))} aria-label="Minder">
              −
            </button>
            <span>
              <strong>{settings.visible}</strong> begin + eind
            </span>
            <button onClick={() => set('visible', Math.min(8, settings.visible + 1))} aria-label="Meer">
              +
            </button>
          </div>
        </Group>

        <Group
          title="Geavanceerd"
          aside={
            settings.advanced && overrideCount > 0 ? (
              <button className="link" onClick={() => setOverrides({})}>
                Reset ({overrideCount})
              </button>
            ) : null
          }
        >
          <Toggle
            checked={settings.advanced}
            onChange={(v) => set('advanced', v)}
            label="Per key kiezen"
            hint="Vink aan welke waarden je wilt zien"
          />
          {settings.advanced && (
            <div className="keys">
              {entries.length === 0 && <p className="muted">Plak eerst een env.</p>}
              {entries.map((e) => (
                <label
                  key={e.key}
                  className={`key ${e.masked ? 'is-masked' : ''} ${overrides[e.key] !== undefined ? 'is-override' : ''}`}
                  title={e.empty ? 'Lege waarde' : `Automatisch: ${e.autoMasked ? 'gemaskeerd' : 'zichtbaar'} (${e.reason})`}
                >
                  <input
                    type="checkbox"
                    checked={!e.masked}
                    disabled={e.empty}
                    onChange={(ev) => toggleKey(e.key, ev.target.checked, e.autoMasked)}
                  />
                  <span className="key-name">{e.key}</span>
                  <span className="tag">{e.reason}</span>
                </label>
              ))}
            </div>
          )}
        </Group>

        {stats.keys > 0 && (
          <div className="stats">
            <div>
              <strong>{stats.keys}</strong>
              <span>keys</span>
            </div>
            <div>
              <strong>{stats.masked}</strong>
              <span>gemaskeerd</span>
            </div>
            <div>
              <strong>{stats.urls}</strong>
              <span>URL's</span>
            </div>
            {stats.empty.length > 0 && (
              <p className="warn">
                Leeg: <code>{stats.empty.join(', ')}</code>
              </p>
            )}
          </div>
        )}
      </aside>

      <main className="panes">
        <section className="pane">
          <div className="pane-head">
            <h2>Invoer</h2>
            <button onClick={() => setInput('')} disabled={!input}>
              Leegmaken
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={'Plak hier je .env\n\nAPP_KEY=base64:...\nDB_PASSWORD=...\nDATABASE_URL=postgres://user:pass@host/db'}
            spellCheck={false}
            autoFocus
          />
        </section>

        <section className="pane">
          <div className="pane-head">
            <h2>Geanonimiseerd</h2>
            <button className="primary" onClick={copy} disabled={!output.trim()}>
              {copied ? 'Gekopieerd ✓' : 'Kopieer'}
            </button>
          </div>
          <textarea value={output} readOnly spellCheck={false} placeholder="Hier verschijnt de veilige versie" />
        </section>
      </main>
    </div>
  )
}
