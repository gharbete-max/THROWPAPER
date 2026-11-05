# Spreadsheet pack

`Loppa-Sheets.ps1`: six jobs people do by hand in Excel, as one script you run yourself. It works
on CSV (and TSV, TXT) files, needs no Excel, no module and no network, and runs in Windows
PowerShell 5.1 or PowerShell 7 (Windows, macOS, Linux; on a Mac install `pwsh` first).

For an `.xlsx`: Save As CSV first, or use Loppa's Convert. The script does not read `.xlsx`.

```powershell
.\Loppa-Sheets.ps1 compare -A old.csv -B new.csv -Key Id     # only in A, only in B, changed cells
.\Loppa-Sheets.ps1 match   -A members.csv -B export.csv      # which column is which, by name
.\Loppa-Sheets.ps1 dupes   -File list.csv -Key Email         # repeated keys; first of each kept
.\Loppa-Sheets.ps1 merge   -File jan.csv,feb.csv,mar.csv     # stack files, columns lined up by name
.\Loppa-Sheets.ps1 split   -File orders.csv -By Country      # one file per value
.\Loppa-Sheets.ps1 clean   -File contacts.csv                # trim, collapse spaces, drop empty rows
```

`Get-Help .\Loppa-Sheets.ps1 -Full` shows the same with options: `-Out <folder>`, `-Trim` and
`-IgnoreCase` (for compare), several keys (`-Key Id,Year`).

## What it promises

- **Your files are only read.** Every result is a new file in a new folder (`-Out`, or a
  `loppa-out-<time>` folder beside the first input). A folder that already has files is refused.
- **It does nothing else:** no connection, no setting changed, nothing it reads is run.
- **It says what it did:** counts first, then each file written.
- Columns are matched by name with case, spaces, punctuation and accents ignored: `E-post`, `e post`
  and `E-Post` are one column.
- The separator (`;` `,` tab `|`) and the encoding (UTF-8 or Windows-1252) are found by the script. It
  writes the same separator back as UTF-8 with a byte-order mark, so Excel shows å ä ö correctly.

## Know before you run

- **Windows may refuse a downloaded script** ("running scripts is disabled", or a security prompt).
  Right-click the file, Properties, tick Unblock; or run
  `powershell -ExecutionPolicy Bypass -File .\Loppa-Sheets.ps1 clean -File x.csv`. Read the script
  first: it is one file of plain text, about 300 lines.
- **Excel turns `00123` into `123` when it opens a CSV.** The script keeps text as text; open the CSV
  with Data > From Text/CSV and set the column to Text.
- A repeated key counts the first row. A column name that repeats (or differs only in case) stops the
  script with a message: rename one first.
- Tested by `scripts/sheets-pack.test.ts`, which runs it for real in PowerShell 7 (skipped where `pwsh`
  is missing). Not yet run in Windows PowerShell 5.1 by a person.
