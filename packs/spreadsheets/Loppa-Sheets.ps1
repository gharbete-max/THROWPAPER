<#
.SYNOPSIS
  Loppa spreadsheet pack: compare, match, look up, summarise, mask and tidy CSV files.

.DESCRIPTION
  One script, twelve commands, for the jobs people do by hand in Excel. Runs in Windows PowerShell 5.1
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

.EXAMPLE
  .\Loppa-Sheets.ps1 fuzzy -A members.csv -B export.csv -Column Name -Threshold 0.85
  For each name in A, the most alike name in B and how alike (word order, case, accents ignored).

.EXAMPLE
  .\Loppa-Sheets.ps1 numbers -A budget.csv -B actual.csv -Key Account -Column Amount -Tolerance 0.01
  Cells whose numbers differ by more than the tolerance (-Percent makes it a percentage of A).

.EXAMPLE
  .\Loppa-Sheets.ps1 lookup -File orders.csv -Key CustomerId -From customers.csv -Take Name,City
  Adds columns from another file, found by key: a VLOOKUP/XLOOKUP across files.

.EXAMPLE
  .\Loppa-Sheets.ps1 gaps -File invoices.csv -Column InvoiceNo
  Missing numbers in a series (INV-0001, INV-0002, ...) and numbers that appear twice.

.EXAMPLE
  .\Loppa-Sheets.ps1 pivot -File sales.csv -By Country -Cols Product -Sum Amount
  Counts (or sums, with -Sum) by one column, or by two as a table; totals included.

.EXAMPLE
  .\Loppa-Sheets.ps1 mask -File people.csv -Column Name,Email -Salt "a secret phrase"
  A copy for sharing: chosen columns replaced by tokens that stay the same for the same value.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0, Mandatory = $true)]
  [ValidateSet('compare', 'match', 'dupes', 'merge', 'split', 'clean', 'fuzzy', 'numbers', 'lookup', 'gaps', 'pivot', 'mask')]
  [string]$Command,
  [string]$A,
  [string]$B,
  [string[]]$File,
  [string[]]$Key,
  [string]$By,
  [string]$Out,
  [switch]$IgnoreCase,
  [switch]$Trim,
  # fuzzy, numbers, gaps, mask: the column(s) to work on. fuzzy: -ColumnB if B names it differently.
  [string[]]$Column,
  [string]$ColumnB,
  [double]$Threshold = 0.85,
  # numbers: how far apart two numbers may be before they count as different (-Percent: % of A).
  [double]$Tolerance = 0,
  [switch]$Percent,
  # Which mark is the decimal one when a number is ambiguous ("1,234"): ',' or '.'.
  [ValidateSet('', ',', '.')][string]$Decimal = '',
  # lookup: the other file, its key column if named differently, the columns to bring, the filler.
  [string]$From,
  [string[]]$KeyFrom,
  [string[]]$Take,
  [string]$Missing = '',
  # pivot: -By rows, -Cols columns, -Sum a number column to add up (otherwise rows are counted).
  [string]$Cols,
  [string]$Sum,
  # gaps: the step between numbers in the series.
  [int]$Step = 1,
  # mask: hash (a token per value), partial (first letter and stars), blank. -Salt keeps tokens the same between runs.
  [ValidateSet('hash', 'partial', 'blank')][string]$Mode = 'hash',
  [string]$Salt
)

$ErrorActionPreference = 'Stop'
# `pwsh -File script.ps1 merge -File a.csv,b.csv` hands over ONE string "a.csv,b.csv": split it,
# unless a file really is called that.
$File = @($File | Where-Object { $_ } | ForEach-Object { if (Test-Path -LiteralPath $_) { $_ } else { $_ -split ',' } })
$Key = @($Key | Where-Object { $_ } | ForEach-Object { $_ -split ',' })
$KeyFrom = @($KeyFrom | Where-Object { $_ } | ForEach-Object { $_ -split ',' })
$Column = @($Column | Where-Object { $_ } | ForEach-Object { $_ -split ',' })
$Take = @($Take | Where-Object { $_ } | ForEach-Object { $_ -split ',' })
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
  $best = ','; $most = 0   # a one-column file has none: ',' then
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

# ---- more helpers -----------------------------------------------------------------------------

# A number as people write it: "1 234,56", "1,234.56", "12.5 kr", "(120)", "-3". $null when it is not one.
# "1,234" alone is read as one thousand two hundred thirty-four unless -Decimal says ',' is the decimal mark.
function ConvertTo-Number([string]$Text) {
  $t = ($Text -replace '[\s  ]', '')
  if ($t -match '^\((.+)\)$') { $t = '-' + $Matches[1] }
  $t = $t -replace '^[^\d\-+.,]+', '' -replace '[^\d]+$', ''
  if ($t -notmatch '^[+-]?\d[\d.,]*$') { return $null }
  $sign = ''; if ($t[0] -eq '-' -or $t[0] -eq '+') { if ($t[0] -eq '-') { $sign = '-' }; $t = $t.Substring(1) }
  $dot = $t.LastIndexOf('.'); $comma = $t.LastIndexOf(',')
  $mark = $null
  if ($dot -ge 0 -and $comma -ge 0) { $mark = if ($dot -gt $comma) { '.' } else { ',' } }
  elseif ($dot -ge 0 -or $comma -ge 0) {
    $one = if ($dot -ge 0) { '.' } else { ',' }
    $parts = $t -split [regex]::Escape($one)
    if ($Decimal -ne '') { $mark = if ($one -eq $Decimal -and $parts.Count -eq 2) { $one } else { $null } }
    elseif ($parts.Count -eq 2 -and -not ($parts[1].Length -eq 3 -and $parts[0].Length -le 3 -and $parts[0] -ne '0')) { $mark = $one }
  }
  if ($mark) {
    $i = $t.LastIndexOf($mark)
    $t = ($t.Substring(0, $i) -replace '[.,]', '') + '.' + ($t.Substring($i + 1) -replace '[.,]', '')
  } else { $t = $t -replace '[.,]', '' }
  $d = [decimal]0
  if ([decimal]::TryParse($sign + $t, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { return $d }
  return $null
}

# A number written for the file it goes into: a ';' file gets a decimal comma, as Excel in that country wants.
function Format-Number([decimal]$Value, [string]$Delimiter) {
  $text = $Value.ToString('0.############', [System.Globalization.CultureInfo]::InvariantCulture)
  if ($Delimiter -eq ';') { $text = $text.Replace('.', ',') }
  return $text
}

# Words, lower case, no accents, no punctuation, in alphabetical order: "Berg, Anna-Maria" = "anna maria berg".
function Get-Tokens([string]$Text) {
  $s = $Text.Normalize([System.Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($c in $s.ToCharArray()) {
    if ([System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -eq 'NonSpacingMark') { continue }
    if ([char]::IsLetterOrDigit($c)) { [void]$sb.Append([char]::ToLowerInvariant($c)) } else { [void]$sb.Append(' ') }
  }
  return ((($sb.ToString() -split ' ') | Where-Object { $_ } | Sort-Object { $_ }) -join ' ')
}

function Get-Similarity([string]$X, [string]$Y) {
  if ($X -eq $Y) { return 1.0 }
  $lx = $X.Length; $ly = $Y.Length
  if ($lx -eq 0 -or $ly -eq 0) { return 0.0 }
  $prev = New-Object 'int[]' ($ly + 1); $cur = New-Object 'int[]' ($ly + 1)
  for ($j = 0; $j -le $ly; $j++) { $prev[$j] = $j }
  for ($i = 1; $i -le $lx; $i++) {
    $cur[0] = $i; $cx = $X[$i - 1]
    for ($j = 1; $j -le $ly; $j++) {
      $cost = if ($cx -eq $Y[$j - 1]) { 0 } else { 1 }
      $m = $prev[$j - 1] + $cost
      $a = $prev[$j] + 1; if ($a -lt $m) { $m = $a }
      $b = $cur[$j - 1] + 1; if ($b -lt $m) { $m = $b }
      $cur[$j] = $m
    }
    $t = $prev; $prev = $cur; $cur = $t
  }
  return 1.0 - ($prev[$ly] / [Math]::Max($lx, $ly))
}

# ---- more commands ----------------------------------------------------------------------------

function Invoke-Fuzzy {
  if (-not $A -or -not $B) { Stop-Loppa 'fuzzy needs -A and -B (two files)' }
  if ($Column.Count -ne 1) { Stop-Loppa 'fuzzy needs -Column: the one column to compare, e.g. -Column Name' }
  $ta = Read-Table $A; $tb = Read-Table $B
  $ca = Find-Column $ta $Column[0]; $cb = Find-Column $tb $(if ($ColumnB) { $ColumnB } else { $Column[0] })
  # ponytail: every A against every B in PowerShell (400 x 500 names took 14 s in PowerShell 7); fine to a couple of thousand rows each, slow beyond. Upgrade path: compile the distance with Add-Type, where the machine allows it.
  $bTokens = @($tb.Rows | ForEach-Object { Get-Tokens ([string]$_.$cb) })
  $exact = @{}; for ($j = 0; $j -lt $bTokens.Count; $j++) { if ($bTokens[$j] -ne '' -and -not $exact.ContainsKey($bTokens[$j])) { $exact[$bTokens[$j]] = $j } }
  $rows = New-Object System.Collections.ArrayList; $same = 0; $likely = 0; $none = 0
  for ($i = 0; $i -lt $ta.Rows.Count; $i++) {
    $va = [string]$ta.Rows[$i].$ca; $tok = Get-Tokens $va
    $best = -1; $score = 0.0
    if ($tok -eq '') { $best = -1 }
    elseif ($exact.ContainsKey($tok)) { $best = $exact[$tok]; $score = 1.0 }
    else {
      for ($j = 0; $j -lt $bTokens.Count; $j++) {
        $t2 = $bTokens[$j]; if ($t2 -eq '') { continue }
        if ([Math]::Abs($tok.Length - $t2.Length) / [Math]::Max($tok.Length, $t2.Length) -gt (1 - $Threshold + 0.15)) { continue }
        $sc = Get-Similarity $tok $t2
        if ($sc -gt $score) { $score = $sc; $best = $j }
      }
    }
    $status = if ($best -lt 0) { 'no candidate' } elseif ($score -ge 0.9999) { 'same' } elseif ($score -ge $Threshold) { 'likely' } else { 'weak' }
    switch ($status) { 'same' { $same++ } 'likely' { $likely++ } default { $none++ } }
    [void]$rows.Add([pscustomobject][ordered]@{
        'Row in A' = $i + 2; 'Value in A' = $va
        'Most alike in B' = $(if ($best -ge 0) { [string]$tb.Rows[$best].$cb } else { '' })
        'Row in B' = $(if ($best -ge 0) { $best + 2 } else { '' })
        'Score' = $(if ($best -ge 0) { [Math]::Round($score, 3).ToString([System.Globalization.CultureInfo]::InvariantCulture) } else { '' })
        'Status' = $status })
  }
  $dir = New-OutDir $A
  Write-Table $dir 'fuzzy-matches.csv' $rows $ta.Delimiter
  Show-Result "Compared '$ca' (case, accents, punctuation and word order ignored). Check 'likely' and 'weak' by eye:" ([ordered]@{
      'values in A' = $ta.Rows.Count; 'same' = $same; "likely (>= $Threshold)" = $likely; 'weak or none' = $none })
}

function Invoke-Numbers {
  if (-not $A -or -not $B) { Stop-Loppa 'numbers needs -A and -B (two files)' }
  if (-not $Key) { Stop-Loppa 'numbers needs -Key: the column that identifies a row' }
  if ($Column.Count -lt 1) { Stop-Loppa 'numbers needs -Column: the number column(s) to compare, e.g. -Column Amount' }
  $ta = Read-Table $A; $tb = Read-Table $B
  $ka = @($Key | ForEach-Object { Find-Column $ta $_ }); $kb = @($Key | ForEach-Object { Find-Column $tb $_ })
  $na = @($Column | ForEach-Object { Find-Column $ta $_ }); $nb = @($Column | ForEach-Object { Find-Column $tb $_ })
  $index = @{}; foreach ($r in $tb.Rows) { $k = Get-KeyOf $r $kb; if (-not $index.ContainsKey($k)) { $index[$k] = $r } }
  $rows = New-Object System.Collections.ArrayList; $checked = 0; $missing = 0; $differ = 0; $bad = 0; $seenKeys = @{}
  foreach ($r in $ta.Rows) {
    $k = Get-KeyOf $r $ka
    if ($seenKeys.ContainsKey($k)) { continue }; $seenKeys[$k] = $true
    if (-not $index.ContainsKey($k)) { $missing++; continue }
    $o = $index[$k]
    for ($c = 0; $c -lt $na.Count; $c++) {
      $checked++
      $xa = ConvertTo-Number ([string]$r.($na[$c])); $xb = ConvertTo-Number ([string]$o.($nb[$c]))
      $status = $null; $diff = ''
      if ($null -eq $xa) { $status = 'A is not a number' } elseif ($null -eq $xb) { $status = 'B is not a number' }
      else {
        $d = $xb - $xa
        $limit = if ($Percent) { [Math]::Abs($xa) * [decimal]$Tolerance / 100 } else { [decimal]$Tolerance }
        if ([Math]::Abs($d) -gt $limit) { $status = 'differs'; $diff = Format-Number $d $ta.Delimiter }
      }
      if ($status) {
        if ($status -eq 'differs') { $differ++ } else { $bad++ }
        $row = [ordered]@{}; for ($i = 0; $i -lt $ka.Count; $i++) { $row[$ka[$i]] = $r.($ka[$i]) }
        $row['Column'] = $na[$c]; $row['A'] = $r.($na[$c]); $row['B'] = $o.($nb[$c]); $row['B minus A'] = $diff; $row['Status'] = $status
        [void]$rows.Add([pscustomobject]$row)
      }
    }
  }
  $dir = New-OutDir $A
  Write-Table $dir 'number-differences.csv' $rows $ta.Delimiter
  Show-Result "Compared numbers (tolerance $Tolerance$(if ($Percent) { ' %' } else { '' })):" ([ordered]@{
      'cells compared' = $checked; 'differ' = $differ; 'not a number' = $bad; 'keys only in A (skipped)' = $missing })
}

function Invoke-Lookup {
  if (-not $File -or $File.Count -ne 1) { Stop-Loppa 'lookup needs -File (the file to add columns to)' }
  if (-not $From) { Stop-Loppa 'lookup needs -From: the file to take columns from' }
  if (-not $Key) { Stop-Loppa 'lookup needs -Key: the column in -File that finds the row in -From' }
  if ($Take.Count -lt 1) { Stop-Loppa 'lookup needs -Take: the column(s) to bring over, e.g. -Take Name,City' }
  $tm = Read-Table $File[0]; $tf = Read-Table $From
  $km = @($Key | ForEach-Object { Find-Column $tm $_ })
  $kf = @($(if ($KeyFrom.Count -gt 0) { $KeyFrom } else { $Key }) | ForEach-Object { Find-Column $tf $_ })
  if ($km.Count -ne $kf.Count) { Stop-Loppa '-Key and -KeyFrom must name the same number of columns' }
  $tk = @($Take | ForEach-Object { Find-Column $tf $_ })
  $index = @{}; $repeats = 0
  foreach ($r in $tf.Rows) { $k = Get-KeyOf $r $kf; if ($index.ContainsKey($k)) { $repeats++ } else { $index[$k] = $r } }
  $existing = @{}; foreach ($h in $tm.Headers) { $existing[(Get-Norm $h)] = $true }
  $names = @($tk | ForEach-Object { if ($existing.ContainsKey((Get-Norm $_))) { "$_ (from $(Split-Path -Leaf $From))" } else { $_ } })
  $rows = New-Object System.Collections.ArrayList; $found = 0; $notFound = 0
  foreach ($r in $tm.Rows) {
    $row = [ordered]@{}; foreach ($h in $tm.Headers) { $row[$h] = $r.$h }
    $k = Get-KeyOf $r $km
    if ($index.ContainsKey($k)) { $found++; $o = $index[$k]; for ($c = 0; $c -lt $tk.Count; $c++) { $row[$names[$c]] = $o.($tk[$c]) } }
    else { $notFound++; for ($c = 0; $c -lt $tk.Count; $c++) { $row[$names[$c]] = $Missing } }
    [void]$rows.Add([pscustomobject]$row)
  }
  $dir = New-OutDir $File[0]
  Write-Table $dir 'lookup-result.csv' $rows $tm.Delimiter
  Show-Result 'Looked up (the first row of a repeated key is the one used):' ([ordered]@{
      'rows' = $tm.Rows.Count; 'found' = $found; 'not found' = $notFound; 'repeated keys in -From' = $repeats })
}

function Invoke-Gaps {
  if (-not $File -or $File.Count -ne 1) { Stop-Loppa 'gaps needs -File (one file)' }
  if ($Column.Count -ne 1) { Stop-Loppa 'gaps needs -Column: the column holding the numbers, e.g. -Column InvoiceNo' }
  if ($Step -lt 1) { Stop-Loppa '-Step must be 1 or more' }
  $t = Read-Table $File[0]; $col = Find-Column $t $Column[0]
  $series = @{}; $skipped = 0
  foreach ($r in $t.Rows) {
    $v = ([string]$r.$col).Trim()
    if ($v -eq '') { continue }
    if ($v -notmatch '^(.*?)(\d+)(\D*)$') { $skipped++; continue }
    $name = $Matches[1] + '#' + $Matches[3]
    if (-not $series.ContainsKey($name)) { $series[$name] = @{ Prefix = $Matches[1]; Suffix = $Matches[3]; Seen = @{}; Pad = 0 } }
    $n = [int64]$Matches[2]
    if ($Matches[2].Length -gt 1 -and $Matches[2][0] -eq '0') { $series[$name].Pad = [Math]::Max($series[$name].Pad, $Matches[2].Length) }
    if ($series[$name].Seen.ContainsKey($n)) { $series[$name].Seen[$n]++ } else { $series[$name].Seen[$n] = 1 }
  }
  $gaps = New-Object System.Collections.ArrayList; $repeats = New-Object System.Collections.ArrayList; $missingTotal = [int64]0
  foreach ($name in ($series.Keys | Sort-Object)) {
    $s = $series[$name]; $nums = @($s.Seen.Keys | ForEach-Object { [int64]$_ } | Sort-Object)
    $fmt = { param($n) $s.Prefix + $(if ($s.Pad -gt 0) { $n.ToString('D' + $s.Pad) } else { [string]$n }) + $s.Suffix }
    foreach ($n in $nums) { if ($s.Seen[$n] -gt 1) { [void]$repeats.Add([pscustomobject][ordered]@{ 'Number' = (& $fmt $n); 'Times' = $s.Seen[$n] }) } }
    for ($i = 0; $i -lt $nums.Count - 1; $i++) {
      $from1 = $nums[$i] + $Step; $to1 = $nums[$i + 1] - $Step
      if ($to1 -ge $from1) {
        $count = [int64][Math]::Floor(($to1 - $from1) / $Step) + 1; $missingTotal += $count
        [void]$gaps.Add([pscustomobject][ordered]@{ 'Series' = "$($s.Prefix)...$($s.Suffix)"; 'Missing from' = (& $fmt $from1); 'Missing to' = (& $fmt $to1); 'How many' = $count })
      }
    }
  }
  $dir = New-OutDir $File[0]
  Write-Table $dir 'gaps.csv' $gaps $t.Delimiter
  Write-Table $dir 'repeated-numbers.csv' $repeats $t.Delimiter
  Show-Result "Looked for gaps in '$col' (one series per prefix and suffix):" ([ordered]@{
      'series' = $series.Count; 'missing numbers' = $missingTotal; 'gaps' = $gaps.Count; 'numbers used twice or more' = $repeats.Count; 'cells with no number' = $skipped })
}

function Invoke-Pivot {
  if (-not $File -or $File.Count -ne 1) { Stop-Loppa 'pivot needs -File (one file)' }
  if (-not $By) { Stop-Loppa 'pivot needs -By: the column whose values become the rows' }
  $t = Read-Table $File[0]; $rc = Find-Column $t $By
  $cc = if ($Cols) { Find-Column $t $Cols } else { $null }
  $sc = if ($Sum) { Find-Column $t $Sum } else { $null }
  $cell = @{}; $rowKeys = @{}; $colKeys = @{}; $bad = 0
  foreach ($r in $t.Rows) {
    $rk = [string]$r.$rc; if ($Trim) { $rk = $rk.Trim() }; if ($rk -eq '') { $rk = '(empty)' }
    $ck = if ($cc) { $x = [string]$r.$cc; if ($Trim) { $x = $x.Trim() }; if ($x -eq '') { '(empty)' } else { $x } } else { 'Total' }
    $add = [decimal]1
    if ($sc) { $add = ConvertTo-Number ([string]$r.$sc); if ($null -eq $add) { $bad++; continue } }
    $rowKeys[$rk] = $true; $colKeys[$ck] = $true
    $key = $rk + [string][char]0x1F + $ck
    $cell[$key] = [decimal]$(if ($cell.ContainsKey($key)) { $cell[$key] } else { 0 }) + $add
  }
  $rks = @($rowKeys.Keys | Sort-Object); $cks = @($colKeys.Keys | Sort-Object)
  $rows = New-Object System.Collections.ArrayList; $colTotals = @{}; $grand = [decimal]0
  foreach ($rk in $rks) {
    $row = [ordered]@{}; $row[$rc] = $rk; $rowTotal = [decimal]0
    foreach ($ck in $cks) {
      $key = $rk + [string][char]0x1F + $ck; $v = if ($cell.ContainsKey($key)) { $cell[$key] } else { [decimal]0 }
      $row[$ck] = if ($cell.ContainsKey($key)) { Format-Number $v $t.Delimiter } else { '' }
      $rowTotal += $v; $colTotals[$ck] = [decimal]$(if ($colTotals.ContainsKey($ck)) { $colTotals[$ck] } else { 0 }) + $v
    }
    if ($cc) { $row['Total'] = Format-Number $rowTotal $t.Delimiter }
    $grand += $rowTotal; [void]$rows.Add([pscustomobject]$row)
  }
  $tr = [ordered]@{}; $tr[$rc] = 'Total'
  foreach ($ck in $cks) { $tr[$ck] = Format-Number ([decimal]$colTotals[$ck]) $t.Delimiter }
  if ($cc) { $tr['Total'] = Format-Number $grand $t.Delimiter }
  [void]$rows.Add([pscustomobject]$tr)
  $dir = New-OutDir $File[0]
  Write-Table $dir 'pivot.csv' $rows $t.Delimiter
  Show-Result "Pivot of '$rc'$(if ($cc) { " by '$cc'" })$(if ($sc) { ", adding up '$sc'" } else { ', counting rows' }):" ([ordered]@{
      'row values' = $rks.Count; 'column values' = $cks.Count; 'grand total' = (Format-Number $grand $t.Delimiter); 'rows skipped (not a number)' = $bad })
}

function Invoke-Mask {
  if (-not $File -or $File.Count -ne 1) { Stop-Loppa 'mask needs -File (one file)' }
  if ($Column.Count -lt 1) { Stop-Loppa 'mask needs -Column: the column(s) to hide, e.g. -Column Name,Email' }
  $t = Read-Table $File[0]; $targets = @($Column | ForEach-Object { Find-Column $t $_ })
  $salt = if ($Salt) { $Salt } else { [guid]::NewGuid().ToString() }
  $sha = [System.Security.Cryptography.SHA256]::Create(); $cache = @{}; $cells = 0
  $rows = New-Object System.Collections.ArrayList
  foreach ($r in $t.Rows) {
    $row = [ordered]@{}; foreach ($h in $t.Headers) { $row[$h] = $r.$h }
    foreach ($h in $targets) {
      $v = [string]$r.$h
      if ($v.Trim() -eq '') { continue }
      $cells++
      switch ($Mode) {
        'blank' { $row[$h] = '' }
        'partial' { $row[$h] = $v.Substring(0, 1) + ('*' * [Math]::Max(1, $v.Length - 1)) }
        default {
          $k = $h + [string][char]0x1F + $v.Trim().ToLowerInvariant()
          if (-not $cache.ContainsKey($k)) {
            $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($salt + [string][char]0x1F + $k))
            $cache[$k] = 'm' + (($bytes[0..4] | ForEach-Object { $_.ToString('x2') }) -join '')
          }
          $row[$h] = $cache[$k]
        }
      }
    }
    [void]$rows.Add([pscustomobject]$row)
  }
  $dir = New-OutDir $File[0]
  Write-Table $dir 'masked.csv' $rows $t.Delimiter
  $note = if ($Mode -eq 'hash') { if ($Salt) { 'tokens repeat across runs that use the same -Salt' } else { 'random salt: tokens cannot be matched to another run' } } else { $Mode }
  Show-Result "Masked $($targets -join ', ') ($note):" ([ordered]@{ 'rows' = $t.Rows.Count; 'cells masked' = $cells; 'distinct tokens' = $cache.Count })
  Write-Host '  Other columns are untouched, and rare values can still identify a person. Check the file before you share it.'
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
    'fuzzy' { Invoke-Fuzzy }
    'numbers' { Invoke-Numbers }
    'lookup' { Invoke-Lookup }
    'gaps' { Invoke-Gaps }
    'pivot' { Invoke-Pivot }
    'mask' { Invoke-Mask }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
