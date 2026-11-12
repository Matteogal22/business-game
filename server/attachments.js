// Allegati dello studio dei gruppi: controllo del tipo reale del file (non solo dell'estensione).
const MAX_BYTES = 10 * 1024 * 1024;   // 10 MB per file
const MAX_PER_ROUND = 5;              // file per gruppo per round

const OFFICE = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function sanitizeName(raw) {
  let name = '';
  try { name = decodeURIComponent(String(raw || '')); } catch { name = String(raw || ''); }
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name || 'allegato';
}

// Restituisce il content-type se il file è di un tipo ammesso, altrimenti null
function detectType(buf, filename) {
  if (!buf || buf.length < 4) return null;
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // pptx/docx/xlsx sono archivi ZIP: si accettano solo con l'estensione corrispondente
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04 && OFFICE[ext]) return OFFICE[ext];
  return null;
}

function sendFile(res, row) {
  res.setHeader('Content-Type', row.content_type);
  res.setHeader('Content-Length', row.size);
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(row.data);
}

module.exports = { MAX_BYTES, MAX_PER_ROUND, sanitizeName, detectType, sendFile };
