# Spreadsheet pack

`Loppa-Sheets.ps1`: twelve jobs people do by hand in Excel, as one script you run yourself. It works
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
.\Loppa-Sheets.ps1 fuzzy   -A members.csv -B export.csv -Column Name   # most alike value, with a score
.\Loppa-Sheets.ps1 numbers -A budget.csv -B actual.csv -Key Account -Column Amount -Tolerance 0.01
.\Loppa-Sheets.ps1 lookup  -File orders.csv -Key CustomerId -From customers.csv -Take Name,City
.\Loppa-Sheets.ps1 gaps    -File invoices.csv -Column InvoiceNo # missing and repeated numbers in a series
.\Loppa-Sheets.ps1 pivot   -File sales.csv -By Country -Cols Product -Sum Amount
.\Loppa-Sheets.ps1 mask    -File people.csv -Column Name,Email -Salt "a secret phrase"
```

`Get-Help .\Loppa-Sheets.ps1 -Full` shows the same with options: `-Out <folder>`, `-Trim` and
`-IgnoreCase` (compare, lookup), several keys (`-Key Id,Year`), `-Threshold`, `-Tolerance`, `-Percent`,
`-Decimal`, `-Step`, `-Mode`, `-Missing`.

## What it promises

- **Your files are only read.** Every result is a new file in a new folder (`-Out`, or a
  `loppa-out-<time>` folder beside the first input). A folder that already has files is refused.
- **It does nothing else:** no connection, no setting changed, nothing it reads is run.
- **It says what it did:** counts first, then each file written.
- Columns are matched by name with case, spaces, punctuation and accents ignored: `E-post`, `e post`
  and `E-Post` are one column.
- The separator (`;` `,` tab `|`) and the encoding (UTF-8 or Windows-1252) are found by the script. It
  writes the same separator back as UTF-8 with a byte-order mark, so Excel shows å ä ö correctly.

## What the newer commands do, and where they stop

- **fuzzy** ignores case, accents, punctuation and word order ("Berg, Anna-Maria" is "Anna Maria
  Berg"), then scores the rest from 0 to 1. `same` is exact after that tidying; `likely` is at or
  above `-Threshold` (default 0.85); `weak` is the best guess and probably wrong. **Always read
  `likely` and `weak` by eye.** It compares every row of A with every row of B: 400 by 500 names took
  14 seconds in PowerShell 7; a couple of thousand each is fine, tens of thousands is not.
- **numbers** reads `1 234,50`, `1,234.50`, `12,5 kr` and `(120)` (minus 120). `1,234` on its own is
  read as one thousand two hundred thirty-four; say `-Decimal ,` if it means one and a bit. Money is
  added up exactly, not as floating point.
- **lookup** takes the first row of a repeated key. A brought-over column with the same name as one you
  already have is named `Name (from file.csv)`.
- **gaps** looks at the last run of digits in each cell: `INV-0042` and `CR-7` are two series, and the
  zeros are kept. Cells with no digits are counted, not guessed at.
- **pivot** counts rows, or adds up `-Sum`; in a `;` file the numbers get a decimal comma so Excel in
  that country reads them as numbers.
- **mask** replaces whole cells with tokens. The same value (ignoring case and outer spaces) gets the
  same token in a run, and in later runs only if you give the same `-Salt`: **keep the salt secret**,
  because short values such as phone numbers can be guessed back from a token without it. It hides the
  columns you name and nothing else: a rare city or job title can still point at a person.

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
