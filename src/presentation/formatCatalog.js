// Display names for target formats. Pure data: no React, no Electron.
const FORMAT_LABEL = { docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', odt: 'ODT', ods: 'ODS', odp: 'ODP', 'tar.gz': 'TAR.GZ', txt: 'טקסט' };

export const fmtLabel = (t) => FORMAT_LABEL[t] || String(t || '').toUpperCase();
