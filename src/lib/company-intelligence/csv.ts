/**
 * Minimal RFC-4180 CSV parser.
 *
 * Hand-rolled rather than adding a dependency, in keeping with this project's
 * deliberately small dependency surface. Handles the parts that actually occur
 * in company seed data: quoted fields, embedded commas and newlines inside
 * quotes, and doubled quotes ("") as an escaped quote. The first row is the
 * header; each subsequent row becomes an object keyed by header name.
 *
 * Not a general-purpose CSV library — no streaming, no custom delimiters, no
 * type coercion. It reads a whole file into rows of strings. That is all the
 * import pipeline needs.
 */

/** Parse CSV text into an array of records keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const records: Record<string, string>[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Skip fully blank lines (a common trailing artifact).
    if (row.length === 1 && row[0].trim() === "") continue;
    const record: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      record[header[c]] = (row[c] ?? "").trim();
    }
    records.push(record);
  }

  return records;
}

/** Tokenize CSV text into rows of raw (untrimmed) cell strings. */
function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Normalize line endings so \r\n and \r both behave as \n.
  const s = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  // Flush the final field/row if the file did not end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}
