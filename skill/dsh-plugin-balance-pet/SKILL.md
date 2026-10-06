---
name: dsh-plugin-balance-pet
description: Use when the DSH balance pet misbehaves or after a DeepSeek Harness upgrade — the pet is missing, invisible or a grey box, the balance never arrives, an appearance or expression stops switching, the right-click menu does not open, the drop animation double-counts or stops firing, the API key cannot be saved, or the doctor route reports needs-adaptation. Explains which live seams to re-read, what the recorded expectations are, which call site to patch, and how to verify each fix.
---

# Re-adapting dsh-plugin-balance-pet

A frame-wide balance pet for the Harness Web UI. The Host half reads the balance; the
Client half draws the pet and owns the whole settings surface, which is the pet's
right-click menu.

**Version 0.4.0.** This package shares no code with any other bundle, so an upgrade only
ever affects the seams listed in `compat/expected-surface.json`.

## First response to any report

```powershell
curl.exe -s http://127.0.0.1:19387/dsh-plugin-balance-pet/doctor
```

Read it in this order:

| Field | Meaning |
|---|---|
| `version` | **Compare it with `package.json` first.** A plugin's Host half is not hot reloaded, so a stale version makes every other field a report about the *old* code. |
| `ok` / `requiredFailures` | A required Host seam is gone. That list is the punch list. |
| `checks[]` | Every seam with its `level` (`required` / `fallback` / `optional` / `info`) and `detail`. |
| `reading` | The last balance, with `source`, `error`, `sourceMode` and `apiKeyStored`. |
| `client` | The browser's own last self-report: `art`, `appearance`, `expression`, `sizeMode`, `side`, `sprite`, `menuOpen`, and how many drop steps it has played. `null` means no page has polled yet. |

Triage from `client`:

| Symptom | Reading |
|---|---|
| `client: null` while a page is open | The browser half never ran — check the slot registration and the console. |
| `client.sprite: false` | The artwork failed to load. Almost always a **Host/client asset-name mismatch** (see below), not a drawing bug. |
| `client.sprite: true` but nothing visible | A positioning or stacking problem; `client.left/bottom/width/height` tells you where it thinks it is. |
| `reading.ok: false` | The balance query failed, not the drawing. Read `reading.error` and `reading.sourceMode`. |

## The asset-name trap

`GET …/asset?file=` matches the requested name against an allowlist in **Host** code
(`ASSET_FILES` in `src/index.js`). The **Client** decides which names to ask for
(`EXPRESSIONS`, `APPEARANCES`, `OFFLINE_FILE` in `src/client.js`). Renaming or replacing
artwork therefore requires **both** files to agree, and — because the Host half only
reloads on a restart — a rename is exactly the change that produces grey boxes until DSH
restarts. `tools/verify-live-balance-pet.ps1` has a check for this; a test asserts the
allowlist equals the files on disk.

## The seams

### 1. `ctx.get('deepseekAccount').getBalance(client)` — Host, required

```js
ctx.get('deepseekAccount').getBalance({ version, locale, timezoneOffsetSeconds })
// => null | { status: 'ready', value: AccountWallet[], bonusWallets: AccountWallet[] }
//         | { status: 'failed' }
// AccountWallet = { currency: 'CNY' | 'USD', balance: string }
```

Re-read with `cordis_inspect_query { platform: 'host', provider: 'Service', method:
'listService', input: { service: 'deepseekAccount' } }`. If it moved, patch **only**
`readBalance()` in `src/index.js`, and keep these invariants — they are what makes the
number trustworthy:

- `null` means *signed out*; in `auto` mode fall through to a key, in `account` mode
  report it. Never ¥0.
- `status: 'failed'` must be **reported** in `auto` mode, not silently replaced by a key's
  balance: with a grant stored, the account balance is the truth and a swap would disagree
  with DSH's own account page.
- `apikey` mode must never call this seam at all (a test and the live script assert it).
- Sum `value` **and** `bonusWallets`, CNY only. A malformed wallet fails the whole reading
  (`sumCnyCents` → `null`) rather than under-reporting.
- Never compute cents through `Number`. `decimalToCents` shifts the decimal point in a
  digit string and rounds half-up with `BigInt`; a test pins `0.1 + 0.2 === 30`.

### 2. `ctx.get('webServer').register({kind: 'exact', path, handler})` — Host, required

Query `{ service: 'webServer' }`. Two properties matter and both are load-bearing:

- **Matching is on the pathname only** (`dsh-host-webserver` matches
  `new URL(req.url).pathname`). If a future build matches the whole URL, the `?interval=`,
  `?source=` and `?report=` parameters on `/state` break; the fix is to move them into a
  `POST` body.
- **The handler receives the raw `node:http` request/response** and is method-agnostic —
  that is how one `/apikey` route serves `POST` and `DELETE`. A build that wrapped the
  request would need `readQuery` / `readJsonBody` / `sendJson` updated.

### 3. `shell.overlay` — Client, required, now carrying three occupants

```
cordis_inspect_query { platform: 'client', provider: 'Slots', method: 'listSubTree',
                       input: { root: 'shell.overlay' } }
```

Registered as `balance-pet` (900, the canvas), `balance-pet.menu` (901) and
`balance-pet.dialog` (902). All three live in the same click-through layer.

**Preserve the input model.** The pet keeps `pointer-events: none` and claims input in the
`window` **capture** phase after an alpha test of the sprite; the menu panels and the
dialog scrim opt back in with `pointer-events: auto`. Giving the pet container
`pointer-events: auto` would make the artwork's transparent corners swallow clicks meant
for the app underneath — the single most annoying way this plugin can regress.

If the slot disappears, do **not** fall back to `document.body`: a plugin never appends a
second application to the body. Pick another frame-wide list slot and accept the different
placement.

### 4. `settings.section` — deliberately NOT used since 0.2.0

The 0.1.x settings page was removed; the right-click menu is the settings surface. A test
asserts the string `settings.section` never reappears in the bundle. If a future request
needs a page again, that is a design change — re-read the slot's contract first
(`label` is `string | () => string`, owner props are `{ close }`).

### 5. `sidebar.footer.action` — Client, required whenever the pet is hidden

The entry beside Settings that brings a hidden pet back, owner props `{ wide }` (`false` =
the 56px rail). As of 0.4.0 it is the **only** way back, and it renders only while the pet
is hidden — the two controls are mutually exclusive.

That makes this slot load-bearing in a new way: if it stops resolving, a user who hides the
pet has no visible way back. The plugin guards against exactly that instead of assuming the
slot works: the entry sets `pet.sidebarReady` when it mounts, and the menu's **隐藏桌宠**
entry is `disabled` until it is set. If a future DSH changes this slot's contract, fix the
component — do not remove the guard. The console one-liner to clear `hidden` is in the
package README.

## Behaviour that must not drift

Each property has a test that fails loudly:

| Property | Where | Test |
|---|---|---|
| One drop step per cent, one cue per 0.2 s, no drift | `modelTick` | "the beat holds at 0.2 s per step with no drift" |
| A change over 400 cents aligns instead of playing for minutes | `modelApply` | "exactly 400 cents still animates; 401 aligns immediately" |
| A repeated poll never replays already-animated money | `modelApply` | "a repeated poll never replays money already animated" |
| A top-up shows at once and its amount comes from the **two server readings** | `modelApply` | "the credit is measured from server readings, never from the lagging display" |
| A woken tab cannot fire a burst of hits | `modelTick` (delta capped at 0.1 s) | "one long frame (a woken tab) fires at most one step" |
| The red flash, shake and `-0.01` are the only reactions | `renderPet` | "the drop animation really is the only animated reaction left" |
| The pained face is worn while draining **and for 1 s after** | `resolveArt` / `modelPained` | "the pained face is held for exactly one second after the run ends" |
| 蓝色大肥鱼 borrows the bowl pose whenever there is no reading | `resolveArt` | "resolveArt: 蓝色大肥鱼 falls back to the bowl pose with no reading" |
| Hide and show are mutually exclusive, with no dead end | `buildSidebarAction` + the `sidebarReady` guard | "hiding and showing are mutually exclusive: never two controls at once" |

**Do not reintroduce a sound or a "demo the animation" control.** They were removed
deliberately; tests assert neither exists in either half. If a hand-test is ever needed,
drive it through `/refresh` and a changed balance, never a client-side rehearsal.

**Do not make the drop animation fire on a source change.** Switching 余额来源 changes
*which account* the number comes from, so the difference between the two is not spending.
The client sets `firstReading = true` before that refresh for exactly this reason.

## Where the numbers live

| Constant | Value | Meaning |
|---|---|---|
| `STEP_INTERVAL` | 0.2 s | one cent per step |
| `HIT_DURATION` | 0.55 s | shake + red-flash duration |
| `FLOAT_LIFETIME` | 0.95 s | how long `-0.01` floats |
| `TOPUP_DURATION` | 0.9 s | green ring after a credit |
| `MAX_PENDING_STEPS` | 400 | above this, align instead of animate |
| `FLOAT_BAND` | 0.55 | the top band reserved for floating amounts; never takes input |
| `CUSTOM_MIN` / `CUSTOM_MAX` | 60 / 420 | the 自定义 size dialog's range |
| `TABLET_WIDTH` / `TABLET_HEIGHT` | 400 × 220 | the virtual panel mapped onto the measured tablet quad |
| `FACE_HAPPY` / `FACE_PAIN` | `'11'` / `'22'` | the automatic top-up and draining faces |
| `PAIN_HOLD` | 1.0 s | how long 紧张 stays on after the last cent lands |

`LAYOUT` follows each artwork's aspect ratio: the box is the sprite plus `0.09 · side` of
shake margin, so a 1:1 artwork gets a narrow box instead of being stretched. If you change
that margin, update the geometry test.

`ART_DEEPSEEK` / `ART_WIDE` / `ART_WIDE_GEMINI` in `src/client.js` are the nominal artwork
size plus the **measured tablet quad from its upper-left**. Re-measure with
`python tools/render-pet-preview.py --corners` whenever artwork is replaced — it draws the
quad back onto every source image, which is far faster than guessing.

## Verify a change

```powershell
# 1. the model, the money math, the source modes and the routes — no DSH needed
node packages\dsh-plugin-balance-pet\test\balance-pet.test.mjs

# 2. what the pet and its menu look like (same math as the browser canvas)
python tools\render-pet-preview.py

# 3. the live seams, version freshness, the guards and both source modes
powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-live-balance-pet.ps1
```

Then restart DSH before trusting the result: **a plugin's Host half is not hot reloaded**,
and the live script's first check exists to catch you forgetting. The Client half reloads
on its own (edit `src/client.js`, refresh the page).

Bump `VERSION` in `src/index.js` and `version` in `package.json` together, and update
`compat/expected-surface.json`.

If you changed anything the user can see, say which parts you verified and which you
could not: installation and slot registration prove the bundle *runs*, not that the pet
looks right.
