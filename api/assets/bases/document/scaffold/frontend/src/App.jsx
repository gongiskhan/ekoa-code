/**
 * Document shell — platform-provided, print-tested.
 *
 * AGENT: the document's CONTENT lives in ./documentData.js — edit that file.
 * Only touch this shell for user-requested EXTRAS (e.g. fill-in form fields,
 * an additional tab). Never remove or restyle the toolbar, exports, or the
 * print layout; the Word/PDF output depends on them.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
} from 'docx';
import documentData from './documentData';

// ---------------------------------------------------------------------------
// .docx generation — mirrors the on-screen blocks 1:1. Notes are NOT included.
// ---------------------------------------------------------------------------

const DOCX_FONT = 'Times New Roman';
const PT = (n) => n * 2; // docx sizes are half-points

function runsFor(text, opts = {}) {
  return [new TextRun({ text: String(text ?? ''), font: DOCX_FONT, size: PT(11), ...opts })];
}

function blockToDocxParagraphs(block) {
  switch (block.type) {
    case 'heading':
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 360, after: 240 },
        children: runsFor(block.text, { bold: true, size: PT(12) }),
      })];
    case 'clause': {
      const out = [new Paragraph({
        spacing: { before: 300, after: 160 },
        children: runsFor(block.title, { bold: true }),
      })];
      for (const p of block.paragraphs || []) {
        out.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 140 },
          children: runsFor(p),
        }));
      }
      return out;
    }
    case 'list':
      return (block.items || []).map((item) => new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 100 },
        children: runsFor(item),
      }));
    case 'pagebreak':
      return [new Paragraph({ children: [new PageBreak()] })];
    case 'signatures': {
      const out = [new Paragraph({ spacing: { before: 600 }, children: runsFor('') })];
      for (const party of block.parties || []) {
        out.push(
          new Paragraph({ spacing: { before: 480 }, children: runsFor('_________________________________________') }),
          new Paragraph({ spacing: { before: 80 }, children: runsFor(party.label, { bold: true }) }),
        );
        if (party.detail) {
          out.push(new Paragraph({ children: runsFor(party.detail, { size: PT(10) }) }));
        }
      }
      return out;
    }
    case 'paragraph':
    default:
      return [new Paragraph({
        alignment: block.align === 'center' ? AlignmentType.CENTER
          : block.align === 'left' ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
        spacing: { after: 140 },
        children: runsFor(block.text),
      })];
  }
}

function buildDocumentDocx() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: documentData.subtitle ? 100 : 360 },
      children: runsFor(documentData.title, { bold: true, size: PT(14) }),
    }),
  ];
  if (documentData.subtitle) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: runsFor(documentData.subtitle, { italics: true }),
    }));
  }
  for (const block of documentData.blocks || []) children.push(...blockToDocxParagraphs(block));
  return new Document({
    sections: [{
      properties: { page: { margin: { top: 1247, bottom: 1247, left: 1134, right: 1134 } } }, // 22mm / 20mm in twips
      children,
    }],
  });
}

function buildNotesDocx() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: runsFor(`Nota de alterações — ${documentData.title}`, { bold: true, size: PT(13) }),
    }),
  ];
  for (const note of documentData.notes || []) {
    children.push(
      new Paragraph({ spacing: { before: 280, after: 120 }, children: runsFor(note.heading, { bold: true }) }),
      new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 140 }, children: runsFor(note.body) }),
    );
  }
  return new Document({ sections: [{ children }] });
}

async function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function DocumentBlock({ block }) {
  switch (block.type) {
    case 'heading':
      return <h2 className="doc-heading">{block.text}</h2>;
    case 'clause':
      return (
        <section className="doc-clause">
          <h3 className="doc-clause-title">{block.title}</h3>
          {(block.paragraphs || []).map((p, i) => <p key={i} className="doc-p">{p}</p>)}
        </section>
      );
    case 'list':
      return <ul className="doc-list">{(block.items || []).map((item, i) => <li key={i}>{item}</li>)}</ul>;
    case 'pagebreak':
      return <div className="page-break" />;
    case 'signatures':
      return (
        <div className="doc-signatures">
          {(block.parties || []).map((party, i) => (
            <div key={i} className="doc-signature">
              <div className="doc-signature-line" />
              <div className="doc-signature-label">{party.label}</div>
              {party.detail ? <div className="doc-signature-detail">{party.detail}</div> : null}
            </div>
          ))}
        </div>
      );
    case 'paragraph':
    default:
      return <p className="doc-p" style={block.align ? { textAlign: block.align } : undefined}>{block.text}</p>;
  }
}

export default function App() {
  const hasNotes = (documentData.notes || []).length > 0;
  const [tab, setTab] = useState('documento');
  const [cloud, setCloud] = useState(null);
  const [cloudState, setCloudState] = useState({ status: 'idle' }); // idle | saving | saved | error

  useEffect(() => {
    if (window.__ekoa?.cloudFiles) {
      window.__ekoa.cloudFiles.status().then(setCloud).catch(() => setCloud(null));
    }
  }, []);

  const downloadWord = useCallback(async () => {
    const blob = await Packer.toBlob(buildDocumentDocx());
    await downloadBlob(blob, `${documentData.fileName}.docx`);
  }, []);

  const downloadPdf = useCallback(async () => {
    setTab('documento'); // the export captures the live DOM — only the document may be visible
    await new Promise((resolve) => setTimeout(resolve, 200));
    await window.__ekoa.exportPdf({ filename: documentData.fileName });
  }, []);

  const downloadNotes = useCallback(async () => {
    const blob = await Packer.toBlob(buildNotesDocx());
    await downloadBlob(blob, `${documentData.fileName}-nota-de-alteracoes.docx`);
  }, []);

  const saveToCloud = useCallback(async (provider) => {
    setCloudState({ status: 'saving', provider });
    try {
      const blob = await Packer.toBlob(buildDocumentDocx());
      const meta = await window.__ekoa.cloudFiles.upload(blob, {
        provider,
        name: `${documentData.fileName}.docx`,
        type: DOCX_MIME,
      });
      setCloudState({ status: 'saved', provider, webUrl: meta.webUrl });
    } catch (err) {
      setCloudState({ status: 'error', provider, message: String(err && err.message ? err.message : err) });
    }
  }, []);

  const providerLabel = { google: 'Google Drive', microsoft: 'OneDrive' };

  return (
    <div className="doc-app">
      <header className="doc-toolbar no-print" data-no-pdf="true">
        <div className="doc-toolbar-title">
          <span className="doc-toolbar-name">{documentData.title}</span>
        </div>
        <div className="doc-toolbar-actions">
          <button className="btn btn-primary" onClick={downloadWord}>Descarregar Word</button>
          <button className="btn btn-outline" onClick={downloadPdf}>Descarregar PDF</button>
          {cloud?.google?.connected && (
            <button className="btn btn-outline" disabled={cloudState.status === 'saving'} onClick={() => saveToCloud('google')}>
              {cloudState.status === 'saving' && cloudState.provider === 'google' ? 'A guardar…' : 'Guardar no Google Drive'}
            </button>
          )}
          {cloud?.microsoft?.connected && (
            <button className="btn btn-outline" disabled={cloudState.status === 'saving'} onClick={() => saveToCloud('microsoft')}>
              {cloudState.status === 'saving' && cloudState.provider === 'microsoft' ? 'A guardar…' : 'Guardar no OneDrive'}
            </button>
          )}
        </div>
        {cloudState.status === 'saved' && (
          <div className="doc-cloud-status ok">
            Guardado no {providerLabel[cloudState.provider]}.{' '}
            {cloudState.webUrl ? <a href={cloudState.webUrl} target="_blank" rel="noreferrer">Abrir</a> : null}
            <button className="doc-cloud-dismiss" onClick={() => setCloudState({ status: 'idle' })}>×</button>
          </div>
        )}
        {cloudState.status === 'error' && (
          <div className="doc-cloud-status err">
            Não foi possível guardar. {cloudState.message}
            <button className="doc-cloud-dismiss" onClick={() => setCloudState({ status: 'idle' })}>×</button>
          </div>
        )}
      </header>

      {hasNotes && (
        <nav className="doc-tabs no-print" data-no-pdf="true">
          <button className={tab === 'documento' ? 'doc-tab active' : 'doc-tab'} onClick={() => setTab('documento')}>Documento</button>
          <button className={tab === 'notas' ? 'doc-tab active' : 'doc-tab'} onClick={() => setTab('notas')}>Nota de alterações</button>
        </nav>
      )}

      {tab === 'documento' ? (
        <main className="sheet">
          <h1 className="doc-title">{documentData.title}</h1>
          {documentData.subtitle ? <p className="doc-subtitle">{documentData.subtitle}</p> : null}
          {(documentData.blocks || []).map((block, i) => <DocumentBlock key={i} block={block} />)}
        </main>
      ) : (
        <main className="sheet notes-sheet no-print" data-no-pdf="true">
          <div className="notes-header">
            <h1 className="doc-title">Nota de alterações</h1>
            <button className="btn btn-outline" onClick={downloadNotes}>Descarregar nota (Word)</button>
          </div>
          {(documentData.notes || []).map((note, i) => (
            <section key={i} className="note">
              <h3 className="note-heading">{note.heading}</h3>
              <p className="doc-p">{note.body}</p>
            </section>
          ))}
        </main>
      )}
    </div>
  );
}
