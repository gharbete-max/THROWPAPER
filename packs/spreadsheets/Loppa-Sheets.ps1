<#
.SYNOPSIS
  Loppa spreadsheet pack: compare, match, de-duplicate, merge, split and tidy CSV files.

.DESCRIPTION
  One script, six commands, for the jobs people do by hand in Excel. Runs in Windows PowerShell 5.1
  and PowerShell 7 (Windows, macOS, Linux). Needs no Excel, no module and no network.

  Safe by design:
    * Your files are only ever read. Every result is a NEW file in a NEW folder (-Out, or a
      timestamped folder beside the first input). A folder that already holds files is refused.
    * It never runs anything it reads, never opens a connection, never changes settings.
    * What it did is printed: counts first, then the files it wrote.

  Reads CSV/TSV/TXT with ';' ',' tab or '|' as separator (found by itself, so a Swedish or German
  ';' file works) in UTF-8 or Windows-1252 (found by itself). Writes the same separator, UTF-8 with
  a byte-order mark, so Excel opens it with å ä ö intact. For an .xlsx, Save As CSV first (or use
  Loppa's Convert), because this script does not read .xlsx.

  Text stays text here, but Excel itself will turn 00123 into 123 when it OPENS a CSV; import the
  column as Text (Data > From Text/CSV) when leading zeros matter.

.EXAMPLE
  .\Loppa-Sheets.ps1 compare -A old.csv -B new.csv -Key Id
  Rows only in old, only in new, and which cells changed, matched by the Id column.

.EXAMPLE
  .\Loppa-Sheets.ps1 match -A members.csv -B export.csv
  Which column of one file is which column of the other ("E-post" = "email"?), by name.

.EXAMPLE
  .\Loppa-Sheets.ps1 dupes -File list.csv -Key Email
  Every row whose Email appears more than once, and a copy with the first of each kept.

.EXAMPLE
  .\Loppa-Sheets.ps1 merge -File jan.csv,feb.csv,mar.csv
  One file with every row, columns lined up by name, and a _source column.

.EXAMPLE
  .\Loppa-Sheets.ps1 split -File orders.csv -By Country
  One file per country.

.EXAMPLE
  .\Loppa-Sheets.ps1 clean -File contacts.csv
  Trims spaces, turns non-breaking spaces into spaces, collapses runs of spaces, drops empty rows.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('compare', 'match', 'dupes', 'merge', 'split', 'clean')]
  [string]$Command,
  [string]$A,
  [string]$B,
  [string[]]$File,
  [string[]]$Key,
  [string]$By,
  [string]$Out,
  [switch]$IgnoreCase,
  [switch]$Trim
)

$ErrorActionPreference = 'Stop'
# `pwsh -File script.ps1 merge -File a.csv,b.csv` hands over ONE string "a.csv,b.csv": split it,
# unless a file really is called that.
$File = @($File | Where-Object { $_ } | ForEach-Object { if (Test-Path -LiteralPath $_) { $_ } else { $_ -split ',' } })
$Key = @($Key | Where-Object { $_ } | ForEach-Object { $_ -split ',' })
$MaxSplitFiles = 500

function Stop-Loppa([string]$Message) { throw "Loppa: $Message" }

# ---- reading ----------------------------------------------------------------------------------

function Get-Text([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Stop-Loppa "no such file: $Path" }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    return [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  }
  try {
    # Strict: a Windows-1252 file with å ä ö is not valid UTF-8, and says so here.
    return (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
  } catch {
    try { [void][System.Text.Encoding]::RegisterProvider([System.Text.CodePagesEncodingProvider]::Instance) } catch { }
    return [System.Text.Encoding]::GetEncoding(1252).GetString($bytes)
  }
}

function Get-Delimiter([string]$Text) {
  $first = ($Text -split "`r?`n", 2)[0]
  $best = ','; $most = -1
  foreach ($d in @(';', ',', "`t", '|')) {
    $inQuotes = $false; $n = 0
    foreach ($c in $first.ToCharArray()) {
      if ($c -eq '"') { $inQuotes = -not $inQuotes } elseif (-not $inQuotes -and $c -eq $d) { $n++ }
    }
    if ($n -gt $most) { $most = $n; $best = $d }
  }
  return $best
}

function Read-Table([string]$Path) {
  $text = Get-Text $Path
  if ([string]::IsNullOrWhiteSpace($text)) { Stop-Loppa "$Path is empty" }
  $d = Get-Delimiter $text
  # The header row is read on its own first: ConvertFrom-Csv's own error for a repeated name is cryptic.
  $headers = @(($text -split "`r?`n", 2)[0] | ConvertFrom-Csv -Delimiter $d -Header (1..2000 | ForEach-Object { "c$_" }) |
      ForEach-Object { $_.PSObject.Properties.Value } | Where-Object { $null -ne $_ })
  $seen = @{}
  foreach ($h in $headers) {
    $k = Get-Norm $h
    if ($seen.ContainsKey($k)) { Stop-Loppa "$Path has the column '$h' twice (or two names that differ only in case, spacing or accents). Rename one first." }
    $seen[$k] = $true
  }
  $rows = @($text | ConvertFrom-Csv -Delimiter $d)
  [pscustomobject]@{ Path = $Path; Delimiter = $d; Headers = $headers; Rows = $rows }
}

# ---- helpers ----------------------------------------------------------------------------------

# A name with case, accents, spaces and punctuation taken out: "E-post" and "e post" are the same.
function Get-Norm([string]$Name) {
  $s = $Name.Normalize([System.Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $s.ToCharArray()) {
    $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($c)
    if ($cat -eq 'NonSpacingMark') { continue }
    if ([char]::IsLetterOrDigit($c)) { [void]$sb.Append([char]::ToLowerInvariant($c)) }
  }
  return $sb.ToString()
}

function Find-Column($Table, [string]$Name) {
  $want = Get-Norm $Name
  foreach ($h in $Table.Headers) { if ((Get-Norm $h) -eq $want) { return $h } }
  Stop-Loppa "$($Table.Path) has no column '$Name'. Its columns: $($Table.Headers -join ', ')"
}

function Get-Value($Row, [string]$Column) {
  $v = $Row.$Column
  if ($null -eq $v) { return '' }
  if ($Trim) { $v = $v.Trim() }
  if ($IgnoreCase) { $v = $v.ToLowerInvariant() }
  return $v
}

function Get-KeyOf($Row, [string[]]$Columns) {
  return (($Columns | ForEach-Object { Get-Value $Row $_ }) -join [string][char]0x1F)
}

function New-OutDir([string]$FirstInput) {
  $dir = $Out
  if (-not $dir) {
    $base = Split-Path -Parent (Resolve-Path -LiteralPath $FirstInput)
    $dir = Join-Path $base ('loppa-out-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  }
  if ((Test-Path -LiteralPath $dir) -and @(Get-ChildItem -LiteralPath $dir -Force).Count -gt 0) {
    Stop-Loppa "the output folder '$dir' already holds files. Loppa writes new files only; choose another -Out."
  }
  [void](New-Item -ItemType Directory -Force -Path $dir)
  return (Resolve-Path -LiteralPath $dir).Path
}

$script:Written = @()
function Write-Table([string]$Dir, [string]$Name, $Rows, [string]$Delimiter) {
  $path = Join-Path $Dir $Name
  $Rows = @($Rows)
  if ($Rows.Count -gt 0) { $text = ($Rows | ConvertTo-Csv -NoTypeInformation -Delimiter $Delimiter) -join "`r`n" }
  else { $text = '' }
  [System.IO.File]::WriteAllText($path, $text + "`r`n", (New-Object System.Text.UTF8Encoding($true)))
  $script:Written += $path
}

function Show-Result([string]$Title, [System.Collections.IDictionary]$Counts) {
  Write-Host $Title
  foreach ($k in $Counts.Keys) { Write-Host ("  {0,-30}{1}" -f $k, $Counts[$k]) }
  foreach ($p in $script:Written) { Write-Host "  wrote $p" }
}

# ---- commands ---------------------------------------------------------------------------------

function Invoke-Compare {
  if (-not $A -or -not $B) { Stop-Loppa 'compare needs -A and -B (two files)' }
  if (-not $Key) { Stop-Loppa 'compare needs -Key: the column (or columns) that identify a row, e.g. -Key Id' }
  $ta = Read-Table $A; $tb = Read-Table $B
  $ka = @($Key | ForEach-Object { Find-Column $ta $_ })
  $kb = @($Key | ForEach-Object { Find-Column $tb $_ })
  $index = @{}; $dupB = 0
  foreach ($r in $tb.Rows) {
    $k = Get-KeyOf $r $kb
    if ($index.ContainsKey($k)) { $dupB++ } else { $index[$k] = $r }
  }
  # Columns present in both, matched by normalised name; A's spelling is shown.
  $pairs = @(); $normB = @{}; foreach ($h in $tb.Headers) { $normB[(Get-Norm $h)] = $h }
  foreach ($h in $ta.Headers) { $n = Get-Norm $h; if ($normB.ContainsKey($n) -and $ka -notcontains $h) { $pairs += , @($h, $normB[$n]) } }
  $onlyA = New-Object System.Collections.ArrayList; $changed = New-Object System.Collections.ArrayList
  $seenA = @{}; $same = 0; $dupA = 0
  foreach ($r in $ta.Rows) {
    $k = Get-KeyOf $r $ka
    if ($seenA.ContainsKey($k)) { $dupA++; continue }
    $seenA[$k] = $true
    if (-not $index.ContainsKey($k)) { [void]$onlyA.Add($r); continue }
    $o = $index[$k]; $diff = $false
    foreach ($p in $pairs) {
      $va = Get-Value $r $p[0]; $vb = Get-Value $o $p[1]
      if ($va -ne $vb) {
        $diff = $true
        $row = [ordered]@{}
        for ($i = 0; $i -lt $ka.Count; $i++) { $row[$ka[$i]] = $r.($ka[$i]) }
        $row['Column'] = $p[0]; $row['A'] = $r.($p[0]); $row['B'] = $o.($p[1])
        [void]$changed.Add([pscustomobject]$row)
      }
    }
    if (-not $diff) { $same++ }
  }
  $onlyB = New-Object System.Collections.ArrayList
  foreach ($k in $index.Keys) { if (-not $seenA.ContainsKey($k)) { [void]$onlyB.Add($index[$k]) } }
  $dir = New-OutDir $A
  Write-Table $dir 'only-in-A.csv' $onlyA $ta.Delimiter
  Write-Table $dir 'only-in-B.csv' $onlyB $tb.Delimiter
  Write-Table $dir 'changed-cells.csv' $changed $ta.Delimiter
  $counts = [ordered]@{ 'rows in A' = $ta.Rows.Count; 'rows in B' = $tb.Rows.Count; 'identical' = $same
    'only in A' = $onlyA.Count; 'only in B' = $onlyB.Count; 'changed cells' = $changed.Count
    'repeated keys in A' = $dupA; 'repeated keys in B' = $dupB; 'columns compared' = $pairs.Count }
  Show-Result 'Compared (the first row of a repeated key is the one used):' $counts
}

function Invoke-Match {
  if (-not $A -or -not $B) { Stop-Loppa 'match needs -A and -B (two files)' }
  $ta = Read-Table $A; $tb = Read-Table $B
  $normB = @{}; foreach ($h in $tb.Headers) { $normB[(Get-Norm $h)] = $h }
  $rows = New-Object System.Collections.ArrayList; $usedB = @{}
  foreach ($h in $ta.Headers) {
    $n = Get-Norm $h
    if ($normB.ContainsKey($n)) { $usedB[$normB[$n]] = $true; [void]$rows.Add([pscustomobject]@{ 'Column in A' = $h; 'Column in B' = $normB[$n]; Status = 'same name' }) }
    else { [void]$rows.Add([pscustomobject]@{ 'Column in A' = $h; 'Column in B' = ''; Status = 'only in A' }) }
  }
  foreach ($h in $tb.Headers) { if (-not $usedB.ContainsKey($h)) { [void]$rows.Add([pscustomobject]@{ 'Column in A' = ''; 'Column in B' = $h; Status = 'only in B' }) } }
  $dir = New-OutDir $A
  Write-Table $dir 'column-match.csv' $rows $ta.Delimiter
  $rows | Format-Table -AutoSize | Out-String | Write-Host
  Show-Result 'Matched columns by name (ignoring case, spaces, punctuation and accents):' ([ordered]@{
      'same name' = @($rows | Where-Object Status -eq 'same name').Count
      'only in A' = @($rows | Where-Object Status -eq 'only in A').Count
      'only in B' = @($rows | Where-Object Status -eq 'only in B').Count })
}

function Invoke-Dupes {
  if (-not $File -or $File.Count -ne 1) { Stop-Loppa 'dupes needs -File (one file)' }
  if (-not $Key) { Stop-Loppa 'dupes needs -Key: the column (or columns) that must be unique, e.g. -Key Email' }
  $t = Read-Table $File[0]; $cols = @($Key | ForEach-Object { Find-Column $t $_ })
  $groups = [ordered]@{}
  foreach ($r in $t.Rows) {
    $k = Get-KeyOf $r $cols
    if (-not $groups.Contains($k)) { $groups[$k] = New-Object System.Collections.ArrayList }
    [void]$groups[$k].Add($r)
  }
  $dups = New-Object System.Collections.ArrayList; $firsts = New-Object System.Collections.ArrayList; $g = 0
  foreach ($k in $groups.Keys) {
    $list = $groups[$k]; [void]$firsts.Add($list[0])
    if ($list.Count -gt 1) {
      $g++
      foreach ($r in $list) {
        $row = [ordered]@{ '_group' = $g; '_count' = $list.Count }
        foreach ($h in $t.Headers) { $row[$h] = $r.$h }
        [void]$dups.Add([pscustomobject]$row)
      }
    }
  }
  $dir = New-OutDir $File[0]
  Write-Table $dir 'duplicates.csv' $dups $t.Delimiter
  Write-Table $dir 'first-of-each.csv' $firsts $t.Delimiter
  Show-Result 'Looked for repeated keys:' ([ordered]@{ 'rows' = $t.Rows.Count; 'keys that repeat' = $g
      'rows in those keys' = $dups.Count; 'rows kept (first of each)' = $firsts.Count })
}

function Invoke-Merge {
  if (-not $File -or $File.Count -lt 2) { Stop-Loppa 'merge needs -File with two or more files, e.g. -File jan.csv,feb.csv' }
  $tables = @($File | ForEach-Object { Read-Table $_ })
  $order = New-Object System.Collections.ArrayList; $names = @{}
  foreach ($t in $tables) { foreach ($h in $t.Headers) { $n = Get-Norm $h; if (-not $names.ContainsKey($n)) { $names[$n] = $h; [void]$order.Add($n) } } }
  $rows = New-Object System.Collections.ArrayList; $perFile = [ordered]@{}
  foreach ($t in $tables) {
    $map = @{}; foreach ($h in $t.Headers) { $map[(Get-Norm $h)] = $h }
    $label = Split-Path -Leaf $t.Path
    foreach ($r in $t.Rows) {
      $row = [ordered]@{}
      foreach ($n in $order) { $row[$names[$n]] = if ($map.ContainsKey($n)) { $r.($map[$n]) } else { '' } }
      $row['_source'] = $label
      [void]$rows.Add([pscustomobject]$row)
    }
    $perFile["rows from $label"] = $t.Rows.Count
  }
  $dir = New-OutDir $File[0]
  Write-Table $dir 'merged.csv' $rows $tables[0].Delimiter
  $perFile['rows in merged.csv'] = $rows.Count; $perFile['columns'] = $order.Count + 1
  Show-Result 'Merged (columns lined up by name):' $perFile
}

function Invoke-Split {
  if (-not $File -or $File.Count -ne 1) { Stop-Loppa 'split needs -File (one file)' }
  if (-not $By) { Stop-Loppa 'split needs -By: the column to split on, e.g. -By Country' }
  $t = Read-Table $File[0]; $col = Find-Column $t $By
  $groups = [ordered]@{}
  foreach ($r in $t.Rows) {
    $v = [string]$r.$col; if ($Trim) { $v = $v.Trim() }
    if ($v -eq '') { $v = '(empty)' }
    if (-not $groups.Contains($v)) { $groups[$v] = New-Object System.Collections.ArrayList }
    [void]$groups[$v].Add($r)
  }
  if ($groups.Count -gt $MaxSplitFiles) { Stop-Loppa "'$col' has $($groups.Count) different values; at most $MaxSplitFiles files are made. Pick a column with fewer." }
  $dir = New-OutDir $File[0]; $used = @{}
  foreach ($v in $groups.Keys) {
    $safe = ($v -replace '[\\/:*?"<>|\x00-\x1f]', '_').Trim().TrimEnd('.'); if ($safe -eq '') { $safe = '_' }
    $name = $safe; $n = 2
    while ($used.ContainsKey($name.ToLowerInvariant())) { $name = "$safe ($n)"; $n++ }
    $used[$name.ToLowerInvariant()] = $true
    Write-Table $dir "$name.csv" $groups[$v] $t.Delimiter
  }
  Show-Result "Split by '$col':" ([ordered]@{ 'rows' = $t.Rows.Count; 'files written' = $groups.Count })
}

function Invoke-Clean {
  if (-not $File -or $File.Count -ne 1) { Stop-Loppa 'clean needs -File (one file)' }
  $t = Read-Table $File[0]; $cells = 0; $emptyRows = 0
  $kept = New-Object System.Collections.ArrayList
  foreach ($r in $t.Rows) {
    $row = [ordered]@{}; $any = $false
    foreach ($h in $t.Headers) {
      $v = [string]$r.$h
      $c = ($v -replace [string][char]0x00A0, ' ' -replace '\s+', ' ').Trim()
      if ($c -ne $v) { $cells++ }
      if ($c -ne '') { $any = $true }
      $row[$h] = $c
    }
    if ($any) { [void]$kept.Add([pscustomobject]$row) } else { $emptyRows++ }
  }
  $dir = New-OutDir $File[0]
  Write-Table $dir 'cleaned.csv' $kept $t.Delimiter
  Show-Result 'Cleaned (spaces trimmed and collapsed, non-breaking spaces turned into spaces):' ([ordered]@{
      'rows in' = $t.Rows.Count; 'cells changed' = $cells; 'empty rows dropped' = $emptyRows; 'rows out' = $kept.Count })
}

# A plain one-line message on stderr and a failing exit code: PowerShell's own error display wraps
# a long message over several decorated lines, which is hard to read and to search.
try {
  switch ($Command) {
    'compare' { Invoke-Compare }
    'match' { Invoke-Match }
    'dupes' { Invoke-Dupes }
    'merge' { Invoke-Merge }
    'split' { Invoke-Split }
    'clean' { Invoke-Clean }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
