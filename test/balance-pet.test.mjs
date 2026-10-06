/**
 * dsh-plugin-balance-pet — offline test suite (zero dependencies).
 *
 *   node test/balance-pet.test.mjs
 *
 * It covers the things that can silently go wrong without a browser:
 *   1. the money math, the API-key parsing and the balance-source rules;
 *   2. the accounting + animation model and the geometry, loaded straight out of
 *      the shipped bundle so the test cannot drift from the bytes the browser runs;
 *   3. the routes end to end, against a fake Cordis context.
 *
 * The last group is the scope guard for this fork: the sound, the test/demo
 * rehearsals and the standalone settings page must all stay gone, while the
 * right-click menu must keep its 显示 / 余额 structure.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(here, '..')
const require = createRequire(import.meta.url)

let passed = 0
let failed = 0
const failures = []
const entries = []

function test(name, run) {
  entries.push({ kind: 'test', name, run })
}

function group(title) {
  entries.push({ kind: 'group', title })
}

/** Tests may be synchronous or asynchronous; they run strictly in order. */
async function runAll() {
  for (const entry of entries) {
    if (entry.kind === 'group') {
      process.stdout.write(`\n${entry.title}\n`)
      continue
    }
    try {
      await entry.run()
      passed += 1
      process.stdout.write(`  ok   ${entry.name}\n`)
    } catch (error) {
      failed += 1
      failures.push({ name: entry.name, error })
      process.stdout.write(`  FAIL ${entry.name}\n         ${error.message.split('\n').join('\n         ')}\n`)
    }
  }
}

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`)

/* ------------------------------------------------------------------ *
 * Host half
 * ------------------------------------------------------------------ */

const host = require(path.join(packageDir, 'src', 'index.js'))

group('Host · exact money math')

test('parses whole, fractional and signed decimals', () => {
  assert.equal(host.decimalToCents('0'), 0)
  assert.equal(host.decimalToCents('12.34'), 1234)
  assert.equal(host.decimalToCents('12.3'), 1230)
  assert.equal(host.decimalToCents('12'), 1200)
  assert.equal(host.decimalToCents('-0.01'), -1)
  assert.equal(host.decimalToCents('0.001'), 0)
  assert.equal(host.decimalToCents('0.005'), 1)
  assert.equal(host.decimalToCents('0.0049999'), 0)
})

test('a float-hostile pair still sums to the exact cent', () => {
  // 0.1 + 0.2 in binary floating point is 0.30000000000000004; in cents it is 30.
  assert.equal(host.decimalToCents('0.1') + host.decimalToCents('0.2'), 30)
  assert.equal(host.decimalToCents('8.29'), 829)
  assert.equal(host.decimalToCents('1.005'), 101)
})

test('rejects non-scalars and out-of-range values', () => {
  assert.equal(host.decimalToCents(''), null)
  assert.equal(host.decimalToCents('abc'), null)
  assert.equal(host.decimalToCents('1.2.3'), null)
  assert.equal(host.decimalToCents(null), null)
  assert.equal(host.decimalToCents(undefined), null)
  assert.equal(host.decimalToCents('1e999'), null)
  assert.equal(host.decimalToCents('x'.repeat(80)), null)
})

test('exponent notation rounds to the cent exactly like the plain spelling', () => {
  assert.equal(host.decimalToCents('1e2'), 10_000)
  assert.equal(host.decimalToCents('1.5e1'), 1500)
  assert.equal(host.decimalToCents('1.234e0'), 123)
  // The same number spelled three ways must give the same cent, always.
  assert.equal(host.decimalToCents('1.005e0'), 101)
  assert.equal(host.decimalToCents('1.005'), 101)
  assert.equal(host.decimalToCents('100.5e-2'), 101)
  assert.equal(host.decimalToCents('1e-3'), 0)
})

test('a bare fraction and a trailing dot are accepted like the platform regex', () => {
  assert.equal(host.decimalToCents('.5'), 50)
  assert.equal(host.decimalToCents('1.'), 100)
  assert.equal(host.decimalToCents('.'), null)
  assert.equal(host.decimalToCents('e5'), null)
})

test('sums CNY wallets across recharge and bonus, ignoring other currencies', () => {
  assert.equal(
    host.sumCnyCents([{ currency: 'CNY', balance: '10.00' }], [{ currency: 'CNY', balance: '2.50' }]),
    1250,
  )
  assert.equal(
    host.sumCnyCents([{ currency: 'USD', balance: '99.99' }, { currency: 'CNY', balance: '1.00' }], []),
    100,
  )
})

test('USD never masquerades as ¥0', () => {
  assert.equal(host.sumCnyCents([{ currency: 'USD', balance: '5.00' }], []), null)
  assert.equal(host.sumCnyCents([], []), null)
  assert.equal(host.sumCnyCents(undefined, undefined), null)
})

test('a malformed wallet fails the whole reading instead of under-reporting', () => {
  assert.equal(host.sumCnyCents([{ currency: 'CNY', balance: 'oops' }], []), null)
})

test('formats cents back to yuan, including negatives and the sub-ten fraction', () => {
  assert.equal(host.centsToYuan(1234), '12.34')
  assert.equal(host.centsToYuan(1204), '12.04')
  assert.equal(host.centsToYuan(5), '0.05')
  assert.equal(host.centsToYuan(0), '0.00')
  assert.equal(host.centsToYuan(-1), '-0.01')
  assert.equal(host.centsToYuan(-1204), '-12.04')
})

group('Host · credentials, source modes and hygiene')

test('reads a single DEEPSEEK_API_KEY and strips quotes', () => {
  assert.equal(host.apiKeyFromCredentialYaml('DEEPSEEK_API_KEY: sk-abc\n'), 'sk-abc')
  assert.equal(host.apiKeyFromCredentialYaml('DEEPSEEK_API_KEY: "sk-abc"\n'), 'sk-abc')
  assert.equal(host.apiKeyFromCredentialYaml("DEEPSEEK_API_KEY: 'sk-abc'\n"), 'sk-abc')
  assert.equal(host.apiKeyFromCredentialYaml('DEEPSEEK_API_KEY: sk-abc # mine\n'), 'sk-abc')
})

test('refuses an ambiguous or absent key rather than guessing an account', () => {
  assert.equal(host.apiKeyFromCredentialYaml('other: 1\n'), null)
  assert.equal(host.apiKeyFromCredentialYaml('DEEPSEEK_API_KEY: a\nDEEPSEEK_API_KEY: b\n'), null)
  assert.equal(host.apiKeyFromCredentialYaml('DEEPSEEK_API_KEY: \n'), null)
  assert.equal(host.apiKeyFromCredentialYaml('DEEPSEEK_API_KEY: sk-a b\n'), null)
})

test('a usable API key is one printable single line', () => {
  assert.equal(host.isUsableToken('sk-abc123'), true)
  assert.equal(host.isUsableToken('  sk-abc123  '), true)
  assert.equal(host.isUsableToken(''), false)
  assert.equal(host.isUsableToken('   '), false)
  assert.equal(host.isUsableToken('sk-abc\n123'), false)
  assert.equal(host.isUsableToken('x'.repeat(5000)), false)
  assert.equal(host.isUsableToken(undefined), false)
  assert.equal(host.isUsableToken(42), false)
})

test('clamps the poll interval to the shipped floor and ceiling', () => {
  assert.equal(host.clampInterval(30), 30)
  assert.equal(host.clampInterval(1), 10)
  assert.equal(host.clampInterval(99_999), 300)
  assert.equal(host.clampInterval('60'), 60)
  assert.equal(host.clampInterval(undefined), 30)
  assert.equal(host.clampInterval(Number.NaN), 30)
})

test('only the three known balance sources are accepted', () => {
  assert.equal(host.clampSourceMode('auto'), 'auto')
  assert.equal(host.clampSourceMode('account'), 'account')
  assert.equal(host.clampSourceMode('apikey'), 'apikey')
  assert.equal(host.clampSourceMode('nope'), 'auto')
  assert.equal(host.clampSourceMode(undefined), 'auto')
  assert.equal(host.clampSourceMode('../etc'), 'auto')
})

test('the plugin version is a release version and both halves agree on it', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'))
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'the manifest version must be a release version')
  assert.equal(host.VERSION, manifest.version, 'the Host half must report the manifest version')
})

test('the asset allowlist names exactly the eight shipped files', () => {
  const onDisk = fs
    .readdirSync(path.join(packageDir, 'assets'))
    .filter((name) => name.endsWith('.webp'))
    .sort()
  const allowed = [...host.ASSET_FILES].sort()
  assert.deepEqual(allowed, onDisk)
  for (const name of allowed) {
    assert.ok(!name.includes('/') && !name.includes('..'), `${name} must be a bare file name`)
  }
})

test('the client self-report is bounded and re-typed, never trusted verbatim', () => {
  const report = host.parseClientReport(
    JSON.stringify({
      art: 'expression-22',
      appearance: 'deepseek',
      expression: '22',
      sizeMode: 'custom',
      side: 240,
      sprite: true,
      offline: false,
      connected: true,
      width: 252,
      height: 372,
      steps: 12,
      topups: 1,
      painHold: 0.4,
      hidden: true,
      menuOpen: true,
      evil: '../../etc/passwd',
    }),
  )
  assert.equal(report.art, 'expression-22')
  assert.equal(report.expression, '22')
  assert.equal(report.sizeMode, 'custom')
  assert.equal(report.side, 240)
  assert.equal(report.painHold, 0.4)
  assert.equal(report.hidden, true)
  assert.equal(report.menuOpen, true)
  assert.equal(report.evil, undefined, 'unknown fields must not survive')
  assert.equal(typeof report.at, 'number')
})

test('a malformed or oversized self-report is dropped, not stored', () => {
  assert.equal(host.parseClientReport('not json'), null)
  assert.equal(host.parseClientReport('[1,2,3]'), null)
  assert.equal(host.parseClientReport('"a string"'), null)
  assert.equal(host.parseClientReport('null'), null)
  assert.equal(host.parseClientReport(''), null)
  assert.equal(host.parseClientReport(undefined), null)
  assert.equal(host.parseClientReport('x'.repeat(1200)), null)
  const odd = host.parseClientReport(JSON.stringify({ appearance: 42, sizeMode: {}, sprite: 'yes' }))
  assert.equal(odd.appearance, null)
  assert.equal(odd.sizeMode, null)
  assert.equal(odd.sprite, false)
})

/* ------------------------------------------------------------------ *
 * Client half — loaded from the shipped bundle
 * ------------------------------------------------------------------ */

function createSandbox(storage) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    isFinite,
    Image: function Image() {},
    AbortController: function AbortController() {
      this.abort = () => {}
      this.signal = {}
    },
    fetch: () => Promise.resolve({ json: () => Promise.resolve({}), ok: true }),
    navigator: { language: 'zh-CN' },
    document: {
      documentElement: { lang: 'zh-CN' },
      head: { appendChild() {} },
      querySelector: () => null,
      createElement: () => ({ getContext: () => null, style: {}, dataset: {} }),
      body: { style: {} },
      visibilityState: 'visible',
    },
  }
  const definition = { current: null }
  sandbox.window = {
    __ModuleLoader__: {
      load: (value) => {
        definition.current = value
      },
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 1,
    performance: { now: () => 0 },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: sandbox.document,
  }
  sandbox.globalThis = sandbox
  return { sandbox, definition }
}

function loadClientBundle(storage = new Map()) {
  const source = fs.readFileSync(path.join(packageDir, 'src', 'client.js'), 'utf8')
  const { sandbox, definition } = createSandbox(storage)
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  assert.ok(definition.current !== null, 'the bundle did not register a module loader factory')
  assert.equal(definition.current.id, 'dsh-plugin-balance-pet')
  const fakeReact = {
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useRef: () => ({ current: null }),
    createElement: () => null,
    Fragment: function Fragment() {},
  }
  const plugin = definition.current.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require(${name}) — the bundle must stay on the platform baseline`)
  })
  assert.deepEqual([...plugin.inject], ['slots'])
  assert.equal(typeof plugin.apply, 'function')
  return { plugin, internals: plugin.__internals, source, storage }
}

const { internals, source: clientSource, storage: clientStorage } = loadClientBundle()
const {
  createModel,
  modelApply,
  modelTick,
  modelNeedsFrame,
  modelDraining,
  modelPained,
  modelImpact,
  constants,
} = internals

group('Client · drop animation is one cent per 0.2 s')

test('the shipped constants match the desktop original', () => {
  assert.equal(constants.STEP_INTERVAL, 0.2)
  assert.equal(constants.HIT_DURATION, 0.55)
  assert.equal(constants.FLOAT_LIFETIME, 0.95)
  assert.equal(constants.TOPUP_DURATION, 0.9)
  assert.equal(constants.MAX_PENDING_STEPS, 400)
})

test('the first reading aligns and queues nothing', () => {
  const model = createModel()
  modelApply(model, 1000, true)
  assert.equal(model.bookedCents, 1000)
  assert.equal(model.realCents, 1000)
  assert.equal(model.pendingSteps, 0)
  assert.equal(modelNeedsFrame(model), false)
  assert.equal(modelDraining(model), false)
})

test('a drop queues exactly one step per cent', () => {
  const model = createModel()
  modelApply(model, 1000, true)
  modelApply(model, 990, false)
  assert.equal(model.pendingSteps, 10)
  assert.equal(model.bookedCents, 1000, 'the display must not jump')
  assert.equal(modelNeedsFrame(model), true)
  assert.equal(modelDraining(model), true, 'the pained expression is worn while draining')
})

test('each step costs one cent and floats exactly one -0.01', () => {
  const model = createModel()
  modelApply(model, 1000, true)
  modelApply(model, 998, false)
  assert.equal(modelTick(model, 0.2), true)
  assert.equal(model.bookedCents, 999)
  assert.equal(model.pendingSteps, 1)
  assert.equal(model.steps, 1)
  assert.equal(model.floating.length, 1)
  assert.equal(model.floating[0].text, '-0.01')
  assert.equal(model.floating[0].kind, 'down')
  close(model.shakeTime, 0.55)
  close(model.flashTime, 0.55)
  assert.equal(modelImpact(model) >= 0, true)
})

test('the beat holds at 0.2 s per step with no drift over five seconds', () => {
  const model = createModel()
  modelApply(model, 1000, true)
  modelApply(model, 900, false)
  const fires = []
  let elapsed = 0
  const step = 1 / 60
  for (let index = 0; index < 300; index += 1) {
    elapsed += step
    if (modelTick(model, step)) fires.push(elapsed)
  }
  // One step at the first frame, then every 0.2 s: 1 + 25 within 5 s.
  assert.equal(fires.length, 26)
  for (let index = 2; index < fires.length; index += 1) {
    const gap = fires[index] - fires[index - 1]
    assert.ok(gap >= 0.2 - 1e-9, `gap ${index} was ${gap}`)
    assert.ok(gap <= 0.2 + step + 1e-9, `gap ${index} was ${gap}`)
  }
  assert.equal(model.pendingSteps, 100 - 26)
})

test('a repeated poll never replays money already animated', () => {
  const model = createModel()
  modelApply(model, 1000, true)
  modelApply(model, 990, false)
  modelTick(model, 0.2) // booked 999
  modelApply(model, 990, false)
  assert.equal(model.pendingSteps, 9, 'must re-derive from the lagging display, not queue 10 again')
})

test('a fresh deduction extends the queue instead of restarting it', () => {
  const model = createModel()
  modelApply(model, 1000, true)
  modelApply(model, 990, false)
  modelTick(model, 0.2) // booked 999, 9 left
  modelApply(model, 985, false)
  assert.equal(model.pendingSteps, 14, '999 - 985: already-animated cents stay animated')
  assert.equal(model.realCents, 985)
})

test('exactly 400 cents still animates; 401 aligns immediately', () => {
  const atLimit = createModel()
  modelApply(atLimit, 10_000, true)
  modelApply(atLimit, 9600, false)
  assert.equal(atLimit.pendingSteps, 400)
  assert.equal(atLimit.bookedCents, 10_000)

  const overLimit = createModel()
  modelApply(overLimit, 10_000, true)
  modelApply(overLimit, 9599, false)
  assert.equal(overLimit.pendingSteps, 0)
  assert.equal(overLimit.bookedCents, 9599, 'a huge jump aligns instead of playing for minutes')
})

test('a huge jump does not leave a queue behind', () => {
  const model = createModel()
  modelApply(model, 100_000, true)
  modelApply(model, 0, false)
  assert.equal(model.bookedCents, 0)
  assert.equal(model.pendingSteps, 0)
  assert.equal(modelNeedsFrame(model), false)
})

group('Client · top-up')

test('a top-up shows immediately from two consecutive server readings', () => {
  const model = createModel()
  modelApply(model, 1000, true)
  modelApply(model, 990, false)
  modelApply(model, 1200, false)
  assert.equal(model.bookedCents, 1200, 'the new balance must show at once')
  assert.equal(model.pendingSteps, 0, 'the pending drop is dropped, not played after the credit')
  close(model.topupTime, 0.9)
  const credit = model.floating.filter((label) => label.kind === 'up')
  assert.equal(credit.length, 1)
  assert.equal(credit[0].text, '+2.10', '2.10 = 12.00 - 9.90, the two server readings')
})

test('the credit is measured from server readings, never from the lagging display', () => {
  const model = createModel()
  modelApply(model, 500, true)
  modelApply(model, 400, false)
  modelApply(model, 450, false)
  assert.equal(model.bookedCents, 450)
  const credit = model.floating.filter((label) => label.kind === 'up')
  assert.equal(credit.length, 1)
  assert.equal(credit[0].text, '+0.50', 'not relative to the display 5.00 and not +1.00')
})

test('an unchanged reading is a no-op', () => {
  const model = createModel()
  modelApply(model, 777, true)
  modelApply(model, 777, false)
  assert.equal(model.pendingSteps, 0)
  assert.equal(model.floating.length, 0)
  assert.equal(modelNeedsFrame(model), false)
})

group('Client · labels, clamping and formats')

test('labels expire after 0.95 s of animation time', () => {
  const model = createModel()
  modelApply(model, 100, true)
  modelApply(model, 99, false)
  modelTick(model, 0.2)
  assert.equal(model.floating.length, 1)
  for (let index = 0; index < 20; index += 1) modelTick(model, 0.1)
  assert.equal(model.floating.length, 0)
})

test('a long burst of frames cannot grow the label list past its cap', () => {
  const model = createModel()
  modelApply(model, 100_000, true)
  modelApply(model, 99_900, false)
  for (let index = 0; index < 400; index += 1) modelTick(model, 0.05)
  assert.ok(model.floating.length <= 60, `label list grew to ${model.floating.length}`)
})

test('one long frame (a woken tab) fires at most one step', () => {
  const model = createModel()
  modelApply(model, 100, true)
  modelApply(model, 90, false)
  modelTick(model, 5)
  assert.equal(model.pendingSteps, 9, 'the delta is capped at 0.1 s, never replayed in a burst')
  assert.equal(model.steps, 1)
})

test('yen formatting keeps two fraction digits', () => {
  assert.equal(internals.centsToYuan(0), '0.00')
  assert.equal(internals.centsToYuan(5), '0.05')
  assert.equal(internals.centsToYuan(1234), '12.34')
  assert.equal(internals.centsToYuan(-1), '-0.01')
  assert.equal(internals.centsToYuan(99_999_999), '999999.99')
})

test('the clamp helper never returns NaN', () => {
  assert.equal(internals.clamp(5, 0, 10), 5)
  assert.equal(internals.clamp(-5, 0, 10), 0)
  assert.equal(internals.clamp(50, 0, 10), 10)
  assert.equal(internals.clamp(Number.NaN, 3, 10), 3)
})

group('Client · geometry across two artwork shapes')

test('the wide macOS artwork keeps the original proportions', () => {
  const box = internals.layout(150, internals.ART_WIDE)
  close(box.width, 225)
  close(box.height, 232.5)
  close(box.spriteWidth, 211.5)
  close(box.spriteHeight, 141)
  close(box.spriteLeft, 6.75)
  close(box.spriteTop, 87)
  close(box.bodyTop, 82.5)
})

test('the square D-16BVM artwork gets a square box that still fits', () => {
  const box = internals.layout(150, internals.ART_DEEPSEEK)
  close(box.height, 232.5)
  close(box.spriteWidth, 141)
  close(box.spriteHeight, 141)
  // The box is always the sprite plus the same 0.09·side shake margin, so the
  // square art simply gets a narrower box rather than a stretched one.
  close(box.width, 154.5)
  close(box.spriteLeft, 6.75)
  close(box.spriteTop, 87)
  assert.ok(box.spriteLeft > 0 && box.spriteWidth + box.spriteLeft <= box.width)
})

test('the tablet matrix lands on the measured screen in every artwork set', () => {
  for (const art of [internals.ART_WIDE, internals.ART_WIDE_GEMINI, internals.ART_DEEPSEEK]) {
    const box = internals.layout(150, art)
    const matrix = internals.tabletMatrix(art, box.spriteLeft, box.spriteTop, box.spriteWidth)
    const scale = box.spriteWidth / art.width
    const corners = art.corners
    close(matrix.e, box.spriteLeft + scale * corners.tl[0])
    close(matrix.f, box.spriteTop + scale * corners.tl[1])
    close(matrix.e + matrix.a * 400, box.spriteLeft + scale * corners.tr[0])
    close(matrix.f + matrix.b * 400, box.spriteTop + scale * corners.tr[1])
    close(matrix.e + matrix.c * 220, box.spriteLeft + scale * corners.bl[0])
    close(matrix.f + matrix.d * 220, box.spriteTop + scale * corners.bl[1])
  }
})

test('gemini keeps its own, wider-reaching tablet corners', () => {
  assert.ok(internals.ART_WIDE_GEMINI.corners.tr[0] < internals.ART_WIDE.corners.tr[0])
})

group('Client · preferences, sizes and the two artwork axes')

test('defaults: 蓝色大肥鱼, 开心, 中, snap on, auto source, 30 s', () => {
  const prefs = internals.defaultPrefs()
  assert.equal(prefs.appearance, 'deepseek')
  assert.equal(prefs.expression, '11')
  assert.equal(prefs.sizeMode, 'medium')
  assert.equal(prefs.snapOnRelease, true)
  assert.equal(prefs.balanceSource, 'auto')
  assert.equal(prefs.pollSeconds, 30)
  assert.equal(prefs.left, 14)
  assert.equal(prefs.bottom, 14)
})

test('there are five appearances and four differential expressions', () => {
  assert.deepEqual(
    Array.from(internals.APPEARANCES, (entry) => entry.id),
    ['deepseek', 'bowl', 'gpt', 'claude', 'gemini'],
  )
  assert.deepEqual(
    Array.from(internals.APPEARANCES, (entry) => entry.label),
    ['蓝色大肥鱼', '抱盆大肥鱼', 'GPT龙娘', '大小姐Claude', '北美猫娘Gemini'],
  )
  assert.deepEqual(
    Array.from(internals.EXPRESSIONS, (entry) => entry.label),
    ['开心', '傲娇', '冷脸', '紧张'],
  )
  // Only the default appearance owns the differential art, so only it can switch
  // its mood; the bowl pose has no tablet, so no other appearance is tablet-less.
  assert.equal(internals.APPEARANCES.filter((entry) => entry.differential === true).length, 1)
  assert.equal(internals.APPEARANCES[0].differential, true)
  assert.equal(internals.APPEARANCES[0].file, null)
  const tabletless = internals.APPEARANCES.filter((entry) => entry.tablet === false)
  assert.deepEqual(Array.from(tabletless, (entry) => entry.id), ['bowl'])
  assert.equal(tabletless[0].file, internals.BOWL_FILE)
})

test('the default expression is 开心 and the automatic one is 紧张', () => {
  assert.equal(internals.FACE_HAPPY, '11')
  assert.equal(internals.FACE_PAIN, '22')
  assert.equal(internals.defaultPrefs().expression, '11')
  assert.equal(internals.FACE_PAIN, internals.EXPRESSIONS[3].id)
})

test('resolveArt: the pained face outlives the last cent by one second', () => {
  const pet = {
    store: { prefs: { appearance: 'deepseek', expression: '12' }, status: 'ready' },
    model: { pendingSteps: 0, shakeTime: 0, painHold: 0, topupTime: 0 },
  }
  // Idle: the chosen face.
  assert.equal(internals.resolveArt(pet).expression, '12')

  // Draining: 紧张, whatever was chosen.
  pet.model.pendingSteps = 5
  assert.equal(internals.resolveArt(pet).expression, '22')

  // The last cent lands: still 紧张 during the hold...
  pet.model.pendingSteps = 0
  pet.model.shakeTime = 0
  pet.model.painHold = constants.PAIN_HOLD
  assert.equal(internals.resolveArt(pet).expression, '22')

  // ...and back to the chosen face once the hold expires.
  pet.model.painHold = 0
  assert.equal(internals.resolveArt(pet).expression, '12')
})

test('resolveArt: a top-up shows 开心 for its duration', () => {
  const pet = {
    store: { prefs: { appearance: 'deepseek', expression: '21' }, status: 'ready' },
    model: { pendingSteps: 0, shakeTime: 0, painHold: 0, topupTime: 0.5 },
  }
  assert.equal(internals.resolveArt(pet).expression, '11')
  pet.model.topupTime = 0
  assert.equal(internals.resolveArt(pet).expression, '21')
})

test('resolveArt: 蓝色大肥鱼 falls back to the bowl pose with no reading', () => {
  for (const status of ['loading', 'error']) {
    const pet = {
      store: { prefs: { appearance: 'deepseek', expression: '11' }, status },
      model: { pendingSteps: 0, shakeTime: 0, painHold: 0, topupTime: 0 },
    }
    const resolved = internals.resolveArt(pet)
    assert.equal(resolved.file, internals.BOWL_FILE, `status ${status} must use the bowl pose`)
    assert.equal(resolved.tablet, false, 'the bowl pose has no tablet')
    assert.equal(resolved.offline, true, 'and therefore no balance text or floating amounts')
  }
})

test('resolveArt: only 蓝色大肥鱼 borrows the bowl pose; the bowl appearance is itself', () => {
  const other = {
    store: { prefs: { appearance: 'gpt', expression: '11' }, status: 'error' },
    model: { pendingSteps: 0, shakeTime: 0, painHold: 0, topupTime: 0 },
  }
  const resolved = internals.resolveArt(other)
  assert.equal(resolved.tablet, true, 'the other characters keep their tablet and show --')
  assert.equal(resolved.file, 'appearance-gpt.webp')

  const bowl = {
    store: { prefs: { appearance: 'bowl', expression: '11' }, status: 'ready' },
    model: { pendingSteps: 0, shakeTime: 0, painHold: 0, topupTime: 0 },
  }
  const chosen = internals.resolveArt(bowl)
  assert.equal(chosen.file, internals.BOWL_FILE)
  assert.equal(chosen.tablet, false)
  assert.equal(chosen.offline, true, 'choosing it by hand is the same tablet-less pose')
})

test('there is no 特大 preset; 自定义 replaces it', () => {
  assert.deepEqual(Array.from(internals.SIZE_PRESETS, (entry) => entry.id), ['small', 'medium', 'large'])
  assert.deepEqual(Array.from(internals.SIZE_PRESETS, (entry) => entry.side), [110, 150, 210])
  assert.ok(internals.CUSTOM_MIN < internals.CUSTOM_MAX)
})

test('a custom size is clamped into the supported range', () => {
  const prefs = internals.defaultPrefs()
  prefs.sizeMode = 'custom'

  prefs.customSide = 240
  assert.equal(internals.resolvedSide(prefs), 240)
  assert.equal(internals.sizeLabel(prefs), '240 pt')

  prefs.customSide = 5
  assert.equal(internals.resolvedSide(prefs), internals.CUSTOM_MIN)
  prefs.customSide = 9999
  assert.equal(internals.resolvedSide(prefs), internals.CUSTOM_MAX)
  prefs.customSide = Number.NaN
  assert.equal(internals.resolvedSide(prefs), internals.CUSTOM_MIN)

  prefs.sizeMode = 'large'
  assert.equal(internals.resolvedSide(prefs), 210)
  assert.equal(internals.sizeLabel(prefs), '大')
})

test('the menu labels report the current choice', () => {
  const prefs = internals.defaultPrefs()
  assert.equal(internals.sourceLabel(prefs), '自动')
  assert.equal(internals.intervalLabel(prefs), '30 秒')
  prefs.balanceSource = 'apikey'
  prefs.pollSeconds = 300
  assert.equal(internals.sourceLabel(prefs), '仅 API Key')
  assert.equal(internals.intervalLabel(prefs), '5 分钟')
})

test('a stored preference round-trips and an unknown id is ignored', () => {
  clientStorage.set(
    'dsh-plugin-balance-pet/preferences',
    JSON.stringify({
      appearance: 'nope',
      expression: 'nope',
      sizeMode: 'nope',
      snapOnRelease: false,
      balanceSource: 'nope',
      pollSeconds: 1,
      customSide: 9999,
    }),
  )
  const prefs = internals.readPrefs()
  assert.equal(prefs.appearance, 'deepseek', 'an unknown id must not blank the artwork')
  assert.equal(prefs.expression, '11')
  assert.equal(prefs.sizeMode, 'medium')
  assert.equal(prefs.snapOnRelease, false)
  assert.equal(prefs.balanceSource, 'auto')
  assert.equal(prefs.pollSeconds, 10)
  assert.equal(prefs.customSide, internals.CUSTOM_MAX)
})

test('stored preferences are read back, and an unknown key falls back to the default', () => {
  clientStorage.set(
    'dsh-plugin-balance-pet/preferences',
    JSON.stringify({ appearance: 'gemini', expression: '21', sizeMode: 'large', snapOnRelease: true }),
  )
  const prefs = internals.readPrefs()
  assert.equal(prefs.appearance, 'gemini')
  assert.equal(prefs.expression, '21')
  assert.equal(prefs.sizeMode, 'large')
  assert.equal(prefs.snapOnRelease, true)

  // A value this build does not know must not be adopted; the default stands.
  clientStorage.set(
    'dsh-plugin-balance-pet/preferences',
    JSON.stringify({ appearance: 'nope', expression: 'nope', sizeMode: 'nope' }),
  )
  const fallback = internals.readPrefs()
  assert.equal(fallback.appearance, 'deepseek')
  assert.equal(fallback.expression, internals.FACE_HAPPY)
  assert.equal(fallback.sizeMode, 'medium')
})

/* ------------------------------------------------------------------ *
 * Host half — live route integration with a fake context
 * ------------------------------------------------------------------ */

/**
 * Drive the real `apply()` and the real route handlers without DSH: a fake
 * `webServer` captures the registrations, and fake request/response objects
 * replay what `node:http` would hand them. This is the only way to exercise the
 * Host half's new code before DSH restarts (a plugin's Host half is not hot
 * reloaded), so it is deliberately thorough.
 */
function createFakeHost(balance) {
  const routes = new Map()
  const log = []
  const state = { calls: 0, balance }
  const account = {
    getBalance: async () => {
      state.calls += 1
      return state.balance()
    },
    getState: async () => ({ status: 'credential-stored' }),
  }
  const ctx = {
    logger: { info: (message) => log.push(message), warn: (message) => log.push(message) },
    get(name) {
      if (name === 'webServer') {
        return {
          register: (route) => {
            routes.set(route.path, route)
            return () => routes.delete(route.path)
          },
        }
      }
      if (name === 'deepseekAccount') return account
      return undefined
    },
    effect: (run) => {
      const disposer = run()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject: () => {},
  }
  return { ctx, routes, log, state }
}

function callRoute(routes, routePath, options = {}) {
  const route = routes.get(routePath)
  if (route === undefined) throw new Error(`route not registered: ${routePath}`)
  const request = {
    url: routePath + (options.query ?? ''),
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
    async *[Symbol.asyncIterator]() {
      if (options.rawBody !== undefined) yield Buffer.from(options.rawBody)
    },
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    const response = {
      statusCode: 0,
      headers: {},
      writeHead(status, headers) {
        this.statusCode = status
        Object.assign(this.headers, headers ?? {})
      },
      setHeader(key, value) {
        this.headers[key] = value
      },
      end(body) {
        if (body !== undefined && body !== null) chunks.push(body)
        const buffer = Buffer.concat(
          chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))),
        )
        let json = null
        try {
          json = JSON.parse(buffer.toString('utf8'))
        } catch {
          json = null
        }
        resolve({ status: this.statusCode, headers: this.headers, body: buffer, json })
      },
    }
    Promise.resolve()
      .then(() => route.handler(request, response))
      .catch(reject)
  })
}

const HEADERS = { 'x-dsh-plugin-balance-pet': '1' }
const ROUTES = {
  state: '/dsh-plugin-balance-pet/state',
  refresh: '/dsh-plugin-balance-pet/refresh',
  doctor: '/dsh-plugin-balance-pet/doctor',
  asset: '/dsh-plugin-balance-pet/asset',
  apikey: '/dsh-plugin-balance-pet/apikey',
}

/** Run `body` with DSH_HOME pointed at an empty temp directory. */
async function withTempHome(body) {
  const previous = process.env.DSH_HOME
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-balance-pet-'))
  process.env.DSH_HOME = dir
  try {
    return await body(dir)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

group('Host · live route integration')

test('apply() registers every route', () => {
  const fake = createFakeHost(() => ({ status: 'failed' }))
  host.apply(fake.ctx)
  for (const routePath of Object.values(ROUTES)) {
    assert.ok(fake.routes.has(routePath), `${routePath} must be registered`)
  }
})

test('the guarded routes answer 403 without the header, 200 with it', async () => {
  const fake = createFakeHost(() => ({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '10.00' }],
    bonusWallets: [],
  }))
  host.apply(fake.ctx)

  const denied = await callRoute(fake.routes, ROUTES.state)
  assert.equal(denied.status, 403)
  assert.equal(denied.json.code, 'forbidden')
  assert.equal(fake.state.calls, 0, 'a rejected request must not reach the account')

  const allowed = await callRoute(fake.routes, ROUTES.state, { headers: HEADERS, query: '?interval=10' })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.json.cents, 1000)
  assert.equal(allowed.json.display, '10.00')
  assert.equal(allowed.json.source, 'DSH 账号')
  assert.equal(allowed.json.interval, 10)
  assert.equal(allowed.json.sourceMode, 'auto')
})

test('the balance is the CNY sum of recharge and bonus wallets', async () => {
  const fake = createFakeHost(() => ({
    status: 'ready',
    value: [
      { currency: 'USD', balance: '99.00' },
      { currency: 'CNY', balance: '7.25' },
    ],
    bonusWallets: [{ currency: 'CNY', balance: '0.75' }],
  }))
  host.apply(fake.ctx)
  const answer = await callRoute(fake.routes, ROUTES.state, { headers: HEADERS })
  assert.equal(answer.json.cents, 800, '7.25 + 0.75, and the USD wallet is ignored')
})

test('rev advances only when the money actually moves', async () => {
  let balance = '10.00'
  const fake = createFakeHost(() => ({
    status: 'ready',
    value: [{ currency: 'CNY', balance }],
    bonusWallets: [],
  }))
  host.apply(fake.ctx)

  const first = await callRoute(fake.routes, ROUTES.state, { headers: HEADERS })
  const callsAfterFirst = fake.state.calls

  const same = await callRoute(fake.routes, ROUTES.refresh, { method: 'POST', headers: HEADERS })
  assert.equal(same.json.rev, first.json.rev, 'an unchanged balance must not bump the revision')
  assert.ok(fake.state.calls > callsAfterFirst, 'a forced refresh still asks the account')

  balance = '9.99'
  const moved = await callRoute(fake.routes, ROUTES.refresh, { method: 'POST', headers: HEADERS })
  assert.equal(moved.json.cents, 999)
  assert.ok(moved.json.rev > first.json.rev, 'a moved balance must bump the revision')
})

test('the interval is clamped and an unchanged poll does not re-query', async () => {
  const fake = createFakeHost(() => ({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '1.00' }],
    bonusWallets: [],
  }))
  host.apply(fake.ctx)
  const fast = await callRoute(fake.routes, ROUTES.state, { headers: HEADERS, query: '?interval=1' })
  assert.equal(fast.json.interval, 10)
  const slow = await callRoute(fake.routes, ROUTES.state, { headers: HEADERS, query: '?interval=99999' })
  assert.equal(slow.json.interval, 300)

  const settled = fake.state.calls
  await callRoute(fake.routes, ROUTES.state, { headers: HEADERS, query: '?interval=300' })
  await callRoute(fake.routes, ROUTES.state, { headers: HEADERS, query: '?interval=300' })
  assert.equal(fake.state.calls, settled, 'the Host, not the browser, decides when to ask')
})

test('an account failure is reported and then backed off', async () => {
  let mode = 'ready'
  const fake = createFakeHost(() => {
    if (mode === 'ready') {
      return { status: 'ready', value: [{ currency: 'CNY', balance: '3.00' }], bonusWallets: [] }
    }
    if (mode === 'failed') return { status: 'failed' }
    throw new Error('network down')
  })
  host.apply(fake.ctx)

  const good = await callRoute(fake.routes, ROUTES.state, { headers: HEADERS })
  assert.equal(good.json.cents, 300)

  mode = 'failed'
  const refused = await callRoute(fake.routes, ROUTES.refresh, { method: 'POST', headers: HEADERS })
  assert.equal(refused.status, 200, 'a failed reading is still a served answer')
  assert.equal(refused.json.cents, null)
  assert.equal(refused.json.error, '平台拒绝或未能返回余额')

  const afterFailureCalls = fake.state.calls
  await callRoute(fake.routes, ROUTES.state, { headers: HEADERS })
  assert.equal(fake.state.calls, afterFailureCalls, 'the failure backoff must hold the next poll')

  mode = 'throw'
  const threw = await callRoute(fake.routes, ROUTES.refresh, { method: 'POST', headers: HEADERS })
  assert.ok(String(threw.json.error).startsWith('账号余额查询失败'), threw.json.error)

  mode = 'ready'
  const recovered = await callRoute(fake.routes, ROUTES.refresh, { method: 'POST', headers: HEADERS })
  assert.equal(recovered.json.cents, 300)
  assert.equal(recovered.json.error, null)
})

test('balance source: 仅 DSH 账号 reports a signed-out account instead of using a key', async () => {
  const fake = createFakeHost(() => null)
  host.apply(fake.ctx)
  const answer = await callRoute(fake.routes, ROUTES.state, {
    headers: HEADERS,
    query: '?source=account',
  })
  assert.equal(answer.json.cents, null)
  assert.equal(answer.json.ok, false)
  assert.match(answer.json.error, /未登录 DSH 账号/)
  assert.equal(answer.json.sourceMode, 'account')
})

test('balance source: 仅 API Key with nothing configured reports the reason, not ¥0', async () => {
  await withTempHome(async () => {
    const fake = createFakeHost(() => ({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '10.00' }],
      bonusWallets: [],
    }))
    host.apply(fake.ctx)
    const answer = await callRoute(fake.routes, ROUTES.state, {
      headers: HEADERS,
      query: '?source=apikey',
    })
    assert.equal(answer.json.cents, null)
    assert.equal(answer.json.ok, false)
    assert.match(answer.json.error, /没有可用凭证/)
    assert.equal(fake.state.calls, 0, '仅 API Key must not touch the account seam at all')
  })
})

test('a missing account and a missing key report as unconfigured, not as ¥0', async () => {
  await withTempHome(async () => {
    const routes = new Map()
    const ctx = {
      logger: { info() {}, warn() {} },
      get: (name) =>
        name === 'webServer'
          ? { register: (route) => (routes.set(route.path, route), () => {}) }
          : undefined,
      effect: (run) => run(),
      inject: () => {},
    }
    host.apply(ctx)
    const answer = await callRoute(routes, ROUTES.state, { headers: HEADERS })
    assert.equal(answer.json.cents, null)
    assert.equal(answer.json.ok, false)
    assert.match(answer.json.error, /没有可用凭证/)
  })
})

test('the API key round-trips through the Host and never comes back to the browser', async () => {
  await withTempHome(async (home) => {
    // Keep the forced refresh off the network by pointing the source at the fake
    // account; the key is still stored and reported.
    const fake = createFakeHost(() => ({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '4.00' }],
      bonusWallets: [],
    }))
    host.apply(fake.ctx)
    await callRoute(fake.routes, ROUTES.state, { headers: HEADERS, query: '?source=account' })

    const stored = await callRoute(fake.routes, ROUTES.apikey, {
      method: 'POST',
      headers: HEADERS,
      query: '?source=account',
      rawBody: JSON.stringify({ key: 'sk-test-not-a-real-key' }),
    })
    assert.equal(stored.status, 200)
    assert.equal(stored.json.stored, true)
    assert.equal(stored.json.cleared, false)
    assert.ok(
      !stored.body.toString('utf8').includes('sk-test-not-a-real-key'),
      'the key must never be echoed back',
    )

    const keyPath = path.join(home, 'balance-pet', 'apikey.txt')
    assert.equal(fs.readFileSync(keyPath, 'utf8'), 'sk-test-not-a-real-key')

    const state = await callRoute(fake.routes, ROUTES.state, {
      headers: HEADERS,
      query: '?source=account',
    })
    assert.equal(state.json.apiKeyStored, true)

    const cleared = await callRoute(fake.routes, ROUTES.apikey, {
      method: 'DELETE',
      headers: HEADERS,
      query: '?source=account',
    })
    assert.equal(cleared.json.cleared, true)
    assert.equal(fs.existsSync(keyPath), false, 'clearing must remove the file')
  })
})

test('the API key route refuses a malformed key and a missing header', async () => {
  await withTempHome(async () => {
    const fake = createFakeHost(() => ({ status: 'failed' }))
    host.apply(fake.ctx)

    const denied = await callRoute(fake.routes, ROUTES.apikey, {
      method: 'POST',
      rawBody: JSON.stringify({ key: 'sk-x' }),
    })
    assert.equal(denied.status, 403)

    const bad = await callRoute(fake.routes, ROUTES.apikey, {
      method: 'POST',
      headers: HEADERS,
      rawBody: JSON.stringify({ key: 'line one\nline two' }),
    })
    assert.equal(bad.status, 400)
    assert.equal(bad.json.code, 'bad-key')

    const wrongMethod = await callRoute(fake.routes, ROUTES.apikey, { headers: HEADERS })
    assert.equal(wrongMethod.status, 405)
  })
})

test('the self-report reaches the doctor route, bounded', async () => {
  const fake = createFakeHost(() => ({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '4.00' }],
    bonusWallets: [],
  }))
  host.apply(fake.ctx)
  const report = JSON.stringify({
    art: 'expression-22',
    appearance: 'deepseek',
    expression: '22',
    sizeMode: 'custom',
    side: 240,
    sprite: true,
    steps: 7,
    topups: 2,
    menuOpen: true,
  })
  await callRoute(fake.routes, ROUTES.state, {
    headers: HEADERS,
    query: `?interval=30&report=${encodeURIComponent(report)}`,
  })
  const doctor = await callRoute(fake.routes, ROUTES.doctor)
  assert.equal(doctor.status, 200)
  assert.equal(doctor.json.ok, true)
  assert.equal(doctor.json.version, host.VERSION, 'the doctor must report the version this build is')
  assert.equal(doctor.json.client.art, 'expression-22')
  assert.equal(doctor.json.client.sizeMode, 'custom')
  assert.equal(doctor.json.client.side, 240)
  assert.equal(doctor.json.client.sprite, true)
  assert.equal(doctor.json.client.menuOpen, true)
  assert.deepEqual(Array.from(doctor.json.requiredFailures), [])
  assert.ok(doctor.json.checks.some((entry) => entry.id === 'client-report' && entry.ok === true))
})

test('a garbage self-report leaves the previous one alone', async () => {
  const fake = createFakeHost(() => ({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '4.00' }],
    bonusWallets: [],
  }))
  host.apply(fake.ctx)
  await callRoute(fake.routes, ROUTES.state, {
    headers: HEADERS,
    query: `?report=${encodeURIComponent(JSON.stringify({ appearance: 'gpt' }))}`,
  })
  await callRoute(fake.routes, ROUTES.state, { headers: HEADERS, query: '?report=%%%not-json' })
  const doctor = await callRoute(fake.routes, ROUTES.doctor)
  assert.equal(doctor.json.client.appearance, 'gpt')
})

group('Host · assets')

test('every shipped artwork is served under its allowlisted name', async () => {
  const fake = createFakeHost(() => ({ status: 'failed' }))
  host.apply(fake.ctx)
  for (const name of host.ASSET_FILES) {
    const answer = await callRoute(fake.routes, ROUTES.asset, { query: `?file=${name}` })
    assert.equal(answer.status, 200, `${name} must be served`)
    assert.equal(answer.headers['content-type'], 'image/webp')
    assert.ok(answer.body.length > 1000)
    assert.equal(answer.body.subarray(0, 4).toString('ascii'), 'RIFF')
    assert.equal(answer.body.subarray(8, 12).toString('ascii'), 'WEBP')
  }
})

test('the asset route refuses traversal, unknown names and an empty request', async () => {
  const fake = createFakeHost(() => ({ status: 'failed' }))
  host.apply(fake.ctx)
  for (const attempt of [
    '../../package.json',
    '/etc/passwd',
    '..%2F..%2Fpackage.json',
    'expression-11.webp/../../package.json',
    'nope.webp',
    '',
  ]) {
    const refused = await callRoute(fake.routes, ROUTES.asset, { query: `?file=${attempt}` })
    assert.equal(refused.status, 404, `must refuse ${attempt}`)
  }
})

/* ------------------------------------------------------------------ *
 * Scope guard for this fork
 * ------------------------------------------------------------------ */

/** Strip comments so a mention of a removed feature in prose is not a failure. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const clientCode = stripComments(clientSource)
const hostCode = stripComments(fs.readFileSync(path.join(packageDir, 'src', 'index.js'), 'utf8'))

group('Client · scope guard for this fork')

test('the sound effect and its toggle are gone from both halves', () => {
  for (const banned of ['hit.mp3', 'soundOn', 'playHit', 'NSSound', 'new Audio', 'AudioContext', '音效']) {
    assert.ok(!clientCode.includes(banned), `client.js still references ${banned}`)
  }
  for (const banned of ['hit.mp3', 'soundOn', 'new Audio', 'AudioContext']) {
    assert.ok(!hostCode.includes(banned), `index.js still references ${banned}`)
  }
  assert.ok(!fs.existsSync(path.join(packageDir, 'assets', 'hit.mp3')), 'no audio asset may ship')
  assert.ok(!fs.existsSync(path.join(packageDir, 'assets', 'hit.wav')), 'no audio asset may ship')
})

test('the test/demo rehearsals and their menus are gone', () => {
  for (const banned of ['playDemo', 'playOneHit', 'demoRemaining', 'demoOffset', '测试一次扣费', '演示连续扣费']) {
    assert.ok(!clientCode.includes(banned), `client.js still references ${banned}`)
  }
})

test('the drop animation really is the only animated reaction left', () => {
  const occurrences = clientCode.split("modelAddLabel(model, '-0.01', 'down')").length - 1
  assert.equal(occurrences, 1)
  assert.ok(clientCode.includes('model.shakeTime = HIT_DURATION'))
  assert.ok(clientCode.includes("layer.globalCompositeOperation = 'source-atop'"), 'the red flash is kept')
})

test('the settings moved into the pet menu: no settings page is registered', () => {
  assert.ok(
    !clientCode.includes('settings.section'),
    'the plugin must not declare a settings page any more — the menu is the settings surface',
  )
  const registered = [...clientCode.matchAll(/register\(\s*\{\s*name:\s*([A-Z_]+)/g)].map((m) => m[1])
  assert.deepEqual(
    [...new Set(registered)].sort(),
    ['OVERLAY_SLOT', 'SIDEBAR_SLOT'],
    'only the click-through overlay and the sidebar-foot action may be occupied',
  )
  assert.equal(
    registered.filter((name) => name === 'OVERLAY_SLOT').length,
    3,
    'pet, menu, dialog — the floating restore pill is gone',
  )
  assert.equal(
    registered.filter((name) => name === 'SIDEBAR_SLOT').length,
    1,
    'exactly one entry is the way back',
  )
})

test('hiding and showing are mutually exclusive: never two controls at once', () => {
  assert.ok(clientSource.includes("hide: '隐藏桌宠'"))
  assert.ok(clientSource.includes("show: '显示桌宠'"))

  // The floating pill is gone entirely — no component, no style, no registration.
  assert.ok(!clientCode.includes('buildRestore'), 'the floating restore pill must not exist')
  assert.ok(!clientCode.includes('dshbp-restore'), 'nor its stylesheet')

  // 隐藏桌宠 sits directly under 立即刷新余额.
  const refresh = clientCode.indexOf("id: 'refresh'")
  const hide = clientCode.indexOf("id: 'hide'")
  assert.ok(refresh > 0 && hide > refresh, '隐藏桌宠 must come after 立即刷新余额')
  assert.ok(hide - refresh < 600, 'and immediately after it, not at the bottom')

  // The sidebar-foot entry is the ONE way back, and it is on screen only while the
  // pet is not — that is what makes the two mutually exclusive.
  assert.ok(clientSource.includes('buildSidebarAction'), 'the sidebar entry must exist')
  assert.ok(
    clientCode.includes('if (!hidden) return null'),
    'the sidebar entry must render only while the pet is hidden',
  )
  assert.ok(
    clientCode.includes('pet.store.setPrefs({ hidden: false })'),
    'and clicking it must bring the pet back',
  )
  assert.ok(
    !clientCode.includes('setPrefs({ hidden: !hidden })'),
    'it is a "bring it back" action, not a second toggle',
  )

  // Because that entry is the only way back, the menu refuses to hide the pet while
  // it is not mounted — otherwise hiding could strand the pet with no way back.
  assert.ok(clientCode.includes('pet.sidebarReady = true'), 'the entry announces that it mounted')
  assert.ok(
    clientCode.includes('disabled: pet.sidebarReady !== true'),
    '隐藏桌宠 stays disabled until the way back exists',
  )
  assert.ok(clientSource.includes("hideUnavailable"), 'and says why when it is disabled')

  // The hidden flag is persisted, and a hidden pet accepts no input.
  assert.ok(clientCode.includes('prefs.hidden === true) return false'), 'a hidden pet takes no input')
})

test('the menu keeps the 显示 group with 外观 / 表情 / 吸附 and the 余额 group', () => {
  assert.ok(clientSource.includes("groupDisplay: '显示'"))
  assert.ok(clientSource.includes("groupBalance: '余额'"))
  assert.ok(clientSource.includes("appearance: '外观'"))
  assert.ok(clientSource.includes("expression: '表情'"))
  assert.ok(clientSource.includes("snap: '吸附（松手回左下角）'"))
  assert.ok(clientSource.includes("size: '尺寸'"))
  assert.ok(clientSource.includes("custom: '自定义…'"))
  assert.ok(clientSource.includes("source: '余额来源'"))
  assert.ok(clientSource.includes("apiKey: '设置 API Key…'"))
  assert.ok(clientSource.includes("clearKey: '清除已保存的 Key'"))
  assert.ok(clientSource.includes("interval: '刷新间隔'"))
})
test('the menu is a grouped menu, not a flat list', () => {
  for (const kind of ["'submenu'", "'toggle'", "'group'", "'sep'", "'status'", "'option'"]) {
    assert.ok(clientCode.includes('kind: ' + kind), `the menu must render ${kind} entries`)
  }
  assert.ok(clientSource.includes('dshbp-menuGroup'), 'group headers are styled')
  assert.ok(clientSource.includes('dshbp-menuChevron'), 'submenus show a chevron')
  assert.ok(clientSource.includes('dshbp-menuTick'), 'the selected choice shows a check mark')
  assert.ok(clientSource.includes("data-pet-menu"), 'the menu is identifiable for outside-click handling')
})

test('the four differential expressions drive the face while money drains', () => {
  assert.ok(clientCode.includes('if (modelPained(pet.model)) wanted = FACE_PAIN'))
  assert.ok(clientCode.includes('else if (pet.model.topupTime > 0) wanted = FACE_HAPPY'))
  assert.equal(internals.FACE_PAIN, '22')
  assert.equal(internals.FACE_HAPPY, '11')
  assert.ok(constants.PAIN_HOLD >= 1, 'the pained face must hold for at least a second')
})

test('the pained face is held for exactly one second after the run ends', () => {
  const model = createModel()
  modelApply(model, 1000, true)
  modelApply(model, 998, false) // two cents to play
  let fired = 0
  const step = 1 / 60
  let elapsed = 0
  // Play the whole run and 0.5 s past it.
  while (elapsed < 3.0) {
    elapsed += step
    if (modelTick(model, step)) fired += 1
  }
  assert.equal(fired, 2, 'both cents must land')
  // The hold started when the run ended (about 0.2 s in) and has since expired.
  assert.equal(model.painHold, 0)
  assert.equal(modelPained(model), false)

  // Now check the hold is SET at the moment the run ends.
  const fresh = createModel()
  modelApply(fresh, 100, true)
  modelApply(fresh, 99, false)
  while (fresh.pendingSteps > 0 || fresh.shakeTime > 0) modelTick(fresh, step)
  assert.equal(fresh.painHold, constants.PAIN_HOLD, 'the hold starts the moment draining stops')
  assert.equal(modelPained(fresh), true, 'so the pained face stays on')
  // ...and it is what keeps the render loop alive for that extra second.
  assert.equal(modelNeedsFrame(fresh), true)
})

test('every artwork the client can ask for exists and is allowlisted', () => {
  const files = new Set()
  for (const appearance of internals.APPEARANCES) {
    if (appearance.file !== null) files.add(appearance.file)
  }
  for (const expression of internals.EXPRESSIONS) files.add(expression.file)
  files.add(internals.BOWL_FILE)
  assert.equal(files.size, 8, '4 expressions + 4 appearance images (the bowl pose is shared)')
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(packageDir, 'assets', file)), `${file} must ship`)
    assert.ok(host.ASSET_FILES.has(file), `${file} must be in the Host allowlist`)
  }
  // macOS sprite.png is verified by tools/make-assets.py but deliberately not
  // shipped: 蓝色大肥鱼 is served by the differential set.
  assert.ok(!fs.existsSync(path.join(packageDir, 'assets', 'appearance-deepseek.webp')))
})

test('the client bundle requests nothing outside the platform baseline', () => {
  const requires = [...clientSource.matchAll(/require\((['"])([^'"]+)\1\)/g)].map((match) => match[2])
  assert.deepEqual([...new Set(requires)], ['react'])
})

test('the host half registers the routes the client talks to', () => {
  for (const suffix of ['/doctor', '/state', '/refresh', '/apikey', '/asset']) {
    assert.ok(hostCode.includes('${ROUTE_PREFIX}' + suffix), `missing ${suffix}`)
  }
  assert.ok(hostCode.includes("kind: 'exact'"), 'routes are exact-path registrations')
})

test('the assets served are an allowlist, never a joined path', () => {
  assert.ok(hostCode.includes('ASSET_FILES.has(name)'), 'asset names must be allowlisted')
  assert.ok(hostCode.includes('path.basename('), 'the requested name is basenamed first')
})

test('the API key is written with the tightest mode and never logged', () => {
  assert.ok(hostCode.includes('mode: 0o600'), 'the key file must be 0600')
  assert.ok(hostCode.includes('await fs.rename(temporary, state.apiKeyPath)'), 'an atomic replace')
  assert.ok(!/logger[^\n]*\$\{?key\b/.test(hostCode), 'the key must never reach a log line')
})

await runAll()

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) {
  for (const failure of failures) {
    process.stdout.write(`\n--- ${failure.name} ---\n${failure.error.stack}\n`)
  }
  process.exit(1)
}
