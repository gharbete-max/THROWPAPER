<#
.SYNOPSIS
  Match the rows of one list to another when the names are not spelled the same.

.DESCRIPTION
  Takes the two newest spreadsheets in the folder. Every row of the newer one (B) is matched to the
  closest row of the older one (A) on a column you choose, by edit distance (Levenshtein), after
  accents, punctuation, word order and words like "AB (publ)" are set aside. So "Öberg, Åsa" meets
  "Asa Oberg", and "Volvo AB (publ)" meets "Volvo".

  Each B row gets its best match, a score from 0 to 100 and a verdict, followed by the matched A
  row's other columns, which fills B in from A the way a lookup would. A row is never matched by a
  silent guess: when two A rows are almost as close, it says Check.

.EXAMPLE
  .\Match-Names.ps1 -ColumnA "Name" -ColumnB "Shareholder" -Threshold 85
#>
param(
  # The column to match on in A (the older file). Asked for when left out.
  [string]$ColumnA,
  # The column to match on in B (the newer file). Asked for when left out.
  [string]$ColumnB,
  # How alike two values must be to count as a match, 1 to 100. Asked for when left out (85).
  [int]$Threshold,
  [switch]$NoOpen,
  [string]$Folder
)
. (Join-Path $PSScriptRoot 'Sheets.Common.ps1')

Invoke-Safely {
  Use-Folder $Folder
  Write-Host 'Match names that are spelled differently'
  $files = Get-NewestFiles -Count 2
  Write-Picked $files
  $a = Read-Table $files[0]
  $b = Read-Table $files[1]

  $colB = Select-Column $b.Headers 'Which column in B holds the names to look up?' $b.Headers[0] $ColumnB
  $sameName = if ((Get-ColumnIndex $a $colB) -ge 0) { $a.Headers[(Get-ColumnIndex $a $colB)] } else { $a.Headers[0] }
  $colA = Select-Column $a.Headers 'Which column in A should they be found in?' $sameName $ColumnA
  $threshold = Read-Number 'How alike must they be to count as a match, 1 to 100?' 85 $Threshold

  $ia = Get-ColumnIndex $a $colA
  $ib = Get-ColumnIndex $b $colB
  $keysA = New-MatchKeys (Get-ColumnValues $a $ia)
  $keysB = New-MatchKeys (Get-ColumnValues $b $ib)
  Write-SpeedNote ([long]$a.Rows.Count * $b.Rows.Count)

  # Exact matches (after preparing) first, in a table: most rows of a real list are exact.
  $exact = @{}
  for ($i = 0; $i -lt $keysA.Text.Count; $i++) {
    $t = $keysA.Text[$i]
    if ($t -ne '' -and -not $exact.ContainsKey($t)) { $exact[$t] = $i }
  }

  # A's other columns follow the verdict, named so they cannot be mistaken for B's.
  $extra = @()
  for ($c = 0; $c -lt $a.Headers.Count; $c++) { if ($c -ne $ia) { $extra += $c } }
  $headers = @($b.Headers) + @("Match in A ($colA)", 'Score', 'Verdict') + @($extra | ForEach-Object { "A: $($a.Headers[$_])" })

  $rows = New-Object 'System.Collections.Generic.List[object]'
  $used = New-Object bool[] $a.Rows.Count
  $tally = @{ Match = 0; Likely = 0; Check = 0; None = 0 }
  # A runner-up this close is too close to choose between without a person.
  $tie = 3
  $floor = [Math]::Max($threshold - 10, 1)

  for ($r = 0; $r -lt $b.Rows.Count; $r++) {
    if ($r % 200 -eq 0) { Write-Progress -Activity 'Matching' -Status "$r of $($b.Rows.Count)" -PercentComplete (100 * $r / [Math]::Max($b.Rows.Count, 1)) }
    $text = $keysB.Text[$r]
    $best = -1; $score = 0; $second = -1
    if ($text -ne '' -and $exact.ContainsKey($text)) {
      $best = $exact[$text]; $score = 100
      # Two A rows with the same name are still a choice a person must make.
      for ($i = 0; $i -lt $keysA.Text.Count; $i++) { if ($i -ne $best -and $keysA.Text[$i] -eq $text) { $second = 100; break } }
    } elseif ($text -ne '') {
      $two = Get-BestTwo $text $keysB.Sorted[$r] $keysA $floor
      $best = $two[0]; $score = [Math]::Max($two[1], 0); $second = $two[3]
    }

    if ($best -lt 0 -or $score -lt $floor) { $verdict = 'No match'; $style = $script:Style.Removed; $tally.None++; $best = -1 }
    elseif ($second -ge 0 -and $score - $second -lt $tie) { $verdict = 'Check: more than one is close'; $style = $script:Style.Changed; $tally.Check++ }
    elseif ($score -lt $threshold) { $verdict = 'Check: not very alike'; $style = $script:Style.Changed; $tally.Check++ }
    elseif ($score -eq 100) { $verdict = 'Match'; $style = $script:Style.Added; $tally.Match++ }
    else { $verdict = 'Likely match'; $style = $script:Style.Added; $tally.Likely++ }

    $cells = New-Object 'System.Collections.Generic.List[object]'
    foreach ($v in $b.Rows[$r]) { $cells.Add($v) }
    if ($best -ge 0) {
      if ($style -ne $script:Style.Changed) { $used[$best] = $true }
      $cells.Add(@{ v = $a.Rows[$best][$ia]; s = $style })
      $cells.Add(@{ v = [string]$score; s = $style })
      $cells.Add(@{ v = $verdict; s = $style })
      foreach ($c in $extra) { $cells.Add($a.Rows[$best][$c]) }
    } else {
      $cells.Add(@{ v = ''; s = $style }); $cells.Add(@{ v = ''; s = $style }); $cells.Add(@{ v = $verdict; s = $style })
    }
    $rows.Add($cells.ToArray())
  }
  Write-Progress -Activity 'Matching' -Completed

  # Who in A was never found: often the more useful list.
  $missing = New-Object 'System.Collections.Generic.List[object]'
  for ($i = 0; $i -lt $a.Rows.Count; $i++) { if (-not $used[$i]) { $missing.Add($a.Rows[$i]) } }

  $summary = New-Object 'System.Collections.Generic.List[object]'
  $summary.Add(@('A (looked in)', "$($a.Name), column $colA"))
  $summary.Add(@('B (looked up)', "$($b.Name), column $colB"))
  $summary.Add(@('Counts as a match from', "$threshold of 100"))
  $summary.Add(@(@{ v = 'Match'; s = $script:Style.Added }, [string]$tally.Match))
  $summary.Add(@(@{ v = 'Likely match'; s = $script:Style.Added }, [string]$tally.Likely))
  $summary.Add(@(@{ v = 'Check by hand'; s = $script:Style.Changed }, [string]$tally.Check))
  $summary.Add(@(@{ v = 'No match'; s = $script:Style.Removed }, [string]$tally.None))
  $summary.Add(@('Rows in A never matched', [string]$missing.Count))
  $summary.Add(@('How it compares', 'Lower case, accents and punctuation removed, words in any order, company words such as AB, publ, Ltd, Inc ignored; score = 100 x (1 - edit distance / length).'))

  $path = Write-Workbook 'Match names' @(
    @{ Name = 'B matched to A'; Headers = $headers; Rows = $rows },
    @{ Name = 'In A, not matched'; Headers = $a.Headers; Rows = $missing },
    @{ Name = 'Summary'; Headers = @('What', 'Count'); Rows = $summary }
  )
  Write-Host ("  Match {0}, likely {1}, check {2}, no match {3}." -f $tally.Match, $tally.Likely, $tally.Check, $tally.None)
  Write-Done $path -NoOpen:$NoOpen
}
