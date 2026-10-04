# Offline checks: shadow network and secret-input commands with synthetic fixtures.
$ErrorActionPreference = 'Stop'
$jobLensLiveScript = Join-Path $PSScriptRoot 'test-backend-live.ps1'
$jobLensHarnessBuild = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../backend/dist/build-info.json') -Raw | ConvertFrom-Json
$global:jobLensMockMode = ''
$global:jobLensMockPosts = 0
$global:jobLensMockPrompts = 0
$global:jobLensMockRequests = @()

function Read-Host {
  param([string]$Prompt, [switch]$AsSecureString)
  $global:jobLensMockPrompts++
  if (-not $AsSecureString) { throw 'Secret prompt must use hidden input.' }
  return ConvertTo-SecureString 'offline-synthetic-test-key-0123456789' -AsPlainText -Force
}

function Invoke-WebRequest {
  param([string]$Method, [string]$Uri, $Headers, [string]$ContentType, $Body, [int]$TimeoutSec, [switch]$UseBasicParsing)
  if (-not $UseBasicParsing) { throw 'Use raw HTTP bytes, without legacy HTML parsing.' }
  $jobLensMockResponse = Invoke-RestMethod -Method $Method -Uri $Uri -Headers $Headers -ContentType $ContentType -Body $Body -TimeoutSec $TimeoutSec
  $jobLensMockBytes = [Text.Encoding]::UTF8.GetBytes(($jobLensMockResponse | ConvertTo-Json -Depth 40))
  return [PSCustomObject]@{ RawContentStream = [IO.MemoryStream]::new($jobLensMockBytes); Headers = @{ 'Content-Type' = 'application/json' } }
}

function Invoke-RestMethod {
  param([string]$Method, [string]$Uri, $Headers, [string]$ContentType, $Body, [int]$TimeoutSec)
  if ($Method -eq 'Get') {
    if ($Uri -notlike '*/health') { throw 'Unexpected health route.' }
    return [PSCustomObject]@{
      status = 'ok'; apiVersion = 'job-lens-analysis-v2'; assessmentVersion = 'clef-score-v9'; scoringVersion = 'weighted-clef-score-v1'; rubricVersion = 'alignment-0-5-v1'
      buildId = $(if ($global:jobLensMockMode -eq 'old-build') { 'outdated' } else { $jobLensHarnessBuild.buildId })
    }
  }
  $global:jobLensMockPosts++
  if ($Uri -notlike '*/analyze' -or $Method -ne 'Post') { throw 'Unexpected inference route.' }
  if ($ContentType -ne 'application/json; charset=utf-8' -or $Body -isnot [byte[]]) { throw 'Request must use explicit UTF-8 JSON bytes.' }
  if ($Headers.Authorization -ne 'Bearer offline-synthetic-test-key-0123456789') { throw 'Missing testing authorization.' }
  $jobLensMockInput = [Text.Encoding]::UTF8.GetString($Body) | ConvertFrom-Json
  $global:jobLensMockRequests += $jobLensMockInput
  $jobLensMockDecisions = @{ skills = 'met'; experience = 'met'; language = 'met'; location = 'met'; employment = 'met' }
  if ($jobLensMockInput.preferencesVersion -eq 'sample-preferences-conflict-v1') {
    $jobLensMockDecisions.location = 'unmet'; $jobLensMockDecisions.employment = 'unmet'
  } elseif ($jobLensMockInput.resume.version -eq 'sample-resume-unknown-v1') {
    $jobLensMockDecisions.skills = 'unknown'; $jobLensMockDecisions.experience = 'unknown'; $jobLensMockDecisions.language = 'unknown'
  }
  if ($jobLensMockInput.resume.version -like 'sample-resume-language-*-v1') {
    $jobLensMockLanguageDecisions = @{ matching = 'met'; conflict = 'unmet'; partial = 'partial'; unknown = 'unknown' }
    $jobLensMockLanguageCase = $jobLensMockInput.resume.version -replace '^sample-resume-language-', '' -replace '-v1$', ''
    $jobLensMockDecisions.language = $jobLensMockLanguageDecisions[$jobLensMockLanguageCase]
    if (@($jobLensMockInput.preferences.languages).Count -ne 0) { throw 'Language scenarios must exercise resume evidence with empty saved language settings.' }
    if (-not $jobLensMockInput.job.description.Contains('Deutsch und Englisch sehr gut in Wort und Schrift')) { throw 'German language requirement was corrupted or omitted.' }
  }
  if ($jobLensMockInput.resume.version -like 'sample-resume-conditional-*-v1') {
    if (-not $jobLensMockInput.job.description.Contains('Werkstudenten >= B1, Vollzeit >= B2')) { throw 'Conditional posting was corrupted.' }
    if ($jobLensMockInput.resume.text.Contains('Seeking a full-time')) { throw 'Conditional cases must not have a CV target overriding the ambiguous preference case.' }
    $jobLensMockDecisions.language = if ($jobLensMockInput.resume.version -eq 'sample-resume-conditional-fulltime-v1') { 'unmet' } `
      elseif ($jobLensMockInput.resume.version -eq 'sample-resume-conditional-unknown-v1') { 'unknown' } else { 'met' }
  }
  if ($global:jobLensMockMode -eq 'wrong-decision') { $jobLensMockDecisions.skills = 'unmet' }
  if ($global:jobLensMockMode -eq 'wrong-language') { $jobLensMockDecisions.language = 'not_required' }
  $jobLensMockAssessments = @{}
  $jobLensMockBreakdown = @()
  foreach ($jobLensMockDimension in $jobLensMockDecisions.Keys) {
    $jobLensMockDecision = $jobLensMockDecisions[$jobLensMockDimension]
    $jobLensMockStatus = if ($jobLensMockDecision -eq 'unknown') { 'unknown' } elseif ($jobLensMockDecision -eq 'not_required') { 'not_required' } else { 'assessable' }
    $jobLensMockConflict = if ($jobLensMockDecision -eq 'unmet') { 'conflict' } else { 'no_conflict' }
    $jobLensMockRating = $null; $jobLensMockPoints = $null
    if ($jobLensMockStatus -eq 'assessable') {
      $jobLensMockScore = if ($jobLensMockDecision -eq 'partial') { 3.7 } elseif ($jobLensMockDecision -eq 'unmet') { 1.5 } else { 5 }
      $jobLensMockRating = @{ score = $jobLensMockScore }
      $jobLensMockPoints = $jobLensMockScore * 20
    }
    $jobLensMockAssessments[$jobLensMockDimension] = @{
      status = @{ decision = $jobLensMockStatus }; conflict = @{ decision = $jobLensMockConflict }; rating = $jobLensMockRating
    }
    if ($global:jobLensMockMode -eq 'wrong-score' -and $jobLensMockDimension -eq 'skills') { $jobLensMockPoints = 50 }
    $jobLensMockBreakdown += @{ dimension = $jobLensMockDimension; points = $jobLensMockPoints }
  }
  return [PSCustomObject]@{
    buildId = $jobLensHarnessBuild.buildId; apiVersion = 'job-lens-analysis-v2'; assessmentVersion = 'clef-score-v9'; scoringVersion = 'weighted-clef-score-v1'; rubricVersion = 'alignment-0-5-v1'
    requestId = $(if ($global:jobLensMockMode -eq 'wrong-request') { 'stale-response' } else { $jobLensMockInput.requestId })
    resumeVersion = $jobLensMockInput.resume.version; preferencesVersion = $jobLensMockInput.preferencesVersion
    jobId = $jobLensMockInput.job.id; assessments = [PSCustomObject]$jobLensMockAssessments
    score = @{ breakdown = $jobLensMockBreakdown }
    debug = $(if ($Headers['X-Job-Lens-Debug'] -eq 'requirements-v1' -and $global:jobLensMockMode -ne 'missing-debug') {
      @{ format = 'job-lens-provider-trace-v2'; request = @{ model = 'clef-flash'; state = @{ resume = $jobLensMockInput.resume.text; job = $jobLensMockInput.job } }; rawResponse = @{ model = 'clef-flash'; answers = @{}; encodingProbe = ('0 ' + [char]0x2014 + ' rubric') }
        work = @{ request = @{ model = 'clef-flash'; state = @{ job = $jobLensMockInput.job; workPreferences = @{ location = @{ acceptableCities = $jobLensMockInput.preferences.acceptableCities; remoteWork = $jobLensMockInput.preferences.remoteWork }; employment = @{ employmentTypes = $jobLensMockInput.preferences.employmentTypes } } } }; rawResponse = @{ model = 'clef-flash'; answers = @{} } } }
    } else { $null })
  }
}

function Reset-JobLensMock([string]$Mode) {
  $global:jobLensMockMode = $Mode; $global:jobLensMockPosts = 0
  $global:jobLensMockPrompts = 0; $global:jobLensMockRequests = @()
}

function Assert-JobLens([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

Reset-JobLensMock 'old-build'
$jobLensHarnessError = $null
try { $null = & $jobLensLiveScript -Scenario all } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $jobLensHarnessError.ToString().Contains('Wrong deployed build')) 'Outdated deployment was not rejected.'
Assert-JobLens ($global:jobLensMockPosts -eq 0 -and $global:jobLensMockPrompts -eq 0) 'Outdated deployment prompted for a secret or sent an inference.'

Reset-JobLensMock 'correct'
$null = & $jobLensLiveScript -Scenario all
Assert-JobLens ($global:jobLensMockPosts -eq 7 -and $global:jobLensMockPrompts -eq 1) 'All scenarios must send seven requests with one secret prompt.'
Assert-JobLens ($global:jobLensMockRequests[0].resume.text -eq $global:jobLensMockRequests[1].resume.text) 'Conflict scenario changed professional evidence.'
Assert-JobLens ($global:jobLensMockRequests[1].preferences.remoteWork -eq 'onsite') 'Conflict scenario did not change the arrangement.'
Assert-JobLens ($global:jobLensMockRequests[2].preferences.remoteWork -eq 'remote') 'Unknown scenario changed the arrangement.'
Assert-JobLens ($global:jobLensMockRequests[2].preferences.employmentTypes[0] -eq 'full-time') 'Unknown scenario changed the employment preference.'

Reset-JobLensMock 'correct'
$null = & $jobLensLiveScript -Scenario languages
Assert-JobLens ($global:jobLensMockPosts -eq 4 -and $global:jobLensMockPrompts -eq 1) 'Language-only suite must send four requests with one secret prompt.'
Assert-JobLens ($global:jobLensMockRequests[0].resume.text.Contains('Muttersprache')) 'Matching case lost its German resume evidence.'
Assert-JobLens ($global:jobLensMockRequests[1].resume.text.Contains('German A2')) 'Conflict case lost its explicitly low proficiency.'
Assert-JobLens ($global:jobLensMockRequests[2].resume.text.Contains('English C2')) 'Partial case lost its supported English proficiency.'

Reset-JobLensMock 'correct'
$null = & $jobLensLiveScript -Scenario conditional
Assert-JobLens ($global:jobLensMockPosts -eq 4 -and $global:jobLensMockPrompts -eq 1) 'Conditional suite must send four requests with one hidden prompt.'
Assert-JobLens (@($global:jobLensMockRequests[0].preferences.employmentTypes).Count -eq 1 -and $global:jobLensMockRequests[0].preferences.employmentTypes[0] -eq 'working-student') 'Student case lost its selected branch.'
Assert-JobLens ($global:jobLensMockRequests[1].preferences.employmentTypes[0] -eq 'full-time') 'Full-time case lost its branch.'
Assert-JobLens (@($global:jobLensMockRequests[2].preferences.employmentTypes).Count -eq 2) 'Multiple-branch case must preserve both preferences.'
Assert-JobLens ($global:jobLensMockRequests[0].resume.text -ceq $global:jobLensMockRequests[2].resume.text) 'Changing the branch must not change the CV evidence.'
Assert-JobLens ($global:jobLensMockRequests[3].resume.text.Contains('No language proficiency declarations')) 'Unknown control invented proficiency.'

Reset-JobLensMock 'correct'
$null = & $jobLensLiveScript -Scenario language-settings
Assert-JobLens ($global:jobLensMockPosts -eq 2 -and $global:jobLensMockPrompts -eq 1) 'Screenshot language settings suite must send two requests with one hidden prompt.'
Assert-JobLens ($global:jobLensMockRequests[0].resume.text.Contains('Deutsch: B1')) 'Screenshot case lost the precise CV language level.'
Assert-JobLens ($global:jobLensMockRequests[0].preferences.languages[1].proficiency -eq 'basic') 'Original broad setting must remain unchanged in the regression case.'
Assert-JobLens ($global:jobLensMockRequests[1].preferences.languages[1].proficiency -eq 'b1') 'Precise setting must use the CEFR enum.'
Assert-JobLens (@($global:jobLensMockRequests[0].preferences.employmentTypes).Count -eq 3) 'Screenshot case lost multiple acceptable employment types.'
Assert-JobLens ($global:jobLensMockRequests[0].resume.text -ceq $global:jobLensMockRequests[1].resume.text) 'Updating settings must not rewrite the CV.'

Reset-JobLensMock 'wrong-request'
$jobLensHarnessError = $null
try { $null = & $jobLensLiveScript -Scenario matching } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $jobLensHarnessError.ToString().Contains('Response requestId did not match')) 'Stale response was not rejected.'

Reset-JobLensMock 'wrong-decision'
$jobLensHarnessError = $null
try { $null = & $jobLensLiveScript -Scenario matching } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $jobLensHarnessError.ToString().Contains('Model decisions did not meet')) 'Incorrect sample decision was reported as passing.'

Reset-JobLensMock 'wrong-language'
$jobLensHarnessError = $null
try { $null = & $jobLensLiveScript -Scenario languages } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $jobLensHarnessError.ToString().Contains('Model decisions did not meet')) 'Incorrect language decisions were reported as passing.'
Reset-JobLensMock 'wrong-score'
$jobLensHarnessError = $null
try { $null = & $jobLensLiveScript -Scenario matching } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $jobLensHarnessError.ToString().Contains('Invalid 0-5 rating or 0-100 conversion')) 'An incorrect rating conversion was reported as passing.'
$jobLensDebugScript = Join-Path $PSScriptRoot 'debug-requirements-live.ps1'
$jobLensDebugReport = Join-Path $PSScriptRoot '../.test-artifacts/mock-provider-trace.json'
Reset-JobLensMock 'old-build'
$jobLensHarnessError = $null
try { $null = & $jobLensDebugScript -ReportFile $jobLensDebugReport } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $global:jobLensMockPosts -eq 0 -and $global:jobLensMockPrompts -eq 0) 'Debug script must reject an old build before prompting or inference.'
Reset-JobLensMock 'correct'
$null = & $jobLensDebugScript -ReportFile $jobLensDebugReport
$jobLensDebugText = Get-Content -LiteralPath $jobLensDebugReport -Raw -Encoding UTF8
$jobLensDebugParsed = $jobLensDebugText | ConvertFrom-Json
Assert-JobLens ($global:jobLensMockPosts -eq 1 -and $global:jobLensMockPrompts -eq 1) 'Debugging must send one authorized request after one hidden key prompt.'
Assert-JobLens ($jobLensDebugParsed.debug.request.state.job.description.Contains('Werkstudenten >= B1, Vollzeit >= B2')) 'Debug trace lost the supplied conditional language requirement.'
Assert-JobLens ($jobLensDebugParsed.debug.rawResponse.encodingProbe -ceq ('0 ' + [char]0x2014 + ' rubric')) 'UTF-8 response decoding damaged rubric punctuation.'
Assert-JobLens ($jobLensDebugParsed.debug.request.state.job.description.Contains(('l' + [char]0x00f6 + 'st'))) 'UTF-8 response decoding damaged German umlauts.'
Assert-JobLens ($jobLensDebugParsed.debug.request.state.job.description.Contains(('Vorteilhafte Erfahrung:' + [char]10 + 'Python-Erfahrung'))) 'UTF-8 response decoding damaged the original posting.'
Assert-JobLens (-not $jobLensDebugText.Contains('offline-synthetic-test-key') -and -not $jobLensDebugText.Contains('Authorization')) 'Debug report exposed authorization.'
Reset-JobLensMock 'missing-debug'
$jobLensHarnessError = $null
try { $null = & $jobLensDebugScript -ReportFile $jobLensDebugReport } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $jobLensHarnessError.ToString().Contains('missing provider trace')) 'Missing provider trace must fail explicitly.'
Write-Host 'PASS: Offline live-script checks (deployment mismatch, seven base scenarios, four CV-only language cases, four conditional cases, stale response, incorrect decisions, authorized provider tracing). No network requests were made.'
