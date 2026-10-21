/**
 * The entry being reversed already has a reversal. Thrown by `ledger.post` from inside the write,
 * where the check and the stamp cannot be separated by another request, and answered as a 409.
 */
export class AlreadyReversed extends Error {
  constructor() {
    super('That entry has already been reversed');
    this.name = 'AlreadyReversed';
  }
}
