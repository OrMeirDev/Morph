# Real-world document corpus (E2)

Files made by other people's tools, kept unmodified, used by `test/electron/corpus.test.cjs`.
They are separate from the generated fixtures (`test/electron/helpers.cjs`): a generated fixture
proves that a feature Morph controls (RTL, bold, a table) survives a conversion; a corpus file
proves that documents nobody designed for Morph's tests convert and keep their text.

Every file is in the public domain where it was published; the basis is given per file. Keep the
attribution when copying them. `corpus.test.cjs` checks each file's SHA-256 against this table, so a
changed file fails instead of silently testing something else.

| File | What it is | Source (retrieved 2026-10-15) | Rights basis | SHA-256 |
| --- | --- | --- | --- | --- |
| `benyehuda-5452-ani-maamin.docx` | "אני מאמין", Shaul Tchernichovsky (1875–1943); Hebrew poem with niqqud, right-to-left paragraphs, headings | Project Ben-Yehuda, https://benyehuda.org/read/5452 (download: DOCX) | Marked "נחלת הכלל" (public domain) by Project Ben-Yehuda; the author died in 1943 | `35b4d1f171e3a800edfb9da2d8e0864e49cc1489ae200ab2c58d790a71b24992` |
| `benyehuda-5452-ani-maamin.epub` | the same work as Project Ben-Yehuda's EPUB | same page (download: EPUB) | same | `4999680fab3b7c24d57217e7afdb838c7fa8dfdb5634e3979398c0a4dcea8bd7` |
| `benyehuda-5452-ani-maamin.pdf` | the same work as Project Ben-Yehuda's PDF (2 pages, Chrome/Skia) | same page (download: PDF) | same | `6386369f9b5cf73956efc5b93e216b03ce3a3c9eabd4a6f7df23be53e413edca` |
| `irs-form-w9-2024.pdf` | IRS Form W-9 (Rev. March 2024): 6 pages, XFA/AcroForm fields, embedded fonts | https://www.irs.gov/pub/irs-pdf/fw9.pdf | Work of the U.S. federal government, not subject to copyright (17 U.S.C. § 105) | `2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53` |
| `census-nst-est2024-pop.xlsx` | U.S. Census Bureau, annual state population estimates 2020–2024 (styled table, merged headers, notes) | https://www2.census.gov/programs-surveys/popest/tables/2020-2024/state/totals/NST-EST2024-POP.xlsx | Work of the U.S. federal government (17 U.S.C. § 105) | `4a98cd464d3f9e122e74b47b38f1584e78e9077f4b36be1cabf7a79ab5942852` |
| `gutenberg-11-alice.epub` | "Alice's Adventures in Wonderland", Lewis Carroll; Project Gutenberg EPUB3 with cover image, 12 chapters | https://www.gutenberg.org/ebooks/11 (EPUB3, with images) | Public domain in the USA; redistributed unmodified with the Project Gutenberg License it contains | `4f81245d31380ac1d6eafb9a321e3691369bc70985736ae4bccf849a4f784036` |

Not covered yet (tracked as E2 in `docs/AUDIT-STATUS.md`): a real-world PPTX (the public-domain
candidates found were not downloadable from here), tracked changes, embedded fonts in DOCX,
scanned (image-only) PDFs.
