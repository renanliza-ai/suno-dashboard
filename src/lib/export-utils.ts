"use client";

import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type ReportSheet = {
  name: string;
  columns: string[];
  rows: (string | number)[][];
};

export type ReportMeta = {
  title: string;
  subtitle?: string;
  accountName?: string;
  generatedBy?: string;
  period?: string;
};

const fileStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

const safeFile = (s: string) => s.replace(/[^a-z0-9\-]+/gi, "-").toLowerCase().replace(/-+/g, "-").replace(/^-|-$/g, "");

/**
 * Gera e faz download de arquivo XLSX com uma ou mais abas.
 */
export function downloadXlsx(meta: ReportMeta, sheets: ReportSheet[]) {
  const wb = XLSX.utils.book_new();

  // Aba de metadata
  const metaRows: (string | number)[][] = [
    ["Relatório", meta.title],
    ["Subtítulo", meta.subtitle || ""],
    ["Conta", meta.accountName || ""],
    ["Período", meta.period || ""],
    ["Gerado em", new Date().toLocaleString("pt-BR")],
    ["Gerado por", meta.generatedBy || "Copiloto Suno"],
  ];
  const metaWs = XLSX.utils.aoa_to_sheet(metaRows);
  metaWs["!cols"] = [{ wch: 18 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, metaWs, "Relatório");

  sheets.forEach((s) => {
    const data = [s.columns, ...s.rows];
    const ws = XLSX.utils.aoa_to_sheet(data);
    // auto-size simples
    ws["!cols"] = s.columns.map((c, i) => ({
      wch: Math.max(
        c.length + 2,
        ...s.rows.map((r) => String(r[i] ?? "").length + 2)
      ),
    }));
    const safeName = s.name.slice(0, 30);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  });

  const filename = `${safeFile(meta.title)}-${fileStamp()}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}

/**
 * Gera e faz download de CSV (apenas a primeira aba, se múltiplas).
 */
export function downloadCsv(meta: ReportMeta, sheets: ReportSheet[]) {
  const first = sheets[0];
  const data = [first.columns, ...first.rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ";" });
  // BOM UTF-8 para Excel abrir acentos corretamente
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const filename = `${safeFile(meta.title)}-${fileStamp()}.csv`;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/**
 * Gera e faz download de PDF com cabeçalho, meta, e tabelas.
 */
export function downloadPdf(meta: ReportMeta, sheets: ReportSheet[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  // Header roxo
  doc.setFillColor(124, 92, 255);
  doc.rect(0, 0, pageW, 60, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Suno Analytics", 40, 28);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(meta.title, 40, 46);

  // Meta
  doc.setTextColor(50, 50, 60);
  doc.setFontSize(9);
  let y = 80;
  const metaLines = [
    meta.subtitle,
    meta.accountName ? `Conta: ${meta.accountName}` : null,
    meta.period ? `Período: ${meta.period}` : null,
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    meta.generatedBy ? `Gerado por: ${meta.generatedBy}` : null,
  ].filter(Boolean) as string[];
  metaLines.forEach((line) => {
    doc.text(line, 40, y);
    y += 14;
  });
  y += 10;

  sheets.forEach((s, idx) => {
    if (idx > 0) y += 12;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 40);
    doc.text(s.name, 40, y);
    y += 6;
    autoTable(doc, {
      startY: y + 6,
      head: [s.columns],
      body: s.rows.map((r) => r.map((v) => String(v))),
      headStyles: {
        fillColor: [124, 92, 255],
        textColor: 255,
        fontStyle: "bold",
        fontSize: 9,
      },
      bodyStyles: {
        fontSize: 9,
        textColor: [50, 50, 60],
      },
      alternateRowStyles: { fillColor: [247, 246, 253] },
      margin: { left: 40, right: 40 },
      didDrawPage: () => {
        // rodapé
        const pageCount = doc.getNumberOfPages();
        const current = doc.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setTextColor(140, 140, 150);
        doc.text(
          `Suno Analytics · pág. ${current} de ${pageCount}`,
          pageW / 2,
          doc.internal.pageSize.getHeight() - 20,
          { align: "center" }
        );
      },
    });
    // @ts-expect-error - plugin adiciona lastAutoTable em tempo de execução
    y = (doc.lastAutoTable?.finalY ?? y + 40) + 10;
  });

  const filename = `${safeFile(meta.title)}-${fileStamp()}.pdf`;
  doc.save(filename);
  return filename;
}

export function downloadReport(
  format: "xlsx" | "pdf" | "csv",
  meta: ReportMeta,
  sheets: ReportSheet[]
): string {
  if (format === "xlsx") return downloadXlsx(meta, sheets);
  if (format === "pdf") return downloadPdf(meta, sheets);
  return downloadCsv(meta, sheets);
}
