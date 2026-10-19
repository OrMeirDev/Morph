// Adapter registry: the names used in domain/capabilities.cjs -> implementations.
module.exports = {
  ffmpeg: require('./ffmpegAdapter.cjs'),
  image: require('./imageAdapter.cjs'),
  pdf: require('./pdfAdapter.cjs'),
  office: require('./officeAdapter.cjs'),
  ebook: require('./ebookAdapter.cjs'),
  archive: require('./archiveAdapter.cjs'),
};
