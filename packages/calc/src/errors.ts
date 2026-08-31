/**
 * Typed error values that propagate visibly — never a silent zero.
 * SPEC-shared.md §packages/calc. The AST engine itself is phase A7 / out of v0.1 scope.
 */
export const CALC_ERRORS = ['#DIV0', '#UNIT', '#MISSING', '#CIRCULAR', '#TYPE'] as const;
export type CalcError = (typeof CALC_ERRORS)[number];

export type CalcValue = string | number | boolean | Date | CalcError | null;

export function isCalcError(value: CalcValue): value is CalcError {
  return typeof value === 'string' && (CALC_ERRORS as readonly string[]).includes(value);
}

/** Errors win over values: any error operand makes the whole result that error. */
export function propagate(...operands: CalcValue[]): CalcError | null {
  for (const operand of operands) if (isCalcError(operand)) return operand;
  return null;
}
