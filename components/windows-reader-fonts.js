// EPUB documents have their own FontFaceSet; preserve the reader's serif role.
(() => {
  function install(frame) {
    if (!(frame instanceof HTMLIFrameElement) || !frame.closest('.epub-stage')) return;
    try {
      const doc = frame.contentDocument;
      if (!doc?.head || doc.getElementById('wenjian-windows-serif')) return;
      const style = doc.createElement('style');
      style.id = 'wenjian-windows-serif';
      const font = new URL('/fonts/NotoSerifSC-variable.woff2', location.origin).href;
      style.textContent = '@font-face{font-family:"Songti SC";src:url(' + JSON.stringify(font) + ') format("woff2");font-weight:200 900;font-display:swap}';
      doc.head.appendChild(style);
    } catch { /* An inaccessible source document keeps its original typography. */ }
  }
  document.addEventListener('load', event => install(event.target), true);
  document.querySelectorAll('.epub-stage iframe').forEach(install);
})();
