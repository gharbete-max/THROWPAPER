import { basename } from 'node:path';

/**
 * What a backup copies: the whole data folder except the plain-text keys files (`secrets.json` at its top
 * for Forms and `sign/secrets.json` for Sign: signing and session keys), which would otherwise land in a
 * synced Documents folder as readable text (ADR 0026). A restored copy makes new keys; sessions and
 * old magic links stop working, the data does not.
 */
export function backupFilter(): (source: string) => boolean {
  return (source) => basename(source) !== 'secrets.json';
}
