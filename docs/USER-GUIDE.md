# Loppa Documents: user guide

For a person who has just installed Loppa on Windows or macOS. It uses the words the app shows. Where
a statement could not be checked against the app's code or text, it says **not verified**. This is not
legal advice, and Loppa does not give any.

## The room

Loppa opens in a room with three doors: **Documents**, **Spreadsheets** and **Presentation & planning**.
Only Documents is built; the other two say _Not built yet_. Inside Documents are four parts and one
centre:

- **Forms**: make a form, fill in a PDF, keep the result as a PDF.
- **Scan**: put PDFs, photos and Word files together as pages.
- **Sign**: put your signature on a PDF, or send it to others to sign.
- **Send**: email a document to one person or many.
- **Summary and translation** (the centre): an optional model on your own computer.

**Drop a file anywhere in the room** and Loppa opens it as a PDF, a Word file or a photo, in the page
list (_Scan_). A PDF with fields of its own offers _Fill it in_. _Recent documents_ keeps only names, on
this device; choose a file again to open it, or _Clear the list_.

First start asks for your organisation's name and yours, or offers demo data. Nothing is sent to set up.

## Forms

- **New form** offers _Start from_ _Blank form_ or a starting point. The **guided** way asks "What is
  this form for?" and builds one question at a time; you can build and publish it by clicking alone.
  The **manual** way is the editor. Free text is optional, and what you edit by hand is kept.
- **Start from paper** reads a document you bring (PDF, Word, a photo) and shows _What Loppa read_. It
  changes nothing until you review it: you accept lines as questions or as plain text. Review keys are
  in _Keyboard_ below. The reading follows fixed rules, not AI.
- **Draft PDF**: a form can be filled in on the spot and kept as a PDF with **Download PDF**. Nothing
  is sent, saved or published. From a draft you can go on to **Fill in**, **Sign** or **Send**.
- **Fill in a PDF**: choose a PDF that has fields of its own, fill them in, then **Keep as PDF**. A PDF
  without such fields says so. If the PDF carries a digital signature, filling it in removes the
  signature, and Loppa asks first.
- **Share to collect** is optional. It publishes the form so other people can answer it by a link. On
  the desktop the link opens only on this computer (_Links open only on this computer. Nobody else can
  open them._), so collecting from others needs the hosted edition (not verified here).

## Scan

Scan is three steps, shown as a bar across the top: **1. Bring in**, **2. Fix**, **3. Keep**. The pages
stay on screen in every step, and any step you have reached is one press away, so you can always go
back. Adding files moves you to _Fix_ by itself; _Done fixing_ moves you to _Keep_. Each step has one
filled button; the rest are quieter.

**1. Bring in.** **Add PDFs or photos**, **Take photos**, or drop files anywhere on the screen. Up to 40
files, 25 MB each, 500 pages in all. PDF, JPEG, PNG and WebP are accepted; a HEIC photo may not open.
Nothing is kept: **Make the PDF** produces a file to download. _More tools_ holds the rarer ways in:
_Add a Word file_, _Read a supplier invoice_ and _Make a form from a document instead_.

**2. Fix.** The page cards get their buttons here. _More tools_ holds _Make a digital copy_, for the page
you choose. **Read with AI** is here too, where this edition has it.

**3. Keep.** **Make the PDF**, _Sign this PDF_, _Send this PDF_, and where they apply _Fill it in_ and
_Summarise this PDF_.

- **Arrange** (Fix): _Move earlier_, _Move later_, _Turn_, _Remove page_.
- **Phone**: _Use a phone_ shows a QR code. Scan it with the phone's camera, on the same Wi-Fi, and
  take a photo of each page; they arrive on the computer. Press _Use the pages_ to bring them in.
  - While a phone scan is open, Loppa listens on your local network (not on every adapter) so the
    phone can reach it. It passes only the phone's own scan routes. It stops when no scan is open.
    The link is plain HTTP, so anyone on the same network who has the code could send pages: use a
    network you trust.
  - The code expires after 15 minutes; press _New code_ for another. If the computer is not on a
    network a phone can reach, it says so.
- **Filters** (per page): _Original_, _Enhanced colour_, _Grey_, _Black and white_, _Clean document_,
  with a strength and _Straighten the page_. A suggestion is only a suggestion until you press
  _Apply_; _Back to the original photo_ undoes it.
- **Make a digital copy** (Fix, _More tools_): reads a photographed page on this device and shows the words, marking those
  it was unsure of. Check them, then keep the copy as _PDF with lines and text_, _Searchable PDF_
  (the photo stays the page, the words are hidden under it so the PDF can be searched), _SVG picture_,
  _Plain text_ or _A form_. Choose the language of the page; a wrong one gives poor reading.
- **Word to PDF is rough.** _Layout may differ from Word._ Loppa lists what it left out: headers and
  footers, text boxes, footnotes, tracked changes (insertions kept, deletions left out), fields shown
  as last saved, and pictures that could not be included. Check the result.
- **Edit text or redact**: _Add text_, _Cover_ or _Redact_ on a page. **Cover only paints over the
  page; the words underneath stay in the file.** **Redact** turns the page into a picture with the
  boxes blacked out, so the words are removed for good, but that page can no longer be searched or
  copied from. It cannot be undone, and Loppa asks first. If a PDF cannot be redacted completely,
  nothing is changed.
- **Read a supplier invoice**: choose a photo, scan or PDF. It is read on this device. Each value is
  shown beside where it was found, and nothing is used until you confirm it.
- **Keep this PDF** offers file name and size (_Small_, _Medium_, _Original_); photos are made
  smaller, PDF pages keep their size.

## Sign

- **Your signature and initials are kept on this computer only.** They leave it only as part of a
  document you apply them to. Use _Place signature, initials and date_ to put them on a PDF; you can
  draw a signature or type your name.
- Signed this way, the PDF is sealed locally with an audit page. No national e-ID (BankID and similar)
  is connected, and Loppa does not claim anybody's identity was verified.
- **Send a PDF for signing** (each signer gets a link of their own, one after another or all at once)
  works only where a Loppa Sign server is connected. Otherwise the screen says _Signing is not set
  up_. Whether the desktop's own signing service covers this is not verified.
- _Test mode_ marks nothing as real. Real mode needs a declaration written by a person; Loppa does not
  write legal wording. You can _Cancel request_ or _Send reminder_, each with a confirmation.

## Send

- **One document**: a PDF or Word file (up to 25 MB; Word is sent as it is, not converted), addresses,
  a subject and a short message. **Review before sending**, then **Confirm and send**.
- **One each, from a list**: a CSV with a name and email column (and optionally amount and reference);
  each row becomes one PDF for one person. Steps: _List, Design, Preview, Confirm_.
- **Campaigns** (one plain-text email to a list):
  - The footer is yours to write. It opens as a skeleton with `[brackets]` to complete: who sends,
    from where, why this person is on the list, and `{{unsubscribe}}` where each person's link goes.
    **A campaign is not sent while a bracket is left or the unsubscribe link is missing.** Loppa adds
    no wording of its own, and you are responsible for what the footer says.
  - Nothing tracks opens or clicks; links are sent as written.
  - _Send me a test_ first. Addresses that unsubscribed or bounced are left out.
  - **Do not email list** holds those addresses and ones you add by hand. It stops campaigns only, not
    one-off documents or signing invitations.
- **Test mode**: nothing reaches the recipients; messages are written as `.eml` files to an outbox
  folder (_File > Open outbox_). The default on a fresh desktop install is test mode (not verified for
  every setting).
- **To send** (desktop): messages wait there and nothing is sent automatically. Open one in your own
  email program and press Send there. An email link cannot attach files, so Loppa says to attach the
  saved file yourself. Sending through your own SMTP server is under Advanced.
- Every send asks you to confirm. _Test mode_ and _To send_ say which kind of send you are about to do.

## The AI centre (optional)

Loppa works fully without it. Nothing is downloaded unless you press **Download** and confirm.

**What it does**, all on your computer with one model loaded at a time:

- **Read with AI**: reads scanned pages from a picture of each page, marks pages to check.
- **Summarise** and **Translate** a pasted text, a PDF or text file, a form's questions or a filled
  form's answers.
- **Proofread**: suggestions you accept or ignore go into a corrected copy; the original is unchanged.
- **Help me reply** and **Write an email about this**: a draft for you to check; nothing is sent.

**What it will not do**: results are labelled _generated on this computer_, can be wrong, are not
saved and are never written into your document, form or message. Contracts, consents, declarations
and clinical forms are **quoted, not reworded or translated**: Loppa picks out passages to read first,
shown exactly as written, and tells you to read the whole document yourself. Numbers in a result that
are not in the original are flagged. Icelandic output is not offered.

**Your computer**: the full model needs about **12 GB of memory** and about 10 GB free while it runs;
it will not start on less. A page takes roughly half a minute on a fast computer and several minutes
on a laptop. Smaller tiers exist for weaker computers (_Full_, _Balanced_, _Light_, _Very light_);
they read and write worse and struggle with hard scans. Loppa marks one _Recommended for this
computer_. Tiers that failed testing are shown as _Not working yet_ and cannot be downloaded.

**Getting a model**, on the _Add-ons and updates_ page (the room's corner, or the _Set up AI_ link in the summary centre): one recommended model and one Download button; _Choose another model_ lists the rest and _Advanced_ holds the graphics card, the program, the folder and the saved results:

1. **Pick a tier and Download.** Loppa names the host (huggingface.co), the files and the total size
   and waits for you to confirm; you can cancel at any time. The files are checked before first use.
2. **Offline**: _Open a file or an AI pack (PACK.json) from disk_. Put the pack's parts and `PACK.json`
   in one folder (a USB stick works); Loppa joins the parts and checks each against its hash. No
   internet is used.

**Using the graphics card (optional)**: under _Advanced_, _Use the graphics card (faster, optional)_ is
off until you turn it on. On a Windows computer with a separate graphics card it reads pages several times
faster. The first time you turn it on, Loppa asks before downloading the extra program (it names github.com,
the file and its size; it is checked against its published fingerprint), or you can put the program in the
folder the setting shows, offline. If the card cannot be used, Loppa says _The graphics card could not be
used; using the processor_, carries on with the processor, and does not try the card again until you press
_Try the graphics card again_. The list says whether the model runs on the processor or the graphics card.
On a Mac the setting says it is not available yet.

The installer never contains the model. The Windows installer carries the program that runs it
(`llama-server`); on a Mac the program is fetched from _Add-ons and updates_ (below), and has not
been tried on a Mac by the developers yet.

## Add-ons and updates

Everything optional is on one page, **Add-ons and updates** (the room's top corner; the first time
the room opens there is a one-line note about it that you can hide). You never need to look for files
on GitHub. Each row has a plain description, its size and a button; **every button asks first and
names the host, the file and the size**, and nothing is fetched or checked until you press and say
yes. There is no automatic check and no telemetry.

| Row | What it is |
| --- | --- |
| **AI model** (the first card) | The recommended model for this computer, one Download button. The usual way. |
| **AI program** | The small program that runs the model. _Included with Loppa_ on Windows. On a Mac, press **Get the AI program** (about 12 MB from github.com). It is checked against a fixed fingerprint before it is opened. It says _Not tested on this kind of computer yet_: if it does not start, Loppa says so and carries on without AI. |
| **Graphics-card program** | Optional, makes reading faster on a computer with a separate graphics card. Switched on and off under _Advanced_ in the model list. |
| **AI pack** | The model's files from Loppa's own release, about 6.9 GB, for offline installs and for computers that cannot reach Hugging Face. It can be stopped and continued. Needs the space for the files and then again for the largest one while it is joined. |
| **New version** | _Check for a new version_ asks the releases page which version is newest (nothing is sent but the request). If there is one, you see what is new and **Download the installer for this computer**: it is saved in your Downloads folder, checked against the release's published checksums, and only then can you press **Open the installer**. Loppa never runs an installer by itself. |

On the portable Windows program the page says to close Loppa and run the new file instead of the old
one; on a Mac, to open the disk image and drag Loppa to Applications. If a download does not match
its published fingerprint it is deleted and nothing is installed.

## Privacy

**Nothing leaves this computer unless you press something and confirm it.** There is no telemetry, no
cloud AI and no automatic update check. The desktop's local servers answer only on this computer. The
exceptions you start yourself are a model download, the AI program, the graphics-card program, the AI pack, checking for a new version and downloading its installer (each confirmation names the host) and a phone scan,
which uses your local network while open. Email goes out only when you confirm, through your own mail
program or your SMTP server.

## Backups

Everything is in one folder: **File > Open data folder**.

- **File > Back up...** copies it **without the keys** (`secrets.json`, `sign/secrets.json`), so no
  readable key lands in a synced folder. A restored copy makes new keys: everyone is signed out and
  old links stop working. Your data is intact.
- **File > Back up with the keys...** also asks for a passphrase twice (at least 8 characters) and
  saves the keys as `keys.enc` beside the copy. **The passphrase cannot be recovered, by you or by
  Loppa.**
- **Restore**: quit Loppa, replace the data folder with the backup (leave `keys.enc` aside), start
  Loppa. To get the old keys back, **File > Restore keys from a backup...**, enter the passphrase and
  choose `keys.enc`. A wrong passphrase or damaged file changes nothing. Details: `docs/BACKUP.md`.

## Keyboard

Few shortcuts exist. Verified in the app: **Undo / Redo** in the form builder (Ctrl+Z, Ctrl+Shift+Z);
in the paper review, ↑ ↓ move, 1-3 choose a type, M merge, S split, T text, Q question, Enter accept,
Ctrl+Z undo; **Settings** with Ctrl+, (Cmd+, on a Mac). No other global shortcuts were found. Not
verified: macOS equivalents for the rest.

## Troubleshooting

| You see | What it means and what to do |
| --- | --- |
| _There is too little free memory to load the model_ / _This computer has X GB of free memory and the model needs about Y GB_ | Close other programs and retry, or choose a lighter tier. |
| _The file does not match the published model and was not used. Nothing was deleted._ (_Damaged_) | The file is cut off or wrong. Remove it and download or open it again. |
| _The program that runs the model is missing_ | Open _Add-ons and updates_ and press **Get the AI program**. A packaged build without `resources/ai-pack/runtime` has no runtime. |
| _The file did not match its published fingerprint, so it was deleted._ | An add-on or installer arrived changed or cut off. Nothing was installed; press the button again, or try later. |
| _GitHub could not be reached_ | The check needs the internet only for that press. Check the connection and try again, or place the files by hand as described above. |
| A pack says _The model is not on this computer_ after opening `PACK.json` | A part is missing from the folder. Put every part beside `PACK.json`. A wrong or damaged part is reported as _does not match_. |
| _That file is not the model Loppa uses_ | The file opened is not a supported model. |
| _A file is protected with a password. Remove the protection first._ | Encrypted PDFs cannot be added to Scan. Remove the protection in the program that made it. |
| _A file you added is digitally signed. Rearranging its pages removes the signature._ | Same for filling in. Loppa asks before it removes a signature. |
| _This PDF cannot be redacted completely, so nothing was changed._ | Redaction refuses rather than leave text behind. |
| _The page could not be read. Try another language, or a clearer photograph._ | Set the language of the page in the digital copy or invoice reader. Twelve languages are offered. |
| _There is not enough free disk space for this model._ | Free space, or choose a lighter tier. |
| _This computer is not on a network a phone can reach._ | Connect to Wi-Fi; the phone must be on the same network. |
| _The download is not available yet_ | Open the model from disk instead. |

## Where to go next

`docs/BACKUP.md` (backups), `docs/DEPLOY.md` (hosted edition and the AI pack for packagers),
`docs/VISION.md` (why Loppa is built the way it is).
