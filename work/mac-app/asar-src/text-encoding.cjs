// All notebook, sync and backup text is UTF-8. Reject malformed bytes before
// JSON parsing so Windows code-page mistakes cannot be saved as replacement text.
function decodeUtf8(bytes, label = '资料') {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`${label}不是有效的 UTF-8 文本，原文件已保留，请核对来源编码。`); }
}
function parseJsonUtf8(bytes, label = '资料') {
  return JSON.parse(decodeUtf8(bytes, label));
}
module.exports = { decodeUtf8, parseJsonUtf8 };
