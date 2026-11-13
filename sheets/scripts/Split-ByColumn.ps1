<#
.SYNOPSIS
  Split the newest file into one sheet per value of a column (per region, per owner, per status).

.DESCRIPTION
  Makes one workbook with a sheet for every different value in the chosen column, each with the
  header row and only that value's rows, after a first sheet of counts. Blank values get a sheet
  called "(blank)". At most 250 sheets, so a column of IDs cannot make thousands by mistake.

.EXAMPLE
  .\Split-ByColumn.ps1 -Column "Region"
#>
param(
  [string]$Column,
  [switch]$NoOpen,
  [string]$Folder
)
. (Join-Path $PSScriptRoot 'Sheets.Common.ps1')

Invoke-Safely {
  Use-Folder $Folder
  Write-Host 'Split a list by a column'
  $files = Get-NewestFiles -Count 1
  Write-Picked $files
  $t = Read-Table $files[0]
  $col = Select-Column $t.Headers 'Split on which column?' $null $Column
  $ci = Get-ColumnIndex $t $col

  $groups = [ordered]@{}
  foreach ($row in $t.Rows) {
    $value = $row[$ci].Trim()
    if ($value -eq '') { $value = '(blank)' }
    $key = $value.ToLowerInvariant()
    if (-not $groups.Contains($key)) { $groups[$key] = @{ Name = $value; Rows = (New-Object 'System.Collections.Generic.List[object]') } }
    $groups[$key].Rows.Add($row)
  }
  if ($groups.Count -gt 250) { throw "$col has $($groups.Count) different values; at most 250 sheets are made. Is it the right column?" }

  $counts = New-Object 'System.Collections.Generic.List[object]'
  $sheets = @()
  foreach ($g in $groups.Values) {
    $counts.Add(@($g.Name, [string]$g.Rows.Count))
    $sheets += @{ Name = $g.Name; Headers = $t.Headers; Rows = $g.Rows }
  }
  $sheets = @(@{ Name = 'Counts'; Headers = @($col, 'Rows'); Rows = $counts }) + $sheets

  $path = Write-Workbook "Split by $col" $sheets
  Write-Host ("  {0} sheets." -f $groups.Count)
  Write-Done $path -NoOpen:$NoOpen
}
