param(
  [ValidateSet('matching', 'conflict', 'unknown', 'languages', 'conditional', 'language-settings', 'all')]
  [string]$Scenario = 'matching'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'worker-json.ps1')
$jobLensEndpoint = 'https://job-lens-api.saeedmohh10.workers.dev'
$jobLensSamplePath = Join-Path $PSScriptRoot '../backend/sample-request.json'
$jobLensLanguageSamplePath = Join-Path $PSScriptRoot '../backend/sample-language-request.json'
$jobLensConditionalSamplePath = Join-Path $PSScriptRoot '../backend/sample-requirements-request.json'
$jobLensSettingsSamplePath = Join-Path $PSScriptRoot '../backend/sample-language-settings-request.json'
$jobLensBuildPath = Join-Path $PSScriptRoot '../backend/dist/build-info.json'
if (-not (Test-Path -LiteralPath $jobLensBuildPath)) {
  throw 'Run npm run build:backend first, then deploy backend/dist/worker.js.'
}
$jobLensBuild = Get-Content -LiteralPath $jobLensBuildPath -Raw | ConvertFrom-Json
$jobLensHealth = Invoke-JobLensJson -Method Get -Uri "$jobLensEndpoint/health" -TimeoutSec 15
if ($jobLensHealth.status -ne 'ok' -or $jobLensHealth.apiVersion -ne 'job-lens-analysis-v2' `
    -or $jobLensHealth.assessmentVersion -ne 'clef-score-v9' `
    -or $jobLensHealth.scoringVersion -ne 'weighted-clef-score-v1' `
    -or $jobLensHealth.rubricVersion -ne 'alignment-0-5-v1' `
    -or $jobLensHealth.buildId -cne $jobLensBuild.buildId) {
  throw "Wrong deployed build. Expected $($jobLensBuild.buildId); received '$($jobLensHealth.buildId)'. Replace all Worker code with backend/dist/worker.js and Deploy. No AI test was sent."
}
Write-Host "Verified deployed build: $($jobLensHealth.buildId)"

$jobLensLanguageScenarios = @('language-matching', 'language-conflict', 'language-partial', 'language-unknown')
$jobLensConditionalScenarios = @('conditional-student', 'conditional-fulltime', 'conditional-multiple', 'conditional-unknown')
$jobLensScenarios = if ($Scenario -eq 'all') { @('matching', 'conflict', 'unknown') + $jobLensLanguageScenarios } `
  elseif ($Scenario -eq 'languages') { $jobLensLanguageScenarios } `
  elseif ($Scenario -eq 'conditional') { $jobLensConditionalScenarios } else { @($Scenario) }
if ($Scenario -eq 'language-settings') { $jobLensScenarios = @('settings-broad', 'settings-cefr') }
$jobLensExpected = @{
  matching = @{ skills = @{ status = 'assessable'; conflict = 'no_conflict' }; experience = @{ status = 'assessable'; conflict = 'no_conflict' }; language = @{ status = 'assessable'; conflict = 'no_conflict' }; location = @{ status = 'assessable'; conflict = 'no_conflict' }; employment = @{ status = 'assessable'; conflict = 'no_conflict' } }
  conflict = @{ skills = @{ status = 'assessable'; conflict = 'no_conflict' }; experience = @{ status = 'assessable'; conflict = 'no_conflict' }; language = @{ status = 'assessable'; conflict = 'no_conflict' }; location = @{ status = 'assessable'; conflict = 'conflict' }; employment = @{ status = 'assessable'; conflict = 'conflict' } }
  unknown = @{ skills = @{ status = 'unknown' }; experience = @{ status = 'unknown' }; language = @{ status = 'unknown' }; location = @{ status = 'assessable'; conflict = 'no_conflict' }; employment = @{ status = 'assessable'; conflict = 'no_conflict' } }
  'language-matching' = @{ language = @{ status = 'assessable'; conflict = 'no_conflict' } }
  'language-conflict' = @{ language = @{ status = 'assessable'; conflict = 'conflict' } }
  'language-partial' = @{ language = @{ status = 'assessable'; conflict = 'no_conflict' } }
  'language-unknown' = @{ language = @{ status = 'unknown' } }
  'conditional-student' = @{ experience = @{ status = 'assessable' }; language = @{ status = 'assessable'; conflict = 'no_conflict' } }
  'conditional-fulltime' = @{ experience = @{ status = 'assessable' }; language = @{ status = 'assessable'; conflict = 'conflict' } }
  'conditional-multiple' = @{ experience = @{ status = 'assessable' }; language = @{ status = 'assessable' } }
  'conditional-unknown' = @{ language = @{ status = 'unknown' } }
  'settings-broad' = @{ language = @{ status = 'assessable' }; location = @{ status = 'assessable'; conflict = 'no_conflict' }; employment = @{ status = 'assessable' } }
  'settings-cefr' = @{ language = @{ status = 'assessable' }; location = @{ status = 'assessable'; conflict = 'no_conflict' }; employment = @{ status = 'assessable' } }
}
$jobLensFailures = [Collections.Generic.List[string]]::new()

# This is a personal application testing secret, never a Cloudflare account token.
$jobLensSecureToken = Read-Host 'Enter JOB_LENS_API_TOKEN (input is hidden)' -AsSecureString
$jobLensTokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($jobLensSecureToken)
try {
  $jobLensPlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($jobLensTokenPointer)
  $jobLensHeaders = @{ Authorization = "Bearer $jobLensPlainToken" }
  foreach ($jobLensScenario in $jobLensScenarios) {
    $jobLensScenarioPath = if ($jobLensScenario -like 'settings-*') { $jobLensSettingsSamplePath } `
      elseif ($jobLensScenario -like 'language-*') { $jobLensLanguageSamplePath } `
      elseif ($jobLensScenario -like 'conditional-*') { $jobLensConditionalSamplePath } else { $jobLensSamplePath }
    # Read UTF-8 explicitly, including German umlauts in the language fixture.
    $jobLensPayload = Get-Content -LiteralPath $jobLensScenarioPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $jobLensPayload.requestId = [Guid]::NewGuid().ToString()
    if ($jobLensScenario -like 'settings-*') {
      $jobLensPayload.resume.version = "sample-resume-$jobLensScenario-v1"
      $jobLensPayload.preferencesVersion = "sample-preferences-$jobLensScenario-v1"
      if ($jobLensScenario -eq 'settings-cefr') {
        $jobLensPayload.preferences.languages[0].proficiency = 'fluent'
        $jobLensPayload.preferences.languages[1].proficiency = 'b1'
      }
    } elseif ($jobLensScenario -eq 'conflict') {
      $jobLensPayload.preferences.remoteWork = 'onsite'
      $jobLensPayload.preferences.employmentTypes = @('part-time')
      $jobLensPayload.preferencesVersion = 'sample-preferences-conflict-v1'
    } elseif ($jobLensScenario -eq 'unknown') {
      $jobLensPayload.resume.text = 'Professional applicant interested in contributing to a collaborative team. Technical skills, years of relevant experience, and language proficiency are not specified.'
      $jobLensPayload.resume.version = 'sample-resume-unknown-v1'
      $jobLensPayload.preferences.languages = @()
      $jobLensPayload.preferencesVersion = 'sample-preferences-unknown-v1'
    } elseif ($jobLensScenario -like 'conditional-*') {
      $jobLensPayload.resume.version = "sample-resume-$jobLensScenario-v1"
      $jobLensPayload.preferencesVersion = "sample-preferences-$jobLensScenario-v1"
      # No CV target that could resolve the multiple-branch case; all cases keep the supplied full posting.
      $jobLensPayload.resume.text = 'Enrolled Computer Science student with Python backend projects and Git experience. Languages: English B2; German B1, written and spoken.'
      $jobLensPayload.preferences.employmentTypes = @(if ($jobLensScenario -eq 'conditional-student') { 'working-student' } `
        elseif ($jobLensScenario -eq 'conditional-fulltime') { 'full-time' } else { 'full-time'; 'working-student' })
      if ($jobLensScenario -eq 'conditional-unknown') {
        $jobLensPayload.resume.text = 'Enrolled Computer Science student with Python backend projects and Git experience. No language proficiency declarations are supplied.'
      }
    } elseif ($jobLensScenario -like 'language-*') {
      $jobLensPayload.resume.version = "sample-resume-$jobLensScenario-v1"
      if ($jobLensScenario -eq 'language-conflict') {
        $jobLensPayload.resume.text = 'Student in an advanced economics degree with practical banking and data analysis experience. Familiar with Excel, Word and PowerPoint. Languages: German A2 (basic written and spoken proficiency); English C2 (written and spoken).'
      } elseif ($jobLensScenario -eq 'language-partial') {
        $jobLensPayload.resume.text = 'Student in an advanced economics degree with practical banking and data analysis experience. Familiar with Excel, Word and PowerPoint. Languages: English C2 (written and spoken). No German proficiency declaration is supplied.'
      } elseif ($jobLensScenario -eq 'language-unknown') {
        $jobLensPayload.resume.text = 'Student in an advanced economics degree with practical banking and data analysis experience. Familiar with Excel, Word and PowerPoint. No language proficiency declarations are supplied.'
      }
    }
    Write-Host "Testing scenario: $jobLensScenario"
    $jobLensBody = [Text.Encoding]::UTF8.GetBytes(($jobLensPayload | ConvertTo-Json -Depth 10))
    $jobLensResult = Invoke-JobLensJson -Method Post -Uri "$jobLensEndpoint/analyze" `
      -Headers $jobLensHeaders -ContentType 'application/json; charset=utf-8' -Body $jobLensBody -TimeoutSec 45
    $jobLensResult | ConvertTo-Json -Depth 10
    if ($jobLensResult.buildId -cne $jobLensBuild.buildId `
        -or $jobLensResult.apiVersion -ne 'job-lens-analysis-v2' `
        -or $jobLensResult.assessmentVersion -ne 'clef-score-v9' `
        -or $jobLensResult.scoringVersion -ne 'weighted-clef-score-v1' `
        -or $jobLensResult.rubricVersion -ne 'alignment-0-5-v1') {
      throw 'The deployment changed during testing. Redeploy the expected build and retry.'
    }
    foreach ($jobLensField in @('requestId', 'resumeVersion', 'preferencesVersion')) {
      $jobLensSent = if ($jobLensField -eq 'resumeVersion') { $jobLensPayload.resume.version } else { $jobLensPayload.$jobLensField }
      if ($jobLensResult.$jobLensField -cne $jobLensSent) { throw "Response $jobLensField did not match the sent request." }
    }
    if ($jobLensResult.jobId -cne $jobLensPayload.job.id) { throw 'Response job ID did not match the sent request.' }
    foreach ($jobLensDimension in $jobLensExpected[$jobLensScenario].Keys) {
      foreach ($jobLensCheck in $jobLensExpected[$jobLensScenario][$jobLensDimension].Keys) {
        $jobLensActual = $jobLensResult.assessments.$jobLensDimension.$jobLensCheck.decision
        $jobLensWanted = $jobLensExpected[$jobLensScenario][$jobLensDimension][$jobLensCheck]
        if ($jobLensActual -cne $jobLensWanted) {
          $jobLensFailures.Add("${jobLensScenario}/${jobLensDimension}/${jobLensCheck}: expected $jobLensWanted, received '$jobLensActual'")
        }
      }
    }
    foreach ($jobLensDimension in @('skills', 'experience', 'language', 'location', 'employment')) {
      $jobLensAssessment = $jobLensResult.assessments.$jobLensDimension
      $jobLensRow = @($jobLensResult.score.breakdown | Where-Object { $_.dimension -eq $jobLensDimension })
      if ($jobLensRow.Count -ne 1) { throw 'Response did not include every score breakdown row.' }
      if ($jobLensAssessment.status.decision -eq 'assessable') {
        $jobLensNumericScore = $jobLensAssessment.rating.score
        if ($null -eq $jobLensNumericScore -or -not ($jobLensNumericScore -is [ValueType]) `
            -or [double]::IsNaN([double]$jobLensNumericScore) -or [double]::IsInfinity([double]$jobLensNumericScore) `
            -or $jobLensNumericScore -lt 0 -or $jobLensNumericScore -gt 5 `
            -or [Math]::Abs($jobLensRow[0].points - $jobLensNumericScore * 20) -gt 0.0001) {
          throw 'Invalid 0-5 rating or 0-100 conversion.'
        }
      } elseif ($null -ne $jobLensAssessment.rating -or $null -ne $jobLensRow[0].points) {
        throw 'Unknown or unneeded criteria must have no numeric rating or points.'
      }
    }
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($jobLensTokenPointer)
  $jobLensPlainToken = $null
  $jobLensHeaders = $null
  $jobLensSecureToken.Dispose()
}
if ($jobLensFailures.Count -gt 0) {
  $jobLensFailures | ForEach-Object { Write-Host "FAIL: $_" }
  throw 'Model decisions did not meet the expected sample results. Keep the outputs for review.'
}
Write-Host "PASS: Expected decisions matched for $($jobLensScenarios.Count) scenario(s). Probabilities and confidence are not accuracy guarantees."
