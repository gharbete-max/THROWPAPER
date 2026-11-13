<#
  Shared by every script in this folder. Dot-sourced, never run on its own.

  What this file promises, and tests/Test-Sheets.ps1 checks:
  - It only reads the files it is given. Results are new files in the Results folder.
  - It never touches the network, never starts Excel, never runs a macro or a formula.
  - It runs on Windows PowerShell 5.1 (every Windows 10 and 11) and on PowerShell 7.
#>

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# The folder the person works in: the one that holds the launchers, one level above scripts\.
$script:WorkFolder = Split-Path -Parent $PSScriptRoot
$script:ResultsFolder = Join-Path $script:WorkFolder 'Results'

# Nothing larger than this is unpacked from an .xlsx: a guard against a file built to fill the disk.
$script:MaxPartBytes = 512MB

# ---------------------------------------------------------------------------------------------
# Finding the two files
# ---------------------------------------------------------------------------------------------

<#
  The two newest spreadsheets in the folder, by when they were last saved or downloaded.
  The older one is A ("before"), the newer one is B ("after"). Excel's own lock files (~$...)
  and anything in Results are never picked.
#>
<#
  Points the scripts at another folder than their own (tests use it; so can anyone with -Folder).
#>
function Use-Folder {
  param([string]$Folder)
  if (-not $Folder) { return }
  $script:WorkFolder = (Resolve-Path -LiteralPath $Folder).Path
  $script:ResultsFolder = Join-Path $script:WorkFolder 'Results'
}

function Get-NewestFiles {
  param([int]$Count = 2, [switch]$AllowFewer, [string]$Folder = $script:WorkFolder)
  $files = @(Get-ChildItem -LiteralPath $Folder -File |
      Where-Object { $_.Extension -match '^\.(xlsx|xlsm|csv|txt)$' -and $_.Name -notlike '~$*' } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First $Count)
  if ($files.Count -eq 0 -or ($files.Count -lt $Count -and -not $AllowFewer)) {
    $need = if ($Count -eq 1) { 'one spreadsheet (.xlsx or .csv)' } else { "$Count spreadsheets (.xlsx or .csv)" }
    throw "Put $need in this folder first: $Folder"
  }
  # Oldest first: A, then B. The comma keeps a single file an array (PowerShell unwraps one item).
  return , @($files | Sort-Object LastWriteTime)
}

function Write-Picked {
  param($Files)
  $letters = 'A', 'B'
  for ($i = 0; $i -lt $Files.Count; $i++) {
    $label = if ($Files.Count -eq 1) { 'File' } else { $letters[$i] }
    Write-Host ("  {0}: {1}  (saved {2:yyyy-MM-dd HH:mm})" -f $label, $Files[$i].Name, $Files[$i].LastWriteTime)
  }
}

# ---------------------------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------------------------

<#
  A table: @{ Name; Headers = string[]; Rows = List of string[] }. Every value is text, exactly as
  the file shows it (dates as yyyy-MM-dd). The header row is the first row with anything in it.
#>
function Read-Table {
  param([Parameter(Mandatory)] [System.IO.FileInfo]$File, [string]$Sheet)
  $grid = if ($File.Extension -match '^\.xls[xm]$') { Read-XlsxGrid $File.FullName $Sheet } else { Read-CsvGrid $File.FullName }
  $start = 0
  while ($start -lt $grid.Count -and -not (Test-RowHasValue $grid[$start])) { $start++ }
  if ($start -ge $grid.Count) { throw "$($File.Name) is empty." }

  $width = 0
  foreach ($row in $grid) { if ($row.Count -gt $width) { $width = $row.Count } }
  $headers = New-Object string[] $width
  $seen = @{}
  for ($c = 0; $c -lt $width; $c++) {
    $name = ''
    if ($c -lt $grid[$start].Count) { $name = ([string]$grid[$start][$c]).Trim() }
    if ($name -eq '') { $name = "Column $(ConvertTo-ColumnLetters ($c + 1))" }
    # Two columns with one name would be indistinguishable later: number the repeats.
    $base = $name; $n = 2
    while ($seen.ContainsKey($name.ToLowerInvariant())) { $name = "$base ($n)"; $n++ }
    $seen[$name.ToLowerInvariant()] = $true
    $headers[$c] = $name
  }

  $rows = New-Object 'System.Collections.Generic.List[string[]]'
  for ($r = $start + 1; $r -lt $grid.Count; $r++) {
    if (-not (Test-RowHasValue $grid[$r])) { continue }
    $cells = New-Object string[] $width
    for ($c = 0; $c -lt $width; $c++) {
      $cells[$c] = if ($c -lt $grid[$r].Count -and $null -ne $grid[$r][$c]) { [string]$grid[$r][$c] } else { '' }
    }
    $rows.Add($cells)
  }
  return @{ Name = $File.Name; Headers = $headers; Rows = $rows }
}

function Test-RowHasValue {
  param($Row)
  foreach ($v in $Row) { if ($null -ne $v -and ([string]$v).Trim() -ne '') { return $true } }
  return $false
}

function New-SafeXml {
  param([string]$Text)
  # No DTDs and no resolver: an .xlsx can never make this reach out to a file or a URL.
  $settings = New-Object System.Xml.XmlReaderSettings
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $reader = [System.Xml.XmlReader]::Create((New-Object System.IO.StringReader $Text), $settings)
  try {
    $doc = New-Object System.Xml.XmlDocument
    $doc.XmlResolver = $null
    $doc.Load($reader)
    return , $doc
  } finally { $reader.Dispose() }
}

function Read-ZipText {
  param($Zip, [string]$Path)
  $entry = $Zip.GetEntry($Path)
  if ($null -eq $entry) { return $null }
  if ($entry.Length -gt $script:MaxPartBytes) { throw "A part of this file is too large to read safely: $Path" }
  $stream = $entry.Open()
  try {
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
    return $reader.ReadToEnd()
  } finally { $stream.Dispose() }
}

function Read-XlsxGrid {
  param([string]$Path, [string]$Sheet)
  # Opened for reading and shared, so a file still open in Excel can be read and is never changed.
  $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
  $zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Read)
  try {
    $ns = @{ m = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'; r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' }
    $workbook = New-SafeXml (Read-ZipText $zip 'xl/workbook.xml')
    $sheets = @(Select-Xml -Xml $workbook -XPath '//m:sheets/m:sheet' -Namespace $ns | ForEach-Object { $_.Node })
    if ($sheets.Count -eq 0) { throw 'The workbook has no sheets.' }
    $chosen = $sheets[0]
    if ($Sheet) {
      $chosen = $sheets | Where-Object { $_.GetAttribute('name') -eq $Sheet } | Select-Object -First 1
      if (-not $chosen) { throw "No sheet called '$Sheet'. The sheets are: $(($sheets | ForEach-Object { $_.GetAttribute('name') }) -join ', ')" }
    }
    $rid = $chosen.GetAttribute('id', $ns.r)
    $rels = New-SafeXml (Read-ZipText $zip 'xl/_rels/workbook.xml.rels')
    $target = $null
    foreach ($rel in $rels.DocumentElement.ChildNodes) {
      if ($rel.NodeType -eq 'Element' -and $rel.GetAttribute('Id') -eq $rid) { $target = $rel.GetAttribute('Target') }
    }
    if (-not $target) { throw 'The workbook does not say where its sheet is.' }
    $sheetPath = if ($target.StartsWith('/')) { $target.TrimStart('/') } else { 'xl/' + $target }

    $shared = New-Object 'System.Collections.Generic.List[string]'
    $sstText = Read-ZipText $zip 'xl/sharedStrings.xml'
    if ($sstText) {
      $sst = New-SafeXml $sstText
      foreach ($si in $sst.DocumentElement.ChildNodes) {
        if ($si.NodeType -ne 'Element') { continue }
        # A rich string is several runs; phonetic guides (rPh) are not part of the text.
        $text = ''
        foreach ($t in $si.SelectNodes('.//*[local-name()="t" and not(ancestor::*[local-name()="rPh"])]')) { $text += $t.InnerText }
        $shared.Add($text)
      }
    }

    $dateStyles = Get-DateStyles $zip
    $xml = New-SafeXml (Read-ZipText $zip $sheetPath)
    $grid = New-Object 'System.Collections.Generic.List[object]'
    $rowNodes = $xml.DocumentElement.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]')
    $expected = 1
    foreach ($rowNode in $rowNodes) {
      $rowNumber = if ($rowNode.GetAttribute('r')) { [int]$rowNode.GetAttribute('r') } else { $expected }
      while ($expected -lt $rowNumber) { $grid.Add(@()); $expected++ }
      $cells = New-Object 'System.Collections.Generic.List[string]'
      $next = 0
      foreach ($c in $rowNode.ChildNodes) {
        if ($c.LocalName -ne 'c') { continue }
        $col = if ($c.GetAttribute('r')) { (ConvertFrom-ColumnLetters ($c.GetAttribute('r') -replace '\d', '')) - 1 } else { $next }
        while ($cells.Count -lt $col) { $cells.Add('') }
        $cells.Add((Get-CellText $c $shared $dateStyles))
        $next = $col + 1
      }
      $grid.Add($cells.ToArray())
      $expected = $rowNumber + 1
    }
    return , $grid
  } finally { $zip.Dispose(); $fs.Dispose() }
}

function Get-CellText {
  param($Cell, $Shared, $DateStyles)
  $type = $Cell.GetAttribute('t')
  $v = $null
  foreach ($child in $Cell.ChildNodes) { if ($child.LocalName -eq 'v') { $v = $child.InnerText } }
  switch ($type) {
    's' { if ($null -ne $v) { return $Shared[[int]$v] } else { return '' } }
    'inlineStr' {
      $text = ''
      foreach ($t in $Cell.SelectNodes('.//*[local-name()="t"]')) { $text += $t.InnerText }
      return $text
    }
    'b' { if ($v -eq '1') { return 'TRUE' } else { return 'FALSE' } }
    'str' { if ($null -ne $v) { return $v } else { return '' } }
    'e' { if ($null -ne $v) { return $v } else { return '' } }
    default {
      if ($null -eq $v) { return '' }
      $style = $Cell.GetAttribute('s')
      if ($style -and $DateStyles.ContainsKey([int]$style)) {
        $serial = 0.0
        if ([double]::TryParse($v, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$serial)) {
          return ConvertFrom-ExcelDate $serial
        }
      }
      return $v
    }
  }
}

function ConvertFrom-ExcelDate {
  param([double]$Serial)
  # Serial 60 is the 29 February 1900 that never was; Excel counts it, so dates after it shift by one.
  # Rounded to the second: a stored 14:30 is 0.6041666… of a day, and adding it as days gives 14:29:59.
  $date = [DateTime]::new(1899, 12, 30).AddSeconds([Math]::Round($Serial * 86400))
  if ([Math]::Abs($Serial - [Math]::Floor($Serial)) -lt 1e-9) { return $date.ToString('yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture) }
  return $date.ToString('yyyy-MM-dd HH:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture)
}

# The cell styles whose number format is a date or a time.
function Get-DateStyles {
  param($Zip)
  $result = @{}
  $text = Read-ZipText $Zip 'xl/styles.xml'
  if (-not $text) { return $result }
  $styles = New-SafeXml $text
  $custom = @{}
  foreach ($f in $styles.SelectNodes('//*[local-name()="numFmts"]/*[local-name()="numFmt"]')) {
    $custom[[int]$f.GetAttribute('numFmtId')] = $f.GetAttribute('formatCode')
  }
  $index = 0
  foreach ($xf in $styles.SelectNodes('//*[local-name()="cellXfs"]/*[local-name()="xf"]')) {
    $id = [int]$xf.GetAttribute('numFmtId')
    $isDate = ($id -ge 14 -and $id -le 22) -or ($id -ge 45 -and $id -le 47)
    if (-not $isDate -and $custom.ContainsKey($id)) {
      # Strip quoted text, escapes and [colour]/[$-locale] parts, then look for day, month or year.
      $code = $custom[$id] -replace '"[^"]*"', '' -replace '\\.', '' -replace '\[[^\]]*\]', ''
      $isDate = $code -match '[dDyY]' -or ($code -match 'm' -and $code -match '[hHsS]')
    }
    if ($isDate) { $result[$index] = $true }
    $index++
  }
  return $result
}

function Read-CsvGrid {
  param([string]$Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $text = ConvertFrom-UnknownEncoding $bytes
  $delimiter = Get-CsvDelimiter $text
  return , (ConvertFrom-CsvText $text $delimiter)
}

<#
  UTF-8 when the bytes are valid UTF-8 (with or without a byte-order mark), otherwise Windows-1252,
  which is what Excel in Sweden writes when it saves "CSV (semicolon delimited)".
#>
function ConvertFrom-UnknownEncoding {
  param([byte[]]$Bytes)
  if ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF) {
    return [System.Text.Encoding]::UTF8.GetString($Bytes, 3, $Bytes.Length - 3)
  }
  if ($Bytes.Length -ge 2 -and $Bytes[0] -eq 0xFF -and $Bytes[1] -eq 0xFE) {
    return [System.Text.Encoding]::Unicode.GetString($Bytes, 2, $Bytes.Length - 2)
  }
  try {
    $strict = New-Object System.Text.UTF8Encoding($false, $true)
    return $strict.GetString($Bytes)
  } catch {
    return [System.Text.Encoding]::GetEncoding(1252).GetString($Bytes)
  }
}

function Get-CsvDelimiter {
  param([string]$Text)
  $line = ($Text -split "`r?`n", 2)[0]
  $outside = $line -replace '"[^"]*"', ''
  $best = ','; $bestCount = -1
  foreach ($d in ';', ',', "`t", '|') {
    $count = @($outside.ToCharArray() | Where-Object { $_ -eq $d }).Count
    if ($count -gt $bestCount) { $best = $d; $bestCount = $count }
  }
  return $best
}

# RFC 4180: quoted fields, doubled quotes, line breaks inside quotes.
function ConvertFrom-CsvText {
  param([string]$Text, [string]$Delimiter)
  $grid = New-Object 'System.Collections.Generic.List[object]'
  $row = New-Object 'System.Collections.Generic.List[string]'
  $field = New-Object System.Text.StringBuilder
  $inQuotes = $false
  $d = [char]$Delimiter
  $i = 0; $n = $Text.Length
  while ($i -lt $n) {
    $ch = $Text[$i]
    if ($inQuotes) {
      if ($ch -eq '"') {
        if ($i + 1 -lt $n -and $Text[$i + 1] -eq '"') { [void]$field.Append('"'); $i++ }
        else { $inQuotes = $false }
      } else { [void]$field.Append($ch) }
    } elseif ($ch -eq '"') { $inQuotes = $true }
    elseif ($ch -eq $d) { $row.Add($field.ToString()); [void]$field.Clear() }
    elseif ($ch -eq "`r") { }
    elseif ($ch -eq "`n") {
      $row.Add($field.ToString()); [void]$field.Clear()
      $grid.Add($row.ToArray()); $row.Clear()
    } else { [void]$field.Append($ch) }
    $i++
  }
  if ($field.Length -gt 0 -or $row.Count -gt 0) { $row.Add($field.ToString()); $grid.Add($row.ToArray()) }
  return , $grid
}

function ConvertFrom-ColumnLetters {
  param([string]$Letters)
  $n = 0
  foreach ($ch in $Letters.ToUpperInvariant().ToCharArray()) { $n = $n * 26 + ([int]$ch - 64) }
  return $n
}

function ConvertTo-ColumnLetters {
  param([int]$Number)
  $s = ''
  while ($Number -gt 0) { $m = ($Number - 1) % 26; $s = [char](65 + $m) + $s; $Number = [int][Math]::Floor(($Number - 1) / 26) }
  return $s
}

# ---------------------------------------------------------------------------------------------
# Writing: a plain .xlsx built here, so Excel does not need to be installed
# ---------------------------------------------------------------------------------------------

# Cell styles, by number. A cell in a sheet row is a string, or @{ v = 'text'; s = <style> }.
$script:Style = @{ Normal = 0; Header = 1; Added = 2; Changed = 3; Removed = 4; Bold = 5 }

<#
  Writes a workbook to Results\<Title> <date time>.xlsx and returns its path.
  $Sheets: array of @{ Name; Headers = string[]; Rows = list of arrays }. Every sheet gets a bold,
  frozen header row, filters and fitted column widths. Values are always written as text or plain
  numbers, never as formulas, so nothing in a result can run when it is opened.
#>
function Write-Workbook {
  param([Parameter(Mandatory)] [string]$Title, [Parameter(Mandatory)] [object[]]$Sheets)
  if (-not (Test-Path -LiteralPath $script:ResultsFolder)) { New-Item -ItemType Directory -Path $script:ResultsFolder | Out-Null }
  $stamp = Get-Date -Format 'yyyy-MM-dd HHmmss'
  $path = Join-Path $script:ResultsFolder ("{0} {1}.xlsx" -f $Title, $stamp)

  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $zip = [System.IO.Compression.ZipFile]::Open($path, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $put = {
      param($name, $content)
      $entry = $zip.CreateEntry($name)
      $w = New-Object System.IO.StreamWriter($entry.Open(), $utf8)
      try { $w.Write($content) } finally { $w.Dispose() }
    }
    $sheetEntries = ''; $relEntries = ''; $overrides = ''
    $names = @{}
    for ($i = 0; $i -lt $Sheets.Count; $i++) {
      $n = $i + 1
      $name = Get-SafeSheetName $Sheets[$i].Name $names
      $sheetEntries += "<sheet name=`"$(ConvertTo-XmlText $name)`" sheetId=`"$n`" r:id=`"rId$n`"/>"
      $relEntries += "<Relationship Id=`"rId$n`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet`" Target=`"worksheets/sheet$n.xml`"/>"
      $overrides += "<Override PartName=`"/xl/worksheets/sheet$n.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml`"/>"
      & $put "xl/worksheets/sheet$n.xml" (ConvertTo-SheetXml $Sheets[$i])
    }
    $styleN = $Sheets.Count + 1
    & $put '[Content_Types].xml' ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + $overrides + '</Types>')
    & $put '_rels/.rels' '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    & $put 'xl/workbook.xml' ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + $sheetEntries + '</sheets></workbook>')
    & $put 'xl/_rels/workbook.xml.rels' ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + $relEntries + "<Relationship Id=`"rId$styleN`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles`" Target=`"styles.xml`"/></Relationships>")
    # Fills: 0 none, 1 gray125 (both required), 2 grey header, 3 green, 4 yellow, 5 red.
    & $put 'xl/styles.xml' ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0" applyFill="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>')
  } finally { $zip.Dispose() }
  return $path
}

function Get-SafeSheetName {
  param([string]$Name, [hashtable]$Taken)
  $clean = ($Name -replace '[\[\]\:\*\?\/\\]', ' ').Trim().Trim("'")
  if ($clean -eq '') { $clean = 'Sheet' }
  if ($clean.Length -gt 31) { $clean = $clean.Substring(0, 31) }
  $base = $clean; $n = 2
  while ($Taken.ContainsKey($clean.ToLowerInvariant())) {
    $suffix = " ($n)"; $clean = $base.Substring(0, [Math]::Min($base.Length, 31 - $suffix.Length)) + $suffix; $n++
  }
  $Taken[$clean.ToLowerInvariant()] = $true
  return $clean
}

function ConvertTo-XmlText {
  param([string]$Text)
  # Characters XML 1.0 cannot carry are dropped; everything else is escaped.
  $clean = [regex]::Replace($Text, '[^\u0009\u000A\u000D -퟿-�]', '')
  return [System.Security.SecurityElement]::Escape($clean)
}

# A plain number Excel can sum: no leading zeros (an ID such as 00123 stays text), no exponent.
$script:PlainNumber = '^-?(0|[1-9]\d{0,14})(\.\d+)?$'

function ConvertTo-SheetXml {
  param($Sheet)
  $headers = @($Sheet.Headers)
  $width = $headers.Count
  $widths = New-Object int[] ([Math]::Max($width, 1))
  $sb = New-Object System.Text.StringBuilder
  $rowXml = {
    param([int]$r, $cells, [int]$defaultStyle)
    [void]$sb.Append("<row r=`"$r`">")
    for ($c = 0; $c -lt $cells.Count; $c++) {
      $cell = $cells[$c]
      $value = ''; $style = $defaultStyle
      if ($cell -is [hashtable]) { $value = [string]$cell.v; if ($cell.ContainsKey('s')) { $style = [int]$cell.s } }
      elseif ($null -ne $cell) { $value = [string]$cell }
      $ref = (ConvertTo-ColumnLetters ($c + 1)) + $r
      $sAttr = if ($style -ne 0) { " s=`"$style`"" } else { '' }
      if ($c -lt $widths.Length -and $value.Length -gt $widths[$c]) { $widths[$c] = $value.Length }
      if ($value -eq '') {
        if ($style -ne 0) { [void]$sb.Append("<c r=`"$ref`"$sAttr/>") }
      } elseif ($r -gt 1 -and $value -match $script:PlainNumber) {
        [void]$sb.Append("<c r=`"$ref`"$sAttr><v>$value</v></c>")
      } else {
        [void]$sb.Append("<c r=`"$ref`"$sAttr t=`"inlineStr`"><is><t xml:space=`"preserve`">$(ConvertTo-XmlText $value)</t></is></c>")
      }
    }
    [void]$sb.Append('</row>')
  }
  & $rowXml 1 $headers $script:Style.Header
  $r = 2
  foreach ($row in $Sheet.Rows) { & $rowXml $r @($row) 0; $r++ }
  $last = $r - 1

  $cols = ''
  for ($c = 0; $c -lt $widths.Length; $c++) {
    $w = [Math]::Min([Math]::Max($widths[$c] + 2, 8), 60)
    $cols += "<col min=`"$($c + 1)`" max=`"$($c + 1)`" width=`"$w`" customWidth=`"1`"/>"
  }
  $lastCol = ConvertTo-ColumnLetters ([Math]::Max($width, 1))
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    "<dimension ref=`"A1:$lastCol$last`"/>" +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    "<cols>$cols</cols><sheetData>" + $sb.ToString() + '</sheetData>' +
    "<autoFilter ref=`"A1:$lastCol$last`"/></worksheet>"
}

# ---------------------------------------------------------------------------------------------
# Comparing text
# ---------------------------------------------------------------------------------------------

# Levenshtein in compiled code when the computer allows it (about 100 times faster), else in
# PowerShell. Some managed computers forbid compiling; the results are the same either way, and
# tests/Test-Sheets.ps1 checks that they are.
$script:FastText = $false
try {
  if (-not ('SheetsLibrary.Text' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
namespace SheetsLibrary {
  public static class Text {
    // The edit distance, or max + 1 as soon as it is certain to exceed max.
    public static int Distance(string a, string b, int max) {
      if (a == b) return 0;
      if (System.Math.Abs(a.Length - b.Length) > max) return max + 1;
      int[] prev = new int[b.Length + 1], cur = new int[b.Length + 1];
      for (int j = 0; j <= b.Length; j++) prev[j] = j;
      for (int i = 1; i <= a.Length; i++) {
        cur[0] = i; int rowMin = i;
        for (int j = 1; j <= b.Length; j++) {
          int cost = a[i - 1] == b[j - 1] ? 0 : 1;
          int v = System.Math.Min(System.Math.Min(prev[j] + 1, cur[j - 1] + 1), prev[j - 1] + cost);
          cur[j] = v; if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        int[] t = prev; prev = cur; cur = t;
      }
      return prev[b.Length];
    }

    public static int Similarity(string aText, string aSorted, string bText, string bSorted, int atLeast) {
      if (aText.Length == 0 && bText.Length == 0) return 100;
      if (aText.Length == 0 || bText.Length == 0) return 0;
      if (aText == bText || aSorted == bSorted) return 100;
      int len = System.Math.Max(aText.Length, bText.Length);
      int max = (int)System.Math.Floor(len * (100 - atLeast) / 100.0);
      int d = System.Math.Min(Distance(aText, bText, max), Distance(aSorted, bSorted, max));
      return (int)System.Math.Floor(100.0 * (1 - (double)d / len));
    }

    // { best index, best score, runner-up index, runner-up score }, -1 where there is none.
    public static int[] BestTwo(string text, string sorted, string[] texts, string[] sorteds, int atLeast) {
      int[] r = new int[] { -1, -1, -1, -1 };
      for (int i = 0; i < texts.Length; i++) {
        int s = Similarity(text, sorted, texts[i], sorteds[i], atLeast);
        if (s < atLeast) continue;
        if (s > r[1]) { r[2] = r[0]; r[3] = r[1]; r[0] = i; r[1] = s; }
        else if (s > r[3]) { r[2] = i; r[3] = s; }
      }
      return r;
    }

    // Every pair i < j at least that alike, as flat triples i, j, score.
    public static int[] Pairs(string[] texts, string[] sorteds, int atLeast) {
      System.Collections.Generic.List<int> r = new System.Collections.Generic.List<int>();
      for (int i = 0; i < texts.Length; i++) {
        if (texts[i].Length == 0) continue;
        for (int j = i + 1; j < texts.Length; j++) {
          int s = Similarity(texts[i], sorteds[i], texts[j], sorteds[j], atLeast);
          if (s >= atLeast) { r.Add(i); r.Add(j); r.Add(s); }
        }
      }
      return r.ToArray();
    }
  }
}
'@
  }
  $script:FastText = $true
} catch {
  $script:FastText = $false
}

function Get-EditDistance {
  param([string]$A, [string]$B, [int]$Max = [int]::MaxValue - 1)
  if ($script:FastText) { return [SheetsLibrary.Text]::Distance($A, $B, $Max) }
  if ($A -ceq $B) { return 0 }
  if ([Math]::Abs($A.Length - $B.Length) -gt $Max) { return $Max + 1 }
  $prev = New-Object int[] ($B.Length + 1)
  $cur = New-Object int[] ($B.Length + 1)
  for ($j = 0; $j -le $B.Length; $j++) { $prev[$j] = $j }
  for ($i = 1; $i -le $A.Length; $i++) {
    $cur[0] = $i; $rowMin = $i
    for ($j = 1; $j -le $B.Length; $j++) {
      $cost = if ($A[$i - 1] -ceq $B[$j - 1]) { 0 } else { 1 }
      $v = [Math]::Min([Math]::Min($prev[$j] + 1, $cur[$j - 1] + 1), $prev[$j - 1] + $cost)
      $cur[$j] = $v; if ($v -lt $rowMin) { $rowMin = $v }
    }
    if ($rowMin -gt $Max) { return $Max + 1 }
    $t = $prev; $prev = $cur; $cur = $t
  }
  return $prev[$B.Length]
}

# Company words that say nothing about which company it is. Not ASA: once accents go, it is Åsa.
$script:NoiseWords = @('ab', 'publ', 'ltd', 'limited', 'inc', 'llc', 'gmbh', 'oyj', 'plc', 'corp', 'corporation')

<#
  Text as it is compared: lower case, accents removed (Å = A, é = e), punctuation and company
  words like "AB (publ)" dropped, spaces collapsed. "Öberg, Åsa" and "asa oberg" become close.
#>
function ConvertTo-MatchText {
  param([string]$Text)
  if ($null -eq $Text) { return '' }
  $t = $Text.ToLowerInvariant().Replace('ß', 'ss').Replace('æ', 'ae').Replace('ø', 'o').Replace('œ', 'oe').Replace('ð', 'd').Replace('þ', 'th')
  $decomposed = $t.Normalize([System.Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $decomposed.ToCharArray()) {
    $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
    if ($cat -eq [System.Globalization.UnicodeCategory]::NonSpacingMark) { continue }
    if ([char]::IsLetterOrDigit($ch)) { [void]$sb.Append($ch) } else { [void]$sb.Append(' ') }
  }
  $words = @($sb.ToString().Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries) | Where-Object { $script:NoiseWords -notcontains $_ })
  return ($words -join ' ')
}

<#
  A column's values, prepared for comparing: Text (from ConvertTo-MatchText) and Sorted (the same
  words in alphabetical order, so "Taylor Jonathan" meets "Jonathan Taylor").
#>
function New-MatchKeys {
  param([string[]]$Values)
  $texts = New-Object string[] $Values.Count
  $sorted = New-Object string[] $Values.Count
  for ($i = 0; $i -lt $Values.Count; $i++) {
    $texts[$i] = ConvertTo-MatchText $Values[$i]
    $sorted[$i] = (@($texts[$i].Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)) | Sort-Object) -join ' '
  }
  return @{ Text = $texts; Sorted = $sorted }
}

<#
  How alike two prepared values are, 0 to 100: one minus the edit distance over the longer length,
  on the words as written and in sorted order, whichever is higher. A score that is certainly below
  $AtLeast may come back as any lower number: counting stops early.
#>
function Get-Similarity {
  param([string]$AText, [string]$ASorted, [string]$BText, [string]$BSorted, [int]$AtLeast = 0)
  if ($script:FastText) { return [SheetsLibrary.Text]::Similarity($AText, $ASorted, $BText, $BSorted, $AtLeast) }
  if ($AText -eq '' -and $BText -eq '') { return 100 }
  if ($AText -eq '' -or $BText -eq '') { return 0 }
  if ($AText -ceq $BText -or $ASorted -ceq $BSorted) { return 100 }
  $len = [Math]::Max($AText.Length, $BText.Length)
  $max = [int][Math]::Floor($len * (100 - $AtLeast) / 100.0)
  $d = [Math]::Min((Get-EditDistance $AText $BText $max), (Get-EditDistance $ASorted $BSorted $max))
  return [int][Math]::Floor(100.0 * (1 - $d / $len))
}

# The closest two candidates: { best index, best score, runner-up index, runner-up score }.
function Get-BestTwo {
  param([string]$Text, [string]$Sorted, $Keys, [int]$AtLeast)
  if ($script:FastText) { return , [SheetsLibrary.Text]::BestTwo($Text, $Sorted, $Keys.Text, $Keys.Sorted, $AtLeast) }
  $r = @(-1, -1, -1, -1)
  for ($i = 0; $i -lt $Keys.Text.Count; $i++) {
    $s = Get-Similarity $Text $Sorted $Keys.Text[$i] $Keys.Sorted[$i] $AtLeast
    if ($s -lt $AtLeast) { continue }
    if ($s -gt $r[1]) { $r[2] = $r[0]; $r[3] = $r[1]; $r[0] = $i; $r[1] = $s }
    elseif ($s -gt $r[3]) { $r[2] = $i; $r[3] = $s }
  }
  return , $r
}

# Every pair i < j at least that alike, as flat triples i, j, score.
function Get-SimilarPairs {
  param($Keys, [int]$AtLeast)
  if ($script:FastText) { return , [SheetsLibrary.Text]::Pairs($Keys.Text, $Keys.Sorted, $AtLeast) }
  $r = New-Object 'System.Collections.Generic.List[int]'
  $n = $Keys.Text.Count
  for ($i = 0; $i -lt $n; $i++) {
    if ($Keys.Text[$i] -eq '') { continue }
    for ($j = $i + 1; $j -lt $n; $j++) {
      $s = Get-Similarity $Keys.Text[$i] $Keys.Sorted[$i] $Keys.Text[$j] $Keys.Sorted[$j] $AtLeast
      if ($s -ge $AtLeast) { $r.Add($i); $r.Add($j); $r.Add($s) }
    }
  }
  return , $r.ToArray()
}

# Said once, before a long comparison, when this computer only allows the slow way.
function Write-SpeedNote {
  param([long]$Comparisons)
  if (-not $script:FastText -and $Comparisons -gt 200000) {
    Write-Host ("  This computer does not allow the fast mode, so {0:N0} comparisons may take a while." -f $Comparisons) -ForegroundColor Yellow
  }
}

# ---------------------------------------------------------------------------------------------
# Asking
# ---------------------------------------------------------------------------------------------

<#
  Which column to use. $Given (a name or a number) answers without asking, for use from scripts;
  otherwise the person picks from a numbered list, and Enter takes the suggestion.
#>
function Select-Column {
  param([string[]]$Headers, [string]$Question, [string]$Suggested, [string]$Given)
  if ($Given) {
    $i = Find-Column $Headers $Given
    if ($i -lt 0) { throw "There is no column '$Given'. The columns are: $($Headers -join ', ')" }
    return $Headers[$i]
  }
  Write-Host ''
  Write-Host $Question
  for ($i = 0; $i -lt $Headers.Count; $i++) { Write-Host ("  {0,3}. {1}" -f ($i + 1), $Headers[$i]) }
  $hint = if ($Suggested) { " [Enter = $Suggested]" } else { '' }
  while ($true) {
    $answer = Read-Host "Number or name$hint"
    if ($answer -eq '' -and $Suggested) { return $Suggested }
    $i = Find-Column $Headers $answer
    if ($i -ge 0) { return $Headers[$i] }
    Write-Host '  Not one of the columns, try again.'
  }
}

function Find-Column {
  param([string[]]$Headers, [string]$Answer)
  $n = 0
  if ([int]::TryParse($Answer, [ref]$n) -and $n -ge 1 -and $n -le $Headers.Count) { return $n - 1 }
  for ($i = 0; $i -lt $Headers.Count; $i++) { if ($Headers[$i] -ieq $Answer.Trim()) { return $i } }
  return -1
}

function Read-Number {
  param([string]$Question, [int]$Default, [int]$Given)
  if ($Given -gt 0) { return $Given }
  $answer = Read-Host "$Question [Enter = $Default]"
  $n = 0
  if ([int]::TryParse($answer, [ref]$n) -and $n -ge 1 -and $n -le 100) { return $n }
  return $Default
}

function Write-Done {
  param([string]$Path, [switch]$NoOpen)
  Write-Host ''
  Write-Host "Done: $Path" -ForegroundColor Green
  if (-not $NoOpen -and $env:OS -eq 'Windows_NT') { Invoke-Item -LiteralPath $Path }
}

# ---------------------------------------------------------------------------------------------
# Small helpers for the scripts
# ---------------------------------------------------------------------------------------------

function Get-ColumnIndex {
  param($Table, [string]$Name)
  for ($i = 0; $i -lt $Table.Headers.Count; $i++) { if ($Table.Headers[$i] -ieq $Name) { return $i } }
  return -1
}

function Get-ColumnValues {
  param($Table, [int]$Index)
  $values = New-Object string[] $Table.Rows.Count
  for ($r = 0; $r -lt $Table.Rows.Count; $r++) { $values[$r] = $Table.Rows[$r][$Index] }
  return , $values
}

<#
  Two cells say the same thing: equal once spaces at the ends are gone, or the same number
  written two ways ("1.50" and "1.5").
#>
function Test-SameValue {
  param([string]$A, [string]$B, [switch]$IgnoreCase)
  $a = $A.Trim(); $b = $B.Trim()
  if ($IgnoreCase) { if ($a -ieq $b) { return $true } } elseif ($a -ceq $b) { return $true }
  $x = [decimal]0; $y = [decimal]0
  $inv = [System.Globalization.CultureInfo]::InvariantCulture
  $style = [System.Globalization.NumberStyles]::AllowLeadingSign -bor [System.Globalization.NumberStyles]::AllowDecimalPoint
  if ($a -match $script:PlainNumber -and $b -match $script:PlainNumber -and
    [decimal]::TryParse($a, $style, $inv, [ref]$x) -and [decimal]::TryParse($b, $style, $inv, [ref]$y)) {
    return $x -eq $y
  }
  return $false
}

function Invoke-Safely {
  param([scriptblock]$Body)
  try { & $Body }
  catch {
    Write-Host ''
    Write-Host "Stopped: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Nothing was changed. Your files are as they were.'
    exit 1
  }
}
