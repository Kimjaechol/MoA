---
name: pdf-2
description: "Comprehensive PDF toolkit: extract text/tables/images, merge, split, fill forms, convert, and compress PDFs using Python libraries."
homepage: https://github.com/jsvine/pdfplumber
metadata:
  {
    "openclaw":
      {
        "emoji": "📄",
        "requires": { "bins": ["python3", "pip3"] },
      },
  }
---

# PDF-2 -- Comprehensive PDF Toolkit

Full-featured PDF manipulation beyond simple reading. Extract text, tables, and
images; merge and split documents; fill forms; convert formats; compress files.
Uses Python libraries that run locally -- no API key required.

## When to use

- "extract tables from this PDF"
- "merge these PDFs into one"
- "split this PDF by pages"
- "fill out this PDF form"
- "extract images from this PDF"
- "compress this PDF"
- "convert PDF to images" / "convert images to PDF"
- Any PDF task beyond basic text extraction (use `nano-pdf` for simple reads)

## Dependencies

Install the required Python libraries (one-time):

```bash
pip3 install pdfplumber reportlab PyPDF2 Pillow
```

## Quick start

### Extract text (all pages)

```bash
python3 -c "
import pdfplumber
with pdfplumber.open('input.pdf') as pdf:
    for i, page in enumerate(pdf.pages):
        print(f'--- Page {i+1} ---')
        print(page.extract_text() or '(no text)')
"
```

### Extract tables to CSV

```bash
python3 -c "
import pdfplumber, csv, sys
with pdfplumber.open('input.pdf') as pdf:
    writer = csv.writer(sys.stdout)
    for page in pdf.pages:
        for table in page.extract_tables():
            for row in table:
                writer.writerow(row)
"
```

### Extract images

```bash
python3 -c "
import pdfplumber, os
os.makedirs('/tmp/pdf_images', exist_ok=True)
with pdfplumber.open('input.pdf') as pdf:
    for i, page in enumerate(pdf.pages):
        for j, img in enumerate(page.images):
            print(f'Page {i+1}, image {j+1}: {img[\"width\"]}x{img[\"height\"]}')
"
```

### Merge multiple PDFs

```bash
python3 -c "
from PyPDF2 import PdfMerger
merger = PdfMerger()
for f in ['file1.pdf', 'file2.pdf', 'file3.pdf']:
    merger.append(f)
merger.write('merged.pdf')
merger.close()
print('Merged -> merged.pdf')
"
```

### Split PDF by page range

```bash
python3 -c "
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader('input.pdf')
writer = PdfWriter()
# Extract pages 2-5 (0-indexed: 1 to 4)
for p in range(1, 5):
    writer.add_page(reader.pages[p])
with open('pages_2_to_5.pdf', 'wb') as f:
    writer.write(f)
print('Split -> pages_2_to_5.pdf')
"
```

### Fill a PDF form

```bash
python3 -c "
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader('form.pdf')
writer = PdfWriter()
writer.append(reader)
writer.update_page_form_field_values(
    writer.pages[0],
    {'field_name': 'value', 'another_field': 'another_value'}
)
with open('filled_form.pdf', 'wb') as f:
    writer.write(f)
print('Filled -> filled_form.pdf')
"
```

### Compress / reduce file size

```bash
python3 -c "
from PyPDF2 import PdfReader, PdfWriter
reader = PdfReader('input.pdf')
writer = PdfWriter()
for page in reader.pages:
    page.compress_content_streams()
    writer.add_page(page)
with open('compressed.pdf', 'wb') as f:
    writer.write(f)
import os
orig = os.path.getsize('input.pdf')
comp = os.path.getsize('compressed.pdf')
print(f'Compressed: {orig} -> {comp} bytes ({100-comp*100//orig}% reduction)')
"
```

### Get PDF metadata and page count

```bash
python3 -c "
from PyPDF2 import PdfReader
reader = PdfReader('input.pdf')
print(f'Pages: {len(reader.pages)}')
info = reader.metadata
if info:
    for k, v in info.items():
        print(f'{k}: {v}')
"
```

## No API Key Required

All operations run locally using open-source Python libraries. No network calls,
no accounts, no usage limits. For simple text extraction only, consider the
lighter-weight `nano-pdf` skill instead.
