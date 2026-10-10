/**
 * Générateur PDF minimal (texte, filets, rectangles) sans dépendance.
 * Utilisé pour les factures/devis et les documents de démonstration.
 * Polices standard Helvetica en WinAnsiEncoding : accents français et € pris en charge.
 */

const WIN_ANSI_EXTRA: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96,
  "—": 0x97, "œ": 0x9c, "Œ": 0x8c, "™": 0x99,
};

function encodeText(s: string): string {
  let out = "";
  for (const ch of s.replace(/[  ]/g, " ").replace(/−/g, "-")) {
    const code = ch.codePointAt(0)!;
    let byte: number;
    if (WIN_ANSI_EXTRA[ch] != null) byte = WIN_ANSI_EXTRA[ch];
    else if (code < 256) byte = code;
    else byte = 0x3f; // ?
    const c = String.fromCharCode(byte);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return out;
}

/** Largeurs Helvetica approximatives (unités /1000) pour aligner à droite. */
function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) {
    if (/[il.,:;'|!]/.test(ch)) w += 250;
    else if (/[fjtrI ]/.test(ch)) w += 300;
    else if (/[mwMW]/.test(ch)) w += 850;
    else if (/[A-Z0-9]/.test(ch)) w += 640;
    else w += 530;
  }
  return (w * size * (bold ? 1.05 : 1)) / 1000;
}

type Op = string;

export class PdfPage {
  ops: Op[] = [];
  readonly width = 595.28;
  readonly height = 841.89;

  text(x: number, y: number, s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? "F2" : "F1";
    const [r, g, b] = opts.color ?? [0.08, 0.08, 0.075];
    let px = x;
    if (opts.align === "right") px = x - textWidth(s, size, opts.bold);
    if (opts.align === "center") px = x - textWidth(s, size, opts.bold) / 2;
    this.ops.push(`BT ${r} ${g} ${b} rg /${font} ${size} Tf ${px.toFixed(2)} ${(this.height - y).toFixed(2)} Td (${encodeText(s)}) Tj ET`);
    return this;
  }

  /** Texte avec retour à la ligne automatique ; renvoie la position y suivante. */
  paragraph(x: number, y: number, s: string, maxWidth: number, opts: { size?: number; bold?: boolean; lineHeight?: number; color?: [number, number, number] } = {}) {
    const size = opts.size ?? 10;
    const lh = opts.lineHeight ?? size * 1.45;
    let cy = y;
    for (const para of s.split("\n")) {
      let line = "";
      for (const word of para.split(" ")) {
        const test = line ? `${line} ${word}` : word;
        if (textWidth(test, size, opts.bold) > maxWidth && line) {
          this.text(x, cy, line, opts);
          cy += lh;
          line = word;
        } else line = test;
      }
      this.text(x, cy, line, opts);
      cy += lh;
    }
    return cy;
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: { width?: number; color?: [number, number, number] } = {}) {
    const [r, g, b] = opts.color ?? [0.85, 0.84, 0.8];
    this.ops.push(`${r} ${g} ${b} RG ${opts.width ?? 0.6} w ${x1} ${this.height - y1} m ${x2} ${this.height - y2} l S`);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, color: [number, number, number]) {
    const [r, g, b] = color;
    this.ops.push(`${r} ${g} ${b} rg ${x} ${this.height - y - h} ${w} ${h} re f`);
    return this;
  }
}

export class PdfDocument {
  pages: PdfPage[] = [];
  title: string;
  constructor(title = "Document") {
    this.title = title;
  }
  addPage() {
    const p = new PdfPage();
    this.pages.push(p);
    return p;
  }
  toBuffer(): Buffer {
    const objects: string[] = [];
    const add = (s: string) => {
      objects.push(s);
      return objects.length;
    };
    const catalogId = add(""); // placeholder
    const pagesId = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const content = page.ops.join("\n");
      const contentId = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`));
    }
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const infoId = add(`<< /Title (${encodeText(this.title)}) /Producer (Recap) >>`);

    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    objects.forEach((obj, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(out, "latin1");
  }
}

/** Document texte simple (titre + paragraphes) — pour les modèles de démonstration. */
export function simpleTextPdf(title: string, subtitle: string, sections: { heading: string; body: string }[]): Buffer {
  const doc = new PdfDocument(title);
  let page = doc.addPage();
  page.rect(0, 0, page.width, 6, [0.18, 0.36, 0.82]);
  page.text(56, 80, title, { size: 22, bold: true });
  page.text(56, 104, subtitle, { size: 11, color: [0.45, 0.45, 0.42] });
  let y = 150;
  for (const s of sections) {
    if (y > 740) { page = doc.addPage(); y = 70; }
    page.text(56, y, s.heading, { size: 12.5, bold: true });
    y = page.paragraph(56, y + 20, s.body, 480, { size: 10.5, color: [0.25, 0.25, 0.23] }) + 16;
  }
  return doc.toBuffer();
}
