$ErrorActionPreference = "Stop"

$csvUrls = @(
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRvdqlkCZyzYwW_OWuj5icUFylM0fgN0gy2zrng3j2DVp9yO_W3x_CNU0Sck0FW2jSm1JsmUCmp7ISe/pub?gid=0&single=true&output=csv",
  "https://docs.google.com/spreadsheets/d/1u7a4fR5lp8Jl0fRk5R8KTC7flyoN0BkzysckJdDMIUQ/export?format=csv&gid=0"
)

function Get-SourceRows {
  foreach ($url in $csvUrls) {
    try {
      $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
      if (-not $resp.Content) { continue }
      if ($resp.Content -match "Google Sheets:\s*Sign-?in") { continue }
      return ($resp.Content | ConvertFrom-Csv)
    }
    catch {
      continue
    }
  }
  throw "Could not load source CSV from provided URLs."
}

function Resolve-IconUrlFromItemId([string]$id) {
  if ([string]::IsNullOrWhiteSpace($id)) {
    return [PSCustomObject]@{ IconUrl = ""; Status = "missing_id" }
  }

  $itemUrl = "https://database.turtlecraft.gg/?item=$id"

  try {
    $resp = Invoke-WebRequest -Uri $itemUrl -UseBasicParsing -TimeoutSec 30
    $html = [string]$resp.Content

    # Current DB pages embed icon token in script, e.g.:
    # _[42014]={icon: 'inv_drink_33'};
    $iconTokenMatch = [regex]::Match(
      $html,
      "_\[$([regex]::Escape($id))\]\s*=\s*\{\s*icon:\s*['""](?<icon>[a-z0-9_]+)['""]",
      [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    if ($iconTokenMatch.Success) {
      $iconToken = $iconTokenMatch.Groups["icon"].Value.ToLowerInvariant()
      return [PSCustomObject]@{
        IconUrl = "https://database.turtlecraft.gg/images/icons/large/$iconToken.png"
        Status  = "ok"
      }
    }

    # Fallback for old style direct image path if page format changes.
    $imgMatch = [regex]::Match($html, '(?<path>images/icons/large/[a-z0-9_]+\.png)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($imgMatch.Success) {
      $path = $imgMatch.Groups["path"].Value.TrimStart("/")
      return [PSCustomObject]@{
        IconUrl = "https://database.turtlecraft.gg/$path"
        Status  = "ok_fallback_path"
      }
    }

    return [PSCustomObject]@{
      IconUrl = ""
      Status  = "icon_not_found"
    }
  }
  catch {
    return [PSCustomObject]@{
      IconUrl = ""
      Status  = "request_failed"
    }
  }
}

$rows = Get-SourceRows
$unique = $rows |
  Where-Object { -not [string]::IsNullOrWhiteSpace($_.id) } |
  Group-Object -Property id |
  ForEach-Object { $_.Group[0] } |
  Sort-Object -Property id

$output = New-Object System.Collections.Generic.List[object]
$total = $unique.Count
$i = 0

foreach ($row in $unique) {
  $i++
  $id = [string]$row.id
  $name = [string]$row.name
  $resolved = Resolve-IconUrlFromItemId -id $id

  $output.Add([PSCustomObject]@{
    id = $id
    name = $name
    iconUrl = $resolved.IconUrl
    status = $resolved.Status
    databaseUrl = "https://database.turtlecraft.gg/?item=$id"
  })

  if (($i % 10) -eq 0 -or $i -eq $total) {
    Write-Output "Processed $i / $total"
  }
}

$outputPath = Join-Path (Get-Location) "item-icon-mapping.csv"
$output | Export-Csv -Path $outputPath -NoTypeInformation -Encoding UTF8

$okCount = ($output | Where-Object { $_.status -like "ok*" }).Count
$failCount = $output.Count - $okCount

Write-Output "Done. Wrote: $outputPath"
Write-Output "Total: $($output.Count) | Resolved: $okCount | Failed: $failCount"
