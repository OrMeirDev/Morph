// Authenticode check of the built installer and app (Windows).
//
//   node e2e/signature-check.cjs <file>... [--publisher "<subject CN>"] [--report <file>]
//
// With --publisher (set when a signing certificate is configured): every file must be validly
// signed by that publisher, or the check fails. Without it: signing is pending; the script records
// each file's actual status and exits 0, so an unsigned build is reported, never called signed.
const { execFileSync } = require('child_process');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const files = args.filter((a, i) => !a.startsWith('--') && !['--publisher', '--report'].includes(args[i - 1]));
const publisher = opt('--publisher');

function signature(file) {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; [pscustomobject]@{ status = "$($s.Status)"; subject = "$($s.SignerCertificate.Subject)"; timestamp = "$($s.TimeStamperCertificate.Subject)" } | ConvertTo-Json -Compress`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }));
}

const results = files.map((f) => ({ file: f, ...signature(f) }));
const failed = publisher
  ? results.filter((r) => r.status !== 'Valid' || !r.subject.includes(`CN=${publisher}`) || !r.timestamp)
  : [];
const report = {
  mode: publisher ? `required: Valid, CN=${publisher}, timestamped` : 'pending: no signing certificate configured (WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD secrets and the MORPH_PUBLISHER variable)',
  results,
  failed: failed.length,
};
if (opt('--report')) fs.writeFileSync(opt('--report'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(failed.length ? 1 : 0);
