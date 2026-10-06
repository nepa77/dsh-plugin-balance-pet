/**
 * dsh-plugin-balance-pet — Client half (browser bundle).
 *
 * This file is NOT compiled. DSH serves the bytes of `exports["./client"]` to the
 * browser, where the shell's lazy-CJS module table executes it: running the script
 * only registers the factory below; the factory runs at materialization with a
 * `require` bound to the frozen platform module table. React comes from that
 * table — no duplicate React, no CDN, no UMD search.
 *
 * WHAT IT ADDS TO THE PAGE
 *   One entry in `shell.overlay` (a list slot): the pet. The overlay layer is
 *   click-through and this entry stays click-through too — pointer input is
 *   claimed in the window CAPTURE phase and only where the sprite is actually
 *   opaque, which is how the transparent corners of the artwork let the app
 *   underneath work.
 *
 *   Everything else lives on the pet's own RIGHT-CLICK MENU: 立即刷新余额, the
 *   显示 group (尺寸 / 外观 / 表情 / 吸附), the 余额 group (余额来源 / 设置 API
 *   Key / 刷新间隔). There is deliberately no separate settings page.
 *
 * TWO AXES OF ARTWORK
 *   外观 (appearance) picks the character; 表情 (expression) picks the mood of the
 *   default character, which is the one with differential art. While money is
 *   draining the pet automatically wears the pained expression and returns to the
 *   chosen one afterwards — the behaviour the D-16BVM widget documents.
 *
 * DELIBERATELY NOT PORTED
 *   The sound effect and its toggle, and the "测试一次扣费" / "演示连续扣费"
 *   rehearsals with every animation they drove. A test asserts neither returns.
 *
 * Seams used: the `slots` Client service, the `shell.overlay` list slot,
 * `ctx.locale` (optional), and this package's own Host routes. All are recorded in
 * `../compat/expected-surface.json`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-balance-pet',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')

    var ROUTE = '/dsh-plugin-balance-pet'
    var REQUEST_HEADERS = { 'x-dsh-plugin-balance-pet': '1' }
    var OVERLAY_SLOT = 'shell.overlay'
    var SIDEBAR_SLOT = 'sidebar.footer.action'
    var OVERLAY_ID = 'balance-pet'
    var PREF_KEY = 'dsh-plugin-balance-pet/preferences'

    var FLOAT_BAND = 0.55
    var TABLET_WIDTH = 400
    var TABLET_HEIGHT = 220

    /* Animation constants, carried over from the desktop original unchanged. */
    var STEP_INTERVAL = 0.2
    var HIT_DURATION = 0.55
    var FLOAT_LIFETIME = 0.95
    var TOPUP_DURATION = 0.9
    var MAX_PENDING_STEPS = 400
    var MAX_DELTA_SECONDS = 0.1

    /* The tablet quad inside each artwork, re-measured from the art itself. The
     * D-16BVM numbers are that project's own sprite constants; the wide numbers
     * are the macOS build's measured corners. Only three are needed — the fourth
     * is implied by the affine map. */
    var ART_DEEPSEEK = {
      width: 1024,
      height: 1024,
      corners: { tl: [549.6, 706.2], tr: [949.7, 642.0], bl: [584.6, 924.3] },
    }
    var ART_WIDE = {
      width: 1536,
      height: 1024,
      corners: { tl: [1060, 699], tr: [1413, 644], bl: [1090, 889] },
    }
    var ART_WIDE_GEMINI = {
      width: 1536,
      height: 1024,
      corners: { tl: [1065, 699], tr: [1400, 646], bl: [1095, 889] },
    }

    /**
     * 外观 — the four characters. The default one is served by the differential
     * expression set below, so it carries no single `file`.
     */
    var APPEARANCES = [
      { id: 'deepseek', label: '蓝色大肥鱼', art: ART_DEEPSEEK, file: null, differential: true },
      { id: 'bowl', label: '抱盆大肥鱼', art: ART_WIDE, file: 'appearance-bowl.webp', tablet: false },
      { id: 'gpt', label: 'GPT龙娘', art: ART_WIDE, file: 'appearance-gpt.webp' },
      { id: 'claude', label: '大小姐Claude', art: ART_WIDE, file: 'appearance-claude.webp' },
      { id: 'gemini', label: '北美猫娘Gemini', art: ART_WIDE_GEMINI, file: 'appearance-gemini.webp' },
    ]

    /**
     * 表情 — the four differential expressions, all of the default character.
     * `note` says what each face looks like and, where relevant, when it is used
     * automatically.
     */
    var EXPRESSIONS = [
      { id: '11', label: '开心', file: 'expression-11.webp', note: '笑口常开（默认）' },
      { id: '12', label: '傲娇', file: 'expression-12.webp', note: '抿嘴侧目，别过头去' },
      { id: '21', label: '冷脸', file: 'expression-21.webp', note: '眯眼，面无表情' },
      { id: '22', label: '紧张', file: 'expression-22.webp', note: '闭眼皱眉；扣费时自动使用，扣完再保持 1 秒' },
    ]
    var FACE_HAPPY = '11'
    var FACE_PAIN = '22'
    /** How long the 紧张 face stays on AFTER the last cent has landed. */
    var PAIN_HOLD = 1.0

    /** The bowl pose: the offline art, and a manually selectable appearance. */
    var BOWL_FILE = 'appearance-bowl.webp'

    var SIZE_PRESETS = [
      { id: 'small', label: '小', side: 110 },
      { id: 'medium', label: '中', side: 150 },
      { id: 'large', label: '大', side: 210 },
    ]
    var CUSTOM_MIN = 60
    var CUSTOM_MAX = 420
    var CUSTOM_DEFAULT = 240

    var INTERVALS = [
      { seconds: 10, label: '10 秒' },
      { seconds: 30, label: '30 秒' },
      { seconds: 60, label: '1 分钟' },
      { seconds: 300, label: '5 分钟' },
    ]

    var SOURCE_CHOICES = [
      { id: 'auto', label: '自动', note: 'DSH 账号优先，未登录时用 API Key' },
      { id: 'account', label: '仅 DSH 账号', note: '只读账号余额，不用 API Key' },
      { id: 'apikey', label: '仅 API Key', note: '只用 API Key 查询' },
    ]

    var APPEARANCE_BY_ID = {}
    var EXPRESSION_BY_ID = {}
    var SIZE_BY_ID = {}
    for (var appearanceIndex = 0; appearanceIndex < APPEARANCES.length; appearanceIndex += 1) {
      APPEARANCE_BY_ID[APPEARANCES[appearanceIndex].id] = APPEARANCES[appearanceIndex]
    }
    for (var expressionIndex = 0; expressionIndex < EXPRESSIONS.length; expressionIndex += 1) {
      EXPRESSION_BY_ID[EXPRESSIONS[expressionIndex].id] = EXPRESSIONS[expressionIndex]
    }
    for (var sizeIndex = 0; sizeIndex < SIZE_PRESETS.length; sizeIndex += 1) {
      SIZE_BY_ID[SIZE_PRESETS[sizeIndex].id] = SIZE_PRESETS[sizeIndex]
    }

    /* Icons are drawn inline so the bundle imports nothing but react. */
    var ICON_PATHS = {
      refresh: ['M13.4 8a5.4 5.4 0 1 1-1.7-3.9', 'M13.4 2.3v3.4h-3.4'],
      size: ['M2.2 13.4h11.6', 'M4.6 13.4V7.6', 'M8 13.4V5', 'M11.4 13.4V9.6'],
      appearance: [
        'M8 7.9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
        'M3.6 13.5c0-2.2 2-3.7 4.4-3.7s4.4 1.5 4.4 3.7',
      ],
      expression: [
        'M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3z',
        'M5.9 6.7h.01',
        'M10.1 6.7h.01',
        'M5.7 9.6c.7.9 1.4 1.3 2.3 1.3s1.6-.4 2.3-1.3',
      ],
      snap: ['M13 13V3H3', 'M7.6 8.4 3 13', 'M3 9.6V13h3.4'],
      clock: ['M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3z', 'M8 5v3.4l2.2 1.3'],
      key: ['M5.6 10.4a2.8 2.8 0 1 1 2-2L14 2', 'M11.2 4.4l1.4 1.4', 'M13 2.6l1.4 1.4'],
      clear: ['M4.2 4.2 11.8 11.8', 'M11.8 4.2 4.2 11.8'],
      source: ['M2.2 4.6h11.6', 'M2.2 8h11.6', 'M2.2 11.4h7.4'],
      chevron: ['M6.2 3.6 10.4 8l-4.2 4.4'],
      check: ['M3 8.4 6.4 11.8 13 4.6'],
      hide: [
        'M2.2 8s2.3-4 5.8-4 5.8 4 5.8 4-2.3 4-5.8 4-5.8-4-5.8-4z',
        'M6.3 8a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 0 0-3.4 0z',
        'M3.2 3.2 12.8 12.8',
      ],
      show: [
        'M2.2 8s2.3-4 5.8-4 5.8 4 5.8 4-2.3 4-5.8 4-5.8-4-5.8-4z',
        'M6.3 8a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 0 0-3.4 0z',
      ],
    }

    var CSS =
      '.dshbp-root{position:fixed;z-index:1;pointer-events:none;will-change:left,bottom}' +
      '.dshbp-canvas{display:block;pointer-events:none;touch-action:none}' +
      '.dshbp-sideAction{display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;' +
      'width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;' +
      'font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}' +
      '.dshbp-sideAction:hover,.dshbp-sideAction:focus-visible{' +
      'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));outline:none}' +
      '.dshbp-sideActionIcon{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;' +
      'justify-content:center;opacity:.9}' +
      '.dshbp-menu{position:fixed;z-index:2;min-width:186px;padding:5px;border:1px solid ' +
      'var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay,#1f2023);' +
      'box-shadow:0 10px 32px rgba(0,0,0,.34);pointer-events:auto;font-size:13px;line-height:20px;' +
      'color:var(--dsw-alias-label-primary,inherit)}' +
      '.dshbp-menuStatus{padding:7px 10px 8px;font-size:12px;line-height:17px;' +
      'color:var(--dsw-alias-label-secondary,inherit);font-variant-numeric:tabular-nums}' +
      '.dshbp-menuGroup{padding:9px 10px 4px;font-size:11px;line-height:16px;letter-spacing:.08em;' +
      'color:var(--dsw-alias-label-secondary,inherit);opacity:.72}' +
      '.dshbp-menuSep{height:1px;margin:5px 8px;background:var(--dsw-alias-border-l2)}' +
      '.dshbp-menuItem{display:flex;align-items:center;gap:9px;box-sizing:border-box;width:100%;' +
      'min-height:30px;padding:5px 9px;border:0;border-radius:7px;background:transparent;' +
      'color:inherit;font:inherit;text-align:left;cursor:pointer;position:relative}' +
      '.dshbp-menuItem:hover:not(:disabled),.dshbp-menuItem:focus-visible:not(:disabled){' +
      'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));outline:none}' +
      '.dshbp-menuItem:disabled{opacity:.38;cursor:default}' +
      '.dshbp-menuIcon{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;' +
      'justify-content:center;opacity:.85}' +
      '.dshbp-menuLabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap}' +
      '.dshbp-menuValue{flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}' +
      '.dshbp-menuTick{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;' +
      'justify-content:center;color:var(--dsw-alias-brand-primary,#4d6bfe)}' +
      '.dshbp-menuChevron{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;' +
      'justify-content:center;opacity:.6}' +
      '.dshbp-menuNote{padding:0 10px 7px;font-size:11px;line-height:16px;' +
      'color:var(--dsw-alias-label-secondary,inherit);opacity:.8}' +
      '.dshbp-scrim{position:fixed;inset:0;z-index:3;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(0,0,0,.38);pointer-events:auto}' +
      '.dshbp-dialog{width:min(360px,calc(100vw - 32px));padding:18px;border:1px solid ' +
      'var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay,#1f2023);' +
      'box-shadow:0 18px 48px rgba(0,0,0,.45);color:var(--dsw-alias-label-primary,inherit)}' +
      '.dshbp-dialogTitle{font-size:14px;line-height:20px;font-weight:600}' +
      '.dshbp-dialogBody{margin-top:8px;font-size:12px;line-height:18px;' +
      'color:var(--dsw-alias-label-secondary,inherit)}' +
      '.dshbp-input{box-sizing:border-box;width:100%;margin-top:12px;padding:8px 10px;border:1px solid ' +
      'var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);' +
      'color:inherit;font:inherit;font-size:13px}' +
      '.dshbp-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);' +
      'outline-offset:1px}' +
      '.dshbp-error{margin-top:8px;font-size:12px;line-height:18px;' +
      'color:var(--dsw-alias-state-error-primary,#ef4444)}' +
      '.dshbp-dialogActions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}' +
      '.dshbp-button{padding:7px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;' +
      'background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;cursor:pointer}' +
      '.dshbp-button:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}' +
      '.dshbp-button[data-primary=true]{border-color:transparent;' +
      'background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}' +
      '.dshbp-button:disabled{opacity:.5;cursor:default}'
    var STYLE_ID = 'dsh-plugin-balance-pet/pet.css'

    /* ---------------------------------------------------------------- *
     * pure helpers
     * ---------------------------------------------------------------- */

    /** `1234` → `"12.34"`; never negates through a float. */
    function centsToYuan(cents) {
      if (typeof cents !== 'number' || !isFinite(cents)) return '--'
      var negative = cents < 0
      var magnitude = Math.abs(cents)
      var fraction = magnitude % 100
      return (negative ? '-' : '') + Math.floor(magnitude / 100) + '.' + (fraction < 10 ? '0' : '') + fraction
    }

    function clamp(value, low, high) {
      if (!isFinite(value)) return low
      return Math.min(high, Math.max(low, value))
    }

    function appearanceById(id) {
      return APPEARANCE_BY_ID[id] || APPEARANCES[0]
    }

    /** The body height for the current size preference. */
    function resolvedSide(prefs) {
      if (prefs.sizeMode === 'custom') {
        return clamp(Math.round(prefs.customSide), CUSTOM_MIN, CUSTOM_MAX)
      }
      var preset = SIZE_BY_ID[prefs.sizeMode]
      return preset === undefined ? SIZE_BY_ID.medium.side : preset.side
    }

    /** A compact label for the current size, for the menu row. */
    function sizeLabel(prefs) {
      if (prefs.sizeMode === 'custom') return resolvedSide(prefs) + ' pt'
      var preset = SIZE_BY_ID[prefs.sizeMode]
      return preset === undefined ? '' : preset.label
    }

    function sourceLabel(prefs) {
      for (var index = 0; index < SOURCE_CHOICES.length; index += 1) {
        if (SOURCE_CHOICES[index].id === prefs.balanceSource) return SOURCE_CHOICES[index].label
      }
      return SOURCE_CHOICES[0].label
    }

    function intervalLabel(prefs) {
      for (var index = 0; index < INTERVALS.length; index += 1) {
        if (INTERVALS[index].seconds === prefs.pollSeconds) return INTERVALS[index].label
      }
      return prefs.pollSeconds + ' 秒'
    }

    /* ---- the accounting + animation model (no DOM, no timers) ---- */

    function createModel() {
      return {
        bookedCents: null,
        realCents: null,
        pendingSteps: 0,
        stepCooldown: 0,
        shakeTime: 0,
        flashTime: 0,
        topupTime: 0,
        floating: [],
        steps: 0,
        topups: 0,
        painHold: 0,
      }
    }

    function modelSnapToReal(model) {
      model.bookedCents = model.realCents
      model.pendingSteps = 0
      model.stepCooldown = 0
    }

    function modelAddLabel(model, text, kind) {
      model.floating.push({ text: text, kind: kind, age: 0 })
      // A hard cap keeps a pathological stream of readings from growing the array
      // without bound; the oldest label is the least interesting one.
      if (model.floating.length > 60) model.floating.splice(0, model.floating.length - 60)
    }

    /**
     * Fold one server reading into the model.
     *
     * `snap` discards queued animation (first read after a page load, a source
     * change, or an explicit refresh): there is nothing to animate *from*, so
     * pretending a drop happened would be a lie.
     */
    function modelApply(model, cents, snap) {
      if (typeof cents !== 'number' || !isFinite(cents)) return false
      var previousReal = model.realCents
      model.realCents = cents

      if (snap || model.bookedCents === null || previousReal === null) {
        modelSnapToReal(model)
        return true
      }

      if (cents > previousReal) {
        // Compare consecutive SERVER readings, never the lagging display or a
        // queued animation: a credit must be reported in full even while the drop
        // animation is still running. A top-up shows immediately.
        modelSnapToReal(model)
        model.topupTime = TOPUP_DURATION
        model.topups += 1
        modelAddLabel(model, '+' + centsToYuan(cents - previousReal), 'up')
        return true
      }

      if (cents < model.bookedCents) {
        var steps = model.bookedCents - cents
        if (steps > MAX_PENDING_STEPS) {
          // A jump this large would take minutes to play out and the queue would
          // only grow. Align instead of acting out every cent.
          modelSnapToReal(model)
        } else {
          // Re-derive the outstanding amount so repeated polls never replay money
          // that has already been animated, while fresh deductions extend it.
          model.pendingSteps = steps
        }
        return true
      }

      model.pendingSteps = 0
      return true
    }

    /** Advance the model by `dt` seconds. One step = one cent = one hit. */
    function modelTick(model, dt) {
      if (typeof dt !== 'number' || !isFinite(dt) || dt < 0) return false
      // Captured BEFORE this frame's time is consumed: the frame in which the last
      // shake expires is the frame that starts the hold, and it can only be
      // recognised if "was draining when the frame began" is still true.
      var drainingBefore = modelDraining(model)
      // A long frame — a background tab waking up — must not fire a burst of hits.
      var elapsed = Math.min(dt, MAX_DELTA_SECONDS)
      model.shakeTime = Math.max(0, model.shakeTime - elapsed)
      model.flashTime = Math.max(0, model.flashTime - elapsed)
      model.topupTime = Math.max(0, model.topupTime - elapsed)

      var kept = []
      for (var index = 0; index < model.floating.length; index += 1) {
        var label = model.floating[index]
        label.age += elapsed
        if (label.age < FLOAT_LIFETIME) kept.push(label)
      }
      model.floating = kept

      var fired = false

      if (model.pendingSteps <= 0) {
        model.stepCooldown = Math.max(0, model.stepCooldown - elapsed)
      } else {
        model.stepCooldown -= elapsed
        if (model.stepCooldown <= 1e-9) {
          // Keep the fractional remainder: resetting to exactly 0.2 would silently
          // stretch each cue to 13 frames on a 60 Hz display.
          model.stepCooldown = Math.max(0, model.stepCooldown + STEP_INTERVAL)
          if (model.bookedCents !== null && model.realCents !== null && model.bookedCents > model.realCents) {
            model.bookedCents -= 1 // safe: booked is strictly above real
            model.pendingSteps -= 1
            model.shakeTime = HIT_DURATION
            model.flashTime = HIT_DURATION
            model.steps += 1
            modelAddLabel(model, '-0.01', 'down')
            fired = true
          } else {
            model.pendingSteps = 0
          }
        }
      }

      // The pained face outlives the last cent: the moment the run stops, start the
      // hold, and only then fall back to whichever face the user chose.
      if (drainingBefore && !modelDraining(model)) {
        model.painHold = PAIN_HOLD
      } else if (!modelDraining(model) && model.painHold > 0) {
        model.painHold = Math.max(0, model.painHold - elapsed)
      }

      return fired
    }

    /** True while the drop animation is still running. */
    function modelDraining(model) {
      return model.pendingSteps > 0 || model.shakeTime > 0
    }

    /** True while the pained face should be worn, including the 1 s hold. */
    function modelPained(model) {
      return modelDraining(model) || model.painHold > 0
    }

    function modelNeedsFrame(model) {
      return modelPained(model) || model.floating.length > 0 || model.topupTime > 0
    }

    /** The hurt shake's intensity curve, shaped exactly like the desktop build. */
    function modelImpact(model) {
      if (model.shakeTime <= 0) return 0
      var elapsed = HIT_DURATION - model.shakeTime
      if (elapsed < 0.08) return Math.min(1, elapsed / 0.08)
      return Math.max(0, 1 - (elapsed - 0.08) / (HIT_DURATION - 0.08))
    }

    function shakeOffset(model, side) {
      if (model.shakeTime <= 0) return { x: 0, y: 0 }
      var elapsed = HIT_DURATION - model.shakeTime
      var decay = Math.max(0, model.shakeTime / HIT_DURATION)
      var amplitude = Math.min(3.2, side * 0.025)
      return {
        x: Math.sin(elapsed * 24) * amplitude * decay,
        // Canvas y grows downward, so the vertical term is negated to keep the
        // same on-screen motion as the bottom-origin desktop original.
        y: -Math.cos(elapsed * 19) * amplitude * 0.875 * decay,
      }
    }

    /**
     * The affine map from the tablet panel's own 400 × 220 space onto the tilted
     * screen in the artwork, as a CSS-style matrix. Derived from the same three
     * measured corners the desktop builds use; the fourth is implied.
     */
    function tabletMatrix(art, spriteLeft, spriteTop, spriteWidth) {
      var scale = spriteWidth / art.width
      var corners = art.corners
      var dx1 = corners.tr[0] - corners.tl[0]
      var dy1 = corners.tr[1] - corners.tl[1]
      var dx2 = corners.bl[0] - corners.tl[0]
      var dy2 = corners.bl[1] - corners.tl[1]
      return {
        a: (scale * dx1) / TABLET_WIDTH,
        b: (scale * dy1) / TABLET_WIDTH,
        c: (scale * dx2) / TABLET_HEIGHT,
        d: (scale * dy2) / TABLET_HEIGHT,
        e: spriteLeft + scale * corners.tl[0],
        f: spriteTop + scale * corners.tl[1],
      }
    }

    /**
     * Geometry of every drawn part in CSS pixels, top-left origin.
     *
     * The window follows the artwork's own aspect ratio, so the 1:1 D-16BVM art
     * and the 3:2 macOS art each get a box that fits them without stretching.
     */
    function layout(side, art) {
      var ratio = art === undefined ? 1.5 : art.width / art.height
      var height = side * (1 + FLOAT_BAND)
      var spriteHeight = side * 0.94
      var spriteWidth = spriteHeight * ratio
      // The box is the sprite plus a shake margin on both sides, so the artwork
      // never clips at the peak of a hit whatever its aspect ratio is.
      var width = spriteWidth + side * 0.09
      return {
        side: side,
        width: width,
        height: height,
        ratio: ratio,
        spriteLeft: (width - spriteWidth) / 2,
        spriteTop: height - side * 0.03 - spriteHeight,
        spriteWidth: spriteWidth,
        spriteHeight: spriteHeight,
        // The floating-amount band is the top `FLOAT_BAND` of the box and, like
        // the desktop builds, never takes pointer input.
        bodyTop: height - side,
      }
    }

    /* ---------------------------------------------------------------- *
     * preferences + store
     * ---------------------------------------------------------------- */

    function defaultPrefs() {
      return {
        appearance: 'deepseek',
        expression: FACE_HAPPY,
        sizeMode: 'medium',
        customSide: CUSTOM_DEFAULT,
        snapOnRelease: true,
        balanceSource: 'auto',
        pollSeconds: 30,
        hidden: false,
        left: 14,
        bottom: 14,
      }
    }

    function readPrefs() {
      var prefs = defaultPrefs()
      try {
        var raw = window.localStorage.getItem(PREF_KEY)
        if (raw === null) return prefs
        var parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return prefs

        if (typeof parsed.appearance === 'string' && APPEARANCE_BY_ID[parsed.appearance] !== undefined) {
          prefs.appearance = parsed.appearance
        }
        if (typeof parsed.expression === 'string' && EXPRESSION_BY_ID[parsed.expression] !== undefined) {
          prefs.expression = parsed.expression
        }
        if (typeof parsed.sizeMode === 'string' && (SIZE_BY_ID[parsed.sizeMode] !== undefined || parsed.sizeMode === 'custom')) {
          prefs.sizeMode = parsed.sizeMode
        }
        if (typeof parsed.customSide === 'number' && isFinite(parsed.customSide)) {
          prefs.customSide = clamp(Math.round(parsed.customSide), CUSTOM_MIN, CUSTOM_MAX)
        }
        if (typeof parsed.snapOnRelease === 'boolean') prefs.snapOnRelease = parsed.snapOnRelease
        if (typeof parsed.hidden === 'boolean') prefs.hidden = parsed.hidden
        if (typeof parsed.balanceSource === 'string') {
          for (var index = 0; index < SOURCE_CHOICES.length; index += 1) {
            if (SOURCE_CHOICES[index].id === parsed.balanceSource) prefs.balanceSource = parsed.balanceSource
          }
        }
        if (typeof parsed.pollSeconds === 'number') {
          prefs.pollSeconds = clamp(Math.round(parsed.pollSeconds), 10, 300)
        }
        if (typeof parsed.left === 'number' && isFinite(parsed.left)) prefs.left = parsed.left
        if (typeof parsed.bottom === 'number' && isFinite(parsed.bottom)) prefs.bottom = parsed.bottom
        return prefs
      } catch (error) {
        return prefs
      }
    }

    function writePrefs(prefs) {
      try {
        window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
      } catch (error) {
        /* private mode / quota: preferences simply do not persist */
      }
    }

    function createStore() {
      var listeners = []
      return {
        version: 0,
        prefs: readPrefs(),
        reading: null,
        status: 'loading',
        error: null,
        menu: null,
        menuPath: [],
        menuPositions: {},
        dialog: null,
        subscribe: function (listener) {
          listeners.push(listener)
          return function () {
            var index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          }
        },
        getVersion: function () {
          return this.version
        },
        emit: function () {
          this.version += 1
          var snapshot = listeners.slice()
          for (var index = 0; index < snapshot.length; index += 1) {
            try {
              snapshot[index]()
            } catch (error) {
              /* one broken listener must not stop the others */
            }
          }
        },
        setPrefs: function (patch) {
          var key
          for (key in patch) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) this.prefs[key] = patch[key]
          }
          writePrefs(this.prefs)
          this.emit()
        },
        closeMenu: function () {
          this.menu = null
          this.menuPath = []
          this.menuPositions = {}
          this.emit()
        },
        openDialog: function (dialog) {
          this.dialog = dialog
          this.menu = null
          this.menuPath = []
          this.menuPositions = {}
          this.emit()
        },
        closeDialog: function () {
          this.dialog = null
          this.emit()
        },
      }
    }

    /** Re-render on any store change. Deliberately not `useSyncExternalStore`:
     *  the extra subscription is trivial here and this works on every React the
     *  shell might ship. */
    function useStore(store) {
      var pair = React.useState(store.getVersion())
      React.useEffect(function () {
        return store.subscribe(function () {
          pair[1](store.getVersion())
        })
      }, [])
      return store
    }

    /* ---------------------------------------------------------------- *
     * artwork resolution
     * ---------------------------------------------------------------- */

    /**
     * Which artwork is on screen right now.
     *
     * The default character has four moods:
     *   - while money is draining she wears 紧张, and keeps it for one more second
     *     after the last cent lands before returning to the chosen face;
     *   - a top-up briefly shows 开心;
     *   - otherwise the face chosen in 表情.
     *
     * She also falls back to the bowl pose — the same art as the 抱盆大肥鱼
     * appearance — whenever there is no reading at all: no account, no key,
     * connecting, or a failed query. That pose has no tablet, so the balance
     * title, amount, status dot and floating amounts are all absent while it is
     * shown, and the tablet readout comes back the moment the reading succeeds.
     */
    function resolveArt(pet) {
      var prefs = pet.store.prefs
      var appearance = appearanceById(prefs.appearance)

      // The bowl pose chosen by hand: no tablet to draw on.
      if (appearance.tablet === false) {
        return { key: appearance.id, file: appearance.file, art: appearance.art, tablet: false, offline: true }
      }
      if (!appearance.differential) {
        return { key: appearance.id, file: appearance.file, art: appearance.art, tablet: true, offline: false }
      }
      if (pet.store.status !== 'ready') {
        return { key: 'bowl', file: BOWL_FILE, art: ART_WIDE, tablet: false, offline: true }
      }

      var wanted = prefs.expression
      if (modelPained(pet.model)) wanted = FACE_PAIN
      else if (pet.model.topupTime > 0) wanted = FACE_HAPPY
      var expression = EXPRESSION_BY_ID[wanted] || EXPRESSIONS[0]
      return {
        key: 'expression-' + expression.id,
        file: expression.file,
        art: ART_DEEPSEEK,
        tablet: true,
        offline: false,
        expression: expression.id,
      }
    }

    /* ---------------------------------------------------------------- *
     * canvas rendering
     * ---------------------------------------------------------------- */

    var themeCache = { at: 0, values: null }

    function themeColor(name, fallback) {
      var now = Date.now()
      // Theme tokens are read while animating at up to 60 fps, so they are memoised
      // for a moment instead of forcing a style resolution on every frame.
      if (themeCache.values === null || now - themeCache.at > 2000) {
        themeCache.at = now
        themeCache.values = {}
      }
      if (Object.prototype.hasOwnProperty.call(themeCache.values, name)) return themeCache.values[name]
      var value = fallback
      try {
        var raw = window.getComputedStyle(document.documentElement).getPropertyValue(name)
        if (typeof raw === 'string' && raw.trim().length > 0) value = raw.trim()
      } catch (error) {
        /* fall through to the fallback */
      }
      themeCache.values[name] = value
      return value
    }

    function fontOf(size, weight, mono) {
      var family = mono
        ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'
        : 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'
      return (weight ? weight + ' ' : '') + Math.max(1, Math.round(size)) + 'px ' + family
    }

    function makeMask(image) {
      var maskWidth = 96
      var maskHeight = 96
      try {
        var canvas = document.createElement('canvas')
        canvas.width = maskWidth
        canvas.height = maskHeight
        var context = canvas.getContext('2d')
        context.clearRect(0, 0, maskWidth, maskHeight)
        context.drawImage(image, 0, 0, maskWidth, maskHeight)
        var data = context.getImageData(0, 0, maskWidth, maskHeight).data
        return { width: maskWidth, height: maskHeight, data: data }
      } catch (error) {
        // A tainted canvas would only happen if the art stopped being same-origin.
        return null
      }
    }

    function makePet() {
      return {
        store: createStore(),
        model: createModel(),
        // Sprites are cached per artwork key, and the alpha mask that decides where
        // the pet accepts a click comes with them.
        sprites: {},
        connected: false,
        lastError: null,
        // The render loop hands the importer a repaint trigger; the poller and the
        // store subscription call it. It is null while the pet is unmounted.
        onFrame: null,
        // Set by the sidebar-foot entry when it mounts: the menu refuses to hide the
        // pet without it, so a build whose sidebar slot never resolves cannot leave
        // the pet hidden with no way back.
        sidebarReady: false,
        hover: false,
      }
    }

    function spriteFor(pet, key, file) {
      var record = pet.sprites[key]
      if (record !== undefined) return record
      record = { ready: false, failed: false, image: null, mask: null }
      pet.sprites[key] = record
      var image = new Image()
      record.image = image
      image.onload = function () {
        record.ready = true
        record.mask = makeMask(image)
        if (pet.onFrame !== null) pet.onFrame()
      }
      image.onerror = function () {
        record.failed = true
        if (pet.onFrame !== null) pet.onFrame()
      }
      image.src = ROUTE + '/asset?file=' + encodeURIComponent(file)
      return record
    }

    /** A reusable offscreen layer, so `source-atop` only ever sees the sprite. */
    function getLayer(pet, width, height) {
      var layer = pet.layer
      if (layer === undefined) {
        layer = document.createElement('canvas')
        pet.layer = layer
        pet.layerContext = layer.getContext('2d')
        pet.layerWidth = 0
        pet.layerHeight = 0
      }
      var w = Math.max(1, Math.ceil(width))
      var h = Math.max(1, Math.ceil(height))
      if (pet.layerWidth !== w || pet.layerHeight !== h) {
        layer.width = w
        layer.height = h
        pet.layerWidth = w
        pet.layerHeight = h
      }
      pet.layerContext.setTransform(1, 0, 0, 1, 0, 0)
      pet.layerContext.clearRect(0, 0, w, h)
      return pet.layerContext
    }

    /**
     * Draw one frame.
     *
     * `options.resolved` and `options.box` let the caller — which already had to
     * resolve the artwork to size the element — hand the answer in, instead of this
     * function resolving and laying out a second time on every frame.
     */
    function renderPet(canvas, pet, options) {
      var side = options.side === undefined ? resolvedSide(pet.store.prefs) : options.side
      var resolved = options.resolved === undefined ? resolveArt(pet) : options.resolved
      var box = options.box === undefined ? layout(side, resolved.art) : options.box
      var dpr = options.dpr
      var context = canvas.getContext('2d')
      if (context === null) return
      var sprite = spriteFor(pet, resolved.key, resolved.file)

      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, box.width, box.height)

      var model = pet.model
      var shake = shakeOffset(model, side)
      var impact = modelImpact(model)

      // A compact self-report the Host exposes through its doctor route: it is how
      // "the pet is invisible" can be told apart from "the balance never arrived"
      // without a browser console. Mutated in place rather than reallocated: this
      // runs on every animation frame and only the poller reads it, once a second.
      var rendered = pet.rendered
      if (rendered === undefined) {
        rendered = {}
        pet.rendered = rendered
      }
      rendered.art = resolved.key
      rendered.appearance = pet.store.prefs.appearance
      rendered.expression = resolved.expression === undefined ? null : resolved.expression
      rendered.sizeMode = pet.store.prefs.sizeMode
      rendered.side = side
      rendered.sprite = sprite.ready
      rendered.offline = resolved.offline
      rendered.connected = pet.connected
      rendered.width = Math.round(box.width)
      rendered.height = Math.round(box.height)
      rendered.left = Math.round(pet.store.prefs.left)
      rendered.bottom = Math.round(pet.store.prefs.bottom)
      rendered.steps = model.steps
      rendered.topups = model.topups
      rendered.painHold = Math.round(model.painHold * 100) / 100
      rendered.hidden = pet.store.prefs.hidden === true
      rendered.menuOpen = pet.store.menu !== null

      context.save()
      context.translate(shake.x, shake.y)

      if (model.topupTime > 0) {
        var progress = 1 - model.topupTime / TOPUP_DURATION
        var inset = side * (0.03 + 0.06 * (1 - progress))
        context.save()
        context.strokeStyle = 'rgba(46,204,113,' + (0.8 * (1 - progress)).toFixed(3) + ')'
        context.lineWidth = Math.max(1, side * 0.015)
        context.beginPath()
        context.ellipse(
          box.spriteLeft + box.spriteWidth / 2,
          box.spriteTop + box.spriteHeight / 2,
          Math.max(1, box.spriteWidth / 2 - inset),
          Math.max(1, box.spriteHeight / 2 - inset),
          0,
          0,
          Math.PI * 2,
        )
        context.stroke()
        context.restore()
      }

      if (sprite.ready) {
        if (impact > 0) {
          // Draw sprite + tint into a private layer: `source-atop` on the shared
          // canvas would also tint anything already drawn there.
          var layer = getLayer(pet, box.spriteWidth, box.spriteHeight)
          layer.drawImage(sprite.image, 0, 0, box.spriteWidth, box.spriteHeight)
          layer.globalCompositeOperation = 'source-atop'
          layer.fillStyle = 'rgba(255,26,36,' + (0.45 * impact).toFixed(3) + ')'
          layer.fillRect(0, 0, box.spriteWidth, box.spriteHeight)
          layer.globalCompositeOperation = 'source-over'
          context.drawImage(
            pet.layer,
            0,
            0,
            pet.layerWidth,
            pet.layerHeight,
            box.spriteLeft,
            box.spriteTop,
            box.spriteWidth,
            box.spriteHeight,
          )
        } else {
          context.drawImage(sprite.image, box.spriteLeft, box.spriteTop, box.spriteWidth, box.spriteHeight)
        }
        if (resolved.tablet) drawTablet(context, pet, box, resolved.art)
      } else if (sprite.failed) {
        context.save()
        context.fillStyle = 'rgba(127,127,127,.35)'
        context.fillRect(box.spriteLeft, box.spriteTop, box.spriteWidth, box.spriteHeight)
        context.restore()
      }

      context.restore()
      drawFloating(context, pet, box, side, resolved.offline)
    }

    function drawTablet(context, pet, box, art) {
      var matrix = tabletMatrix(art, box.spriteLeft, box.spriteTop, box.spriteWidth)
      var panelWidth = TABLET_WIDTH
      var panelHeight = TABLET_HEIGHT
      context.save()
      context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
      context.beginPath()
      context.rect(0, 0, panelWidth, panelHeight)
      context.clip()

      var labelColor = 'rgb(158,184,227)'
      // Panel-local Y is measured from the top, matching the measured corners.
      var titleY = panelHeight * 0.2
      var amountY = panelHeight * 0.68

      context.textAlign = 'left'
      context.textBaseline = 'middle'
      context.shadowOffsetX = 1.5
      context.shadowOffsetY = 1.5
      context.shadowBlur = 1.5
      context.shadowColor = 'rgba(0,0,0,.65)'

      var titleSize = panelHeight * 0.21
      context.font = fontOf(titleSize, '700', false)
      context.fillStyle = labelColor
      var title = 'DSH 余额'
      context.fillText(title, (panelWidth - context.measureText(title).width) / 2, titleY)

      var numberSize = panelHeight * 0.48
      var currencySize = panelHeight * 0.27
      var text = pet.connected
        ? centsToYuan(pet.model.bookedCents === null ? 0 : pet.model.bookedCents)
        : '--'
      var currency = '¥ '

      function measure(factor) {
        context.font = fontOf(currencySize * factor, '700', false)
        var currencyWidth = context.measureText(currency).width
        context.font = fontOf(numberSize * factor, '700', true)
        return currencyWidth + context.measureText(text).width
      }

      var full = measure(1)
      var factor = full > 0 ? Math.min(1, (panelWidth * 0.9) / full) : 1

      context.font = fontOf(currencySize * factor, '700', false)
      var currencyWidth = context.measureText(currency).width
      context.font = fontOf(numberSize * factor, '700', true)
      var numberWidth = context.measureText(text).width
      var startX = (panelWidth - (currencyWidth + numberWidth)) / 2

      context.fillStyle = labelColor
      context.fillText(currency, startX, amountY)
      context.fillStyle = pet.connected ? 'rgb(240,247,255)' : 'rgb(173,186,207)'
      context.fillText(text, startX + currencyWidth, amountY)

      context.shadowOffsetX = 0
      context.shadowOffsetY = 0
      context.shadowBlur = 0
      context.fillStyle = pet.connected
        ? themeColor('--dsw-alias-state-success-primary', '#22c55e')
        : pet.lastError === null
          ? themeColor('--dsw-alias-state-warn-primary', '#eab308')
          : themeColor('--dsw-alias-state-error-primary', '#ef4444')
      context.beginPath()
      // The desktop builds put the 15 pt dot near the top-right of the panel.
      context.arc(panelWidth * 0.92 + 7.5, panelHeight * 0.23 - 7.5, 7.5, 0, Math.PI * 2)
      context.fill()
      context.restore()
    }

    function drawFloating(context, pet, box, side, offline) {
      var model = pet.model
      if (model.floating.length === 0 || offline) return
      var start = box.bodyTop
      var top = side * 0.1
      var font = fontOf(side * 0.08, '800', true)
      for (var index = 0; index < model.floating.length; index += 1) {
        var label = model.floating[index]
        var progress = Math.min(1, label.age / FLOAT_LIFETIME)
        var alpha = Math.max(0, 1 - Math.pow(progress, 1.6))
        context.save()
        context.font = font
        context.textAlign = 'left'
        context.textBaseline = 'top'
        var width = context.measureText(label.text).width
        // Follow the character on the right rather than centering over the tail.
        var x = Math.min(
          Math.max(0, box.width - side + side * 0.5 - width / 2),
          Math.max(0, box.width - width),
        )
        var y = start + (top - start) * progress
        context.shadowBlur = side * 0.022
        context.shadowColor = 'rgba(0,0,0,' + (0.4 * alpha).toFixed(3) + ')'
        context.fillStyle =
          label.kind === 'up'
            ? 'rgba(60,214,120,' + alpha.toFixed(3) + ')'
            : 'rgba(255,74,80,' + alpha.toFixed(3) + ')'
        context.fillText(label.text, x, y)
        context.restore()
      }
    }

    /* ---------------------------------------------------------------- *
     * hit testing, dragging, snapping
     * ---------------------------------------------------------------- */

    /**
     * True only where the sprite has a pixel — the desktop build's rule too.
     *
     * The container rect is memoised briefly: this runs on every pointer move in
     * the application, and `getBoundingClientRect()` forces a synchronous layout.
     */
    function hitTest(pet, element, clientX, clientY) {
      if (element === null) return false
      if (pet.store.prefs.hidden === true) return false
      if (pet.store.menu !== null || pet.store.dialog !== null) return false
      var now =
        typeof window.performance === 'object' && window.performance !== null
          ? window.performance.now()
          : Date.now()
      if (pet.rect === undefined || now - pet.rectAt > 150) {
        pet.rect = element.getBoundingClientRect()
        pet.rectAt = now
      }
      var rect = pet.rect
      var side = resolvedSide(pet.store.prefs)
      var resolved = resolveArt(pet)
      var box = layout(side, resolved.art)
      var shake = shakeOffset(pet.model, side)
      var x = clientX - rect.left - shake.x
      var y = clientY - rect.top - shake.y
      if (x < 0 || y < 0 || x >= box.width || y >= box.height) return false
      if (y < box.bodyTop) return false
      if (x < box.spriteLeft || x >= box.spriteLeft + box.spriteWidth) return false
      if (y < box.spriteTop || y >= box.spriteTop + box.spriteHeight) return false
      var sprite = spriteFor(pet, resolved.key, resolved.file)
      if (!sprite.ready || sprite.mask === null) return true
      var mask = sprite.mask
      var u = (x - box.spriteLeft) / box.spriteWidth
      var v = (y - box.spriteTop) / box.spriteHeight
      var px = Math.min(mask.width - 1, Math.max(0, Math.floor(u * mask.width)))
      var py = Math.min(mask.height - 1, Math.max(0, Math.floor(v * mask.height)))
      return mask.data[(py * mask.width + px) * 4 + 3] > 8
    }

    function viewportSize() {
      return {
        width: window.innerWidth || document.documentElement.clientWidth || 0,
        height: window.innerHeight || document.documentElement.clientHeight || 0,
      }
    }

    function boxSize(pet) {
      var side = resolvedSide(pet.store.prefs)
      return layout(side, resolveArt(pet).art)
    }

    function clampPosition(pet, left, bottom) {
      var box = boxSize(pet)
      var viewport = viewportSize()
      return {
        left: clamp(left, 0, Math.max(0, viewport.width - box.width)),
        bottom: clamp(bottom, 0, Math.max(0, viewport.height - box.height)),
      }
    }

    function snapTarget(pet) {
      return clampPosition(pet, 14, 14)
    }

    /* ---------------------------------------------------------------- *
     * host polling
     * ---------------------------------------------------------------- */

    function createPoller(pet) {
      var timer = null
      var stopped = false
      var inFlight = false

      function applyReading(reading) {
        // A poll that reports the same thing as the last one must not re-render
        // React once a second for nothing.
        var signature = [
          reading.rev,
          reading.cents,
          reading.ok === true,
          reading.error,
          reading.source,
          reading.apiKeyStored === true,
        ].join('\u0000')
        if (signature === pet.readingSignature) return false
        pet.readingSignature = signature

        var changed = pet.readingRev !== reading.rev
        pet.readingRev = reading.rev
        pet.connected = reading.ok === true
        pet.lastError = reading.ok === true ? null : reading.error
        pet.store.reading = reading
        pet.store.status = reading.ok === true ? 'ready' : 'error'
        pet.store.error = reading.error
        if (changed && typeof reading.cents === 'number') {
          // The first real number after a page load has nothing to animate from,
          // so it aligns; every later change is folded in against the previous
          // server reading.
          modelApply(pet.model, reading.cents, pet.firstReading === true)
          pet.firstReading = false
        }
        // A failed poll deliberately leaves the last good number and the queued
        // animation alone: only the status changes.
        return true
      }

      function request(path, options) {
        var params = []
        params.push('interval=' + encodeURIComponent(String(pet.store.prefs.pollSeconds)))
        params.push('source=' + encodeURIComponent(String(pet.store.prefs.balanceSource)))
        if (pet.rendered !== undefined) {
          params.push('report=' + encodeURIComponent(JSON.stringify(pet.rendered)))
        }
        var url = ROUTE + path + (path.indexOf('?') >= 0 ? '&' : '?') + params.join('&')

        var controller = typeof AbortController === 'function' ? new AbortController() : null
        var timeout = setTimeout(function () {
          if (controller !== null) controller.abort()
        }, 25_000)
        var init = {
          headers: REQUEST_HEADERS,
          cache: 'no-store',
          signal: controller === null ? undefined : controller.signal,
        }
        if (options !== undefined && options.method !== undefined) init.method = options.method
        if (options !== undefined && options.body !== undefined) {
          init.headers = { 'content-type': 'application/json', 'x-dsh-plugin-balance-pet': '1' }
          init.body = JSON.stringify(options.body)
        }
        return fetch(url, init).then(
          function (response) {
            return response.json().then(
              function (payload) {
                clearTimeout(timeout)
                return payload
              },
              function () {
                clearTimeout(timeout)
                return null
              },
            )
          },
          function (error) {
            clearTimeout(timeout)
            throw error
          },
        )
      }

      function tick() {
        if (stopped) return
        // A hidden tab has nothing to animate, so it stops asking.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          schedule()
          return
        }
        if (inFlight) {
          schedule()
          return
        }
        inFlight = true
        request('/state')
          .then(function (payload) {
            if (stopped || payload === null || typeof payload !== 'object') return
            if (applyReading(payload)) {
              pet.store.emit()
              if (pet.onFrame !== null) pet.onFrame()
            }
          })
          .catch(function (error) {
            if (stopped) return
            pet.connected = false
            pet.lastError = String((error && error.message) || error)
            pet.store.status = 'error'
            pet.store.error = pet.lastError
            pet.store.emit()
          })
          .then(function () {
            inFlight = false
            schedule()
          })
      }

      function schedule() {
        if (stopped) return
        if (timer !== null) clearTimeout(timer)
        // The Host owns the real schedule; this cadence only decides how quickly a
        // change becomes visible, and the payload is a few hundred bytes.
        timer = setTimeout(tick, 1000)
      }

      return {
        start: function () {
          stopped = false
          if (pet.firstReading === undefined) pet.firstReading = true
          tick()
        },
        /** Force one host-side query now; also used after a source change. */
        refresh: function () {
          return request('/refresh', { method: 'POST' })
            .then(function (payload) {
              if (payload === null || typeof payload !== 'object') return null
              // A source change replaces the number rather than animating a
              // difference between two different accounts.
              pet.firstReading = true
              if (applyReading(payload)) {
                pet.store.emit()
                if (pet.onFrame !== null) pet.onFrame()
              }
              return payload
            })
            .catch(function (error) {
              return { ok: false, message: String((error && error.message) || error) }
            })
        },
        /** Store or clear the pet's own API key. */
        saveApiKey: function (key) {
          return request('/apikey', key === null ? { method: 'DELETE' } : { method: 'POST', body: { key: key } })
        },
        stop: function () {
          stopped = true
          if (timer !== null) clearTimeout(timer)
          timer = null
        },
      }
    }

    /* ---------------------------------------------------------------- *
     * menu components
     * ---------------------------------------------------------------- */

    function SvgIcon(paths, size, width) {
      var children = []
      for (var index = 0; index < paths.length; index += 1) {
        children.push(
          React.createElement('path', {
            key: index,
            d: paths[index],
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: width,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )
      }
      return React.createElement(
        'svg',
        { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': 'true' },
        children,
      )
    }

    function MenuIcon(name) {
      var paths = ICON_PATHS[name]
      if (paths === undefined) return null
      return React.createElement('span', { className: 'dshbp-menuIcon' }, SvgIcon(paths, 16, 1.4))
    }

    function Tick() {
      return React.createElement('span', { className: 'dshbp-menuTick' }, SvgIcon(ICON_PATHS.check, 14, 1.8))
    }

    function estimateHeight(items) {
      var height = 10
      for (var index = 0; index < items.length; index += 1) {
        if (items[index].kind === 'sep') height += 11
        else if (items[index].kind === 'group') height += 29
        else height += 30
        // Every entry with a note renders one extra line under it.
        if (items[index].note) height += 16
      }
      return height
    }

    /**
     * The pet's right-click menu.
     *
     * It is the whole settings surface, so it carries the structure the desktop
     * widget's menu does: a dim status line, group headers, items with icons,
     * submenus on the right and a check mark for the selected choice.
     */
    function buildMenu(pet, poller, text) {
      return function PetMenu() {
        useStore(pet.store)
        var menu = pet.store.menu
        if (menu === null) return null

        var prefs = pet.store.prefs
        var reading = pet.store.reading
        var appearance = appearanceById(prefs.appearance)

        function close() {
          pet.store.closeMenu()
        }

        function choose(patch, options) {
          close()
          pet.store.setPrefs(patch)
          if (options !== undefined && options.refresh === true) poller.refresh()
          if (pet.onFrame !== null) pet.onFrame()
        }

        var items = []
        items.push({
          kind: 'status',
          label:
            reading !== null && reading.ok
              ? '¥ ' + centsToYuan(reading.cents) + ' · ' + (reading.source || '')
              : pet.store.status === 'loading'
                ? text.connecting
                : (reading !== null && reading.error) || pet.store.error || text.offline,
        })
        items.push({
          kind: 'item',
          id: 'refresh',
          icon: 'refresh',
          label: text.refresh,
          onSelect: function () {
            close()
            poller.refresh()
          },
        })
        items.push({
          kind: 'item',
          id: 'hide',
          icon: 'hide',
          label: text.hide,
          // Only offerable when the sidebar entry that brings the pet back actually
          // mounted; otherwise hiding would strand it.
          disabled: pet.sidebarReady !== true,
          note: pet.sidebarReady === true ? null : text.hideUnavailable,
          onSelect: function () {
            // Hiding shows the 桌宠 entry at the sidebar foot, which is the way back.
            close()
            pet.store.setPrefs({ hidden: true })
          },
        })
        items.push({ kind: 'sep' })
        items.push({ kind: 'group', label: text.groupDisplay })
        items.push({
          kind: 'submenu',
          id: 'size',
          icon: 'size',
          label: text.size,
          value: sizeLabel(prefs),
          items: SIZE_PRESETS.map(function (preset) {
            return {
              kind: 'option',
              id: preset.id,
              label: preset.label,
              note: preset.side + ' pt',
              checked: prefs.sizeMode === preset.id,
              onSelect: function () {
                choose({ sizeMode: preset.id })
              },
            }
          }).concat([
            {
              kind: 'option',
              id: 'custom',
              label: text.custom,
              note: CUSTOM_MIN + '–' + CUSTOM_MAX + ' pt',
              checked: prefs.sizeMode === 'custom',
              onSelect: function () {
                pet.store.openDialog({ kind: 'size', value: String(resolvedSide(prefs)), error: '' })
              },
            },
          ]),
        })
        items.push({
          kind: 'submenu',
          id: 'appearance',
          icon: 'appearance',
          label: text.appearance,
          value: appearance.label,
          items: APPEARANCES.map(function (entry) {
            return {
              kind: 'option',
              id: entry.id,
              label: entry.label,
              note: entry.differential ? text.differential : null,
              checked: prefs.appearance === entry.id,
              onSelect: function () {
                choose({ appearance: entry.id })
              },
            }
          }),
        })
        items.push({
          kind: 'submenu',
          id: 'expression',
          icon: 'expression',
          label: text.expression,
          value: appearance.differential
            ? (EXPRESSION_BY_ID[prefs.expression] || EXPRESSIONS[0]).label
            : text.notApplicable,
          disabled: !appearance.differential,
          note: appearance.differential ? null : text.expressionOnlyDefault.replace('{name}', APPEARANCES[0].label),
          items: EXPRESSIONS.map(function (entry) {
            return {
              kind: 'option',
              id: entry.id,
              label: entry.label,
              note: entry.note,
              checked: prefs.expression === entry.id,
              onSelect: function () {
                choose({ expression: entry.id })
              },
            }
          }),
        })
        items.push({
          kind: 'toggle',
          id: 'snap',
          icon: 'snap',
          label: text.snap,
          checked: prefs.snapOnRelease,
          onSelect: function () {
            var next = !prefs.snapOnRelease
            pet.store.setPrefs({ snapOnRelease: next })
            // Turning it on is also a request to go there now; otherwise the
            // toggle would appear to do nothing until the next drag.
            if (next) animateTo(pet, snapTarget(pet))
            close()
          },
        })

        items.push({ kind: 'sep' })
        items.push({ kind: 'group', label: text.groupBalance })
        items.push({
          kind: 'submenu',
          id: 'source',
          icon: 'source',
          label: text.source,
          value: sourceLabel(prefs),
          items: SOURCE_CHOICES.map(function (entry) {
            return {
              kind: 'option',
              id: entry.id,
              label: entry.label,
              note: entry.note,
              checked: prefs.balanceSource === entry.id,
              onSelect: function () {
                choose({ balanceSource: entry.id }, { refresh: true })
              },
            }
          }),
        })
        items.push({
          kind: 'item',
          id: 'apikey',
          icon: 'key',
          label: text.apiKey,
          onSelect: function () {
            pet.store.openDialog({ kind: 'apikey', value: '', error: '' })
          },
        })
        if (reading !== null && reading.apiKeyStored === true) {
          items.push({
            kind: 'item',
            id: 'clearKey',
            icon: 'clear',
            label: text.clearKey,
            onSelect: function () {
              close()
              poller.saveApiKey(null).then(function () {
                return poller.refresh()
              })
            },
          })
        }
        items.push({
          kind: 'submenu',
          id: 'interval',
          icon: 'clock',
          label: text.interval,
          value: intervalLabel(prefs),
          items: INTERVALS.map(function (entry) {
            return {
              kind: 'option',
              id: String(entry.seconds),
              label: entry.label,
              checked: prefs.pollSeconds === entry.seconds,
              onSelect: function () {
                choose({ pollSeconds: entry.seconds })
              },
            }
          }),
        })

        function openSubmenu(entry, event) {
          var rect = event.currentTarget.getBoundingClientRect()
          var width = 224
          var left = rect.right + 3
          if (left + width > window.innerWidth - 6) left = Math.max(6, rect.left - width - 3)
          var height = estimateHeight(entry.items)
          var top = rect.top - 6
          if (top + height > window.innerHeight - 6) top = Math.max(6, window.innerHeight - 6 - height)
          pet.store.menuPositions[entry.id] = { left: left, top: top }
          pet.store.menuPath = [entry.id]
          pet.store.emit()
        }

        function renderEntry(entry, index, level) {
          if (entry.kind === 'status') {
            return React.createElement('div', { key: 'status', className: 'dshbp-menuStatus' }, entry.label)
          }
          if (entry.kind === 'group') {
            return React.createElement('div', { key: 'group-' + index, className: 'dshbp-menuGroup' }, entry.label)
          }
          if (entry.kind === 'sep') {
            return React.createElement('div', { key: 'sep-' + index, className: 'dshbp-menuSep' })
          }

          var children = [MenuIcon(entry.icon)]
          children.push(
            React.createElement(
              'span',
              { key: 'label', className: 'dshbp-menuLabel', title: entry.note || entry.label },
              entry.label,
            ),
          )
          if (entry.value !== undefined && entry.value !== null) {
            children.push(React.createElement('span', { key: 'value', className: 'dshbp-menuValue' }, entry.value))
          }
          if (entry.kind === 'toggle' || entry.kind === 'option') {
            children.push(
              entry.checked ? Tick() : React.createElement('span', { key: 'tick', className: 'dshbp-menuTick' }),
            )
          }
          if (entry.kind === 'submenu') {
            children.push(
              React.createElement(
                'span',
                { key: 'chevron', className: 'dshbp-menuChevron' },
                SvgIcon(ICON_PATHS.chevron, 14, 1.5),
              ),
            )
          }

          var isOpen =
            entry.kind === 'submenu' &&
            pet.store.menuPath[level] !== undefined &&
            pet.store.menuPath[level] === entry.id

          var props = {
            key: (entry.id || 'row') + '-' + index,
            type: 'button',
            role: 'menuitem',
            className: 'dshbp-menuItem',
            disabled: entry.disabled === true,
            onClick: function (event) {
              event.preventDefault()
              if (entry.disabled === true) return
              if (entry.kind === 'submenu') {
                if (isOpen) {
                  pet.store.menuPath = []
                  pet.store.emit()
                } else {
                  openSubmenu(entry, event)
                }
                return
              }
              if (typeof entry.onSelect === 'function') entry.onSelect()
            },
          }
          if (entry.kind === 'submenu') {
            props.onMouseEnter = function (event) {
              if (entry.disabled !== true) openSubmenu(entry, event)
            }
          }
          return React.createElement('button', props, children)
        }

        function renderLevel(entries, level, style) {
          var rows = []
          for (var index = 0; index < entries.length; index += 1) {
            rows.push(renderEntry(entries[index], index, level))
            // A note is the one-line explanation under an entry — used for the
            // "only the default appearance has differential art" hint and for
            // describing each expression.
            if (entries[index].note) {
              rows.push(
                React.createElement(
                  'div',
                  { key: 'note-' + index, className: 'dshbp-menuNote' },
                  entries[index].note,
                ),
              )
            }
          }
          return React.createElement(
            'div',
            { className: 'dshbp-menu', 'data-pet-menu': '', style: style, role: 'menu' },
            rows,
          )
        }

        var levels = []
        var rootLeft = Math.min(menu.x, Math.max(0, window.innerWidth - 214))
        var rootTop = Math.min(menu.y, Math.max(0, window.innerHeight - estimateHeight(items) - 8))
        levels.push(renderLevel(items, 0, { left: rootLeft, top: rootTop }))

        var openId = pet.store.menuPath[0]
        if (openId !== undefined) {
          for (var index = 0; index < items.length; index += 1) {
            if (items[index].kind === 'submenu' && items[index].id === openId) {
              var position = pet.store.menuPositions[openId] || { left: rootLeft + 214, top: rootTop }
              levels.push(renderLevel(items[index].items, 1, { left: position.left, top: position.top }))
            }
          }
        }
        return React.createElement(React.Fragment, null, levels)
      }
    }

    /* ---------------------------------------------------------------- *
     * dialogs
     * ---------------------------------------------------------------- */

    function buildDialog(pet, poller, text) {
      return function PetDialog() {
        useStore(pet.store)
        var dialog = pet.store.dialog
        var inputRef = React.useRef(null)
        var busyPair = React.useState(false)
        var localPair = React.useState({ value: '', error: '' })
        var busy = busyPair[0]
        var value = localPair[0].value
        var error = localPair[0].error
        var dialogKind = dialog === null ? '' : dialog.kind
        var dialogValue = dialog === null ? '' : dialog.value

        React.useEffect(
          function () {
            if (dialogKind !== '') localPair[1]({ value: dialogValue || '', error: '' })
          },
          // `dialogValue` is part of the key so reopening the same dialog after a
          // cancel starts from the current value rather than the abandoned edit.
          [dialogKind, dialogValue],
        )

        React.useEffect(
          function () {
            if (dialogKind === '') return undefined
            if (inputRef.current !== null && typeof inputRef.current.focus === 'function') {
              inputRef.current.focus()
            }
            function onKey(event) {
              if (event.key === 'Escape') {
                event.preventDefault()
                pet.store.closeDialog()
              }
            }
            window.addEventListener('keydown', onKey, true)
            return function () {
              window.removeEventListener('keydown', onKey, true)
            }
          },
          [dialogKind],
        )

        if (dialog === null) return null

        function submit() {
          if (busy) return
          if (dialogKind === 'size') {
            var parsed = Number(value)
            if (!isFinite(parsed) || Math.round(parsed) < CUSTOM_MIN || Math.round(parsed) > CUSTOM_MAX) {
              localPair[1]({
                value: value,
                error: text.sizeRange.replace('{min}', String(CUSTOM_MIN)).replace('{max}', String(CUSTOM_MAX)),
              })
              return
            }
            pet.store.closeDialog()
            pet.store.setPrefs({ sizeMode: 'custom', customSide: clamp(Math.round(parsed), CUSTOM_MIN, CUSTOM_MAX) })
            if (pet.onFrame !== null) pet.onFrame()
            return
          }
          if (value.trim().length === 0) {
            localPair[1]({ value: value, error: text.keyRequired })
            return
          }
          busyPair[1](true)
          poller
            .saveApiKey(value.trim())
            .then(function (payload) {
              busyPair[1](false)
              if (payload === null || typeof payload !== 'object' || payload.ok !== true) {
                localPair[1]({ value: '', error: (payload && payload.message) || text.keyFailed })
                return
              }
              pet.firstReading = true
              pet.store.closeDialog()
              return poller.refresh()
            })
            .catch(function (cause) {
              busyPair[1](false)
              localPair[1]({ value: '', error: String((cause && cause.message) || cause) })
            })
        }

        var isKey = dialogKind === 'apikey'
        return React.createElement(
          'div',
          {
            className: 'dshbp-scrim',
            onPointerDown: function (event) {
              if (event.target === event.currentTarget) pet.store.closeDialog()
            },
          },
          React.createElement('div', { className: 'dshbp-dialog', role: 'dialog', 'aria-modal': 'true' }, [
            React.createElement(
              'div',
              { key: 'title', className: 'dshbp-dialogTitle' },
              isKey ? text.apiKey.replace('…', '') : text.customSize,
            ),
            React.createElement(
              'div',
              { key: 'body', className: 'dshbp-dialogBody' },
              isKey ? text.apiKeyBody.replace('<dshHome>', text.dshHomeLabel) : text.sizeBody,
            ),
            React.createElement('input', {
              key: 'input',
              ref: inputRef,
              className: 'dshbp-input',
              type: isKey ? 'password' : 'number',
              inputMode: isKey ? 'text' : 'numeric',
              autoComplete: 'off',
              spellCheck: false,
              placeholder: isKey ? 'sk-…' : String(CUSTOM_DEFAULT),
              value: value,
              onChange: function (event) {
                localPair[1]({ value: event.target.value, error: '' })
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              },
            }),
            error.length > 0
              ? React.createElement('div', { key: 'error', className: 'dshbp-error', role: 'alert' }, error)
              : null,
            React.createElement('div', { key: 'actions', className: 'dshbp-dialogActions' }, [
              React.createElement(
                'button',
                {
                  key: 'cancel',
                  type: 'button',
                  className: 'dshbp-button',
                  onClick: function () {
                    pet.store.closeDialog()
                  },
                },
                text.cancel,
              ),
              React.createElement(
                'button',
                {
                  key: 'save',
                  type: 'button',
                  className: 'dshbp-button',
                  'data-primary': 'true',
                  disabled: busy,
                  onClick: submit,
                },
                busy ? text.saving : text.save,
              ),
            ]),
          ]),
        )
      }
    }

    /* ---------------------------------------------------------------- *
     * the pet
     * ---------------------------------------------------------------- */

    function buildOverlay(pet, poller, text) {
      return function BalancePetOverlay() {
        useStore(pet.store)
        var containerRef = React.useRef(null)
        var canvasRef = React.useRef(null)
        var clickRef = React.useRef(null)
        var viewport = viewportSize()
        var initialSide = resolvedSide(pet.store.prefs)
        // Sized on the first render as well as in `paint()`, so the pet never
        // appears for one frame at the canvas' intrinsic 300 × 150.
        var initialBox = layout(initialSide, resolveArt(pet).art)
        var menu = pet.store.menu

        // The imperative animation loop. React never re-renders per frame: the
        // canvas is driven from the model directly and the loop stops when there
        // is nothing left to animate.
        React.useEffect(function () {
          var canvas = canvasRef.current
          var container = containerRef.current
          if (canvas === null || container === null) return undefined
          var frameId = null
          var last = 0
          var alive = true

          function paint() {
            var side = resolvedSide(pet.store.prefs)
            var resolved = resolveArt(pet)
            var box = layout(side, resolved.art)
            var dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1))
            var pixelWidth = Math.max(1, Math.round(box.width * dpr))
            var pixelHeight = Math.max(1, Math.round(box.height * dpr))
            if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
              canvas.width = pixelWidth
              canvas.height = pixelHeight
            }
            canvas.style.width = box.width + 'px'
            canvas.style.height = box.height + 'px'
            container.style.width = box.width + 'px'
            container.style.height = box.height + 'px'
            container.style.left = pet.store.prefs.left + 'px'
            container.style.bottom = pet.store.prefs.bottom + 'px'
            // The memoised rect must not outlive a move.
            pet.rectAt = 0
            // Resolved and laid out once here and handed down, rather than repeating
            // both inside renderPet on every frame.
            renderPet(canvas, pet, { dpr: dpr, side: side, resolved: resolved, box: box })
          }

          function step(timestamp) {
            if (!alive) return
            var dt = last === 0 ? 0 : (timestamp - last) / 1000
            last = timestamp
            modelTick(pet.model, dt)
            paint()
            if (modelNeedsFrame(pet.model)) {
              frameId = window.requestAnimationFrame(step)
            } else {
              frameId = null
              last = 0
            }
          }

          function ensure() {
            if (!alive) return
            if (frameId === null) {
              last = 0
              frameId = window.requestAnimationFrame(step)
            }
          }

          pet.onFrame = ensure
          var unsubscribe = pet.store.subscribe(ensure)
          // Warm the artwork this configuration needs, so the first frame after a
          // switch is not a blank box.
          var wanted = resolveArt(pet)
          spriteFor(pet, wanted.key, wanted.file)
          spriteFor(pet, 'bowl', BOWL_FILE)
          ensure()

          return function () {
            alive = false
            pet.onFrame = null
            unsubscribe()
            if (frameId !== null) window.cancelAnimationFrame(frameId)
          }
        }, [])

        // Pointer input is claimed in the capture phase from `window`, and only
        // where the sprite is opaque. The pet itself keeps `pointer-events: none`,
        // so a click on a transparent corner reaches the app underneath instead of
        // being swallowed by an invisible rectangle.
        React.useEffect(function () {
          function isPetTarget(event) {
            return hitTest(pet, containerRef.current, event.clientX, event.clientY)
          }

          function onPointerDown(event) {
            if (event.button !== 0 || event.ctrlKey || event.metaKey) return
            if (!isPetTarget(event)) return
            event.preventDefault()
            event.stopPropagation()
            clickRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              startLeft: pet.store.prefs.left,
              startBottom: pet.store.prefs.bottom,
              moved: false,
              pointerId: event.pointerId,
            }
            window.addEventListener('pointermove', onPointerMove, true)
            window.addEventListener('pointerup', onPointerUp, true)
            window.addEventListener('pointercancel', onPointerUp, true)
          }

          function onPointerMove(event) {
            var drag = clickRef.current
            if (drag === null || event.pointerId !== drag.pointerId) return
            var dx = event.clientX - drag.startX
            var dy = event.clientY - drag.startY
            if (!drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return
            drag.moved = true
            event.preventDefault()
            var next = clampPosition(pet, drag.startLeft + dx, drag.startBottom - dy)
            pet.store.prefs.left = next.left
            pet.store.prefs.bottom = next.bottom
            if (pet.onFrame !== null) pet.onFrame()
          }

          function onPointerUp(event) {
            var drag = clickRef.current
            if (drag === null) return
            clickRef.current = null
            window.removeEventListener('pointermove', onPointerMove, true)
            window.removeEventListener('pointerup', onPointerUp, true)
            window.removeEventListener('pointercancel', onPointerUp, true)
            if (!drag.moved) return // a plain click must not move a placed pet
            if (pet.store.prefs.snapOnRelease) {
              animateTo(pet, snapTarget(pet))
            } else {
              writePrefs(pet.store.prefs)
            }
          }

          function onContextMenu(event) {
            if (!isPetTarget(event)) return
            event.preventDefault()
            event.stopPropagation()
            pet.store.menu = { x: event.clientX, y: event.clientY }
            pet.store.menuPath = []
            pet.store.menuPositions = {}
            pet.store.emit()
          }

          function onPointerMoveHover(event) {
            if (clickRef.current !== null) return
            var over = isPetTarget(event)
            if (over !== pet.hover) {
              pet.hover = over
              document.body.style.cursor = over ? 'grab' : ''
            }
          }

          window.addEventListener('pointerdown', onPointerDown, true)
          window.addEventListener('contextmenu', onContextMenu, true)
          window.addEventListener('pointermove', onPointerMoveHover, true)
          return function () {
            window.removeEventListener('pointerdown', onPointerDown, true)
            window.removeEventListener('contextmenu', onContextMenu, true)
            window.removeEventListener('pointermove', onPointerMoveHover, true)
            window.removeEventListener('pointermove', onPointerMove, true)
            window.removeEventListener('pointerup', onPointerUp, true)
            window.removeEventListener('pointercancel', onPointerUp, true)
            document.body.style.cursor = ''
          }
        }, [])

        // Keep the pet on screen when the window changes size.
        React.useEffect(function () {
          function onResize() {
            var next = clampPosition(pet, pet.store.prefs.left, pet.store.prefs.bottom)
            pet.store.prefs.left = next.left
            pet.store.prefs.bottom = next.bottom
            if (pet.onFrame !== null) pet.onFrame()
          }
          window.addEventListener('resize', onResize)
          return function () {
            window.removeEventListener('resize', onResize)
          }
        }, [])

        // Dismiss the menu on any interaction outside it. A pointerdown inside it
        // must NOT close it — this listener runs in the capture phase, so it would
        // unmount the entry before its click landed.
        React.useEffect(
          function () {
            if (menu === null) return undefined
            function close(event) {
              if (event.type === 'keydown' && event.key !== 'Escape') return
              if (event.type === 'pointerdown') {
                var target = event.target
                if (
                  target !== null &&
                  typeof target.closest === 'function' &&
                  target.closest('[data-pet-menu]') !== null
                ) {
                  return
                }
              }
              pet.store.closeMenu()
            }
            window.addEventListener('pointerdown', close, true)
            window.addEventListener('keydown', close, true)
            window.addEventListener('blur', close, true)
            return function () {
              window.removeEventListener('pointerdown', close, true)
              window.removeEventListener('keydown', close, true)
              window.removeEventListener('blur', close, true)
            }
          },
          [menu === null],
        )

        return React.createElement(
          'div',
          {
            ref: containerRef,
            className: 'dshbp-root',
            role: 'img',
            style: {
              left: Math.min(pet.store.prefs.left, Math.max(0, viewport.width - initialBox.width)) + 'px',
              bottom: Math.min(pet.store.prefs.bottom, Math.max(0, viewport.height - initialBox.height)) + 'px',
              width: initialBox.width + 'px',
              height: initialBox.height + 'px',
              // Hidden: the component stays mounted (its poller wiring and
              // animation loop keep running) but draws nothing, and `hitTest`
              // refuses every pointer so the pill underneath is clickable.
              display: pet.store.prefs.hidden === true ? 'none' : 'block',
            },
            'aria-label': text.petLabel + ' · ' + appearanceById(pet.store.prefs.appearance).label,
          },
          [
            React.createElement('canvas', {
              key: 'canvas',
              ref: canvasRef,
              className: 'dshbp-canvas',
              width: Math.max(1, Math.round(initialBox.width)),
              height: Math.max(1, Math.round(initialBox.height)),
              'aria-hidden': 'true',
            }),
          ],
        )
      }
    }

    /* ---------------------------------------------------------------- *
     * hiding and restoring
     * ---------------------------------------------------------------- */

    /**
     * The way back from 隐藏桌宠: an entry beside Settings at the sidebar foot.
     *
     * It is deliberately the ONLY one, and it renders only while the pet is hidden —
     * when the pet is on screen, its own right-click menu owns the toggle. That keeps
     * the two controls mutually exclusive instead of offering both at once.
     *
     * The owner hands the component `{ wide }` (the column state) and nothing else,
     * so this renders its own control. When the sidebar is collapsed to the 56px rail
     * only the icon is shown.
     *
     * Because it is the only way back, it also *announces* that it mounted: the menu's
     * 隐藏桌宠 entry stays disabled until `pet.sidebarReady` is set, so a DSH build
     * whose sidebar slot never resolves cannot strand a hidden pet with no way to
     * bring it back.
     */
    function buildSidebarAction(pet, text) {
      return function BalancePetSidebarAction(props) {
        useStore(pet.store)
        var wide = props !== null && props !== undefined && props.wide === true
        var hidden = pet.store.prefs.hidden === true
        // Declare the way back as reachable, whatever this render returns.
        React.useEffect(function () {
          pet.sidebarReady = true
          return function () {
            pet.sidebarReady = false
          }
        }, [])
        // Only while the pet is hidden: the two toggles are never both on screen.
        if (!hidden) return null
        return React.createElement(
          'button',
          {
            type: 'button',
            className: 'dshbp-sideAction',
            title: text.show,
            onClick: function (event) {
              event.preventDefault()
              pet.store.setPrefs({ hidden: false })
            },
          },
          [
            React.createElement(
              'span',
              { key: 'icon', className: 'dshbp-sideActionIcon' },
              SvgIcon(ICON_PATHS.show, 16, 1.5),
            ),
            wide ? React.createElement('span', { key: 'label' }, text.petLabel) : null,
          ],
        )
      }
    }

    /** The 0.16 s ease-out corner move, matching the desktop snap. */
    function animateTo(pet, target) {
      var from = { left: pet.store.prefs.left, bottom: pet.store.prefs.bottom }
      var started = 0
      function step(timestamp) {
        if (started === 0) started = timestamp
        var progress = Math.min(1, (timestamp - started) / 160)
        var eased = 1 - Math.pow(1 - progress, 3)
        pet.store.prefs.left = from.left + (target.left - from.left) * eased
        pet.store.prefs.bottom = from.bottom + (target.bottom - from.bottom) * eased
        if (pet.onFrame !== null) pet.onFrame()
        if (progress < 1) {
          window.requestAnimationFrame(step)
        } else {
          pet.store.prefs.left = target.left
          pet.store.prefs.bottom = target.bottom
          writePrefs(pet.store.prefs)
          pet.store.emit()
        }
      }
      window.requestAnimationFrame(step)
    }

    /* ---------------------------------------------------------------- *
     * locale + boot
     * ---------------------------------------------------------------- */

    function localeId(ctx) {
      var candidates = []
      try {
        var locale = ctx.get('locale')
        if (locale !== undefined) {
          var snapshot = typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : undefined
          var current = typeof locale.getLocale === 'function' ? locale.getLocale() : undefined
          if (snapshot) candidates.push(snapshot.id, snapshot.locale, snapshot.current)
          if (current) candidates.push(current.id, current.locale)
        }
      } catch (error) {
        /* ignore */
      }
      if (typeof navigator !== 'undefined') candidates.push(navigator.language)
      if (typeof document !== 'undefined' && document.documentElement) {
        candidates.push(document.documentElement.lang)
      }
      for (var index = 0; index < candidates.length; index += 1) {
        if (typeof candidates[index] === 'string' && candidates[index].length > 0) return candidates[index]
      }
      return ''
    }

    function stringsFor(id) {
      var normalized = String(id).toLowerCase()
      if (normalized !== '' && normalized.indexOf('zh') !== 0) {
        return {
          petLabel: 'DSH balance pet',
          refresh: 'Refresh balance now',
          hide: 'Hide the pet',
          show: 'Show the pet',
          hideUnavailable: 'The sidebar toggle is unavailable, so the pet cannot be hidden right now.',
          connecting: 'Connecting…',
          connected: 'Connected',
          offline: 'Offline',
          groupDisplay: 'Display',
          groupBalance: 'Balance',
          size: 'Size',
          custom: 'Custom…',
          appearance: 'Appearance',
          expression: 'Expression',
          notApplicable: 'n/a',
          differential: 'has differential expressions',
          expressionOnlyDefault: 'Differential expressions exist only for {name}.',
          snap: 'Snap to bottom-left on release',
          source: 'Balance source',
          apiKey: 'Set API key…',
          clearKey: 'Clear saved key',
          interval: 'Refresh interval',
          cancel: 'Cancel',
          save: 'Save',
          saving: 'Saving…',
          customSize: 'Custom size',
          sizeBody: 'Body height of the pet in CSS pixels. 110 / 150 / 210 match the 小 / 中 / 大 presets.',
          sizeRange: 'Enter a whole number between {min} and {max}.',
          apiKeyBody:
            'Stored in {dshHome}/balance-pet/apikey.txt (mode 0600) and used only when the balance source needs it. ' +
            'DSH keeps its own key under Settings → Models; that one is preferred and needs no entry here.',
          dshHomeLabel: '<dshHome>',
          keyRequired: 'Enter a key, or Cancel to keep the current one.',
          keyFailed: 'The key could not be saved.',
        }
      }
      return {
        petLabel: 'DSH 余额桌宠',
        refresh: '立即刷新余额',
        hide: '隐藏桌宠',
        show: '显示桌宠',
        hideUnavailable: '侧边栏开关不可用，暂时无法隐藏桌宠。',
        connecting: '连接中…',
        connected: '已连接',
        offline: '离线',
        groupDisplay: '显示',
        groupBalance: '余额',
        size: '尺寸',
        custom: '自定义…',
        appearance: '外观',
        expression: '表情',
        notApplicable: '不适用',
        differential: '有差分表情',
        expressionOnlyDefault: '差分表情只有「{name}」有。',
        snap: '吸附（松手回左下角）',
        source: '余额来源',
        apiKey: '设置 API Key…',
        clearKey: '清除已保存的 Key',
        interval: '刷新间隔',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        customSize: '自定义尺寸',
        sizeBody: '桌宠的基础高度（CSS 像素）。110 / 150 / 210 对应「小 / 中 / 大」。',
        sizeRange: '请输入 {min} 到 {max} 之间的整数。',
        apiKeyBody:
          '保存到 {dshHome}/balance-pet/apikey.txt（权限 0600），只在余额来源需要时使用。' +
          'DSH 自己的 Key 在「设置 → 模型」里，那个优先且不必在这里填。',
        dshHomeLabel: '<dshHome>',
        keyRequired: '请输入 Key，或点「取消」保留原来的。',
        keyFailed: 'Key 保存失败。',
      }
    }

    function ensureStyles() {
      if (typeof document === 'undefined' || !document.head) return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']') !== null) return
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-plugin-balance-pet'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Resolve a service now, or as soon as it appears. */
    function whenService(ctx, name, whenReady) {
      var service = ctx.get(name)
      if (service !== undefined) {
        whenReady(service)
        return
      }
      if (typeof ctx.inject === 'function') {
        try {
          ctx.inject([name], function (scoped) {
            var ready = scoped.get(name)
            if (ready !== undefined) whenReady(ready)
          })
          return
        } catch (error) {
          /* fall through to polling */
        }
      }
      var attempts = 0
      var interval = setInterval(function () {
        attempts += 1
        var late = ctx.get(name)
        if (late !== undefined) {
          clearInterval(interval)
          whenReady(late)
        } else if (attempts > 80) {
          clearInterval(interval)
        }
      }, 250)
      ctx.effect(function () {
        return function () {
          clearInterval(interval)
        }
      })
    }

    exports.inject = ['slots']

    exports.apply = function apply(ctx) {
      ensureStyles()
      var text = stringsFor(localeId(ctx))
      var pet = makePet()
      var poller = createPoller(pet)

      whenService(ctx, 'slots', function (slots) {
        if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
          console.error(
            '[dsh-plugin-balance-pet] the slots service no longer looks like {inject, register}; ' +
              'see the dsh-plugin-balance-pet skill and GET ' + ROUTE + '/doctor',
          )
          return
        }
        // The pet, its menu and its dialogs are three occupants of the same
        // click-through overlay; the plugin declares no settings page at all.
        slots.inject(OVERLAY_SLOT, function () {
          return slots.register({ name: OVERLAY_SLOT, id: OVERLAY_ID, order: 900 }, buildOverlay(pet, poller, text))
        })
        slots.inject(OVERLAY_SLOT, function () {
          return slots.register(
            { name: OVERLAY_SLOT, id: OVERLAY_ID + '.menu', order: 901 },
            buildMenu(pet, poller, text),
          )
        })
        slots.inject(OVERLAY_SLOT, function () {
          return slots.register(
            { name: OVERLAY_SLOT, id: OVERLAY_ID + '.dialog', order: 902 },
            buildDialog(pet, poller, text),
          )
        })
        // The one and only way back from 隐藏桌宠, beside Settings at the sidebar
        // foot. It renders only while the pet is hidden.
        slots.inject(SIDEBAR_SLOT, function () {
          return slots.register(
            { name: SIDEBAR_SLOT, id: OVERLAY_ID, order: 20, label: text.petLabel },
            buildSidebarAction(pet, text),
          )
        })
      })

      poller.start()
      ctx.effect(function () {
        return function () {
          poller.stop()
          pet.onFrame = null
        }
      })
    }

    /** Exposed for the offline test suite: the bundle's pure logic, no DOM. */
    exports.__internals = {
      centsToYuan: centsToYuan,
      clamp: clamp,
      createModel: createModel,
      modelApply: modelApply,
      modelTick: modelTick,
      modelNeedsFrame: modelNeedsFrame,
      modelDraining: modelDraining,
      modelImpact: modelImpact,
      layout: layout,
      tabletMatrix: tabletMatrix,
      readPrefs: readPrefs,
      defaultPrefs: defaultPrefs,
      createStore: createStore,
      resolvedSide: resolvedSide,
      sizeLabel: sizeLabel,
      sourceLabel: sourceLabel,
      intervalLabel: intervalLabel,
      appearanceById: appearanceById,
      resolveArt: resolveArt,
      APPEARANCES: APPEARANCES,
      EXPRESSIONS: EXPRESSIONS,
      SIZE_PRESETS: SIZE_PRESETS,
      SOURCE_CHOICES: SOURCE_CHOICES,
      INTERVALS: INTERVALS,
      ART_DEEPSEEK: ART_DEEPSEEK,
      ART_WIDE: ART_WIDE,
      ART_WIDE_GEMINI: ART_WIDE_GEMINI,
      BOWL_FILE: BOWL_FILE,
      FACE_HAPPY: FACE_HAPPY,
      FACE_PAIN: FACE_PAIN,
      CUSTOM_MIN: CUSTOM_MIN,
      CUSTOM_MAX: CUSTOM_MAX,
      CUSTOM_DEFAULT: CUSTOM_DEFAULT,
      modelPained: modelPained,
      constants: {
        STEP_INTERVAL: STEP_INTERVAL,
        HIT_DURATION: HIT_DURATION,
        FLOAT_LIFETIME: FLOAT_LIFETIME,
        TOPUP_DURATION: TOPUP_DURATION,
        MAX_PENDING_STEPS: MAX_PENDING_STEPS,
        PAIN_HOLD: PAIN_HOLD,
      },
    }

    return module.exports
  },
})
