// How each engine is confined on Windows (infra/Confinement.cjs, backlog D2). PROVISIONAL until
// the Windows measurements are recorded here: every tool in an AppContainer, no limits yet.
const tools = {
  ffmpeg: { isolation: 'appcontainer' },
  ffprobe: { isolation: 'appcontainer' },
  sevenzip: { isolation: 'appcontainer' },
  pdftoppm: { isolation: 'appcontainer' },
  pdftotext: { isolation: 'appcontainer' },
  pdfinfo: { isolation: 'appcontainer' },
  soffice: { isolation: 'appcontainer' },
  calibre: { isolation: 'appcontainer' },
};

const defaults = { jobMemoryMb: null, maxProcesses: null };
const limits = {};
const notes = [];

module.exports = { tools, defaults, limits, notes };
