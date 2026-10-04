param(
  [ValidateSet('matching', 'conflict', 'unknown', 'all')]
  [string]$Scenario = 'matching'
)

$ErrorActionPreference = 'Stop'
$jobLensEndpoint = 'https://job-lens-api.saeedmohh10.workers.dev'
$jobLensSamplePath = Join-Path $PSScriptRoot '../backend/sample-request.json'
$jobLensBuildPath = Join-Path $PSScriptRoot '../backend/dist/build-info.json'
if (-not (Test-Path -LiteralPath $jobLensBuildPath)) {
  throw 'Run npm run build:backend first, then deploy backend/dist/worker.js.'
}
$jobLensBuild = Get-Content -LiteralPath $jobLensBuildPath -Raw | ConvertFrom-Json
$jobLensHealth = Invoke-RestMethod -Method Get -Uri "$jobLensEndpoint/health" -TimeoutSec 15
if ($jobLensHealth.status -ne 'ok' -or $jobLensHealth.apiVersion -ne 'job-lens-analysis-v1' `
    -or $jobLensHealth.assessmentVersion -ne 'dimension-scope-v2' `
    -or $jobLensHealth.buildId -cne $jobLensBuild.buildId) {
  throw "Wrong deployed build. Expected $($jobLensBuild.buildId); received '$($jobLensHealth.buildId)'. Replace all Worker code with backend/dist/worker.js and Deploy. No AI test was sent."
}
Write-Host "Verified deployed build: $($jobLensHealth.buildId)"

$jobLensScenarios = if ($Scenario -eq 'all') { @('matching', 'conflict', 'unknown') } else { @($Scenario) }
$jobLensExpected = @{
  matching = @{ skills = 'met'; experience = 'met'; language = 'met'; location = 'met'; employment = 'met' }
  conflict = @{ skills = 'met'; experience = 'met'; language = 'met'; location = 'unmet'; employment = 'unmet' }
  unknown = @{ skills = 'unknown'; experience = 'unknown'; language = 'unknown'; location = 'met'; employment = 'met' }
}
$jobLensFailures = [Collections.Generic.List[string]]::new()

# This is a personal application testing secret, never a Cloudflare account token.
$jobLensSecureToken = Read-Host 'Enter JOB_LENS_API_TOKEN (input is hidden)' -AsSecureString
$jobLensTokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($jobLensSecureToken)
try {
  $jobLensPlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($jobLensTokenPointer)
  $jobLensHeaders = @{ Authorization = "Bearer $jobLensPlainToken" }
  foreach ($jobLensScenario in $jobLensScenarios) {
    $jobLensPayload = Get-Content -LiteralPath $jobLensSamplePath -Raw | ConvertFrom-Json
    $jobLensPayload.requestId = [Guid]::NewGuid().ToString()
    if ($jobLensScenario -eq 'conflict') {
      $jobLensPayload.preferences.remoteWork = 'onsite'
      $jobLensPayload.preferences.employmentTypes = @('part-time')
      $jobLensPayload.preferencesVersion = 'sample-preferences-conflict-v1'
    } elseif ($jobLensScenario -eq 'unknown') {
      $jobLensPayload.resume.text = 'Professional applicant interested in contributing to a collaborative team. Technical skills, years of relevant experience, and language proficiency are not specified.'
      $jobLensPayload.resume.version = 'sample-resume-unknown-v1'
      $jobLensPayload.preferences.languages = @()
      $jobLensPayload.preferencesVersion = 'sample-preferences-unknown-v1'
    }
    Write-Host "Testing scenario: $jobLensScenario"
    $jobLensBody = [Text.Encoding]::UTF8.GetBytes(($jobLensPayload | ConvertTo-Json -Depth 10))
    $jobLensResult = Invoke-RestMethod -Method Post -Uri "$jobLensEndpoint/analyze" `
      -Headers $jobLensHeaders -ContentType 'application/json; charset=utf-8' -Body $jobLensBody -TimeoutSec 45
    $jobLensResult | ConvertTo-Json -Depth 10
    if ($jobLensResult.buildId -cne $jobLensBuild.buildId `
        -or $jobLensResult.assessmentVersion -ne 'dimension-scope-v2') {
      throw 'The deployment changed during testing. Redeploy the expected build and retry.'
    }
    foreach ($jobLensField in @('requestId', 'resumeVersion', 'preferencesVersion')) {
      $jobLensSent = if ($jobLensField -eq 'resumeVersion') { $jobLensPayload.resume.version } else { $jobLensPayload.$jobLensField }
      if ($jobLensResult.$jobLensField -cne $jobLensSent) { throw "Response $jobLensField did not match the sent request." }
    }
    if ($jobLensResult.jobId -cne $jobLensPayload.job.id) { throw 'Response job ID did not match the sent request.' }
    foreach ($jobLensDimension in @('skills', 'experience', 'language', 'location', 'employment')) {
      $jobLensActual = $jobLensResult.assessments.$jobLensDimension.decision
      $jobLensWanted = $jobLensExpected[$jobLensScenario][$jobLensDimension]
      if ($jobLensActual -cne $jobLensWanted) {
        $jobLensFailures.Add("${jobLensScenario}/${jobLensDimension}: expected $jobLensWanted, received '$jobLensActual'")
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
