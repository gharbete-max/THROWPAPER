<#
.SYNOPSIS
  A tidied copy of the newest one or two files: spaces, numbers stored as text, dates.

.DESCRIPTION
  For every cell: spaces at the ends removed, double spaces made single, non-breaking and invisible
  spaces and control characters taken out.

  For every column, only when every filled cell in it agrees:
  - numbers written as text ("1 234,50", "1,234.50") become real numbers;
  - dates written as text ("05.11.2026", "11/5/2026") become yyyy-MM-dd.
  A column with a leading zero (00123) is left as text: it is an ID, not a number. A date column
  where day and month could be either way round is left alone and reported, never guessed.

  Every changed cell is yellow, and the last sheet lists what changed in which column.

.EXAMPLE
  .\Clean-Files.ps1
#>
param(
  [switch]$NoOpen,
  [string]$Folder
)
. (Join-Path $PSScriptRoot 'Sheets.Common.ps1')

$inv = [System.Globalization.CultureInfo]::InvariantCulture

function Clear-Text {
  param([string]$Value)
  # Non-breaking, thin, narrow and figure spaces to plain spaces; zero-width characters out.
  $v = [regex]::Replace($Value, '[    ]', ' ')
  $v = [regex]::Replace($v, '[​-‍﻿]', '')
  $v = [regex]::Replace($v, '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]', '')
  $v = [regex]::Replace($v, '[ \t]{2,}', ' ')
  return $v.Trim()
}

<#
  How a column writes its numbers: 'comma' (1 234,50), 'point' (1,234.50), 'plain' (whole numbers
  only, either way), $null when not all numbers, 'id' when a leading zero says it is an ID, and
  'unclear' when both ways are possible (1,234 alone).
#>
function Get-NumberStyle {
  param([string[]]$Values)
  $comma = $false; $point = $false; $any = $false
  foreach ($raw in $Values) {
    $v = $raw -replace ' ', ''
    if ($v -eq '') { continue }
    $any = $true
    if ($v -match '^-?0\d') { return 'id' }
    if ($v -match '^-?\d+$') { continue }
    if ($v -match '^-?\d{1,3}(\.\d{3})+(,\d+)?$' -or $v -match '^-?\d+,(\d{1,2}|\d{4,})$') { $comma = $true; continue }
    if ($v -match '^-?\d{1,3}(,\d{3})+(\.\d+)?$' -or $v -match '^-?\d+\.(\d{1,2}|\d{4,})$') { $point = $true; continue }
    if ($v -match '^-?\d+,\d{3}$' -or $v -match '^-?\d+\.\d{3}$') { continue }
    return $null
  }
  if (-not $any) { return $null }
  if ($comma -and $point) { return $null }
  if ($comma) { return 'comma' }
  if ($point) { return 'point' }
  # Only whole numbers, or ones like 1,234 that read both ways.
  foreach ($raw in $Values) { if (($raw -replace ' ', '') -match '^-?\d+[,.]\d{3}$') { return 'unclear' } }
  return 'plain'
}

function ConvertTo-Number {
  param([string]$Value, [string]$Style)
  $v = $Value -replace ' ', ''
  if ($v -eq '') { return '' }
  if ($Style -eq 'comma') { $v = $v.Replace('.', '').Replace(',', '.') }
  elseif ($Style -eq 'point') { $v = $v.Replace(',', '') }
  $d = [decimal]0
  if ([decimal]::TryParse($v, [System.Globalization.NumberStyles]::Number, $inv, [ref]$d)) { return $d.ToString($inv) }
  return $Value
}

$script:DatePattern = '^(?<a>\d{1,4})[./-](?<b>\d{1,2})[./-](?<c>\d{1,4})$'

<#
  How a column writes its dates: 'ymd', 'dmy', 'mdy', $null when not all dates, 'unclear' when day
  and month could be either way round in every row.
#>
function Get-DateStyle {
  param([string[]]$Values)
  $ymd = $true; $dayFirst = $false; $monthFirst = $false; $any = $false; $alreadyIso = $true
  foreach ($v in $Values) {
    if ($v -eq '') { continue }
    $any = $true
    # Before the match below: -match and -notmatch both overwrite $Matches.
    if ($v -notmatch '^\d{4}-\d{2}-\d{2}$') { $alreadyIso = $false }
    if ($v -notmatch $script:DatePattern) { return $null }
    $a = [int]$Matches.a; $b = [int]$Matches.b; $c = [int]$Matches.c
    if ($Matches.a.Length -eq 4) { if ($b -gt 12 -or $c -gt 31) { return $null }; continue }
    $ymd = $false
    if ($Matches.c.Length -ne 4) { return $null }
    if ($a -gt 31 -or $b -gt 31 -or ($a -gt 12 -and $b -gt 12)) { return $null }
    if ($a -gt 12) { $dayFirst = $true }
    if ($b -gt 12) { $monthFirst = $true }
  }
  if (-not $any -or $alreadyIso) { return $null }
  if ($ymd) { return 'ymd' }
  if ($dayFirst -and $monthFirst) { return $null }
  if ($dayFirst) { return 'dmy' }
  if ($monthFirst) { return 'mdy' }
  # A dot is how the Nordic countries and Germany write day.month.year; with slashes, it is unclear.
  if (@($Values | Where-Object { $_ -ne '' -and $_ -notmatch '^\d{1,2}\.\d{1,2}\.\d{4}$' }).Count -eq 0) { return 'dmy' }
  return 'unclear'
}

function ConvertTo-IsoDate {
  param([string]$Value, [string]$Style)
  if ($Value -notmatch $script:DatePattern) { return $Value }
  switch ($Style) {
    'ymd' { $y = [int]$Matches.a; $m = [int]$Matches.b; $d = [int]$Matches.c }
    'dmy' { $d = [int]$Matches.a; $m = [int]$Matches.b; $y = [int]$Matches.c }
    'mdy' { $m = [int]$Matches.a; $d = [int]$Matches.b; $y = [int]$Matches.c }
  }
  try { return ([DateTime]::new($y, $m, $d)).ToString('yyyy-MM-dd', $inv) } catch { return $Value }
}

Invoke-Safely {
  Use-Folder $Folder
  Write-Host 'Clean up data'
  $files = Get-NewestFiles -Count 2 -AllowFewer
  Write-Picked $files

  $sheets = @()
  $report = New-Object 'System.Collections.Generic.List[object]'
  foreach ($file in $files) {
    $t = Read-Table $file
    $out = New-Object 'System.Collections.Generic.List[object]'
    $cleaned = New-Object 'System.Collections.Generic.List[string[]]'
    $changedText = New-Object int[] $t.Headers.Count
    $marks = @{}
    for ($r = 0; $r -lt $t.Rows.Count; $r++) {
      $row = New-Object string[] $t.Headers.Count
      for ($c = 0; $c -lt $t.Headers.Count; $c++) {
        $row[$c] = Clear-Text $t.Rows[$r][$c]
        if ($row[$c] -cne $t.Rows[$r][$c]) { $changedText[$c]++; $marks["$r,$c"] = $true }
      }
      $cleaned.Add($row)
    }

    for ($c = 0; $c -lt $t.Headers.Count; $c++) {
      $values = @($cleaned | ForEach-Object { $_[$c] })
      $name = $t.Headers[$c]
      if ($changedText[$c]) { $report.Add(@($t.Name, $name, 'Spaces or invisible characters removed', [string]$changedText[$c])) }

      $dates = Get-DateStyle $values
      if ($dates -eq 'unclear') {
        $report.Add(@($t.Name, $name, @{ v = 'Left alone: day and month could be either way round'; s = $script:Style.Removed }, ''))
        continue
      }
      if ($dates) {
        $n = 0
        for ($r = 0; $r -lt $cleaned.Count; $r++) {
          $new = ConvertTo-IsoDate $cleaned[$r][$c] $dates
          if ($new -cne $cleaned[$r][$c]) { $cleaned[$r][$c] = $new; $marks["$r,$c"] = $true; $n++ }
        }
        if ($n) { $report.Add(@($t.Name, $name, 'Dates written as yyyy-MM-dd', [string]$n)) }
        continue
      }

      $numbers = Get-NumberStyle $values
      if ($numbers -eq 'id') { $report.Add(@($t.Name, $name, 'Kept as text: a leading zero (an ID)', '')); continue }
      if ($numbers -eq 'unclear') {
        $report.Add(@($t.Name, $name, @{ v = 'Left alone: 1,234 could be a thousand or one point two'; s = $script:Style.Removed }, ''))
        continue
      }
      if ($numbers) {
        $n = 0
        for ($r = 0; $r -lt $cleaned.Count; $r++) {
          $new = ConvertTo-Number $cleaned[$r][$c] $numbers
          if ($new -cne $cleaned[$r][$c]) { $cleaned[$r][$c] = $new; $marks["$r,$c"] = $true; $n++ }
        }
        if ($n) { $report.Add(@($t.Name, $name, 'Numbers stored as text made real numbers', [string]$n)) }
      }
    }

    for ($r = 0; $r -lt $cleaned.Count; $r++) {
      $cells = New-Object object[] $t.Headers.Count
      for ($c = 0; $c -lt $t.Headers.Count; $c++) {
        $cells[$c] = if ($marks.ContainsKey("$r,$c")) { @{ v = $cleaned[$r][$c]; s = $script:Style.Changed } } else { $cleaned[$r][$c] }
      }
      $out.Add($cells)
    }
    $sheets += @{ Name = $t.Name; Headers = $t.Headers; Rows = $out }
    Write-Host ("  {0}: {1} cells changed." -f $t.Name, $marks.Count)
  }

  if ($report.Count -eq 0) { $report.Add(@('', '', 'Nothing needed changing', '')) }
  $sheets += @{ Name = 'What changed'; Headers = @('File', 'Column', 'Change', 'Cells'); Rows = $report }
  $path = Write-Workbook 'Cleaned' $sheets
  Write-Done $path -NoOpen:$NoOpen
}
