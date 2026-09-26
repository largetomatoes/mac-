/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, PDFArray, PDFDict, PDFHexString, PDFName, StandardFonts, rgb } = require('../work/mac-app/node_modules/pdf-lib');
const { createAnnotatedPdf } = require('../work/mac-app/asar-src/pdf-export');

(async () => {
  const scratch = path.join(__dirname, '..', 'tmp', 'pdfs');
  await fs.mkdir(scratch, { recursive: true });
  const sourcePath = path.join(scratch, 'source.pdf');
  const outputPath = path.join(scratch, 'annotated.pdf');
  const source = await PDFDocument.create();
  const page = source.addPage([595, 842]);
  const font = await source.embedFont(StandardFonts.Helvetica);
  page.drawText('A sentence that should remain readable below a pale highlight.', { x: 72, y: 690, size: 15, font, color: rgb(0.1, 0.15, 0.2) });
  await fs.writeFile(sourcePath, await source.save());

  const output = await createAnnotatedPdf(await fs.readFile(sourcePath), [{
    page: 1,
    rects: [{ x: 0.115, y: 0.16, width: 0.69, height: 0.025 }],
    notes: [{ y: 0.18, contents: '第 1 页\n\n我的过程笔记\n\n原文：测试句子' }]
  }]);
  await fs.writeFile(outputPath, output);

  const reopened = await PDFDocument.load(output);
  assert.equal(reopened.getPageCount(), 1);
  const annotations = reopened.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
  assert.equal(annotations.size(), 1);
  const annotation = annotations.lookup(0, PDFDict);
  assert.match(annotation.lookup(PDFName.of('Contents'), PDFHexString).decodeText(), /我的过程笔记/);
  assert.ok(output.length > (await fs.stat(sourcePath)).size);
  console.log(outputPath);
})().catch((error) => { console.error(error); process.exitCode = 1; });
