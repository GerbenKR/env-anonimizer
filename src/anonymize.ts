export type Options = {
  /** URL's en hosts volledig weghalen (alleen het schema blijft staan) */
  hideUrls: boolean
  /** Elke waarde maskeren, niet alleen waarden die op een secret lijken */
  maskAll: boolean
  /** Gebruikersnamen (USERNAME/USER/LOGIN en user in URL's) maskeren */
  maskUsernames: boolean
  /** E-mailadressen overal maskeren */
  maskEmails: boolean
  /** Aantal tekens dat aan begin en eind zichtbaar blijft */
  visible: number
}

/** Per key: true = waarde tonen, false = maskeren. Ontbreekt = automatisch. */
export type Overrides = Record<string, boolean>

export type Entry = {
  key: string
  /** Automatische beslissing: wordt de waarde (deels) verborgen? */
  autoMasked: boolean
  /** Uiteindelijke beslissing, na eventuele override */
  masked: boolean
  empty: boolean
  reason: string
}

export type Stats = {
  keys: number
  masked: number
  urls: number
  empty: string[]
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i
const LINE_RE = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/

/**
 * Laravel-keys waarvan we zeker weten dat ze geen secret zijn, ook al zit er
 * een woord als SESSION, AUTH, PASSWORD of KEY in de naam.
 */
const SAFE_KEYS = new Set([
  'APP_NAME', 'APP_ENV', 'APP_DEBUG', 'APP_TIMEZONE', 'APP_LOCALE', 'APP_FALLBACK_LOCALE',
  'APP_FAKER_LOCALE', 'APP_MAINTENANCE_DRIVER', 'APP_MAINTENANCE_STORE', 'APP_PREVIOUS_KEYS',
  'PHP_CLI_SERVER_WORKERS', 'BCRYPT_ROUNDS',
  'LOG_CHANNEL', 'LOG_STACK', 'LOG_DEPRECATIONS_CHANNEL', 'LOG_LEVEL', 'LOG_DAILY_DAYS',
  'DB_CONNECTION', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_SOCKET', 'DB_CHARSET',
  'DB_COLLATION', 'DB_FOREIGN_KEYS', 'DB_QUEUE', 'DB_QUEUE_TABLE', 'DB_QUEUE_CONNECTION',
  'DB_QUEUE_RETRY_AFTER', 'DB_CACHE_TABLE', 'DB_CACHE_CONNECTION', 'DB_CACHE_LOCK_CONNECTION',
  'SESSION_DRIVER', 'SESSION_LIFETIME', 'SESSION_EXPIRE_ON_CLOSE', 'SESSION_ENCRYPT',
  'SESSION_PATH', 'SESSION_CONNECTION', 'SESSION_STORE', 'SESSION_TABLE', 'SESSION_COOKIE',
  'SESSION_SECURE_COOKIE', 'SESSION_HTTP_ONLY', 'SESSION_SAME_SITE', 'SESSION_PARTITIONED_COOKIE',
  'AUTH_GUARD', 'AUTH_PASSWORD_BROKER', 'AUTH_MODEL', 'AUTH_PASSWORD_TIMEOUT',
  'AUTH_PASSWORD_RESET_TOKEN_TABLE',
  'BROADCAST_CONNECTION', 'BROADCAST_DRIVER', 'FILESYSTEM_DISK', 'QUEUE_CONNECTION',
  'QUEUE_FAILED_DRIVER', 'CACHE_STORE', 'CACHE_DRIVER', 'CACHE_PREFIX',
  'REDIS_CLIENT', 'REDIS_PORT', 'REDIS_DB', 'REDIS_CACHE_DB', 'REDIS_PREFIX', 'REDIS_CLUSTER',
  'REDIS_USERNAME', 'REDIS_QUEUE', 'REDIS_CACHE_CONNECTION', 'REDIS_CACHE_LOCK_CONNECTION',
  'MAIL_MAILER', 'MAIL_SCHEME', 'MAIL_PORT', 'MAIL_ENCRYPTION', 'MAIL_FROM_ADDRESS',
  'MAIL_FROM_NAME', 'MAIL_EHLO_DOMAIN',
  'AWS_DEFAULT_REGION', 'AWS_BUCKET', 'AWS_USE_PATH_STYLE_ENDPOINT',
  'PUSHER_APP_ID', 'PUSHER_PORT', 'PUSHER_SCHEME', 'PUSHER_APP_CLUSTER',
  'REVERB_APP_ID', 'REVERB_PORT', 'REVERB_SCHEME', 'REVERB_SERVER_PORT',
  'SCOUT_DRIVER', 'SCOUT_QUEUE', 'TELESCOPE_ENABLED', 'HORIZON_PREFIX', 'OCTANE_SERVER',
  'NIGHTWATCH_ENABLED', 'SAIL_XDEBUG_MODE', 'WWWUSER', 'WWWGROUP', 'FORWARD_DB_PORT',
])

/** Keys die naar een host/domein wijzen: weg als "URL's weghalen" aan staat */
const HOST_NAME = /(_HOST|_DOMAIN|_DOMAINS|_ENDPOINT)$/i
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|mysql|pgsql|mariadb|redis|memcached|mailpit|meilisearch|minio|null)$/i

/** Woorden die overal in de naam een secret aanduiden */
const SECRET_WORD = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)/
/** Losse naamdelen die een secret aanduiden */
const SECRET_PART = new Set(['PASS', 'PWD', 'DSN', 'SALT', 'SIGNATURE', 'WEBHOOK', 'AUTH'])

function isSecretName(key: string): boolean {
  const k = key.toUpperCase()
  if (SAFE_KEYS.has(k)) return false
  const parts = k.split(/[_.-]/)
  const last = parts[parts.length - 1]
  return SECRET_WORD.test(k) || parts.some((p) => SECRET_PART.has(p)) || last.endsWith('KEY') || last === 'KEYS'
}

export function mask(value: string, visible: number): string {
  const prefix = value.match(/^base64:/)?.[0] ?? ''
  if (prefix) return prefix + mask(value.slice(prefix.length), visible)
  // Bij korte waarden zou "eerste 3 + laatste 3" bijna alles verraden
  if (value.length <= visible * 2 + 4) return '*'.repeat(Math.min(value.length, 8))
  return `${value.slice(0, visible)}...${value.slice(-visible)}`
}

const USERNAME_NAME = /(^|_)(USERNAME|USER|LOGIN)$/i
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** info@mijnsite.nl -> i***@m***.nl */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  const dot = domain.lastIndexOf('.')
  return `${local[0]}***@${domain[0]}***${domain.slice(dot)}`
}

function maskEmails(value: string): string {
  return value.replace(EMAIL_RE, maskEmail)
}

function looksLikeSecret(value: string): boolean {
  if (value.length < 16 || /\s/.test(value)) return false
  const hasLetter = /[a-z]/i.test(value)
  const hasDigit = /\d/.test(value)
  return hasLetter && hasDigit
}

function isHarmless(value: string): boolean {
  return /^(true|false|yes|no|on|off|null|-?\d+(\.\d+)?)$/i.test(value)
}

function anonymizeUrl(key: string, url: string, opts: Options): string {
  const scheme = url.match(URL_RE)![0]
  if (opts.hideUrls) return `${scheme}***`
  // Wachtwoord in user:pass@host altijd maskeren, de gebruikersnaam optioneel
  let out = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^:@/]*)(?::([^@/]*))?@/i, (_, s, user, pass) => {
    const u = opts.maskUsernames && user ? mask(user, opts.visible) : user
    return `${s}${u}${pass !== undefined ? ':' + mask(pass, opts.visible) : ''}@`
  })
  // Gevoelige query params (?api_key=..., &token=...) maskeren
  out = out.replace(/([?&])([^=&#]+)=([^&#]*)/g, (m, sep, k, v) =>
    isSecretName(k) && v ? `${sep}${k}=${mask(v, opts.visible)}` : m,
  )
  // Bij webhooks (Slack, Discord, ...) zit het secret in het pad
  if (isSecretName(key)) {
    out = out.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/]+)(\/[^?#]+)/i, (_, origin, path) =>
      path.length > 1 ? `${origin}/${mask(path.slice(1), opts.visible)}` : origin + path,
    )
  }
  // E-mails alleen na de host zoeken (pad/query), niet in user:pass@host
  if (opts.maskEmails) {
    out = out.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/is, (_, authority, rest) => authority + maskEmails(rest))
  }
  return out
}

type Result = { value: string; reason: string; url?: boolean }

/** Automatische beslissing voor één waarde */
function anonymizeValue(key: string, raw: string, opts: Options): Result {
  const keep = (reason: string, url = false): Result => ({ value: raw, reason, url })
  const hide = (value: string, reason: string, url = false): Result => ({ value, reason, url })

  if (raw === '') return keep('leeg')
  // Verwijzingen als "${PUSHER_APP_KEY}" bevatten zelf geen secret
  if (/^\$\{[A-Za-z0-9_]+\}$/.test(raw)) return keep('verwijzing')
  if (URL_RE.test(raw)) {
    const out = anonymizeUrl(key, raw, opts)
    return out === raw ? keep('url', true) : hide(out, opts.hideUrls ? 'url' : 'url (deels)', true)
  }
  if (opts.hideUrls && HOST_NAME.test(key) && !LOCAL_HOST.test(raw)) return hide('***', 'host', true)
  if (opts.maskAll) return hide(mask(raw, opts.visible), 'alles maskeren')
  if (isHarmless(raw)) return keep('onschuldig')
  if (opts.maskUsernames && USERNAME_NAME.test(key)) {
    const emails = maskEmails(raw)
    return hide(emails !== raw ? emails : mask(raw, opts.visible), 'gebruikersnaam')
  }
  if (opts.maskEmails) {
    const out = maskEmails(raw)
    if (out !== raw) return hide(out, 'e-mail')
  }
  if (SAFE_KEYS.has(key.toUpperCase())) return keep('laravel')
  if (isSecretName(key)) return hide(mask(raw, opts.visible), 'secret')
  if (looksLikeSecret(raw)) return hide(mask(raw, opts.visible), 'lijkt op secret')
  return keep('gewoon')
}

/** Handmatig verbergen: zo veel mogelijk weg, maar nog herkenbaar */
function forceMask(raw: string, opts: Options): string {
  const scheme = raw.match(URL_RE)?.[0]
  if (scheme) return `${scheme}***`
  return mask(raw, opts.visible)
}

/** Splitst een waarde in quote + inhoud + rest (inline comment) */
function splitValue(rest: string): { quote: string; value: string; trailing: string; open: boolean } {
  const q = rest[0]
  if (q === '"' || q === "'" || q === '`') {
    const end = rest.indexOf(q, 1)
    if (end === -1) return { quote: q, value: rest.slice(1), trailing: '', open: true }
    return { quote: q, value: rest.slice(1, end), trailing: rest.slice(end + 1), open: false }
  }
  const comment = rest.match(/\s+#.*$/)
  if (comment) {
    return { quote: '', value: rest.slice(0, comment.index), trailing: comment[0], open: false }
  }
  return { quote: '', value: rest.trimEnd(), trailing: rest.slice(rest.trimEnd().length), open: false }
}

export function anonymizeEnv(
  input: string,
  opts: Options,
  overrides: Overrides = {},
): { output: string; stats: Stats; entries: Entry[] } {
  const stats: Stats = { keys: 0, masked: 0, urls: 0, empty: [] }
  const entries = new Map<string, Entry>()
  const lines = input.split(/\r?\n/)
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE_RE)
    if (!m) {
      out.push(lines[i])
      continue
    }
    const [, indent, exp = '', key, eq, rest] = m
    const start = i
    let { quote, value, trailing, open } = splitValue(rest)
    const prefix = `${indent}${exp}${key}${eq}${quote}`

    let auto: Result
    let original: string | null = null
    if (open) {
      // Meerregelige waarde tussen quotes (bv. private keys)
      const parts = [value]
      while (++i < lines.length) {
        const end = lines[i].indexOf(quote)
        if (end !== -1) {
          parts.push(lines[i].slice(0, end))
          trailing = lines[i].slice(end + 1)
          break
        }
        parts.push(lines[i])
      }
      value = parts.join('\n')
      original = lines.slice(start, i + 1).join('\n')
      const firstLine = value.split('\n').find((l) => l.trim())?.trim() ?? ''
      const label = /^-----BEGIN [A-Z ]+-----$/.test(firstLine) ? firstLine : 'meerregelige waarde'
      auto = { value: `<${label}, ${value.length} tekens>`, reason: 'meerregelig' }
    } else {
      auto = anonymizeValue(key, value, opts)
    }

    const empty = value === ''
    const autoMasked = auto.value !== value
    const override = empty ? undefined : overrides[key]
    const finalMasked = override === undefined ? autoMasked : !override

    let shown: string
    if (!finalMasked) shown = value
    else if (autoMasked) shown = auto.value
    else shown = forceMask(value, opts)

    if (!finalMasked && original !== null) out.push(original)
    else out.push(`${prefix}${shown}${quote}${trailing}`)

    stats.keys++
    if (empty) stats.empty.push(key)
    if (finalMasked) stats.masked++
    if (auto.url) stats.urls++
    entries.set(key, { key, autoMasked, masked: finalMasked, empty, reason: auto.reason })
  }

  return { output: out.join('\n'), stats, entries: [...entries.values()] }
}
