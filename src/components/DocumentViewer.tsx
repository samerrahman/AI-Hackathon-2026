import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Minus, Plus, ScanLine, X } from 'lucide-react';
import { getDocument, TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { SelectionContext, StudyDocument } from '../../shared/types';
import '../lib/documents';
import './document-viewer.css';

export interface DocumentViewerProps {
  documents: StudyDocument[];
  documentId: string;
  pageIndex: number;
  onNavigate: (documentId: string, pageIndex: number) => void;
  highlightIds: string[];
  onSelection: (selection: SelectionContext | null) => void;
  /** When supplied, the parent owns the selection strip and clearing behavior. */
  selection?: SelectionContext | null;
}

export function DocumentViewer({ documents, documentId, pageIndex, onNavigate, highlightIds, onSelection, selection: controlledSelection }: DocumentViewerProps) {
  const current = documents.find(document => document.id === documentId) ?? documents[0];
  const safePage = Math.max(0, Math.min(pageIndex, (current?.pageCount ?? 1) - 1));
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(700);
  const [pageSize, setPageSize] = useState({ width: 612, height: 792 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [localSelection, setSelection] = useState<SelectionContext | null>(null);
  const selection = controlledSelection === undefined ? localSelection : controlledSelection;
  const [retry, setRetry] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const render = useRef<RenderTask | null>(null);
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;
  const activeSpans = current?.spans.filter(span => span.pageIndex === safePage) ?? [];
  const highlighted = activeSpans.filter(span => highlightIds.includes(span.id));
  const fitScale = Math.max(.15, (width - (width < 500 ? 24 : 56)) / pageSize.width);
  const scale = fitScale * zoom;
  const displayWidth = pageSize.width * scale;
  const displayHeight = pageSize.height * scale;
  const highlightKey = `${current?.id}:${safePage}:${highlightIds.join(',')}`;
  const lastScrolledHighlight = useRef('');

  useEffect(() => {
    if (!scroller.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelection(null);
    onSelectionRef.current(null);
    window.getSelection()?.removeAllRanges();
    scroller.current?.scrollTo({ top: 0, left: 0 });
  }, [current?.id, safePage]);

  useEffect(() => {
    if (controlledSelection === null) {
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [controlledSelection]);

  useEffect(() => {
    setPdf(null);
    setError('');
    if (!current || current.kind !== 'pdf') { setBusy(false); return; }
    if (!current.blob) { setError('The original PDF is missing from this browser. Upload it again to view its pages.'); return; }
    let disposed = false;
    let loading: ReturnType<typeof getDocument> | undefined;
    setBusy(true);
    current.blob.arrayBuffer().then(bytes => {
      if (disposed) return;
      loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      return loading.promise.then(document => { if (!disposed) setPdf(document); });
    }).catch(() => { if (!disposed) { setBusy(false); setError('This page could not be opened. Retry, or use the extracted source passages below.'); } });
    return () => {
      disposed = true;
      render.current?.cancel();
      if (loading) void loading.destroy();
    };
  }, [current?.id, current?.blob, current?.kind, retry]);

  useEffect(() => {
    if (!pdf) return;
    let disposed = false;
    pdf.getPage(safePage + 1).then(page => {
      if (disposed) return;
      const viewport = page.getViewport({ scale: 1 });
      setPageSize({ width: viewport.width, height: viewport.height });
    }).catch(() => { if (!disposed) setError('This page could not be read. Try another page.'); });
    return () => { disposed = true; };
  }, [pdf, safePage]);

  useEffect(() => {
    if (!pdf || !canvas.current || !textLayer.current) return;
    let disposed = false;
    let localRender: RenderTask | undefined;
    let layer: TextLayer | undefined;
    const targetCanvas = canvas.current;
    const targetText = textLayer.current;
    setBusy(true);
    setError('');
    const draw = async () => {
      const page = await pdf.getPage(safePage + 1);
      if (disposed) return;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      targetCanvas.width = Math.floor(viewport.width * ratio);
      targetCanvas.height = Math.floor(viewport.height * ratio);
      targetCanvas.style.width = `${viewport.width}px`;
      targetCanvas.style.height = `${viewport.height}px`;
      targetText.replaceChildren();
      targetText.style.setProperty('--scale-factor', String(scale));
      targetText.style.setProperty('--total-scale-factor', String(scale));
      targetText.style.setProperty('--min-font-size', '1');
      const context = targetCanvas.getContext('2d');
      if (!context) throw new Error('Canvas is not available.');
      localRender = page.render({ canvas: targetCanvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      render.current = localRender;
      await localRender.promise;
      if (disposed) return;
      const content = await page.getTextContent();
      if (disposed) return;
      layer = new TextLayer({ textContentSource: content, container: targetText, viewport });
      await layer.render();
      if (!disposed) setBusy(false);
    };
    void draw().catch(error => {
      if (!disposed && error?.name !== 'RenderingCancelledException' && error?.name !== 'AbortException') {
        setBusy(false);
        setError('There was a problem drawing this page. Retry, or read the extracted passages below.');
      }
    });
    return () => { disposed = true; localRender?.cancel(); layer?.cancel(); };
  }, [pdf, safePage, scale, retry]);

  useEffect(() => { lastScrolledHighlight.current = ''; }, [highlightIds]);

  useEffect(() => {
    if (!highlighted.length) { lastScrolledHighlight.current = ''; return; }
    if (!scroller.current || busy || lastScrolledHighlight.current === highlightKey) return;
    lastScrolledHighlight.current = highlightKey;
    const top = highlighted[0].rects?.[0]?.y;
    const textElement = surface.current?.querySelector<HTMLElement>(`[data-span-id="${highlighted[0].id}"]`);
    const offset = top === undefined ? textElement?.offsetTop : top * displayHeight;
    if (offset !== undefined) scroller.current.scrollTo({ top: Math.max(0, offset + 28 - scroller.current.clientHeight * .25), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [highlightKey, busy, highlighted, displayHeight]);

  const captureSelection = useCallback(() => {
    const selected = window.getSelection();
    if (!selected || !selected.rangeCount || !selected.toString().trim() || !surface.current || !current) return;
    const range = selected.getRangeAt(0);
    if (!surface.current.contains(range.commonAncestorContainer)) return;
    const text = selected.toString().trim().slice(0, 4000);
    const bounds = surface.current.getBoundingClientRect();
    const selectedRects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
    const spanIds = activeSpans.filter(span => {
      const element = surface.current?.querySelector(`[data-span-id="${span.id}"]`);
      if (element) return range.intersectsNode(element);
      return span.rects?.some(rect => selectedRects.some(selectionRect => {
        const left = bounds.left + rect.x * bounds.width;
        const top = bounds.top + rect.y * bounds.height;
        return left < selectionRect.right && left + rect.width * bounds.width > selectionRect.left && top < selectionRect.bottom && top + rect.height * bounds.height > selectionRect.top;
      })) || span.text.replace(/\s+/g, ' ').includes(text.replace(/\s+/g, ' '));
    }).map(span => span.id);
    const context = { text, documentId: current.id, pageIndex: safePage, spanIds };
    setSelection(context);
    onSelectionRef.current(context);
  }, [current, safePage, activeSpans]);

  const clearSelection = () => {
    setSelection(null);
    onSelectionRef.current(null);
    window.getSelection()?.removeAllRanges();
  };

  if (!current) return <div className="document-empty"><FileText size={30} /><p>Add your notes to see them here.</p></div>;

  return <section className="document-viewer" aria-label="Lecture notes">
    <div className="document-toolbar">
      <div className="document-source-picker">
        <FileText size={16} aria-hidden="true" />
        <select aria-label="Choose source document" value={current.id} onChange={event => onNavigate(event.target.value, 0)}>
          {documents.map(document => <option key={document.id} value={document.id}>{document.name}</option>)}
        </select>
      </div>
      <div className="document-zoom" aria-label="Document zoom">
        <button aria-label="Zoom out" title="Zoom out" onClick={() => setZoom(value => Math.max(.5, value - .15))} disabled={zoom <= .5}><Minus size={15} /></button>
        <button className="zoom-value" aria-label="Fit document to width" title="Fit to width" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button aria-label="Zoom in" title="Zoom in" onClick={() => setZoom(value => Math.min(2.5, value + .15))} disabled={zoom >= 2.5}><Plus size={15} /></button>
      </div>
    </div>
    <div className="document-location-bar">
      <span><span className="document-dot" /> {current.kind === 'pdf' ? 'Original document' : 'Your pasted notes'}</span>
      <div className="document-pagination">
        <button aria-label="Previous page" disabled={safePage <= 0} onClick={() => onNavigate(current.id, safePage - 1)}><ChevronLeft size={16} /></button>
        <label>{current.kind === 'pdf' ? 'Page' : 'Section'} <input aria-label={current.kind === 'pdf' ? 'Page number' : 'Section number'} type="number" min={1} max={current.pageCount} value={safePage + 1} onChange={event => { const page = Number(event.target.value); if (page >= 1 && page <= current.pageCount) onNavigate(current.id, page - 1); }} /> <span>of {current.pageCount}</span></label>
        <button aria-label="Next page" disabled={safePage >= current.pageCount - 1} onClick={() => onNavigate(current.id, safePage + 1)}><ChevronRight size={16} /></button>
      </div>
    </div>
    {selection && controlledSelection === undefined && <div className="selection-context" role="status"><ScanLine size={15} /><span><strong>Passage selected</strong> · {selection.text.length} characters. “Explain this part” will use this passage.</span><button aria-label="Clear selected passage" onClick={clearSelection}><X size={15} /></button></div>}
    <div className="document-scroll" ref={scroller}>
      {current.warnings.filter(warning => warning.startsWith(`Page ${safePage + 1}:`)).map(warning => <p className="document-warning" key={warning}>{warning}</p>)}
      {error && <div className="document-error" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Retry page</button></div>}
      {busy && current.kind === 'pdf' && <span className="page-loading" role="status">Opening page {safePage + 1}…</span>}
      <div className={`document-paper ${current.kind === 'text' ? 'document-text-paper' : ''}`} ref={surface} style={current.kind === 'pdf' ? { width: displayWidth, height: displayHeight } : { width: `${zoom * 100}%`, maxWidth: `${850 * zoom}px`, fontSize: `${16 * zoom}px` }} onPointerUp={captureSelection} onKeyUp={captureSelection}>
        {current.kind === 'pdf' ? <>
          <canvas ref={canvas} aria-label={`${current.name}, page ${safePage + 1}`} />
          <div className="source-highlights" aria-hidden="true">{highlighted.flatMap(span => (span.rects ?? []).map((rect, index) => <div key={`${span.id}-${index}`} className="source-highlight" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />))}</div>
          <div className="textLayer" ref={textLayer} />
        </> : <>
          <div className="pasted-document-heading"><span>STUDY NOTES</span><h2>{current.name}</h2>{current.pageCount > 1 && <small>Section {safePage + 1} of {current.pageCount}</small>}</div>
          {activeSpans.map(span => <p key={span.id} data-span-id={span.id} className={highlightIds.includes(span.id) ? 'text-source-highlight' : ''}>{span.text}</p>)}
          <div className="pasted-document-footer">TEACH STU · YOUR NOTES <span>{safePage + 1}</span></div>
        </>}
      </div>
      {error && activeSpans.length > 0 && <details className="extracted-fallback"><summary>Read extracted text for this page</summary>{activeSpans.map(span => <p key={span.id}>{span.text}</p>)}</details>}
      <p className="document-selection-tip">Select a passage to give Stu exact context.</p>
    </div>
    {highlighted.length > 0 && <div className="source-quote-card" role="note" aria-label="Referenced source passages"><div><span className="source-quote-marker" /> <strong>From your notes</strong><span>{current.kind === 'pdf' ? 'p.' : 'section'} {safePage + 1}</span></div>{highlighted.slice(0, 3).map(span => <blockquote key={span.id}>{span.text}</blockquote>)}{highlighted.some(span => !span.rects?.length) && current.kind === 'pdf' && <small>Page reference; exact text position was not available.</small>}</div>}
  </section>;
}

export default DocumentViewer;
