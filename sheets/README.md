# Loppa Sheets: six spreadsheet tools that need nothing installed

Put two spreadsheets in this folder, double-click a tool, and a coloured result opens in Excel. No
Excel add-ins, no macros, no internet, no install: the tools are PowerShell scripts, and every
Windows 10 and 11 computer already has PowerShell.

## How to use

1. Unzip the download into a folder of its own, for example `Documents\Sheets`.
2. Put your two files into that same folder: `.xlsx`, `.xlsm` or `.csv`.
3. Double-click a tool. A window shows which two files it picked and asks one or two questions.
   Press Enter to take the suggested answer.
4. The result opens. It is also saved in the `Results` folder, with the date and time in its name.

**Which two files?** The two newest in the folder, by when they were last saved or downloaded. The
older one is **A** (before), the newer one is **B** (after). The window always prints which is
which, so check it before you answer. To use other files, save or copy them into the folder again,
which makes them the newest. Excel's own lock files (`~$…`) and anything in `Results` are never
picked. Only the first sheet of a workbook is read.

## The tools

| Tool                       | What it does                                                                                                                                                                                                                                                                                                                                         | Colours                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **1 Compare two versions** | Pairs the rows of A and B on a column that identifies them (an ID, account or e-mail) and shows what is new, what is gone and which cells changed. Also lists every changed cell with its before and after.                                                                                                                                          | green new, yellow changed, red removed          |
| **2 Match names**          | Finds each row of B in A even when the names are spelled differently: "Öberg, Åsa" finds "Asa Oberg", "Volvo AB (publ)" finds "Volvo". Adds the matched A row's other columns to B, like a lookup that forgives typos. Lists the A rows nobody matched.                                                                                              | green match, yellow check by hand, red no match |
| **3 Find duplicates**      | Within each file, groups rows whose chosen column is the same or almost the same ("Anna Svensson", "Anna Svenson"). Removes nothing.                                                                                                                                                                                                                 | groups in alternating colour                    |
| **4 Combine files**        | One list from A and B, columns lined up by name, a column saying where each row came from. Exact repeats are kept once.                                                                                                                                                                                                                              |                                                 |
| **5 Clean up data**        | A tidied copy: stray and invisible spaces removed, numbers stored as text ("1 234,50") made real numbers, dates written as text ("05.11.2026") made `yyyy-MM-dd`. A column is only changed when every cell in it agrees, and IDs with a leading zero stay text. When day and month could be either way round, the column is left alone and reported. | yellow changed                                  |
| **6 Split by column**      | The newest file split into one sheet per value of a column (per region, owner or status), with a sheet of counts first.                                                                                                                                                                                                                              |                                                 |

### How "alike" is measured (tools 2 and 3)

Both values are put in lower case, accents are removed (Å = A, é = e, ø = o), punctuation goes, and
company words that say nothing about which company it is are ignored: AB, publ, Ltd, Limited, Inc,
LLC, GmbH, ASA, Oyj, plc, Corp, Corporation. Then the **edit distance** (Levenshtein) is counted:
how many letters must be added, removed or changed to turn one into the other. The score is
`100 × (1 − distance ÷ length of the longer)`, on the words as written and in alphabetical order,
whichever is higher, so "Taylor, Jonathan" and "Jonathan Taylor" score 100.

Match names asks for the score that counts as a match (85 by default). It never guesses silently:
when two rows of A are almost equally close, or the best is only a little below the line, the
verdict is **Check** and the row is yellow.

## Safety

- **Your files are only read.** They are opened read-only, and results are always new files in
  `Results`. The tests check that the two files are byte for byte the same after every tool.
- **No internet.** No script contains a command that can reach the network. The tests scan every
  script for them and fail if one appears.
- **Nothing runs from your data.** The tools never start Excel and never run a macro: an `.xlsm` is
  read as data only. Results contain values, never formulas, so a cell that starts with `=` stays
  text and cannot run when the result is opened.
- **Nothing is deleted or overwritten.** The scripts contain no delete or overwrite command.
- **One compiled helper.** To compare thousands of names quickly, `scripts\Sheets.Common.ps1`
  compiles a small, readable piece of C# (the edit distance, about 70 lines, in the file itself).
  If your computer does not allow that, the tools do the same work in plain PowerShell, more slowly,
  with the same results.
- **ExecutionPolicy.** The `.cmd` launchers start PowerShell with `-ExecutionPolicy Bypass`, which
  applies to that one run and changes no setting on the computer. If your organisation blocks
  scripts entirely, ask IT; do not work around it.

### Check the download before you run it

Every release lists the SHA-256 of the zip. In PowerShell, in the folder where you saved it:

```powershell
Get-FileHash .\loppa-sheets.zip -Algorithm SHA256
```

The hash must equal the one on the release page. Then unzip. If Windows says the files came from
the internet, that is expected for a download: right-click the zip → Properties → Unblock, before
unzipping, once you have checked the hash.

## From a PowerShell window

Each tool also runs without questions, for use in your own scripts:

```powershell
.\scripts\Compare-Files.ps1 -Key "Account" -NoOpen
.\scripts\Match-Names.ps1 -ColumnA "Name" -ColumnB "Shareholder" -Threshold 85
.\scripts\Find-Duplicates.ps1 -Column "Name" -Threshold 90
.\scripts\Combine-Files.ps1 -KeepDuplicates
.\scripts\Clean-Files.ps1
.\scripts\Split-ByColumn.ps1 -Column "Region"
```

`-Folder <path>` makes any tool work in another folder. `Get-Help .\scripts\Match-Names.ps1 -Full`
describes every option.

## For developers

- `scripts\Sheets.Common.ps1` holds everything shared: reading `.xlsx` (the Open XML parts, with
  DTDs refused) and `.csv` (UTF-8 or Windows-1252, any of `; , tab |`), writing `.xlsx`, the edit
  distance and the questions. Windows PowerShell 5.1 and PowerShell 7 both run it.
- `tests\Test-Sheets.ps1` is the whole test suite: reading, writing, every tool end to end in a
  child process, the files left unchanged, the fast and slow comparisons agreeing, and the safety
  scan. CI (`.github/workflows/sheets.yml`) runs it on Windows PowerShell 5.1 and on PowerShell 7.
- A release is a tag `sheets-v<version>`. The workflow zips the folder without its tests and
  attaches the zip and its SHA-256 to the release. The desktop app's update check only reads its
  own tags, so a Sheets release never looks like an app update.
