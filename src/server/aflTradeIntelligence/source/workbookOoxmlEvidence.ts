import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { unzipSync } from 'fflate';

import { sha256AflTradeCanonicalJson } from '../artifacts/contentAddress';
import type {
  AflTradeWorkbookRawCell,
  AflTradeWorkbookRawEvidence,
  AflTradeWorkbookRawFormula,
  AflTradeWorkbookRawHyperlink,
  AflTradeWorkbookRawRow,
  AflTradeWorkbookRawSheetEvidence,
} from './workbookImportContracts';

const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_INFLATED_BYTES = 512 * 1024 * 1024;
const MAX_XML_BYTES = 64 * 1024 * 1024;
const MAX_SHEETS = 256;
const MAX_PHYSICAL_ROWS = 1_000_000;
const MAX_PHYSICAL_CELLS = 2_000_000;
const MAX_HYPERLINKS = 200_000;
const MAX_XML_MARKERS = 4_000_000;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  ignoreDeclaration: true,
});

interface ArchiveResult {
  entries: Readonly<Record<string, Uint8Array>>;
  archiveEntryCount: number;
  inflatedByteLength: number;
}

interface RelationshipTarget {
  target: string;
  targetMode: string | null;
  type: string;
}

const WORKSHEET_RELATIONSHIP_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet',
]);
const OFFICE_DOCUMENT_RELATIONSHIP_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
]);
const HYPERLINK_RELATIONSHIP_TYPES = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink',
]);
const WORKBOOK_CONTENT_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  'application/vnd.ms-excel.sheet.main+xml',
]);
const WORKSHEET_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

export class AflTradeWorkbookOoxmlError extends Error {
  constructor(
    readonly code:
      | 'ARCHIVE_LIMIT_EXCEEDED'
      | 'UNSAFE_ARCHIVE_PATH'
      | 'DUPLICATE_ARCHIVE_ENTRY'
      | 'MISSING_OOXML_PART'
      | 'INVALID_OOXML'
      | 'OOXML_LIMIT_EXCEEDED',
    message: string
  ) {
    super(message);
    this.name = 'AflTradeWorkbookOoxmlError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AflTradeWorkbookOoxmlError('INVALID_OOXML', `${context} must be an XML object.`);
  }
  return value;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attribute(node: Record<string, unknown>, name: string): string | null {
  const value = node[`@_${name}`];
  return typeof value === 'string' ? value : value === undefined ? null : String(value);
}

function attributes(node: Record<string, unknown>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key.startsWith('@_'))
      .map(([key, value]) => [key.slice(2), String(value)])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function elementText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return value === undefined || value === null ? null : String(value);
  const text = value['#text'];
  return typeof text === 'string'
    ? text
    : text === undefined || text === null
      ? null
      : String(text);
}

function recursiveText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(recursiveText).join('');
  if (!isRecord(value)) return '';
  if ('t' in value) return recursiveText(value.t);
  if ('#text' in value) return recursiveText(value['#text']);
  if ('r' in value) return recursiveText(value.r);
  return '';
}

function parseXml(bytes: Uint8Array, partName: string): Record<string, unknown> {
  if (bytes.byteLength > MAX_XML_BYTES) {
    throw new AflTradeWorkbookOoxmlError(
      'OOXML_LIMIT_EXCEEDED',
      `OOXML part ${partName} exceeds the per-part byte limit.`
    );
  }
  try {
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
      throw new AflTradeWorkbookOoxmlError(
        'INVALID_OOXML',
        `OOXML part ${partName} contains a prohibited document type or entity declaration.`
      );
    }
    const validation = XMLValidator.validate(xml, {
      allowBooleanAttributes: false,
      unpairedTags: [],
    });
    if (validation !== true) {
      throw new AflTradeWorkbookOoxmlError(
        'INVALID_OOXML',
        `OOXML part ${partName} is not well-formed XML.`
      );
    }
    let markerCount = 0;
    for (let index = 0; index < xml.length; index += 1) {
      if (xml.charCodeAt(index) === 60) markerCount += 1;
      if (markerCount > MAX_XML_MARKERS) {
        throw new AflTradeWorkbookOoxmlError(
          'OOXML_LIMIT_EXCEEDED',
          `OOXML part ${partName} exceeds the structural marker limit.`
        );
      }
    }
    return record(xmlParser.parse(xml), partName);
  } catch (error) {
    if (error instanceof AflTradeWorkbookOoxmlError) throw error;
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      `OOXML part ${partName} could not be parsed safely.`
    );
  }
}

function shouldExtract(name: string): boolean {
  return (
    name === '[Content_Types].xml' ||
    name === '_rels/.rels' ||
    name === 'xl/workbook.xml' ||
    name === 'xl/_rels/workbook.xml.rels' ||
    name === 'xl/styles.xml' ||
    name === 'xl/sharedStrings.xml' ||
    /^xl\/worksheets\/sheet[^/]*\.xml$/.test(name) ||
    /^xl\/worksheets\/_rels\/sheet[^/]*\.xml\.rels$/.test(name)
  );
}

function readBoundedArchive(bytes: Uint8Array): ArchiveResult {
  let archiveEntryCount = 0;
  let inflatedByteLength = 0;
  const seenNames = new Set<string>();
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (entry) => {
        archiveEntryCount += 1;
        if (archiveEntryCount > MAX_ARCHIVE_ENTRIES) {
          throw new AflTradeWorkbookOoxmlError(
            'ARCHIVE_LIMIT_EXCEEDED',
            'Workbook archive exceeds the entry-count limit.'
          );
        }
        const normalized = posix.normalize(entry.name);
        if (
          entry.name.startsWith('/') ||
          entry.name.includes('\\') ||
          normalized !== entry.name ||
          normalized === '..' ||
          normalized.startsWith('../')
        ) {
          throw new AflTradeWorkbookOoxmlError(
            'UNSAFE_ARCHIVE_PATH',
            'Workbook archive contains an unsafe entry path.'
          );
        }
        if (seenNames.has(entry.name)) {
          throw new AflTradeWorkbookOoxmlError(
            'DUPLICATE_ARCHIVE_ENTRY',
            'Workbook archive contains a duplicate entry name.'
          );
        }
        seenNames.add(entry.name);
        inflatedByteLength += entry.originalSize;
        if (inflatedByteLength > MAX_INFLATED_BYTES || entry.originalSize > MAX_XML_BYTES) {
          throw new AflTradeWorkbookOoxmlError(
            'ARCHIVE_LIMIT_EXCEEDED',
            'Workbook archive exceeds the bounded inflated-byte limits.'
          );
        }
        return shouldExtract(entry.name);
      },
    });
  } catch (error) {
    if (error instanceof AflTradeWorkbookOoxmlError) throw error;
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      'Workbook bytes are not a supported bounded OOXML archive.'
    );
  }
  return { entries, archiveEntryCount, inflatedByteLength };
}

function requireEntry(entries: Readonly<Record<string, Uint8Array>>, name: string): Uint8Array {
  const bytes = entries[name];
  if (!bytes) {
    throw new AflTradeWorkbookOoxmlError(
      'MISSING_OOXML_PART',
      `Workbook archive is missing required OOXML part ${name}.`
    );
  }
  return bytes;
}

function resolveInternalTarget(basePart: string, target: string): string {
  const resolved = target.startsWith('/')
    ? posix.normalize(target.slice(1))
    : posix.normalize(posix.join(posix.dirname(basePart), target));
  if (!resolved || resolved === '..' || resolved.startsWith('../') || resolved.includes('\\')) {
    throw new AflTradeWorkbookOoxmlError(
      'UNSAFE_ARCHIVE_PATH',
      'OOXML relationship resolves outside the workbook archive.'
    );
  }
  return resolved;
}

function relationshipPartFor(partName: string): string {
  return posix.join(posix.dirname(partName), '_rels', `${posix.basename(partName)}.rels`);
}

function parseRelationships(
  entries: Readonly<Record<string, Uint8Array>>,
  partName: string,
  required: boolean
): Map<string, RelationshipTarget> {
  const relationshipPart = relationshipPartFor(partName);
  const bytes = entries[relationshipPart];
  if (!bytes) {
    if (!required) return new Map();
    throw new AflTradeWorkbookOoxmlError(
      'MISSING_OOXML_PART',
      `Workbook archive is missing relationship part ${relationshipPart}.`
    );
  }
  const parsed = parseXml(bytes, relationshipPart);
  const relationships = optionalRecord(parsed.Relationships);
  const result = new Map<string, RelationshipTarget>();
  for (const unparsed of array(relationships?.Relationship)) {
    const relation = record(unparsed, `${relationshipPart} Relationship`);
    const id = attribute(relation, 'Id');
    const target = attribute(relation, 'Target');
    const targetMode = attribute(relation, 'TargetMode');
    const type = attribute(relation, 'Type');
    if (!id || !target || !type || result.has(id)) {
      throw new AflTradeWorkbookOoxmlError(
        'INVALID_OOXML',
        `Relationship part ${relationshipPart} contains an invalid or duplicate relationship.`
      );
    }
    result.set(id, {
      target: targetMode === 'External' ? target : resolveInternalTarget(partName, target),
      targetMode,
      type,
    });
  }
  return result;
}

function formula(value: unknown): AflTradeWorkbookRawFormula | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    return {
      text: value,
      attributes: {},
      formulaType: null,
      sharedIndex: null,
      reference: null,
    };
  }
  const node = record(value, 'worksheet formula');
  return {
    text: elementText(node),
    attributes: attributes(node),
    formulaType: attribute(node, 't'),
    sharedIndex: attribute(node, 'si'),
    reference: attribute(node, 'ref'),
  };
}

function rawCell(value: unknown): AflTradeWorkbookRawCell {
  const node = record(value, 'worksheet cell');
  const coordinate = attribute(node, 'r');
  if (!coordinate || !/^[A-Z]{1,3}[1-9]\d*$/.test(coordinate)) {
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      'Every physical worksheet cell requires an A1 coordinate.'
    );
  }
  return {
    coordinate,
    attributes: attributes(node),
    sourceType: attribute(node, 't'),
    styleIndex: attribute(node, 's'),
    cachedValue: elementText(node.v),
    inlineText: node.is === undefined ? null : recursiveText(node.is),
    inlineStructure: node.is === undefined ? null : node.is,
    formula: formula(node.f),
  };
}

function rawRow(value: unknown): AflTradeWorkbookRawRow {
  const node = record(value, 'worksheet row');
  const rowNumberText = attribute(node, 'r');
  if (!rowNumberText || !/^[1-9]\d*$/.test(rowNumberText)) {
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      'Every physical worksheet row requires a positive row number.'
    );
  }
  const cells = array(node.c).map(rawCell);
  return {
    rowNumber: Number(rowNumberText),
    hidden: attribute(node, 'hidden') === '1' || attribute(node, 'hidden') === 'true',
    physicalCellCount: cells.length,
    cells,
  };
}

function rawHyperlink(
  value: unknown,
  relationships: ReadonlyMap<string, RelationshipTarget>
): AflTradeWorkbookRawHyperlink {
  const node = record(value, 'worksheet hyperlink');
  const reference = attribute(node, 'ref');
  const relationshipId = attribute(node, 'id');
  if (!reference) {
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      'Every worksheet hyperlink requires a cell reference.'
    );
  }
  const relation = relationshipId ? relationships.get(relationshipId) : undefined;
  if (relationshipId && !relation) {
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      'Worksheet hyperlink relationship is missing from its relationship part.'
    );
  }
  if (relation && !HYPERLINK_RELATIONSHIP_TYPES.has(relation.type)) {
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      'Worksheet hyperlink relationship has an invalid relationship type.'
    );
  }
  return {
    reference,
    relationshipId,
    target: relation?.target ?? null,
    targetMode: relation?.targetMode ?? null,
    location: attribute(node, 'location'),
    display: attribute(node, 'display'),
    tooltip: attribute(node, 'tooltip'),
  };
}

function sheetEvidence(input: {
  entries: Readonly<Record<string, Uint8Array>>;
  sheet: string;
  ordinal: number;
  visibility: AflTradeWorkbookRawSheetEvidence['visibility'];
  worksheetPath: string;
}): AflTradeWorkbookRawSheetEvidence {
  const worksheet = record(
    parseXml(requireEntry(input.entries, input.worksheetPath), input.worksheetPath).worksheet,
    `${input.worksheetPath} worksheet`
  );
  const sheetData = optionalRecord(worksheet.sheetData);
  const rows = array(sheetData?.row).map(rawRow);
  let previousRowNumber = 0;
  for (const row of rows) {
    if (row.rowNumber <= previousRowNumber) {
      throw new AflTradeWorkbookOoxmlError(
        'INVALID_OOXML',
        'Physical worksheet rows must have unique, strictly ascending row numbers.'
      );
    }
    previousRowNumber = row.rowNumber;
    const seenCoordinates = new Set<string>();
    for (const cell of row.cells) {
      const coordinateRow = /([1-9]\d*)$/.exec(cell.coordinate);
      if (seenCoordinates.has(cell.coordinate) || Number(coordinateRow?.[1]) !== row.rowNumber) {
        throw new AflTradeWorkbookOoxmlError(
          'INVALID_OOXML',
          'Physical worksheet cells must have unique coordinates matching their row.'
        );
      }
      seenCoordinates.add(cell.coordinate);
    }
  }
  const relationships = parseRelationships(input.entries, input.worksheetPath, false);
  const hyperlinksNode = optionalRecord(worksheet.hyperlinks);
  const hyperlinks = array(hyperlinksNode?.hyperlink).map((value) =>
    rawHyperlink(value, relationships)
  );
  const physicalCellCount = rows.reduce((total, row) => total + row.physicalCellCount, 0);
  return {
    sheet: input.sheet,
    ordinal: input.ordinal,
    visibility: input.visibility,
    worksheetPath: input.worksheetPath,
    physicalRowCount: rows.length,
    physicalCellCount,
    rows,
    hyperlinks,
  };
}

function validateContentTypes(
  entries: Readonly<Record<string, Uint8Array>>,
  worksheetPaths: readonly string[]
) {
  const partName = '[Content_Types].xml';
  const types = record(parseXml(requireEntry(entries, partName), partName).Types, partName);
  const overrides = new Map<string, string>();
  for (const unparsed of array(types.Override)) {
    const override = record(unparsed, `${partName} Override`);
    const name = attribute(override, 'PartName');
    const contentType = attribute(override, 'ContentType');
    if (!name || !contentType || overrides.has(name)) {
      throw new AflTradeWorkbookOoxmlError(
        'INVALID_OOXML',
        'Workbook content types contain a missing or duplicate override.'
      );
    }
    overrides.set(name, contentType);
  }
  if (!WORKBOOK_CONTENT_TYPES.has(overrides.get('/xl/workbook.xml') ?? '')) {
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      'Workbook content types do not identify the governed spreadsheet workbook part.'
    );
  }
  for (const worksheetPath of worksheetPaths) {
    if (overrides.get(`/${worksheetPath}`) !== WORKSHEET_CONTENT_TYPE) {
      throw new AflTradeWorkbookOoxmlError(
        'INVALID_OOXML',
        'Every governed worksheet requires the exact spreadsheet worksheet content type.'
      );
    }
  }
}

function partReferences(entries: Readonly<Record<string, Uint8Array>>) {
  return Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([partName, bytes]) => ({
      partName,
      byteLength: bytes.byteLength,
      contentSha256: createHash('sha256').update(bytes).digest('hex'),
    }));
}

export function extractAflTradeWorkbookOoxmlEvidence(
  bytes: Uint8Array
): AflTradeWorkbookRawEvidence {
  const archive = readBoundedArchive(bytes);
  const workbookPart = 'xl/workbook.xml';
  const rootRelationships = parseRelationships(archive.entries, '', true);
  if (
    ![...rootRelationships.values()].some(
      ({ target, targetMode, type }) =>
        target === workbookPart &&
        targetMode !== 'External' &&
        OFFICE_DOCUMENT_RELATIONSHIP_TYPES.has(type)
    )
  ) {
    throw new AflTradeWorkbookOoxmlError(
      'INVALID_OOXML',
      'The OPC root must identify the exact internal spreadsheet office document.'
    );
  }
  const workbook = record(
    parseXml(requireEntry(archive.entries, workbookPart), workbookPart).workbook,
    'workbook.xml workbook'
  );
  const sheetsNode = record(workbook.sheets, 'workbook.xml sheets');
  const unparsedSheets = array(sheetsNode.sheet);
  if (unparsedSheets.length === 0 || unparsedSheets.length > MAX_SHEETS) {
    throw new AflTradeWorkbookOoxmlError(
      'OOXML_LIMIT_EXCEEDED',
      'Workbook contains no sheets or exceeds the sheet-count limit.'
    );
  }
  const relationships = parseRelationships(archive.entries, workbookPart, true);
  const seenNames = new Set<string>();
  const sheetDefinitions = unparsedSheets.map((unparsedSheet, ordinal) => {
    const node = record(unparsedSheet, 'workbook sheet');
    const sheet = attribute(node, 'name');
    const relationshipId = attribute(node, 'id');
    const visibilityValue = attribute(node, 'state') ?? 'visible';
    if (
      !sheet ||
      !relationshipId ||
      seenNames.has(sheet) ||
      !['visible', 'hidden', 'veryHidden'].includes(visibilityValue)
    ) {
      throw new AflTradeWorkbookOoxmlError(
        'INVALID_OOXML',
        'Workbook sheet metadata is missing, duplicated, or invalid.'
      );
    }
    seenNames.add(sheet);
    const relationship = relationships.get(relationshipId);
    if (
      !relationship ||
      relationship.targetMode === 'External' ||
      !WORKSHEET_RELATIONSHIP_TYPES.has(relationship.type)
    ) {
      throw new AflTradeWorkbookOoxmlError(
        'INVALID_OOXML',
        'Workbook sheet must resolve to one internal worksheet relationship.'
      );
    }
    return {
      sheet,
      ordinal,
      visibility: visibilityValue as AflTradeWorkbookRawSheetEvidence['visibility'],
      worksheetPath: relationship.target,
    };
  });
  validateContentTypes(
    archive.entries,
    sheetDefinitions.map(({ worksheetPath }) => worksheetPath)
  );
  const sheets = sheetDefinitions.map((definition) =>
    sheetEvidence({ entries: archive.entries, ...definition })
  );
  const physicalRowCount = sheets.reduce((total, sheet) => total + sheet.physicalRowCount, 0);
  const physicalCellCount = sheets.reduce((total, sheet) => total + sheet.physicalCellCount, 0);
  const hyperlinkCount = sheets.reduce((total, sheet) => total + sheet.hyperlinks.length, 0);
  if (
    physicalRowCount > MAX_PHYSICAL_ROWS ||
    physicalCellCount > MAX_PHYSICAL_CELLS ||
    hyperlinkCount > MAX_HYPERLINKS
  ) {
    throw new AflTradeWorkbookOoxmlError(
      'OOXML_LIMIT_EXCEEDED',
      'Workbook exceeds the physical row, cell, or hyperlink limit.'
    );
  }
  const workbookProperties = optionalRecord(workbook.workbookPr);
  const stylesBytes = archive.entries['xl/styles.xml'];
  const sharedStringsBytes = archive.entries['xl/sharedStrings.xml'];
  const content = {
    evidenceVersion: 'afl-trade-workbook-ooxml-evidence/v1' as const,
    archiveEntryCount: archive.archiveEntryCount,
    inflatedByteLength: archive.inflatedByteLength,
    physicalRowCount,
    physicalCellCount,
    hyperlinkCount,
    date1904:
      attribute(workbookProperties ?? {}, 'date1904') === '1' ||
      attribute(workbookProperties ?? {}, 'date1904') === 'true',
    referencedParts: partReferences(archive.entries),
    supportingTables: {
      workbookProperties: workbookProperties ? attributes(workbookProperties) : {},
      styles: stylesBytes ? (parseXml(stylesBytes, 'xl/styles.xml').styleSheet ?? null) : null,
      sharedStrings: sharedStringsBytes
        ? (parseXml(sharedStringsBytes, 'xl/sharedStrings.xml').sst ?? null)
        : null,
    },
    sheets,
  };
  return {
    ...content,
    evidenceSha256: sha256AflTradeCanonicalJson(content),
  };
}
