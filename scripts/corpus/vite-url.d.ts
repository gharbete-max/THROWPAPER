// `apps/forms` imports some files with Vite's `?url` suffix (the pdf.js worker). Reading a Word
// file for `word-to-pdf.test.ts` reaches that import; here, in Node, it is only ever a string.
declare module '*?url' {
  const url: string;
  export default url;
}
