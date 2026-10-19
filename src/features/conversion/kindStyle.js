// Visual identity per detected kind (icon, colour class, plural group name).
import {
  Film, Music, Image as ImageIcon, FileText, FileSpreadsheet, Presentation, BookOpen, Archive, Shapes, Clapperboard,
} from 'lucide-react';

export const KIND_STYLE = {
  video: { icon: Film, cls: 't-vid', group: 'וידאו' },
  audio: { icon: Music, cls: 't-aud', group: 'אודיו' },
  image: { icon: ImageIcon, cls: 't-img', group: 'תמונות' },
  gif: { icon: Clapperboard, cls: 't-vid', group: 'GIF' },
  apng: { icon: Clapperboard, cls: 't-vid', group: 'APNG' },
  svg: { icon: Shapes, cls: 't-img', group: 'SVG' },
  pdf: { icon: FileText, cls: 't-doc', group: 'PDF' },
  doc: { icon: FileText, cls: 't-doc', group: 'מסמכים' },
  sheet: { icon: FileSpreadsheet, cls: 't-sheet', group: 'גיליונות' },
  slides: { icon: Presentation, cls: 't-doc', group: 'מצגות' },
  ebook: { icon: BookOpen, cls: 't-book', group: 'ספרים' },
  archive: { icon: Archive, cls: 't-zip', group: 'ארכיונים' },
};

export const FALLBACK_STYLE = { icon: FileText, cls: 't-doc' };
