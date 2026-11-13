<#
.SYNOPSIS
  Put the two newest files into one list, lining their columns up by name.

.DESCRIPTION
  A's rows, then B's, under every column either file has (A's order first). A first column says
  which file each row came from. Rows that are exactly the same in every column are kept once,
  unless -KeepDuplicates is given.

.EXAMPLE
  .\Combine-Files.ps1 -KeepDuplicates
#>
param(
  [switch]$KeepDuplicates,
  [switch]$NoOpen,
  [string]$Folder
)
. (Join-Path $PSScriptRoot 'Sheets.Common.ps1')

Invoke-Safely {
  Use-Folder $Folder
  Write-Host 'Combine two files into one list'
  $files = Get-NewestFiles -Count 2
  Write-Picked $files
  $tables = @((Read-Table $files[0]), (Read-Table $files[1]))

  $headers = New-Object 'System.Collections.Generic.List[string]'
  foreach ($t in $tables) { foreach ($h in $t.Headers) { if (-not ($headers | Where-Object { $_ -ieq $h })) { $headers.Add($h) } } }

  $rows = New-Object 'System.Collections.Generic.List[object]'
  $seen = @{}; $dropped = 0
  foreach ($t in $tables) {
    $map = @($headers | ForEach-Object { Get-ColumnIndex $t $_ })
    foreach ($row in $t.Rows) {
      $values = New-Object string[] $headers.Count
      for ($c = 0; $c -lt $headers.Count; $c++) { $values[$c] = if ($map[$c] -ge 0) { $row[$map[$c]] } else { '' } }
      # A row's identity: every value, trimmed, joined by a character no cell contains.
      $identity = ($values | ForEach-Object { $_.Trim() }) -join [char]0x1F
      if (-not $KeepDuplicates -and $seen.ContainsKey($identity)) { $dropped++; continue }
      $seen[$identity] = $true
      $rows.Add(@($t.Name) + $values)
    }
  }

  $summary = New-Object 'System.Collections.Generic.List[object]'
  $summary.Add(@('Rows from A', [string]$tables[0].Rows.Count))
  $summary.Add(@('Rows from B', [string]$tables[1].Rows.Count))
  $summary.Add(@('Exact repeats left out', [string]$dropped))
  $summary.Add(@('Rows in the combined list', [string]$rows.Count))
  $onlyOne = @($headers | Where-Object { (Get-ColumnIndex $tables[0] $_) -lt 0 -or (Get-ColumnIndex $tables[1] $_) -lt 0 })
  if ($onlyOne.Count) { $summary.Add(@('Columns in only one file (blank for the other)', ($onlyOne -join ', '))) }

  $path = Write-Workbook 'Combined' @(
    @{ Name = 'Combined'; Headers = @('Source file') + $headers.ToArray(); Rows = $rows },
    @{ Name = 'Summary'; Headers = @('What', 'Count'); Rows = $summary }
  )
  Write-Host ("  {0} rows; {1} exact repeats left out." -f $rows.Count, $dropped)
  Write-Done $path -NoOpen:$NoOpen
}
