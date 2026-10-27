import type { CSSProperties } from 'react';
import { partCssVariables } from '@tp/tokens';

/** The four parts' colours as custom properties, for an element whose children use them. */
export const PART_STYLE = partCssVariables() as CSSProperties;
