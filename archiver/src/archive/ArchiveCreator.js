function csvField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvLine = (values) => values.map(csvField).join(',');

class ArchiveCreator {
  create(targetDate, rows) {
    const columns = Object.keys(rows[0]);
    const lines = [csvLine(columns), ...rows.map((row) => csvLine(columns.map((column) => row[column])))];
    return { fileName: `${targetDate}-archive.csv`, content: lines.map((line) => `${line}\n`).join('') };
  }
}

module.exports = { ArchiveCreator };
