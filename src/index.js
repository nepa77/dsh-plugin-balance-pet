/**
 * dsh-plugin-balance-pet — Host half.
 *
 * WHAT THIS IS
 *   The DSH-native form of the "DSH 余额桌宠": a frame-wide pet drawn in the
 *   Harness Web UI that reads the DeepSeek balance and reacts to it. There is no
 *   separate application, no tray icon and no desktop window — the browser half
 *   renders the pet, this half owns the account query.
 *
 * WHERE THE BALANCE COMES FROM
 *   1. `ctx.get('deepseekAccount').getBalance(client)` — the shipped Host seam
 *      the account settings page itself uses. It already owns the grant, the
 *      Platform origin, the `x-dsh-auth-token` header, the response envelope and
 *      the money parsing, so this plugin never touches `~/.dsh/.credentials.yaml`
 *      for that path and never sees a token.
 *   2. The plugin's own API key, set from the pet's right-click menu and stored in
 *      `<dshHome>/balance-pet/apikey.txt` (0600). Mirrors the macOS original's
 *      `apikey.txt`.
 *   3. `DEEPSEEK_API_KEY` from `<dshHome>/.credentials.yaml` — the key DSH's own
 *      model settings write.
 *
 *   The pet's menu chooses between them (余额来源: auto / account only / key
 *   only), because "auto" deliberately prefers the account: when a grant is
 *   stored, the account balance IS the balance, and silently substituting a key's
 *   balance would show a different number than DSH's own account page.
 *
 * WHY THE CLIENT POLLS THIS HALF
 *   The browser cannot reach `deepseekAccount` (Host-only), and DSH's own
 *   `ctx.remote` needs generated Typert artifacts this package deliberately ships
 *   no build step for. So the halves speak over ordinary HTTP routes on
 *   `ctx.webServer`, exactly like the other local plugins.
 *
 * SCHEDULING
 *   The Host is authoritative about *when* an upstream query may happen: the
 *   Client only asks "what is the balance?", and this half refreshes at most once
 *   per configured interval, at most one request in flight, with exponential
 *   backoff after failures. No browser open ⇒ no upstream traffic at all.
 *
 * Every seam is recorded in `compat/expected-surface.json`; `GET <prefix>/doctor`
 * reports the live verdict.
 */

'use strict'

const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')

const PACKAGE_NAME = 'dsh-plugin-balance-pet'
const ROUTE_PREFIX = '/dsh-plugin-balance-pet'
const VERSION = '0.4.0'
const ADAPTED_FOR = 'DSH desktop, Harness 0.2.0-rc.2'

/**
 * A custom header cannot be set by a cross-origin page without a CORS preflight,
 * and these routes never approve one, so a drive-by web page cannot read the
 * balance out of the local Host or write an API key into it. The asset route is
 * the one exception: `<img>` and CSS `url()` cannot set headers, and the artwork
 * is not a secret.
 */
const REQUIRED_HEADER = 'x-dsh-plugin-balance-pet'

const MIN_INTERVAL_SECONDS = 10
const MAX_INTERVAL_SECONDS = 300
const DEFAULT_INTERVAL_SECONDS = 30
const REQUEST_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 1 << 20
const MAX_API_KEY_BYTES = 4096

/** How the reading is obtained; the pet's 余额来源 menu picks between them. */
const SOURCE_MODES = new Set(['auto', 'account', 'apikey'])
const DEFAULT_SOURCE_MODE = 'auto'

/** Artwork this half is allowed to serve. An allowlist, never a join. */
const ASSET_FILES = new Set([
  'expression-11.webp',
  'expression-12.webp',
  'expression-21.webp',
  'expression-22.webp',
  'appearance-bowl.webp',
  'appearance-gpt.webp',
  'appearance-claude.webp',
  'appearance-gemini.webp',
])

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function safeGet(getter, fallback) {
  try {
    const value = getter()
    return value === undefined || value === null ? fallback : value
  } catch {
    return fallback
  }
}

function clampInterval(value) {
  const seconds = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(seconds)) return DEFAULT_INTERVAL_SECONDS
  return Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, Math.round(seconds)))
}

function clampSourceMode(value) {
  return SOURCE_MODES.has(value) ? value : DEFAULT_SOURCE_MODE
}

/** The DSH home that owns `profiles/`, `storages/` and `.credentials.yaml`. */
function resolveDshHome(ctx) {
  const configured = safeGet(() => ctx.config && ctx.config.dshHome, undefined)
  if (typeof configured === 'string' && configured.length > 0) return configured
  for (const key of ['DSH_HOME', 'DSH_DATA_DIR', 'DSH_DIR']) {
    const value = process.env[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return path.join(os.homedir(), '.dsh')
}

/**
 * Exact decimal → integer cents.
 *
 * Balances are decimal strings; going through `Number` would let `0.1 + 0.2`
 * style error decide whether a cent moved, which is the one thing this plugin
 * must never get wrong. Exponent notation — which no wallet uses — is normalised
 * into a plain digit string first, so both spellings land on the same cent.
 */
function decimalToCents(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const text = String(raw).trim()
  if (text.length === 0 || text.length > 64) return null
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text)
  if (match === null) return null
  const negative = match[1] === '-'
  const intRaw = match[2] ?? ''
  const fractionRaw = match[3] ?? ''
  if (intRaw.length === 0 && fractionRaw.length === 0) return null
  const exponent = match[4] === undefined ? 0 : Number(match[4])
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 40) return null

  // Shift the decimal point inside the digit string; `point` is how many digits
  // sit to its left. No floating point is involved at any stage.
  let digits = intRaw + fractionRaw
  let point = intRaw.length + exponent
  if (point < 0) {
    digits = '0'.repeat(-point) + digits
    point = 0
  } else if (point > digits.length) {
    digits = digits + '0'.repeat(point - digits.length)
  }
  const intPart = digits.slice(0, point) || '0'
  const fraction = digits.slice(point)

  // Round half-up at the third decimal, like the macOS original.
  const kept = (fraction + '00').slice(0, 2)
  const dropped = fraction.slice(2)
  let cents = BigInt(intPart) * 100n + BigInt(kept)
  if (dropped.length > 0 && dropped.charCodeAt(0) >= 0x35) cents += 1n
  if (negative) cents = -cents
  if (cents > 9007199254740991n || cents < -9007199254740991n) return null
  return Number(cents)
}

/**
 * Sum every CNY wallet — recharge and bonus alike — and ignore other currencies
 * rather than inventing an exchange rate. Returns null when no CNY wallet
 * exists, so "USD only" is reported as an error instead of masquerading as ¥0.
 */
function sumCnyCents(wallets, bonusWallets) {
  let total = 0
  let found = false
  for (const wallet of [].concat(wallets ?? [], bonusWallets ?? [])) {
    if (wallet === null || typeof wallet !== 'object') continue
    if (wallet.currency !== 'CNY') continue
    const cents = decimalToCents(wallet.balance)
    if (cents === null) return null
    total += cents
    if (!Number.isSafeInteger(total)) return null
    found = true
  }
  return found ? total : null
}

/** `1234` → `"12.34"`, handling the sign without negating `Int.min`. */
function centsToYuan(cents) {
  const negative = cents < 0
  const magnitude = Math.abs(cents)
  const fraction = magnitude % 100
  return `${negative ? '-' : ''}${Math.floor(magnitude / 100)}.${fraction < 10 ? '0' : ''}${fraction}`
}

/** Credentials are single-line HTTP header values, never arbitrary text. */
function isUsableToken(value) {
  if (typeof value !== 'string') return false
  const key = value.trim()
  if (key.length === 0 || Buffer.byteLength(key) > MAX_API_KEY_BYTES) return false
  for (let index = 0; index < key.length; index += 1) {
    const code = key.charCodeAt(index)
    if (code < 33 || code > 126) return false
  }
  return true
}

/* ------------------------------------------------------------------ *
 * API-key sources
 * ------------------------------------------------------------------ */

/**
 * Read one scalar from the DSH credential file. This is deliberately not a YAML
 * parser: it looks for the single `DEEPSEEK_API_KEY` mapping key and accepts the
 * value only when it is a plausible single-line HTTP credential.
 */
function apiKeyFromCredentialYaml(yaml) {
  const values = []
  for (const line of String(yaml).split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue
    const match = /^\s*DEEPSEEK_API_KEY\s*:\s*(.+?)\s*$/.exec(line)
    if (match === null) continue
    let value = match[1]
    const comment = value.search(/\s#/)
    if (comment >= 0) value = value.slice(0, comment).trim()
    if (value.length >= 2) {
      const first = value[0]
      const last = value[value.length - 1]
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    values.push(value.trim())
  }
  // More than one candidate is ambiguous; refuse rather than guess an account.
  if (values.length !== 1) return null
  return isUsableToken(values[0]) ? values[0].trim() : null
}

/** One bounded, redirect-free HTTPS GET that returns parsed JSON. */
function httpsGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = new URL(url)
    } catch {
      reject(new Error('地址无效'))
      return
    }
    if (target.protocol !== 'https:') {
      reject(new Error('只允许 HTTPS'))
      return
    }
    const request = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port === '' ? undefined : target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        const status = response.statusCode ?? 0
        if (status >= 300 && status < 400) {
          // Never follow a redirect: it could forward the credential elsewhere.
          response.resume()
          reject(new Error(`拒绝重定向（HTTP ${status}）`))
          return
        }
        const chunks = []
        let length = 0
        response.on('data', (chunk) => {
          length += chunk.length
          if (length > MAX_RESPONSE_BYTES) {
            request.destroy()
            reject(new Error('响应过大'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (status !== 200) {
            reject(new Error(`HTTP ${status}`))
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new Error('响应无法解析'))
          }
        })
      },
    )
    request.on('timeout', () => {
      request.destroy(new Error('超时'))
    })
    request.on('error', (cause) => reject(cause))
    request.end()
  })
}

/**
 * `https://api.deepseek.com/user/balance` with a Bearer key.
 *
 * @returns `{ok: true, cents, source}` or `{ok: false, code, message}`
 */
async function readApiKeyBalance(key, source) {
  let payload
  try {
    payload = await httpsGetJson('https://api.deepseek.com/user/balance', {
      accept: 'application/json',
      authorization: `Bearer ${key}`,
      'user-agent': `DSHBalancePet/${VERSION} (${PACKAGE_NAME})`,
    })
  } catch (cause) {
    return { ok: false, code: 'api-key-request', message: `API Key 查询失败：${cause.message}` }
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.balance_infos)) {
    return { ok: false, code: 'api-key-protocol', message: 'API Key 响应缺少 balance_infos' }
  }
  // `total_balance` is denominated by the account; only CNY may be labelled ¥.
  let total = 0
  let found = false
  for (const info of payload.balance_infos) {
    if (!info || typeof info !== 'object') continue
    if (info.currency !== 'CNY') continue
    const cents = decimalToCents(info.total_balance)
    if (cents === null) return { ok: false, code: 'api-key-protocol', message: 'total_balance 无效' }
    total += cents
    found = true
  }
  if (!found) return { ok: false, code: 'api-key-protocol', message: 'API Key 响应没有 CNY 余额' }
  return { ok: true, cents: total, source }
}

/** The key the user saved from the pet's own menu, if any. */
async function readStoredKey(state) {
  try {
    const raw = await fs.readFile(state.apiKeyPath, 'utf8')
    const key = raw.trim()
    return isUsableToken(key) ? key : null
  } catch {
    return null
  }
}

/** Whichever API key is configured, the pet's own taking precedence. */
async function readConfiguredKeyBalance(state) {
  const stored = await readStoredKey(state)
  if (stored !== null) return await readApiKeyBalance(stored, 'API Key（桌宠设置）')

  let yaml
  try {
    yaml = await fs.readFile(path.join(state.dshHome, '.credentials.yaml'), 'utf8')
  } catch {
    return { ok: false, code: 'no-credential', message: '没有可用凭证：未登录 DSH 账号，也没有 API Key' }
  }
  const key = apiKeyFromCredentialYaml(yaml)
  if (key === null) {
    return { ok: false, code: 'no-credential', message: '没有可用凭证：未登录 DSH 账号，也没有 API Key' }
  }
  return await readApiKeyBalance(key, 'DEEPSEEK_API_KEY（~/.dsh/.credentials.yaml）')
}

/* ------------------------------------------------------------------ *
 * Balance acquisition
 * ------------------------------------------------------------------ */

/**
 * One balance reading, from the source the pet asked for.
 *
 * `auto` prefers the account, and reports a genuine account *failure* rather than
 * masking it with a key: when a grant is stored, the account balance is the truth,
 * and a silent fallback would disagree with DSH's own account page. Only "signed
 * out" falls through to a key.
 *
 * @returns `{ok: true, cents, source}` or `{ok: false, code, message}`
 */
async function readBalance(ctx, state) {
  const mode = clampSourceMode(state.sourceMode)
  const account = ctx.get('deepseekAccount')
  const accountUsable = account !== undefined && typeof account.getBalance === 'function'

  if (mode === 'apikey') return await readConfiguredKeyBalance(state)

  if (!accountUsable) {
    if (mode === 'account') {
      return { ok: false, code: 'account-unavailable', message: '这个 DSH 版本没有可用的账号服务' }
    }
    return await readConfiguredKeyBalance(state)
  }

  let outcome
  try {
    outcome = await account.getBalance({
      version: VERSION,
      locale: state.locale,
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    })
  } catch (cause) {
    return {
      ok: false,
      code: 'account-request',
      message: `账号余额查询失败：${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  if (outcome !== null && outcome !== undefined) {
    if (outcome.status === 'failed') {
      return { ok: false, code: 'account-refused', message: '平台拒绝或未能返回余额' }
    }
    if (outcome.status === 'ready') {
      const cents = sumCnyCents(outcome.value, outcome.bonusWallets)
      if (cents === null) {
        return { ok: false, code: 'account-protocol', message: '账号余额没有可用的 CNY 钱包' }
      }
      return { ok: true, cents, source: 'DSH 账号' }
    }
    return { ok: false, code: 'account-protocol', message: '账号余额响应形状未知' }
  }

  // null ⇒ signed out or the grant changed.
  if (mode === 'account') {
    return { ok: false, code: 'no-account', message: '未登录 DSH 账号（余额来源已设为「仅 DSH 账号」）' }
  }
  return await readConfiguredKeyBalance(state)
}

/* ------------------------------------------------------------------ *
 * Poll scheduling
 * ------------------------------------------------------------------ */

/**
 * At most one upstream query in flight, no faster than the configured interval,
 * with doubling backoff after consecutive failures. A `Retry-After` header is not
 * visible through the account seam, so backoff is driven by failures.
 */
function createSchedule(intervalSeconds) {
  return {
    interval: clampInterval(intervalSeconds),
    nextAt: 0,
    inFlight: false,
    failures: 0,
  }
}

function backoffDelay(schedule) {
  const doubled = schedule.interval * Math.pow(2, Math.min(schedule.failures, 4))
  return Math.min(MAX_INTERVAL_SECONDS, doubled)
}

/* ------------------------------------------------------------------ *
 * Doctor
 * ------------------------------------------------------------------ */

function buildDoctorReport(ctx, state) {
  const checks = []
  const check = (id, level, ok, detail) => checks.push({ id, level, ok: Boolean(ok), detail })

  const account = ctx.get('deepseekAccount')
  check(
    'deepseekAccount.getBalance',
    'required',
    typeof account?.getBalance === 'function',
    'ctx.get("deepseekAccount").getBalance({version,locale,timezoneOffsetSeconds}) — Host-only account seam',
  )
  check(
    'webServer.register',
    'required',
    typeof ctx.get('webServer')?.register === 'function',
    'ctx.get("webServer").register({kind,path,handler}) — carries the Client↔Host bridge',
  )
  check('asset-directory', 'required', state.assetsPresent, `artwork under ${state.assetDir}`)
  check(
    'fallback:API-key',
    'fallback',
    true,
    'used when the account is signed out or 余额来源 is set to the key; reads ' +
      `${state.apiKeyPath} then ${path.join(state.dshHome, '.credentials.yaml')}`,
  )
  check(
    'api-key-file',
    'info',
    true,
    state.apiKeyStored
      ? `a key is stored at ${state.apiKeyPath}; set or cleared from 设置 API Key… in the pet's right-click menu`
      : `no key stored yet at ${state.apiKeyPath}; 设置 API Key… in the pet's right-click menu writes it`,
  )
  check(
    'client-report',
    'info',
    state.clientReport !== null,
    'the browser half reporting what it painted; absent until a page with the plugin open polls /state',
  )

  const required = checks.filter((entry) => entry.level === 'required')
  return {
    plugin: PACKAGE_NAME,
    version: VERSION,
    adaptedFor: ADAPTED_FOR,
    dshHome: state.dshHome,
    assetDir: state.assetDir,
    apiKeyPath: state.apiKeyPath,
    apiKeyStored: state.apiKeyStored,
    sourceMode: clampSourceMode(state.sourceMode),
    ok: required.every((entry) => entry.ok),
    requiredFailures: required.filter((entry) => !entry.ok).map((entry) => entry.id),
    checks,
    client: state.clientReport,
    reading: snapshotReading(state),
  }
}

/**
 * The browser's own report of what it painted. Treated strictly as untrusted
 * display data: every field is re-typed and bounded here, nothing is ever used as
 * a path, a URL or an expression, and a malformed report is simply dropped.
 */
function parseClientReport(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const text = (value, max) => (typeof value === 'string' && value.length <= max ? value : null)
  const number = (value) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null
  return {
    art: text(parsed.art, 48),
    appearance: text(parsed.appearance, 32),
    expression: text(parsed.expression, 32),
    sizeMode: text(parsed.sizeMode, 16),
    side: number(parsed.side),
    sprite: parsed.sprite === true,
    offline: parsed.offline === true,
    connected: parsed.connected === true,
    width: number(parsed.width),
    height: number(parsed.height),
    left: number(parsed.left),
    bottom: number(parsed.bottom),
    steps: number(parsed.steps),
    topups: number(parsed.topups),
    painHold: number(parsed.painHold),
    hidden: parsed.hidden === true,
    menuOpen: parsed.menuOpen === true,
    at: Date.now(),
  }
}

/** The reading as the browser sees it: numbers and labels, never a credential. */
function snapshotReading(state) {
  const reading = state.reading
  const schedule = state.schedule
  return {
    rev: reading === null ? 0 : reading.rev,
    cents: reading !== null && reading.ok ? reading.cents : null,
    display: reading !== null && reading.ok ? centsToYuan(reading.cents) : null,
    source: reading === null ? null : reading.source ?? null,
    ok: reading !== null && reading.ok,
    error: reading !== null && !reading.ok ? reading.message : null,
    at: reading === null ? null : reading.at,
    interval: schedule.interval,
    nextInMs: Math.max(0, Math.round(schedule.nextAt - Date.now())),
    sourceMode: clampSourceMode(state.sourceMode),
    apiKeyStored: state.apiKeyStored,
  }
}

let readingSequence = 0

function recordReading(state, outcome) {
  const previous = state.reading
  const cents = outcome.ok ? outcome.cents : null
  // `rev` advances only when the money actually moved (or the reading newly
  // succeeded/failed). The browser animates on a change of `rev`, so an unchanged
  // poll can never replay a deduction.
  const changed = previous === null || previous.ok !== outcome.ok || previous.cents !== cents
  readingSequence += 1
  state.reading = {
    rev: changed ? readingSequence : previous.rev,
    ok: outcome.ok,
    cents,
    source: outcome.source,
    message: outcome.message,
    at: Date.now(),
  }
}

/** Run one upstream query, honouring "one in flight" and backoff. */
function refreshBalance(ctx, state, options = {}) {
  const schedule = state.schedule
  const now = Date.now()
  if (schedule.inFlight) return state.inFlight
  if (!options.force && now < schedule.nextAt) return null

  schedule.inFlight = true
  state.inFlight = (async () => {
    let outcome
    try {
      outcome = await readBalance(ctx, state)
    } catch (cause) {
      outcome = {
        ok: false,
        code: 'unexpected',
        message: cause instanceof Error ? cause.message : String(cause),
      }
    }
    recordReading(state, outcome)
    schedule.inFlight = false
    if (outcome.ok) {
      schedule.failures = 0
      schedule.nextAt = Date.now() + schedule.interval * 1000
    } else {
      schedule.failures += 1
      schedule.nextAt = Date.now() + backoffDelay(schedule) * 1000
      ctx.logger?.warn?.(`[${PACKAGE_NAME}] ${outcome.code}: ${outcome.message}`)
    }
    return state.reading
  })().finally(() => {
    schedule.inFlight = false
    state.inFlight = null
  })
  return state.inFlight
}

/* ------------------------------------------------------------------ *
 * HTTP face
 * ------------------------------------------------------------------ */

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  }
  if (typeof response.writeHead === 'function') {
    response.writeHead(status, headers)
    response.end(body)
    return
  }
  response.statusCode = status
  for (const [key, value] of Object.entries(headers)) response.setHeader(key, value)
  response.end(body)
}

function readQuery(request) {
  const raw = safeGet(() => request.url, '')
  const index = typeof raw === 'string' ? raw.indexOf('?') : -1
  const query = index < 0 ? '' : raw.slice(index + 1)
  const result = {}
  for (const pair of query.split('&')) {
    if (pair.length === 0) continue
    const equals = pair.indexOf('=')
    const key = equals < 0 ? pair : pair.slice(0, equals)
    const value = equals < 0 ? '' : pair.slice(equals + 1)
    try {
      result[decodeURIComponent(key)] = decodeURIComponent(value)
    } catch {
      /* a malformed pair is simply ignored */
    }
  }
  return result
}

async function readJsonBody(request) {
  if (typeof request.json === 'function') return await request.json()
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > 64 * 1024) throw new Error('请求体过大')
    chunks.push(Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return {}
  return JSON.parse(text)
}

/**
 * Serve one artwork file.
 *
 * The name is matched against an allowlist before any path is built, so no
 * request can escape the asset directory. These bytes are artwork, not user data,
 * so no header guard is required — and `<img>`/CSS loads could not set one anyway.
 */
async function serveAsset(state, request, response) {
  const name = path.basename(String(readQuery(request).file ?? ''))
  if (!ASSET_FILES.has(name)) {
    sendJson(response, 404, { ok: false, code: 'unknown-asset', message: '未知的图片' })
    return
  }
  let bytes
  try {
    bytes = await fs.readFile(path.join(state.assetDir, name))
  } catch {
    sendJson(response, 404, { ok: false, code: 'missing-asset', message: '图片不可读' })
    return
  }
  const headers = {
    'content-type': 'image/webp',
    'content-length': bytes.length,
    'cache-control': 'public, max-age=3600',
  }
  if (typeof response.writeHead === 'function') response.writeHead(200, headers)
  else {
    response.statusCode = 200
    for (const [key, value] of Object.entries(headers)) response.setHeader(key, value)
  }
  response.end(bytes)
}

/** Write the pet's own API key (or clear it) with the tightest mode available. */
async function storeApiKey(ctx, state, raw) {
  const clearing = raw === null || raw === undefined || String(raw).trim().length === 0
  if (clearing) {
    await fs.rm(state.apiKeyPath, { force: true }).catch(() => {})
    state.apiKeyStored = false
    state.schedule.nextAt = 0
    return { cleared: true, stored: false }
  }
  const key = String(raw).trim()
  if (!isUsableToken(key)) {
    const error = new Error('API Key 必须是单行、可打印的凭证文本')
    error.code = 'bad-key'
    throw error
  }
  await fs.mkdir(path.dirname(state.apiKeyPath), { recursive: true, mode: 0o700 })
  // A 0600 temporary file renamed over the destination: a failure leaves the
  // previous key intact and there is never a world-readable interval.
  const temporary = `${state.apiKeyPath}.${process.pid}.tmp`
  await fs.writeFile(temporary, key, { mode: 0o600 })
  await fs.rename(temporary, state.apiKeyPath)
  state.apiKeyStored = true
  // The next poll must use it at once rather than waiting out the interval.
  state.schedule.nextAt = 0
  ctx.logger?.info?.(`[${PACKAGE_NAME}] API key stored at ${state.apiKeyPath}`)
  return { cleared: false, stored: true }
}

function registerRoutes(ctx, state) {
  whenService(ctx, 'webServer', (webServer) => {
    if (state.routesRegistered) return
    state.routesRegistered = true

    const guard = (label, register) => {
      try {
        return register()
      } catch (cause) {
        ctx.logger?.warn?.(
          `[${PACKAGE_NAME}] could not register the ${label} route: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
        return undefined
      }
    }

    const guarded = (handler) => (request, response) => {
      Promise.resolve()
        .then(() => handler(request, response))
        .catch((cause) => {
          const code = (cause && cause.code) || 'route-failed'
          const message = cause instanceof Error ? cause.message : String(cause)
          ctx.logger?.warn?.(`[${PACKAGE_NAME}] route failed: ${message}`)
          sendJson(response, code === 'bad-key' ? 400 : 500, { ok: false, code, message })
        })
    }

    const requireHeader = (request, response) => {
      const value = safeGet(() => request.headers?.[REQUIRED_HEADER], undefined)
      if (typeof value !== 'string' || value.length === 0) {
        sendJson(response, 403, {
          ok: false,
          code: 'forbidden',
          message: `missing ${REQUIRED_HEADER} header`,
        })
        return false
      }
      return true
    }

    guard(
      'doctor',
      () =>
        ctx.effect(() =>
          webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/doctor`,
            handler: guarded((request, response) => {
              sendJson(response, 200, buildDoctorReport(ctx, state))
            }),
          }),
        ),
    )

    guard(
      'state',
      () =>
        ctx.effect(() =>
          webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/state`,
            handler: guarded(async (request, response) => {
              if (!requireHeader(request, response)) return
              const query = readQuery(request)
              const clientReport = parseClientReport(query.report)
              if (clientReport !== null) state.clientReport = clientReport

              const requested = clampInterval(query.interval)
              if (requested !== state.schedule.interval) {
                state.schedule.interval = requested
                state.schedule.nextAt = Math.min(state.schedule.nextAt, Date.now())
              }
              const mode = clampSourceMode(query.source)
              if (mode !== state.sourceMode) {
                // Changing where the number comes from invalidates the backoff and
                // must be visible on this very response, not after the interval.
                state.sourceMode = mode
                state.schedule.failures = 0
                state.schedule.nextAt = 0
                state.reading = null
              }

              if (state.reading === null) {
                // First call after a page load: answer with a real number rather
                // than an empty shell, but never hold the socket open forever.
                const pending = refreshBalance(ctx, state, { force: true })
                if (pending !== null) {
                  await Promise.race([
                    pending,
                    new Promise((resolve) => setTimeout(resolve, REQUEST_TIMEOUT_MS + 2000)),
                  ])
                }
              } else {
                // Fire-and-forget: the caller gets the current cached reading and
                // the next call sees the update. This keeps the route instant.
                refreshBalance(ctx, state)
              }
              sendJson(response, 200, { ok: true, ...snapshotReading(state) })
            }),
          }),
        ),
    )

    guard(
      'refresh',
      () =>
        ctx.effect(() =>
          webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/refresh`,
            handler: guarded(async (request, response) => {
              if (!requireHeader(request, response)) return
              const mode = clampSourceMode(readQuery(request).source)
              state.sourceMode = mode
              const pending = refreshBalance(ctx, state, { force: true })
              if (pending !== null) {
                await Promise.race([
                  pending,
                  new Promise((resolve) => setTimeout(resolve, REQUEST_TIMEOUT_MS + 2000)),
                ])
              }
              sendJson(response, 200, { ok: true, ...snapshotReading(state) })
            }),
          }),
        ),
    )

    guard(
      'apikey',
      () =>
        ctx.effect(() =>
          webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/apikey`,
            handler: guarded(async (request, response) => {
              if (!requireHeader(request, response)) return
              const method = safeGet(() => request.method, 'GET')
              if (method !== 'POST' && method !== 'DELETE') {
                sendJson(response, 405, { ok: false, code: 'method', message: 'use POST or DELETE' })
                return
              }
              let raw = null
              if (method === 'POST') {
                const body = await readJsonBody(request)
                raw = body === null || typeof body !== 'object' ? null : body.key
              }
              const outcome = await storeApiKey(ctx, state, raw)
              // A key change must be reflected on the next reading, not after the
              // interval, so this forces one query.
              const pending = refreshBalance(ctx, state, { force: true })
              if (pending !== null) {
                await Promise.race([
                  pending,
                  new Promise((resolve) => setTimeout(resolve, REQUEST_TIMEOUT_MS + 2000)),
                ])
              }
              sendJson(response, 200, {
                ok: true,
                cleared: outcome.cleared,
                stored: outcome.stored,
                reading: snapshotReading(state),
              })
            }),
          }),
        ),
    )

    guard(
      'asset',
      () =>
        ctx.effect(() =>
          webServer.register({
            kind: 'exact',
            path: `${ROUTE_PREFIX}/asset`,
            handler: guarded((request, response) => serveAsset(state, request, response)),
          }),
        ),
    )

    ctx.logger?.info?.(
      `[${PACKAGE_NAME}] routes ready: GET ${ROUTE_PREFIX}/doctor, GET ${ROUTE_PREFIX}/state, ` +
        `POST ${ROUTE_PREFIX}/refresh, POST|DELETE ${ROUTE_PREFIX}/apikey, GET ${ROUTE_PREFIX}/asset?file=…`,
    )
  })
}

/** Run `whenReady(service)` as soon as `name` is resolvable, then stop caring. */
function whenService(ctx, name, whenReady) {
  const ready = ctx.get(name)
  if (ready !== undefined) {
    whenReady(ready)
    return
  }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject([name], (scoped) => {
        const service = scoped.get(name)
        if (service !== undefined) whenReady(service)
      })
      return
    } catch {
      /* fall through to polling */
    }
  }
  let attempts = 0
  const interval = setInterval(() => {
    attempts += 1
    const service = ctx.get(name)
    if (service !== undefined) {
      clearInterval(interval)
      whenReady(service)
      return
    }
    if (attempts >= 240) {
      clearInterval(interval)
      ctx.logger?.warn?.(`[${PACKAGE_NAME}] gave up waiting for service "${name}"`)
    }
  }, 250)
  if (interval.unref) interval.unref()
  ctx.effect(() => () => clearInterval(interval))
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

/**
 * Whether the artwork is where this package expects it.
 *
 * Deliberately synchronous: the doctor route is a health check, and an
 * asynchronously-populated flag would let a request that arrives during boot
 * report a missing-assets failure that is not real.
 */
function assetsPresent(assetDir) {
  for (const name of ASSET_FILES) {
    try {
      if (fsSync.existsSync(path.join(assetDir, name))) return true
    } catch {
      return false
    }
  }
  return false
}

function apply(ctx) {
  const dshHome = resolveDshHome(ctx)
  const assetDir = path.join(__dirname, '..', 'assets')
  const apiKeyPath = path.join(dshHome, 'balance-pet', 'apikey.txt')
  const state = {
    dshHome,
    assetDir,
    apiKeyPath,
    assetsPresent: assetsPresent(assetDir),
    apiKeyStored: fsSync.existsSync(apiKeyPath),
    routesRegistered: false,
    locale: 'zh_CN',
    sourceMode: DEFAULT_SOURCE_MODE,
    reading: null,
    clientReport: null,
    inFlight: null,
    schedule: createSchedule(
      safeGet(() => ctx.config && ctx.config.pollSeconds, DEFAULT_INTERVAL_SECONDS),
    ),
  }

  const report = buildDoctorReport(ctx, state)
  if (report.requiredFailures.length > 0) {
    ctx.logger?.warn?.(
      `[${PACKAGE_NAME}] ${VERSION} needs adaptation for this DSH build — missing: ` +
        `${report.requiredFailures.join(', ')}. GET ${ROUTE_PREFIX}/doctor explains what to change.`,
    )
  } else {
    ctx.logger?.info?.(`[${PACKAGE_NAME}] ${VERSION} ready (dshHome=${dshHome})`)
  }

  registerRoutes(ctx, state)
}

exports.name = PACKAGE_NAME
exports.apply = apply
exports.VERSION = VERSION
/** Exported for the offline test suite and the adaptation workflow. */
exports.decimalToCents = decimalToCents
exports.sumCnyCents = sumCnyCents
exports.centsToYuan = centsToYuan
exports.apiKeyFromCredentialYaml = apiKeyFromCredentialYaml
exports.isUsableToken = isUsableToken
exports.clampInterval = clampInterval
exports.clampSourceMode = clampSourceMode
exports.parseClientReport = parseClientReport
exports.buildDoctorReport = buildDoctorReport
exports.ASSET_FILES = ASSET_FILES
