import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const SAMPLE_TEXT = "Backend engineer with five years of experience in TypeScript, Python, SQL, REST APIs, and distributed systems. Professional English and intermediate German.";

export function createPdf(pageTexts) {
  const objects = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const pages = [];
  for (const text of pageTexts) {
    const pageId = objects.length + 1;
    const contentId = pageId + 1;
    const content = text ? `BT /F1 10 Tf 30 700 Td (${text.replace(/[\\()]/g, "\\$&")}) Tj ET` : "";
    pages.push(`${pageId} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.join(" ")}] >>`;
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A small uncompressed ZIP writer keeps synthetic DOCX fixtures dependency-free.
function createZip(files) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const [fileName, contents] of Object.entries(files)) {
    const name = Buffer.from(fileName);
    const data = Buffer.from(contents);
    const checksum = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    localRecords.push(header, name, data); centralRecords.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  const count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, directory, end]);
}

export function createDocx(text = SAMPLE_TEXT) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return createZip({
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escaped}</w:t></w:r></w:p></w:body></w:document>`,
  });
}

export async function writeFixtures(directory) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "sample-resume.pdf"), createPdf([SAMPLE_TEXT]));
  await writeFile(path.join(directory, "sample-resume.docx"), createDocx());
  await writeFile(path.join(directory, "no-text.pdf"), createPdf([""]));
  await writeFile(path.join(directory, "mixed-pages.pdf"), createPdf([SAMPLE_TEXT, ""]));
  await writeFile(path.join(directory, "corrupted.pdf"), "%PDF-1.7\nbroken");
  await writeFile(path.join(directory, "corrupted.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]));
  await writeFile(path.join(directory, "too-many-pages.pdf"), createPdf(Array(31).fill(SAMPLE_TEXT)));
}
