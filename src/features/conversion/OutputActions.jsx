import React from 'react';
import { Check, ExternalLink, FolderOpen } from 'lucide-react';

export default function OutputActions({ onOpen, onShow }) {
  return (
    <>
      <span className="pill pill-success"><Check size={14} /> הושלם</span>
      <button className="icon-btn" title="פתח" onClick={onOpen}><ExternalLink size={17} /></button>
      <button className="icon-btn" title="הצג בתיקייה" onClick={onShow}><FolderOpen size={17} /></button>
    </>
  );
}
