# Backing up and restoring Loppa (desktop)

Everything Loppa keeps lives in one folder (File > Open data folder). A backup is a copy of it.

- **File > Back up...** copies the folder without the two key files (`secrets.json` and
  `sign/secrets.json`), so no readable key lands in a synced Documents folder (ADR 0026). A restored
  copy makes new keys: everyone is signed out and old links stop working; the data is intact.
- **File > Back up with the keys...** does the same, then asks for a passphrase twice (at least 8
  characters) and writes the two key files, encrypted, to `keys.enc` beside the copy. Format: JSON
  with `scrypt` (N 32768, r 8, p 1), a random salt and nonce, and AES-256-GCM; the parameters are
  authenticated with the text. The passphrase is not stored anywhere and cannot be recovered.

## Restoring

1. Quit Loppa. Replace the data folder with the backup folder (leave `keys.enc` out or aside), and
   start Loppa. It works, with new keys.
2. To get the old keys back as well: File > **Restore keys from a backup...**, type the passphrase,
   choose the `keys.enc`. A wrong passphrase or a damaged file is reported and nothing is written.
   Otherwise Loppa asks you to confirm, stops its servers, writes the two key files and starts again.

The restore only ever writes `secrets.json` and `sign/secrets.json` inside the data folder, whatever a
`keys.enc` claims.
