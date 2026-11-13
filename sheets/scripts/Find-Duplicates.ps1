<#
.SYNOPSIS
  Find rows that are the same, or almost the same, within each of the two newest files.

.DESCRIPTION
  Groups rows whose chosen column is alike (by edit distance, as Match-Names does), so "Anna
  Svensson", "Svensson, Anna" and "Anna Svenson" land in one group. Each file gets a sheet with
  only the rows that have a likely twin, side by side, numbered by group. Nothing is removed:
  which row to keep is yours to decide.

.EXAMPLE
  .\Find-Duplicates.ps1 -Column "Name" -Threshold 90
#>
param(
  # The column to compare. Asked for when left out (per file, when the files differ).
  [string]$Column,
  # How alike two values must be to count as the same, 1 to 100. Asked for when left out (90).
  [int]$Threshold,
  [switch]$NoOpen,
  [string]$Folder
)
. (Join-Path $PSScriptRoot 'Sheets.Common.ps1')

Invoke-Safely {
  Use-Folder $Folder
  Write-Host 'Find duplicates'
  $files = Get-NewestFiles -Count 2 -AllowFewer
  Write-Picked $files
  $threshold = Read-Number 'How alike must two values be to count as duplicates, 1 to 100?' 90 $Threshold

  $sheets = @()
  $summary = New-Object 'System.Collections.Generic.List[object]'
  foreach ($file in $files) {
    $t = Read-Table $file
    $col = Select-Column $t.Headers "Which column in $($t.Name) should be compared?" $t.Headers[0] $Column
    $ci = Get-ColumnIndex $t $col
    $keys = New-MatchKeys (Get-ColumnValues $t $ci)
    Write-SpeedNote ([long]$t.Rows.Count * $t.Rows.Count / 2)

    # Union-find over the alike pairs: a chain of near-twins is one group.
    $parent = New-Object int[] $t.Rows.Count
    for ($i = 0; $i -lt $parent.Length; $i++) { $parent[$i] = $i }
    $find = { param($x) while ($parent[$x] -ne $x) { $parent[$x] = $parent[$parent[$x]]; $x = $parent[$x] }; return $x }
    $lowest = @{}
    $pairs = Get-SimilarPairs $keys $threshold
    for ($p = 0; $p -lt $pairs.Count; $p += 3) {
      $i = $pairs[$p]; $j = $pairs[$p + 1]; $s = $pairs[$p + 2]
      $ri = & $find $i; $rj = & $find $j
      if ($ri -ne $rj) { $parent[[Math]::Max($ri, $rj)] = [Math]::Min($ri, $rj) }
      foreach ($k in $i, $j) { if (-not $lowest.ContainsKey($k) -or $s -lt $lowest[$k]) { $lowest[$k] = $s } }
    }

    $groups = [ordered]@{}
    for ($i = 0; $i -lt $t.Rows.Count; $i++) {
      if (-not $lowest.ContainsKey($i)) { continue }
      # A text key: an ordered dictionary reads a number as a position, not a name.
      $root = [string](& $find $i)
      if (-not $groups.Contains($root)) { $groups[$root] = New-Object 'System.Collections.Generic.List[int]' }
      $groups[$root].Add($i)
    }

    $rows = New-Object 'System.Collections.Generic.List[object]'
    $g = 0; $duplicateRows = 0
    foreach ($members in $groups.Values) {
      $g++
      # Alternate the colour per group, so where one group ends and the next begins is visible.
      $style = if ($g % 2) { $script:Style.Changed } else { $script:Style.Normal }
      foreach ($i in $members) {
        $cells = New-Object 'System.Collections.Generic.List[object]'
        $cells.Add(@{ v = [string]$g; s = $style })
        $cells.Add(@{ v = [string]($i + 1); s = $style })
        $cells.Add(@{ v = [string]$lowest[$i]; s = $style })
        foreach ($v in $t.Rows[$i]) { $cells.Add(@{ v = $v; s = $style }) }
        $rows.Add($cells.ToArray())
      }
      $duplicateRows += $members.Count - 1
    }
    $sheets += @{ Name = $t.Name; Headers = @('Group', 'Data row', 'Score') + $t.Headers; Rows = $rows }
    $summary.Add(@($t.Name, "$g groups; $duplicateRows rows could go (column $col, at least $threshold of 100)"))
    Write-Host ("  {0}: {1} groups of alike rows." -f $t.Name, $g)
  }

  $sheets += @{ Name = 'Summary'; Headers = @('File', 'Found'); Rows = $summary }
  $path = Write-Workbook 'Duplicates' $sheets
  Write-Done $path -NoOpen:$NoOpen
}
