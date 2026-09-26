const { PDFDocument, PDFArray, PDFHexString, PDFName, degrees, rgb } = require('pdf-lib');

function addTextAnnotation(pdfDocument, page, x, y, contents, index) {
  const context = pdfDocument.context;
  let annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (!annotations) {
    annotations = context.obj([]);
    page.node.set(PDFName.of('Annots'), annotations);
  }
  const annotation = context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Text'),
    Rect: [x, y, x + 22, y + 22],
    Contents: PDFHexString.fromText(contents),
    T: PDFHexString.fromText('问间过程笔记'),
    Subj: PDFHexString.fromText('阅读批注'),
    NM: PDFHexString.fromText(`wenjian-note-${index}`),
    Name: PDFName.of('Comment'),
    C: [0.32, 0.49, 0.57],
    Open: false,
    F: 4
  });
  annotations.push(context.register(annotation));
}

async function createAnnotatedPdf(sourceBytes, entries) {
  const pdfDocument = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  let noteIndex = 0;
  for (const entry of Array.isArray(entries) ? entries.slice(0, 5000) : []) {
    const pageIndex = Number(entry.page) - 1;
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdfDocument.getPageCount()) continue;
    const page = pdfDocument.getPage(pageIndex), { width, height } = page.getSize();
    const seen = new Set();
    for (const raw of Array.isArray(entry.rects) ? entry.rects.slice(0, 1000) : []) {
      const nx = Math.max(0, Math.min(1, Number(raw.x))), ny = Math.max(0, Math.min(1, Number(raw.y))), nw = Math.max(0, Math.min(1 - nx, Number(raw.width))), nh = Math.max(0, Math.min(1 - ny, Number(raw.height)));
      if (![nx, ny, nw, nh].every(Number.isFinite) || nw <= 0 || nh <= 0) continue;
      const key = [nx, ny, nw, nh].map((value) => value.toFixed(4)).join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      page.drawRectangle({ x: nx * width, y: height - (ny + nh) * height, width: nw * width, height: nh * height, color: rgb(0.965, 0.835, 0.36), opacity: 0.24, borderWidth: 0, rotate: degrees(0) });
    }
    for (const note of Array.isArray(entry.notes) ? entry.notes.slice(0, 250) : []) {
      const normalizedY = Math.max(0.03, Math.min(0.97, Number(note.y)));
      const contents = typeof note.contents === 'string' ? note.contents.slice(0, 16000) : '';
      if (!Number.isFinite(normalizedY) || !contents.trim()) continue;
      addTextAnnotation(pdfDocument, page, Math.max(8, width - 30), Math.max(8, height - normalizedY * height - 11), contents, ++noteIndex);
    }
  }
  return pdfDocument.save({ useObjectStreams: false, addDefaultPage: false });
}

module.exports = { createAnnotatedPdf };
