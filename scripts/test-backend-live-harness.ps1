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

function Invoke-RestMethod {
  param([string]$Method, [string]$Uri, $Headers, [string]$ContentType, $Body, [int]$TimeoutSec)
  if ($Method -eq 'Get') {
    if ($Uri -notlike '*/health') { throw 'Unexpected health route.' }
    return [PSCustomObject]@{
      status = 'ok'; apiVersion = 'job-lens-analysis-v1'; assessmentVersion = 'dimension-scope-v2'
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
  if ($global:jobLensMockMode -eq 'wrong-decision') { $jobLensMockDecisions.skills = 'unmet' }
  $jobLensMockAssessments = @{}
  foreach ($jobLensMockDimension in $jobLensMockDecisions.Keys) {
    $jobLensMockDistribution = @{}
    foreach ($jobLensMockChoice in @('met', 'partial', 'unmet', 'unknown', 'not_required')) {
      $jobLensMockDistribution[$jobLensMockChoice] = [int]($jobLensMockChoice -eq $jobLensMockDecisions[$jobLensMockDimension])
    }
    $jobLensMockAssessments[$jobLensMockDimension] = @{
      decision = $jobLensMockDecisions[$jobLensMockDimension]; confidence = 1; probabilities = $jobLensMockDistribution
    }
  }
  return [PSCustomObject]@{
    buildId = $jobLensHarnessBuild.buildId; assessmentVersion = 'dimension-scope-v2'
    requestId = $(if ($global:jobLensMockMode -eq 'wrong-request') { 'stale-response' } else { $jobLensMockInput.requestId })
    resumeVersion = $jobLensMockInput.resume.version; preferencesVersion = $jobLensMockInput.preferencesVersion
    jobId = $jobLensMockInput.job.id; assessments = [PSCustomObject]$jobLensMockAssessments
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
Assert-JobLens ($global:jobLensMockPosts -eq 3 -and $global:jobLensMockPrompts -eq 1) 'All scenarios must send three requests with one secret prompt.'
Assert-JobLens ($global:jobLensMockRequests[0].resume.text -eq $global:jobLensMockRequests[1].resume.text) 'Conflict scenario changed professional evidence.'
Assert-JobLens ($global:jobLensMockRequests[1].preferences.remoteWork -eq 'onsite') 'Conflict scenario did not change the arrangement.'
Assert-JobLens ($global:jobLensMockRequests[2].preferences.remoteWork -eq 'remote') 'Unknown scenario changed the arrangement.'
Assert-JobLens ($global:jobLensMockRequests[2].preferences.employmentTypes[0] -eq 'full-time') 'Unknown scenario changed the employment preference.'

Reset-JobLensMock 'wrong-request'
$jobLensHarnessError = $null
try { $null = & $jobLensLiveScript -Scenario matching } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $jobLensHarnessError.ToString().Contains('Response requestId did not match')) 'Stale response was not rejected.'

Reset-JobLensMock 'wrong-decision'
$jobLensHarnessError = $null
try { $null = & $jobLensLiveScript -Scenario matching } catch { $jobLensHarnessError = $_ }
Assert-JobLens ($jobLensHarnessError -and $jobLensHarnessError.ToString().Contains('Model decisions did not meet')) 'Incorrect sample decision was reported as passing.'
Write-Host 'PASS: Offline live-script checks (deployment mismatch, all scenarios, stale response, incorrect decision). No network requests were made.'
