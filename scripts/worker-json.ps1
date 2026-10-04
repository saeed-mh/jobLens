# Decode Worker JSON from its original UTF-8 bytes. Windows PowerShell 5.1 can
# misdecode application/json without a charset before Invoke-RestMethod parses it.
function Invoke-JobLensJson {
  param([string]$Method, [string]$Uri, $Headers, [string]$ContentType, $Body, [int]$TimeoutSec = 45)
  $jobLensHttpParameters = @{ Method = $Method; Uri = $Uri; TimeoutSec = $TimeoutSec; UseBasicParsing = $true }
  if ($Headers) { $jobLensHttpParameters.Headers = $Headers }
  if ($ContentType) { $jobLensHttpParameters.ContentType = $ContentType }
  if ($null -ne $Body) { $jobLensHttpParameters.Body = $Body }
  $jobLensHttpResponse = Invoke-WebRequest @jobLensHttpParameters
  $jobLensResponseStream = $jobLensHttpResponse.RawContentStream
  if ($null -eq $jobLensResponseStream) { throw 'The Worker response did not contain a readable byte stream.' }
  if ($jobLensResponseStream.CanSeek) { $jobLensResponseStream.Position = 0 }
  $jobLensResponseReader = [IO.StreamReader]::new($jobLensResponseStream, [Text.UTF8Encoding]::new($false, $true), $false)
  try { return ($jobLensResponseReader.ReadToEnd() | ConvertFrom-Json) }
  finally { $jobLensResponseReader.Dispose() }
}
