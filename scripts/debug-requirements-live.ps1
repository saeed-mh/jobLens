param(
  [string]$RequestFile = (Join-Path $PSScriptRoot '../backend/sample-requirements-request.json'),
  [string]$ReportFile = (Join-Path $PSScriptRoot '../.test-artifacts/provider-trace.json')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'worker-json.ps1')
$jobLensEndpoint = 'https://job-lens-api.saeedmohh10.workers.dev'
$jobLensBuild = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../backend/dist/build-info.json') -Raw | ConvertFrom-Json
$jobLensHealth = Invoke-JobLensJson -Method Get -Uri "$jobLensEndpoint/health" -TimeoutSec 15
if ($jobLensHealth.buildId -cne $jobLensBuild.buildId) {
  throw 'Deploy the current backend/dist/worker.js before debugging. No AI request was sent.'
}
$jobLensPayload = Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$jobLensPayload.requestId = [Guid]::NewGuid().ToString()
Write-Host 'The default fixture uses the supplied posting and a synthetic CV. The local report includes request text and the raw model response, but no authorization header.'
$jobLensSecureToken = Read-Host 'Enter JOB_LENS_API_TOKEN (input is hidden)' -AsSecureString
$jobLensTokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($jobLensSecureToken)
try {
  $jobLensPlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($jobLensTokenPointer)
  $jobLensHeaders = @{ Authorization = "Bearer $jobLensPlainToken"; 'X-Job-Lens-Debug' = 'requirements-v1' }
  $jobLensBody = [Text.Encoding]::UTF8.GetBytes(($jobLensPayload | ConvertTo-Json -Depth 20))
  $jobLensResult = Invoke-JobLensJson -Method Post -Uri "$jobLensEndpoint/analyze" -Headers $jobLensHeaders `
    -ContentType 'application/json; charset=utf-8' -Body $jobLensBody -TimeoutSec 45
  if ($jobLensResult.buildId -cne $jobLensBuild.buildId -or $jobLensResult.requestId -cne $jobLensPayload.requestId `
      -or $jobLensResult.debug.format -cne 'job-lens-provider-trace-v2' `
      -or $null -eq $jobLensResult.debug.request -or $null -eq $jobLensResult.debug.rawResponse `
      -or $null -eq $jobLensResult.debug.work.request -or $null -eq $jobLensResult.debug.work.rawResponse) { throw 'Unexpected build, request correlation, or missing provider trace.' }
  $jobLensReportPath = [IO.Path]::GetFullPath($ReportFile)
  $jobLensReportDirectory = [IO.Path]::GetDirectoryName($jobLensReportPath)
  [IO.Directory]::CreateDirectory($jobLensReportDirectory) | Out-Null
  [IO.File]::WriteAllText($jobLensReportPath, ($jobLensResult | ConvertTo-Json -Depth 40), [Text.UTF8Encoding]::new($false))
  Write-Host "Saved actual Workers AI request, raw response, and parsed assessments: $jobLensReportPath"
  foreach ($jobLensDimension in @('skills', 'experience', 'language', 'location', 'employment')) {
    $jobLensAssessment = $jobLensResult.assessments.$jobLensDimension
    Write-Host "${jobLensDimension}: model=$($jobLensAssessment.reportedStatus.decision); parsed=$($jobLensAssessment.status.decision); issues=$($jobLensAssessment.issues -join ',')"
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($jobLensTokenPointer)
  $jobLensPlainToken = $null; $jobLensHeaders = $null
  $jobLensSecureToken.Dispose()
}
