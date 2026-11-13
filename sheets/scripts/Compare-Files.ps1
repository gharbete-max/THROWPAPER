<#
.SYNOPSIS
  Compare two versions of a list: what is new, what is gone, and which cells changed.

.DESCRIPTION
  Takes the two newest spreadsheets in the folder. The older one is A (before), the newer one is
  B (after). Rows are paired on a column that identifies them, such as an ID or an e-mail address.
  The result has three sheets: B with every change coloured, one row per changed cell, and counts.

.EXAMPLE
  .\Compare-Files.ps1 -Key "Account"
#>
param(
  # The column that identifies a row in both files. Asked for when left out.
  [string]$Key,
  # Treat "Anna" and "ANNA" as the same.
  [switch]$IgnoreCase,
  # Do not open the result when it is ready.
  [switch]$NoOpen,
  # Work in this folder instead of the one the scripts are in.
  [string]$Folder
)
. (Join-Path $PSScriptRoot 'Sheets.Common.ps1')

Invoke-Safely {
  Use-Folder $Folder
  Write-Host 'Compare two versions of a list'
  $files = Get-NewestFiles -Count 2
  Write-Picked $files
  $a = Read-Table $files[0]
  $b = Read-Table $files[1]

  $common = @($b.Headers | Where-Object { (Get-ColumnIndex $a $_) -ge 0 })
  if ($common.Count -eq 0) { throw 'The two files have no column name in common, so their rows cannot be paired.' }

  # Suggest the first shared column whose values are filled in and never repeat, in both files.
  $suggested = $null
  foreach ($name in $common) {
    $ok = $true
    foreach ($t in $a, $b) {
      $values = Get-ColumnValues $t (Get-ColumnIndex $t $name)
      $seen = @{}
      foreach ($v in $values) {
        $k = $v.Trim().ToLowerInvariant()
        if ($k -eq '' -or $seen.ContainsKey($k)) { $ok = $false; break }
        $seen[$k] = $true
      }
      if (-not $ok) { break }
    }
    if ($ok) { $suggested = $name; break }
  }
  $keyName = Select-Column $common 'Which column identifies a row in both files (an ID, account or e-mail)?' $suggested $Key

  $ka = Get-ColumnIndex $a $keyName
  $kb = Get-ColumnIndex $b $keyName
  $norm = { param($v) if ($IgnoreCase) { $v.Trim().ToLowerInvariant() } else { $v.Trim() } }

  # Key -> row number. A key seen twice keeps its first row; the summary says how many repeated.
  $index = {
    param($table, $col)
    $map = @{}; $repeats = 0
    for ($r = 0; $r -lt $table.Rows.Count; $r++) {
      $k = & $norm $table.Rows[$r][$col]
      if ($k -eq '') { continue }
      if ($map.ContainsKey($k)) { $repeats++ } else { $map[$k] = $r }
    }
    return @{ Map = $map; Repeats = $repeats }
  }
  $ia = & $index $a $ka
  $ib = & $index $b $kb

  $statusHeader = 'Status'
  $overview = New-Object 'System.Collections.Generic.List[object]'
  $changes = New-Object 'System.Collections.Generic.List[object]'
  $counts = @{ Same = 0; Changed = 0; New = 0; Removed = 0 }

  for ($r = 0; $r -lt $b.Rows.Count; $r++) {
    $row = $b.Rows[$r]
    $k = & $norm $row[$kb]
    $cells = New-Object object[] ($b.Headers.Count + 1)
    if ($k -eq '' -or -not $ia.Map.ContainsKey($k)) {
      $cells[0] = @{ v = 'New'; s = $script:Style.Added }
      for ($c = 0; $c -lt $b.Headers.Count; $c++) { $cells[$c + 1] = @{ v = $row[$c]; s = $script:Style.Added } }
      $counts.New++
    } else {
      $before = $a.Rows[$ia.Map[$k]]
      $changed = $false
      for ($c = 0; $c -lt $b.Headers.Count; $c++) {
        $cells[$c + 1] = $row[$c]
        $ac = Get-ColumnIndex $a $b.Headers[$c]
        if ($ac -lt 0 -or $c -eq $kb) { continue }
        if (-not (Test-SameValue $before[$ac] $row[$c] -IgnoreCase:$IgnoreCase)) {
          $cells[$c + 1] = @{ v = $row[$c]; s = $script:Style.Changed }
          $changes.Add(@($row[$kb], $b.Headers[$c], $before[$ac], $row[$c]))
          $changed = $true
        }
      }
      if ($changed) { $cells[0] = @{ v = 'Changed'; s = $script:Style.Changed }; $counts.Changed++ }
      else { $cells[0] = 'Same'; $counts.Same++ }
    }
    $overview.Add($cells)
  }

  # Rows only in A, under B's columns, at the end.
  for ($r = 0; $r -lt $a.Rows.Count; $r++) {
    $k = & $norm $a.Rows[$r][$ka]
    if ($k -eq '' -or $ib.Map.ContainsKey($k)) { continue }
    $cells = New-Object object[] ($b.Headers.Count + 1)
    $cells[0] = @{ v = 'Removed'; s = $script:Style.Removed }
    for ($c = 0; $c -lt $b.Headers.Count; $c++) {
      $ac = Get-ColumnIndex $a $b.Headers[$c]
      $value = if ($ac -ge 0) { $a.Rows[$r][$ac] } else { '' }
      $cells[$c + 1] = @{ v = $value; s = $script:Style.Removed }
    }
    $overview.Add($cells)
    $counts.Removed++
  }

  $onlyA = @($a.Headers | Where-Object { (Get-ColumnIndex $b $_) -lt 0 })
  $onlyB = @($b.Headers | Where-Object { (Get-ColumnIndex $a $_) -lt 0 })
  $summary = New-Object 'System.Collections.Generic.List[object]'
  $summary.Add(@('A (before)', $a.Name))
  $summary.Add(@('B (after)', $b.Name))
  $summary.Add(@('Rows paired on', $keyName))
  $summary.Add(@('Same', [string]$counts.Same))
  $summary.Add(@(@{ v = 'Changed'; s = $script:Style.Changed }, [string]$counts.Changed))
  $summary.Add(@(@{ v = 'New in B'; s = $script:Style.Added }, [string]$counts.New))
  $summary.Add(@(@{ v = 'Removed (only in A)'; s = $script:Style.Removed }, [string]$counts.Removed))
  $summary.Add(@('Cells changed', [string]$changes.Count))
  if ($onlyA.Count) { $summary.Add(@('Columns only in A', ($onlyA -join ', '))) }
  if ($onlyB.Count) { $summary.Add(@('Columns only in B (not compared)', ($onlyB -join ', '))) }
  if ($ia.Repeats) { $summary.Add(@(@{ v = "Repeated $keyName in A"; s = $script:Style.Changed }, "$($ia.Repeats) rows share a value with an earlier row; only the first was compared")) }
  if ($ib.Repeats) { $summary.Add(@(@{ v = "Repeated $keyName in B"; s = $script:Style.Changed }, "$($ib.Repeats) rows share a value with an earlier row; each was compared with A's first")) }

  $path = Write-Workbook 'Compare' @(
    @{ Name = 'B with changes'; Headers = @($statusHeader) + $b.Headers; Rows = $overview },
    @{ Name = 'Changed cells'; Headers = @($keyName, 'Column', 'Before (A)', 'After (B)'); Rows = $changes },
    @{ Name = 'Summary'; Headers = @('What', 'Count'); Rows = $summary }
  )
  Write-Host ("  Same {0}, changed {1}, new {2}, removed {3}." -f $counts.Same, $counts.Changed, $counts.New, $counts.Removed)
  Write-Done $path -NoOpen:$NoOpen
}
