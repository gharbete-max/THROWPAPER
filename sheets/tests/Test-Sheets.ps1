<#
  The library's tests. Run from anywhere:

    powershell -NoProfile -ExecutionPolicy Bypass -File sheets\tests\Test-Sheets.ps1

  CI runs it on Windows PowerShell 5.1 (the version every Windows computer has) and on PowerShell 7.
  It exits 1 if anything fails; a test that cannot run is a failure, never a pass.
#>
$here = $PSScriptRoot
$scripts = Join-Path (Split-Path -Parent $here) 'scripts'
$fixtures = Join-Path $here 'fixtures'
. (Join-Path $scripts 'Sheets.Common.ps1')
$ErrorActionPreference = 'Stop'

$script:failures = 0
$script:passes = 0
function Check {
  param([string]$Name, [bool]$Ok, [string]$Detail = '')
  if ($Ok) { $script:passes++; Write-Host "  ok    $Name" }
  else { $script:failures++; Write-Host "  FAIL  $Name  $Detail" -ForegroundColor Red }
}
function Same {
  param([string]$Name, $Actual, $Expected)
  Check $Name ([string]$Actual -ceq [string]$Expected) "expected '$Expected', got '$Actual'"
}

Write-Host "PowerShell $($PSVersionTable.PSVersion), fast mode: $script:FastText"

# --- Text ----------------------------------------------------------------------------------
Write-Host 'Text'
Same 'kitten to sitting is 3 edits' (Get-EditDistance 'kitten' 'sitting') 3
Same 'empty to abc is 3 edits' (Get-EditDistance '' 'abc') 3
Same 'counting stops past the limit' (Get-EditDistance 'kitten' 'sitting' 1) 2
Same 'accents, punctuation and word marks go' (ConvertTo-MatchText 'Öberg, Åsa') 'oberg asa'
Same 'company words go' (ConvertTo-MatchText 'Volvo AB (publ)') 'volvo'
Same 'ø and æ become letters' (ConvertTo-MatchText 'Søren Ærø') 'soren aero'

# The compiled path and the PowerShell path must agree on every score.
$samples = 'Anna Svensson', 'Anna Svenson', 'Svensson, Anna', 'Åsa Öberg', 'Asa Oberg', 'Volvo AB (publ)', 'Volvo Cars', 'Erik', ''
$keys = New-MatchKeys $samples
$scores = @{}
foreach ($fast in $true, $false) {
  if ($fast -and -not $script:FastText) { continue }
  $saved = $script:FastText; $script:FastText = $fast
  $list = New-Object System.Collections.Generic.List[int]
  for ($i = 0; $i -lt $samples.Count; $i++) {
    for ($j = 0; $j -lt $samples.Count; $j++) {
      $list.Add((Get-Similarity $keys.Text[$i] $keys.Sorted[$i] $keys.Text[$j] $keys.Sorted[$j] 0))
    }
  }
  $scores[$fast] = $list -join ','
  $pairs = Get-SimilarPairs $keys 90
  $scores["pairs$fast"] = $pairs -join ','
  $two = Get-BestTwo $keys.Text[1] $keys.Sorted[1] $keys 50
  $scores["two$fast"] = $two -join ','
  $script:FastText = $saved
}
if ($script:FastText) {
  Same 'fast and slow similarity agree' $scores[$true] $scores[$false]
  Same 'fast and slow pairs agree' $scores['pairsTrue'] $scores['pairsFalse']
  Same 'fast and slow best-two agree' $scores['twoTrue'] $scores['twoFalse']
} else {
  Write-Host '  (this computer refused the fast mode; only the PowerShell path was tested)'
}
Same 'reversed names are a full match' (Get-Similarity $keys.Text[0] $keys.Sorted[0] $keys.Text[2] $keys.Sorted[2]) 100
Same 'one letter apart scores 92' (Get-Similarity $keys.Text[0] $keys.Sorted[0] $keys.Text[1] $keys.Sorted[1]) 92

# --- Reading ---------------------------------------------------------------------------------
Write-Host 'Reading'
$t = Read-Table (Get-Item (Join-Path $fixtures 'register.xlsx'))
Same 'xlsx: header row is the first filled one' ($t.Headers -join '|') 'Account|Name|Shares|Since|Active'
Same 'xlsx: three rows' $t.Rows.Count 3
Same 'xlsx: inline text with accents' $t.Rows[0][1] 'Åsa Öberg'
Same 'xlsx: a date cell reads as yyyy-MM-dd' $t.Rows[0][3] '2026-11-05'
Same 'xlsx: a date and time' $t.Rows[2][3] '2019-03-15 14:30:00'
Same 'xlsx: a boolean' $t.Rows[0][4] 'TRUE'
Same 'xlsx: a decimal' $t.Rows[1][2] '50000.5'
Same 'xlsx: an ID with a leading zero stays text' $t.Rows[2][0] '00123'
Same 'xlsx: XML characters' $t.Rows[2][1] 'Zoë "Zed" <Smith> & Co'
Same 'xlsx: an empty cell' $t.Rows[2][2] ''
Same 'xlsx: another sheet by name' ((Read-Table (Get-Item (Join-Path $fixtures 'register.xlsx')) -Sheet 'Other').Headers -join '|') 'Not|this'

$t = Read-Table (Get-Item (Join-Path $fixtures 'before-libreoffice.xlsx'))
Same 'xlsx shared strings: text' $t.Rows[0][1] 'Åsa Öberg'
Same 'xlsx shared strings: number' $t.Rows[1][2] '50000'

$t = Read-Table (Get-Item (Join-Path $fixtures 'before.csv'))
Same 'csv: semicolons and UTF-8' $t.Rows[0][1] 'Åsa Öberg'
Same 'csv: five rows' $t.Rows.Count 5
$t = Read-Table (Get-Item (Join-Path $fixtures 'after.csv'))
Same 'csv: commas and Windows-1252' $t.Rows[1][4] 'Göteborg'
Same 'csv: a quoted comma' $t.Rows[2][1] 'Taylor, Jonathan'

# --- Writing ---------------------------------------------------------------------------------
Write-Host 'Writing'
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("sheets-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  Use-Folder $work
  $path = Write-Workbook 'Round trip' @(@{
      Name = 'Data: one/two'
      Headers = @('Text', 'Number', 'Id', 'Formula-like')
      Rows = @(, @(@{ v = 'Zoë <&> "q"'; s = $script:Style.Changed }, '1234.5', '00123', '=1+1'))
    })
  $back = Read-Table (Get-Item $path)
  Same 'round trip: styled text' $back.Rows[0][0] 'Zoë <&> "q"'
  Same 'round trip: number' $back.Rows[0][1] '1234.5'
  Same 'round trip: ID kept as text' $back.Rows[0][2] '00123'
  Same 'round trip: formula-like text kept as text' $back.Rows[0][3] '=1+1'
  $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
  try {
    $sheetXml = Read-ZipText $zip 'xl/worksheets/sheet1.xml'
    $workbookXml = Read-ZipText $zip 'xl/workbook.xml'
  } finally { $zip.Dispose() }
  Check 'no formula is ever written' ($sheetXml -notmatch '<f>')
  Check 'a number is stored as a number' ($sheetXml -match '<v>1234.5</v>')
  Check 'a sheet name loses the characters Excel refuses' ($workbookXml -match 'name="Data  one two"')
  Check 'the header row is frozen and filtered' ($sheetXml -match 'state="frozen"' -and $sheetXml -match '<autoFilter')

  # --- The scripts, start to finish -------------------------------------------------------------
  Write-Host 'Scripts'
  $exe = (Get-Process -Id $PID).Path
  $before = Join-Path $work 'before.csv'
  $after = Join-Path $work 'after.csv'
  Copy-Item (Join-Path $fixtures 'before.csv') $before
  Copy-Item (Join-Path $fixtures 'after.csv') $after
  (Get-Item $before).LastWriteTime = (Get-Date).AddHours(-2)
  (Get-Item $after).LastWriteTime = (Get-Date).AddHours(-1)
  $hashes = @((Get-FileHash $before).Hash, (Get-FileHash $after).Hash)

  $run = {
    param([string]$Script, [string[]]$Arguments)
    $output = & $exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts $Script) -Folder $work -NoOpen @Arguments 2>&1
    $code = $LASTEXITCODE
    Check "$Script finishes" ($code -eq 0) (($output | Out-String).Trim())
    return $code
  }
  $latest = {
    param([string]$Title)
    $file = Get-ChildItem (Join-Path $work 'Results') -Filter "$Title *.xlsx" | Sort-Object LastWriteTime | Select-Object -Last 1
    if (-not $file) { Check "$Title made a result" $false; return $null }
    return $file
  }
  $sheet = { param($File, [string]$Name) Read-Table $File -Sheet $Name }

  [void](& $run 'Compare-Files.ps1' @('-Key', 'Account'))
  $f = & $latest 'Compare'
  if ($f) {
    $o = & $sheet $f 'B with changes'
    Same 'compare: status of every row' (($o.Rows | ForEach-Object { "$($_[1])=$($_[0])" }) -join ' ') '1001=Changed 1002=Changed 1003=Changed 1006=New 1004=Removed 1005=Removed'
    Same 'compare: four changed cells' (& $sheet $f 'Changed cells').Rows.Count 4
  }

  [void](& $run 'Match-Names.ps1' @('-ColumnA', 'Name', '-ColumnB', 'Name', '-Threshold', '85'))
  $f = & $latest 'Match names'
  if ($f) {
    $m = & $sheet $f 'B matched to A'
    $verdict = Get-ColumnIndex $m 'Verdict'
    Same 'match: accents, company words and word order' (($m.Rows | ForEach-Object { $_[$verdict] }) -join '|') 'Match|Match|Match|No match'
    Same 'match: A rows never found' (& $sheet $f 'In A, not matched').Rows.Count 2
    Same 'match: fills in from A' $m.Rows[0][(Get-ColumnIndex $m 'A: Since')] '05.11.2026'
  }

  [void](& $run 'Find-Duplicates.ps1' @('-Column', 'Name', '-Threshold', '90'))
  $f = & $latest 'Duplicates'
  if ($f) {
    Same 'duplicates: one pair in A' (((& $sheet $f 'before.csv').Rows | ForEach-Object { $_[4] }) -join '|') 'Anna Svensson|Anna Svenson'
    Same 'duplicates: none in B' (& $sheet $f 'after.csv').Rows.Count 0
  }

  [void](& $run 'Combine-Files.ps1' @())
  $f = & $latest 'Combined'
  if ($f) {
    $c = & $sheet $f 'Combined'
    Same 'combine: every row' $c.Rows.Count 9
    Same 'combine: columns from both' ($c.Headers -join '|') 'Source file|Account|Name|Shares|Email|Since|City'
  }

  [void](& $run 'Clean-Files.ps1' @())
  $f = & $latest 'Cleaned'
  if ($f) {
    $c = & $sheet $f 'before.csv'
    Same 'clean: a day.month.year date' $c.Rows[0][4] '2026-11-05'
    Same 'clean: a number with a space' $c.Rows[1][2] '50000'
    Same 'clean: a space at the end' $c.Rows[3][3] 'anna@example.com'
    Same 'clean: the other file too' (& $sheet $f 'after.csv').Rows[0][2] '1200'
  }

  [void](& $run 'Split-ByColumn.ps1' @('-Column', 'City'))
  $f = & $latest 'Split by City'
  if ($f) { Same 'split: a sheet per city' (& $sheet $f 'Counts').Rows.Count 4 }

  Same 'the two files are exactly as they were' ((Get-FileHash $before).Hash + (Get-FileHash $after).Hash) ($hashes -join '')

  # One file only: Compare stops with a message, and makes nothing.
  $lonely = Join-Path $work 'lonely'
  New-Item -ItemType Directory -Path $lonely | Out-Null
  Copy-Item (Join-Path $fixtures 'before.csv') $lonely
  $null = & $exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $scripts 'Compare-Files.ps1') -Folder $lonely -NoOpen -Key Account 2>&1
  Check 'compare with one file stops' ($LASTEXITCODE -eq 1)
  Check 'and writes nothing' (-not (Test-Path (Join-Path $lonely 'Results')))
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# --- Safety ----------------------------------------------------------------------------------
Write-Host 'Safety'
$library = Split-Path -Parent $here
$shipped = Get-ChildItem $library -Recurse -File -Include *.ps1, *.cmd | Where-Object { $_.FullName -notlike "$here*" }
$forbidden = 'Invoke-WebRequest', 'Invoke-RestMethod', 'WebClient', 'HttpClient', 'Start-BitsTransfer', 'Download(String|File|Data)',
'Invoke-Expression', '\biex\b', 'Net\.Sockets', '-ComObject', 'Remove-Item', 'Set-Content', 'Out-File', 'Start-Process', 'Invoke-Command', 'Enter-PSSession'
foreach ($file in $shipped) {
  $text = Get-Content -LiteralPath $file.FullName -Raw
  $hits = @($forbidden | Where-Object { $text -match $_ })
  Check "$($file.Name) has no network, delete, overwrite or remote command" ($hits.Count -eq 0) ($hits -join ', ')
}
$compiled = @($shipped | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'Add-Type -Language' })
Same 'compiled code lives in one place only' (($compiled | ForEach-Object { $_.Name }) -join ',') 'Sheets.Common.ps1'

Write-Host ''
Write-Host "$script:passes passed, $script:failures failed"
if ($script:failures -gt 0) { exit 1 }
exit 0
