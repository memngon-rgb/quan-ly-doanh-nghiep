import readXlsxFile from 'read-excel-file'
import writeXlsxFile from 'write-excel-file'
import { safeCell } from './format'

export type Cell = string | number | boolean | Date | null

/** Đọc file .xlsx hoặc .csv thành bảng 2 chiều */
export async function readTable(file: File): Promise<Cell[][]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) {
    return (await readXlsxFile(file)) as Cell[][]
  }
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return parseCsv(await file.text())
  }
  throw new Error('Chỉ hỗ trợ file .xlsx hoặc .csv. Nếu file là .xls, hãy mở bằng Excel và Lưu thành .xlsx.')
}

export function parseCsv(text: string): Cell[][] {
  const clean = text.replace(/^﻿/, '')
  const first = clean.split(/\r?\n/, 1)[0] ?? ''
  const delim = [';', '\t', ','].reduce((best, d) => (first.split(d).length > first.split(best).length ? d : best), ',')
  const rows: Cell[][] = []
  let row: Cell[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (q) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
    } else cur += ch
  }
  row.push(cur)
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}

/** Xuất bảng ra file .xlsx và tải về máy */
export async function exportXlsx(fileName: string, headers: string[], rows: (string | number)[][]): Promise<void> {
  const data = [
    headers.map((h) => ({ value: h, fontWeight: 'bold' as const })),
    ...rows.map((r) =>
      r.map((v) => (typeof v === 'number' ? { value: v, type: Number } : { value: safeCell(String(v ?? '')), type: String })),
    ),
  ]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeXlsxFile(data as any, { fileName: fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx` })
}

export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}
