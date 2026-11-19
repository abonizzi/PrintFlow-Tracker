import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildTable, type PdfItem, type RawTable } from './tableImport';

/** Estrae il testo (con coordinate) dai PDF digitali. I PDF scansionati non hanno testo: servirebbe un OCR separato. */
export async function readPdfTable(buf: ArrayBuffer): Promise<{ table?: RawTable; error?: string }> {
  try {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    const pages: PdfItem[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      pages.push((tc.items as unknown as { str?: string; transform: number[]; width: number }[])
        .filter(i => typeof i.str === 'string').map(i => ({ str: i.str!, x: i.transform[4], y: i.transform[5], w: i.width })));
    }
    if (pages.every(p => p.every(i => !i.str.trim())))
      return { error: 'Il PDF sembra scansionato (nessun testo selezionabile): serve un OCR separato, non ancora disponibile. Usa il JSON.' };
    const table = buildTable(pages);
    return table ? { table } : { error: 'Intestazione della tabella non riconosciuta (servono almeno 3 colonne note, es. Stampa, Durata, Stato). Usa il JSON.' };
  } catch (e) { return { error: `PDF non leggibile: ${(e as Error).message}` }; }
}
