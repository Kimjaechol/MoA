---
name: xlsx
description: Create, edit, and analyze Excel (.xlsx) and CSV files.
homepage: https://sheetjs.com
metadata:
  {
    "openclaw":
      {
        "emoji": "📊",
        "requires": { "bins": ["node"] },
      },
  }
---

# XLSX

Create, edit, and analyze Excel and CSV files using SheetJS (xlsx) and local Node scripts. No API key required.

## When to use

- Generate Excel reports or CSV exports from structured data
- Read and parse existing spreadsheets
- Transform CSV to XLSX (or vice versa) with formatting
- Perform column-level analysis, filtering, or aggregation

## Quick start

Install the SheetJS library (if not already available):

```bash
npm install xlsx --prefix {baseDir}
```

### Read a spreadsheet

```bash
node -e "
const XLSX = require('{baseDir}/node_modules/xlsx');
const wb = XLSX.readFile('input.xlsx');
const ws = wb.Sheets[wb.SheetNames[0]];
console.log(JSON.stringify(XLSX.utils.sheet_to_json(ws), null, 2));
"
```

### Create a new Excel file

```bash
node -e "
const XLSX = require('{baseDir}/node_modules/xlsx');
const data = [
  { Name: 'Alice', Score: 95 },
  { Name: 'Bob', Score: 87 },
  { Name: 'Carol', Score: 92 },
];
const ws = XLSX.utils.json_to_sheet(data);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Results');
XLSX.writeFile(wb, 'output.xlsx');
console.log('Wrote output.xlsx');
"
```

### Convert CSV to XLSX

```bash
node -e "
const XLSX = require('{baseDir}/node_modules/xlsx');
const wb = XLSX.readFile('data.csv');
XLSX.writeFile(wb, 'data.xlsx');
console.log('Converted data.csv -> data.xlsx');
"
```

### Analyze columns

```bash
node -e "
const XLSX = require('{baseDir}/node_modules/xlsx');
const wb = XLSX.readFile('sales.xlsx');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const total = rows.reduce((s, r) => s + (r.Revenue || 0), 0);
console.log('Total revenue:', total);
console.log('Row count:', rows.length);
console.log('Avg revenue:', (total / rows.length).toFixed(2));
"
```

## Tips

- SheetJS supports `.xlsx`, `.xls`, `.csv`, `.tsv`, `.ods`, and more.
- For large files (>50MB), stream with `XLSX.stream.to_csv()` to avoid memory issues.
- Column widths: set `ws['!cols'] = [{ wch: 20 }, { wch: 10 }]` before writing.
