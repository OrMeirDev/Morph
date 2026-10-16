// Office documents (and PDF -> Word) through LibreOffice, inside an exclusive, version-matched
// profile (see infra/OfficeProfileManager.cjs).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const limits = require('../domain/limits.cjs');

// Export filters by target. Names follow LibreOffice's filter list for the bundled release (S9);
// each direction is covered by test/electron/engines.test.cjs where soffice is available.
const OFFICE_FILTERS = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
  odt: 'odt',
  rtf: 'rtf',
  txt: 'txt:Text (encoded):UTF8',
  epub: 'epub',
  xlsx: 'xlsx:Calc MS Excel 2007 XML',
  ods: 'ods',
  csv: 'csv:Text - txt - csv (StarCalc):44,34,76',
  pptx: 'pptx:Impress MS PowerPoint 2007 XML',
  odp: 'odp',
};

async function run(ctx) {
  const { job } = ctx;
  const filter = OFFICE_FILTERS[job.target];
  if (!filter) throw new Error(`unsupported-target:${job.target}`);
  // LibreOffice names its output after the input, so work on a copy with a plain name.
  const src = ctx.workspace.file(`in.${job.ext}`);
  await fsp.copyFile(job.input, src);
  const outDir = ctx.workspace.file('out');
  await fsp.mkdir(outDir);
  const produced = path.join(outDir, `in.${job.target}`);
  await ctx.officeProfiles.withProfile(ctx, async (profileUrl, profileDir) => {
    const args = ['--headless', '--norestore', '--nologo', `-env:UserInstallation=${profileUrl}`];
    if (job.ext === 'pdf') args.push('--infilter=writer_pdf_import');
    args.push('--convert-to', filter, '--outdir', outDir, src);
    await ctx.run('soffice', args, { timeoutMs: limits.deadlines.office, write: [profileDir] });
    return fs.existsSync(produced);
  });
  if (!fs.existsSync(produced)) throw new Error('LibreOffice did not produce a file');
  return { path: produced, isDir: false };
}

module.exports = { run, OFFICE_FILTERS };
