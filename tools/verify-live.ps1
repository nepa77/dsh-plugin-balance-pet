<#
.SYNOPSIS
  Live verification for dsh-plugin-balance-pet against a running DSH.

.DESCRIPTION
  Checks the things that can only be checked against a real Host:
    1. the doctor reports every required seam as present and the expected version;
    2. the bundle is enabled in the profile and the browser half is reporting;
    3. the JSON routes refuse a request without the custom header;
    4. a real balance query succeeds, and the source modes behave;
    5. the artwork is served and path traversal is refused.

  Read-only apart from the balance refreshes it forces (POST /refresh), which cost
  nothing: they ask the account service for the balance it already knows. The API
  key is never written by this script.

  The two slot registrations are NOT checkable from a shell - an agent verifies
  them with cordis_inspect_query, as noted at the end of the output.

  IMPORTANT: a plugin's Host half is not hot reloaded. If the doctor's `version`
  is older than package.json, restart DSH before trusting any of this.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-live.ps1
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = $env:DSH_WEB_URL,
  [string]$Route = '/dsh-plugin-balance-pet'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch { }

if ([string]::IsNullOrWhiteSpace($BaseUrl)) { $BaseUrl = 'http://127.0.0.1:19387' }
$BaseUrl = $BaseUrl.TrimEnd('/')
$prefix = $BaseUrl + $Route
$header = @{ 'x-dsh-plugin-balance-pet' = '1' }

$script:passed = 0
$script:failed = 0
$script:doctor = $null
$script:state = $null

function Check {
  param([string]$Name, [scriptblock]$Body)
  try {
    $detail = & $Body
    $script:passed++
    Write-Host ("  ok   {0}" -f $Name) -ForegroundColor Green
    if ($detail) { Write-Host ("         {0}" -f $detail) -ForegroundColor DarkGray }
  } catch {
    $script:failed++
    Write-Host ("  FAIL {0}" -f $Name) -ForegroundColor Red
    Write-Host ("         {0}" -f $_.Exception.Message) -ForegroundColor Red
  }
}

function Get-Json {
  param([string]$Url, [hashtable]$Headers = @{}, [string]$Method = 'GET')
  $response = Invoke-WebRequest -Uri $Url -Headers $Headers -Method $Method -UseBasicParsing -TimeoutSec 40
  return ($response.Content | ConvertFrom-Json)
}

function Get-Status {
  param([string]$Url, [hashtable]$Headers = @{}, [string]$Method = 'GET')
  try {
    $response = Invoke-WebRequest -Uri $Url -Headers $Headers -Method $Method -UseBasicParsing -TimeoutSec 40
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

Write-Host ""
Write-Host "dsh-plugin-balance-pet - live verification against $BaseUrl" -ForegroundColor Cyan
Write-Host ""

# ---- 1. doctor ------------------------------------------------------------
Write-Host "doctor" -ForegroundColor White

Check 'GET /doctor answers' {
  $script:doctor = Get-Json "$prefix/doctor"
  "version $($script:doctor.version) | adaptedFor $($script:doctor.adaptedFor)"
}

Check 'the running Host is the package on disk (restart if not)' {
  if ($null -eq $script:doctor) { throw 'doctor did not answer' }
  $manifestPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'package.json'
  if (-not (Test-Path $manifestPath)) { throw "no manifest at $manifestPath" }
  $manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
  if ($script:doctor.version -ne $manifest.version) {
    throw "running $($script:doctor.version) but the package is $($manifest.version) - restart DSH (a plugin's Host half is not hot reloaded)"
  }
  "running $($script:doctor.version), matching package.json"
}

Check 'every required seam is present' {
  if ($null -eq $script:doctor) { throw 'doctor did not answer' }
  $missing = @($script:doctor.requiredFailures)
  if ($missing.Count -gt 0) { throw ("required failures: " + ($missing -join ', ')) }
  $required = @($script:doctor.checks | Where-Object { $_.level -eq 'required' })
  "$($required.Count) required seams, all ok"
}

Check 'the account balance seam is usable' {
  if ($null -eq $script:doctor) { throw 'doctor did not answer' }
  $entry = $script:doctor.checks | Where-Object { $_.id -eq 'deepseekAccount.getBalance' }
  if ($null -eq $entry -or -not $entry.ok) { throw 'ctx.get("deepseekAccount").getBalance is unavailable' }
  'ctx.get("deepseekAccount").getBalance present'
}

Check 'the artwork is where the package expects it' {
  if ($null -eq $script:doctor) { throw 'doctor did not answer' }
  $entry = $script:doctor.checks | Where-Object { $_.id -eq 'asset-directory' }
  if ($null -eq $entry -or -not $entry.ok) { throw "asset directory unreadable: $($script:doctor.assetDir)" }
  $script:doctor.assetDir
}

# ---- 2. install state -----------------------------------------------------
Write-Host ""
Write-Host "install state" -ForegroundColor White

Check 'the bundle is enabled in the profile' {
  $manifestPath = Join-Path $env:DSH_PROFILE_DIR 'package.json'
  if (-not (Test-Path $manifestPath)) { throw "no profile manifest at $manifestPath" }
  $manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
  $bundles = @($manifest.dsh.profile.bundles)
  if ($bundles -notcontains 'dsh-plugin-balance-pet') { throw 'not in dsh.profile.bundles' }
  'dsh.profile.bundles contains dsh-plugin-balance-pet'
}

Check 'the browser half has reported what it painted' {
  if ($null -eq $script:doctor) { throw 'doctor did not answer' }
  if ($null -eq $script:doctor.client) {
    throw 'no client self-report yet - open the Harness Web UI (an enabled page polls /state within a second)'
  }
  $client = $script:doctor.client
  $age = [math]::Round(([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $client.at) / 1000, 1)
  "art={0} appearance={1} expression={2} size={3}/{4}pt sprite={5} canvas={6}x{7} at {8},{9} steps={10} topups={11} menuOpen={12} ({13}s ago)" -f `
    $client.art, $client.appearance, $client.expression, $client.sizeMode, $client.side, $client.sprite, `
    $client.width, $client.height, $client.left, $client.bottom, $client.steps, $client.topups, $client.menuOpen, $age
}

Check 'the reported artwork is actually loaded' {
  if ($null -eq $script:doctor -or $null -eq $script:doctor.client) { throw 'no client report' }
  if (-not $script:doctor.client.sprite) {
    throw 'the browser reported sprite=false - check GET /asset and the browser console'
  }
  'sprite=true'
}

# ---- 3. route guards ------------------------------------------------------
Write-Host ""
Write-Host "route guards" -ForegroundColor White

Check 'GET /state without the header is refused' {
  $status = Get-Status "$prefix/state"
  if ($status -ne 403) { throw "expected 403, got $status" }
  '403 without x-dsh-plugin-balance-pet'
}

Check 'POST /refresh without the header is refused' {
  $status = Get-Status "$prefix/refresh" -Method 'POST'
  if ($status -ne 403) { throw "expected 403, got $status" }
  '403 without x-dsh-plugin-balance-pet'
}

Check 'POST /apikey without the header is refused' {
  $status = Get-Status "$prefix/apikey" -Method 'POST'
  if ($status -ne 403) { throw "expected 403, got $status" }
  '403 without x-dsh-plugin-balance-pet'
}

# ---- 4. the balance itself ------------------------------------------------
Write-Host ""
Write-Host "balance" -ForegroundColor White

Check 'GET /state returns a reading' {
  $script:state = Get-Json "$prefix/state?interval=30" $header
  if ($null -eq $script:state) { throw 'empty response' }
  "ok=$($script:state.ok) cents=$($script:state.cents) source=$($script:state.source) mode=$($script:state.sourceMode)"
}

Check 'the reading is a real number or an explained failure' {
  if ($null -eq $script:state) { throw 'no state' }
  if ($script:state.ok) {
    if ($null -eq $script:state.cents) { throw 'ok=true but cents is null' }
    if ($script:state.display -notmatch '^-?\d+\.\d\d$') { throw "display '$($script:state.display)' is not x.xx" }
    "CNY $($script:state.display) from $($script:state.source)"
  } else {
    if ([string]::IsNullOrWhiteSpace($script:state.error)) { throw 'ok=false without an error message' }
    "reported as offline: $($script:state.error)"
  }
}

Check 'POST /refresh forces a query without inventing a balance change' {
  $before = Get-Json "$prefix/state?interval=30" $header
  $after = Get-Json "$prefix/refresh" $header -Method 'POST'
  if ($before.cents -eq $after.cents -and $before.rev -ne $after.rev) {
    throw "the revision moved ($($before.rev) -> $($after.rev)) without the balance moving - the animation would replay"
  }
  "rev $($before.rev) -> $($after.rev), cents $($before.cents) -> $($after.cents)"
}

Check 'the interval is clamped to 10..300' {
  $fast = Get-Json "$prefix/state?interval=1" $header
  $slow = Get-Json "$prefix/state?interval=99999" $header
  if ($fast.interval -ne 10) { throw "interval=1 became $($fast.interval), expected 10" }
  if ($slow.interval -ne 300) { throw "interval=99999 became $($slow.interval), expected 300" }
  '1 -> 10, 99999 -> 300'
}

Check 'the reading matches the source mode it claims' {
  # The browser re-asserts ITS preference on every ~1 Hz poll, so a probe from this
  # script can legitimately be overridden a moment later. What must hold is that the
  # mode named in a response agrees with where that response's number came from.
  #
  # The comparison is deliberately ASCII-only: Windows PowerShell 5.1 reads a
  # BOM-less UTF-8 .ps1 as ANSI, which silently corrupts non-ASCII literals.
  $answer = Get-Json "$prefix/state?source=account" $header
  $mode = $answer.sourceMode
  if ($null -eq $mode) { throw 'the response has no sourceMode field - the Host half is stale' }
  if ($mode -eq 'account' -and $answer.ok -and $answer.source -like '*API Key*') {
    throw "mode is account but the reading came from an API key"
  }
  if ($mode -eq 'apikey' -and $answer.ok -and $answer.source -notlike '*API Key*') {
    throw "mode is apikey but the reading did not come from an API key"
  }
  "mode=$mode source=$($answer.source) ok=$($answer.ok)"
}

Check 'only an API-key reading can come from an API key' {
  $answer = Get-Json "$prefix/state?source=apikey" $header
  if ($answer.sourceMode -eq 'apikey' -and $answer.ok -and $answer.source -notlike '*API Key*') {
    throw "mode is apikey but the reading did not come from an API key"
  }
  if ($answer.ok -and $answer.source -like '*API Key*' -and $answer.sourceMode -eq 'account') {
    throw "mode is account but an API key answered"
  }
  "mode=$($answer.sourceMode) source=$($answer.source)$(if (-not $answer.ok) { " error=$($answer.error)" })"
}

Check 'the API key store is reported but never returned' {
  $answer = Get-Json "$prefix/state?source=auto" $header
  if ($null -eq $answer.apiKeyStored) { throw 'no apiKeyStored field' }
  if ($answer.apiKeyStored -eq $true) { 'a key is stored (its value is never sent to the browser)' }
  else { 'no key stored in the pet yet' }
}

Check 'the browser reports the hidden flag and the pain hold' {
  if ($null -eq $script:doctor -or $null -eq $script:doctor.client) {
    throw 'no client report - open the Harness Web UI'
  }
  $client = $script:doctor.client
  if ($null -eq $client.hidden) { throw 'the report has no hidden field - the Host or Client half is stale' }
  $hold = if ($null -eq $client.painHold) { 'missing' } else { "$($client.painHold)s" }
  "hidden=$($client.hidden) painHold=$hold (0 = not holding the 紧张 face)"
}

Check 'the API key route rejects a malformed key' {
  $status = 0
  try {
    Invoke-WebRequest -Uri "$prefix/apikey" -Method POST -Headers $header -UseBasicParsing -TimeoutSec 20 `
      -ContentType 'application/json' -Body '{"key":"line one\nline two"}' | Out-Null
    $status = 200
  } catch {
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } else { throw }
  }
  if ($status -ne 400) { throw "expected 400 for a malformed key, got $status" }
  '400 for a multi-line key (nothing was written)'
}

# ---- 5. assets ------------------------------------------------------------
Write-Host ""
Write-Host "artwork" -ForegroundColor White

$files = @(
  'expression-11.webp',
  'expression-12.webp',
  'expression-21.webp',
  'expression-22.webp',
  'appearance-bowl.webp',
  'appearance-gpt.webp',
  'appearance-claude.webp',
  'appearance-gemini.webp'
)

foreach ($file in $files) {
  Check "GET /asset serves $file" {
    $response = Invoke-WebRequest -Uri "$prefix/asset?file=$file" -UseBasicParsing -TimeoutSec 30
    if ([int]$response.StatusCode -ne 200) { throw "status $($response.StatusCode)" }
    $bytes = $response.RawContentStream.ToArray()
    if ($bytes.Length -lt 1000) { throw "only $($bytes.Length) bytes" }
    $magic = [System.Text.Encoding]::ASCII.GetString($bytes[0..3])
    $format = [System.Text.Encoding]::ASCII.GetString($bytes[8..11])
    if ($magic -ne 'RIFF' -or $format -ne 'WEBP') { throw "not a WebP (magic '$magic'/'$format')" }
    "$([math]::Round($bytes.Length / 1KB, 1)) KiB, RIFF/WEBP"
  }
}

Check 'the four differential expressions are distinct files' {
  $hashes = @{}
  foreach ($file in @('expression-11.webp', 'expression-12.webp', 'expression-21.webp', 'expression-22.webp')) {
    $response = Invoke-WebRequest -Uri "$prefix/asset?file=$file" -UseBasicParsing -TimeoutSec 30
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [BitConverter]::ToString($sha.ComputeHash($response.RawContentStream.ToArray())).Replace('-', '')
    if ($hashes.ContainsKey($hash)) { throw "$file is byte-identical to $($hashes[$hash])" }
    $hashes[$hash] = $file
  }
  '4 distinct images (4 差分表情, not the same file four times)'
}

Check 'path traversal is refused' {
  foreach ($attempt in @('../../package.json', '..%2F..%2Fpackage.json', '/etc/passwd')) {
    $status = Get-Status "$prefix/asset?file=$attempt"
    if ($status -ne 404) { throw "$attempt returned $status, expected 404" }
  }
  '3 traversal attempts -> 404'
}

Check 'an unknown asset is refused' {
  $status = Get-Status "$prefix/asset?file=nope.webp"
  if ($status -ne 404) { throw "expected 404, got $status" }
  '404'
}

# ---- summary --------------------------------------------------------------
Write-Host ""
if ($script:failed -eq 0) {
  Write-Host "$($script:passed) passed, 0 failed" -ForegroundColor Green
} else {
  Write-Host "$($script:passed) passed, $($script:failed) failed" -ForegroundColor Red
}
Write-Host ""
Write-Host "Not covered here - run these with cordis_inspect_query:" -ForegroundColor DarkGray
Write-Host "  Slots.listSubTree root=shell.overlay -> balance-pet, .menu, .dialog, .restore (active)" -ForegroundColor DarkGray
Write-Host "  Slots.listSubTree root=sidebar.footer.action -> balance-pet (active)" -ForegroundColor DarkGray
Write-Host "  Slots.listSubTree root=settings.section -> balance-pet must be ABSENT (the menu replaced the page)" -ForegroundColor DarkGray
Write-Host ""

exit $(if ($script:failed -eq 0) { 0 } else { 1 })
