import { expect, test } from '@playwright/test';
import { db, plantLoginToken, scanStep } from './support.js';
import { docxBytes, paragraph } from '../apps/forms/src/screens/builder/paper/docx.fixture.js';

/**
 * Rough Word to PDF — phase 1c of `docs/plan/NEXT.md`. A Word file with a footer becomes a page in
 * the Arrange pages list; the screen says the layout may differ, and names the footer as left out;
 * the file that comes down carries the same label in its name.
 */
const sql = db();

test.afterAll(async () => {
  await sql.end();
});

test('a Word file with a footer becomes a labelled PDF page, and the footer is named as left out', async ({
  page,
}) => {
  const secret = await plantLoginToken(sql, 'admin@example.com');
  await page.goto(`/auth/callback?token=${secret}`);
  await expect(page.getByRole('link', { name: 'Documents' })).toBeVisible();
  await page.goto('/scan');

  const word = docxBytes({
    body: paragraph('Protokoll'),
    sectPr: '<w:footerReference w:type="default" r:id="rId21"/>',
    relationships:
      '<Relationship Id="rId21" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    extra: [
      {
        name: 'word/footer1.xml',
        data: '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Sidfot</w:t></w:r></w:p></w:ftr>',
      },
    ],
  });
  await page.getByTestId('scan-word-file').setInputFiles({
    name: 'protokoll.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(word),
  });

  await expect(page.locator('.scan__page')).toHaveCount(1);
  await expect(page.getByTestId('scan-word-notice')).toContainText('Layout may differ from Word');
  await expect(page.getByTestId('scan-word-dropped')).toContainText('Headers and footers: 1');

  const download = page.waitForEvent('download');
  await scanStep(page, 'keep');
  await page.getByRole('button', { name: 'Make the PDF' }).click();
  await page.getByTestId('keep-panel').getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('protokoll (Layout may differ from Word).pdf');
});
