/** Node-only entry point for the PDF target — see compile-pdf.ts. */
export {
  toPrintCss,
  toPdfHeaderTemplate,
  toPdfFooterTemplate,
  printMargins,
  DEFAULT_MARGIN,
  type PrintOptions,
  type PageSize,
} from './compile-pdf.js';
export { fontFaceCss, primaryFamily, EMBEDDABLE_FONTS } from './fonts.js';
