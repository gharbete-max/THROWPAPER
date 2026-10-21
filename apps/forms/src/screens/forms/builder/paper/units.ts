/** A length in the IR's integer units: ten-thousandths of the page's width or height. */
export const toIu = (value: number, extent: number) =>
  Math.min(10_000, Math.max(0, Math.round((value / extent) * 10_000)));
