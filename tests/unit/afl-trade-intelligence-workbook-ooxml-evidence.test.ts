import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  AflTradeWorkbookOoxmlError,
  extractAflTradeWorkbookOoxmlEvidence,
} from '@/server/aflTradeIntelligence/source/workbookOoxmlEvidence';

function xml(value: string) {
  return strToU8(value);
}

function fixtureWorkbook() {
  return zipSync({
    '[Content_Types].xml': xml(
      '<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    ),
    '_rels/.rels': xml(
      '<?xml version="1.0"?><Relationships><Relationship Id="rOffice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ),
    'xl/workbook.xml': xml(
      '<?xml version="1.0"?><workbook xmlns:r="relationships"><workbookPr date1904="1"/><sheets><sheet name="Trades" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ),
    'xl/styles.xml': xml(
      '<?xml version="1.0"?><styleSheet><numFmts count="1"><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="1"><xf numFmtId="165"/></cellXfs></styleSheet>'
    ),
    'xl/sharedStrings.xml': xml(
      '<?xml version="1.0"?><sst count="1" uniqueCount="1"><si><r><t>Rich</t></r><r><t> text</t></r></si></sst>'
    ),
    'xl/_rels/workbook.xml.rels': xml(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    ),
    'xl/worksheets/sheet1.xml': xml(
      [
        '<?xml version="1.0"?><worksheet xmlns:r="relationships">',
        '<sheetData>',
        '<row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1"><f t="shared" si="2" ref="B1:B2">1+1</f><v>2</v></c><c r="C1" t="e"><v>#DIV/0!</v></c><c r="D1" s="4"/></row>',
        '<row r="2" hidden="1"><c r="A2" s="7"><v>45500</v></c><c r="B2"><f t="shared" si="2"/><v>3</v></c></row>',
        '</sheetData>',
        '<hyperlinks><hyperlink ref="A1" r:id="rLink1" display="DraftGuru"/></hyperlinks>',
        '</worksheet>',
      ].join('')
    ),
    'xl/worksheets/_rels/sheet1.xml.rels': xml(
      '<?xml version="1.0"?><Relationships><Relationship Id="rLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.draftguru.com.au/players/example" TargetMode="External"/></Relationships>'
    ),
  });
}

describe('AFL trade workbook bounded OOXML evidence', () => {
  it('preserves physical cells, formula metadata, errors, styled blanks, dates, and hyperlinks', () => {
    const evidence = extractAflTradeWorkbookOoxmlEvidence(fixtureWorkbook());
    const sheet = evidence.sheets[0]!;

    expect(evidence.physicalRowCount).toBe(2);
    expect(evidence.physicalCellCount).toBe(6);
    expect(evidence.hyperlinkCount).toBe(1);
    expect(evidence.date1904).toBe(true);
    expect(evidence.referencedParts.map(({ partName }) => partName)).toEqual(
      expect.arrayContaining(['xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml'])
    );
    expect(evidence.supportingTables.styles).not.toBeNull();
    expect(evidence.supportingTables.sharedStrings).not.toBeNull();
    expect(sheet.rows[1]).toMatchObject({ rowNumber: 2, hidden: true });
    expect(sheet.rows[0]?.cells).toEqual([
      {
        coordinate: 'A1',
        attributes: { r: 'A1', s: '1', t: 's' },
        sourceType: 's',
        styleIndex: '1',
        cachedValue: '0',
        inlineText: null,
        inlineStructure: null,
        formula: null,
      },
      {
        coordinate: 'B1',
        attributes: { r: 'B1' },
        sourceType: null,
        styleIndex: null,
        cachedValue: '2',
        inlineText: null,
        inlineStructure: null,
        formula: {
          text: '1+1',
          attributes: { ref: 'B1:B2', si: '2', t: 'shared' },
          formulaType: 'shared',
          sharedIndex: '2',
          reference: 'B1:B2',
        },
      },
      {
        coordinate: 'C1',
        attributes: { r: 'C1', t: 'e' },
        sourceType: 'e',
        styleIndex: null,
        cachedValue: '#DIV/0!',
        inlineText: null,
        inlineStructure: null,
        formula: null,
      },
      {
        coordinate: 'D1',
        attributes: { r: 'D1', s: '4' },
        sourceType: null,
        styleIndex: '4',
        cachedValue: null,
        inlineText: null,
        inlineStructure: null,
        formula: null,
      },
    ]);
    expect(sheet.rows[1]?.cells[0]).toMatchObject({
      coordinate: 'A2',
      styleIndex: '7',
      cachedValue: '45500',
    });
    expect(sheet.hyperlinks).toEqual([
      {
        reference: 'A1',
        relationshipId: 'rLink1',
        target: 'https://www.draftguru.com.au/players/example',
        targetMode: 'External',
        location: null,
        display: 'DraftGuru',
        tooltip: null,
      },
    ]);
    expect(evidence.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when required OOXML custody parts are absent', () => {
    const malformed = zipSync({
      '_rels/.rels': xml(
        '<Relationships><Relationship Id="rOffice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      ),
      'xl/workbook.xml': xml('<x/>'),
    });
    expect(() => extractAflTradeWorkbookOoxmlEvidence(malformed)).toThrowError(
      AflTradeWorkbookOoxmlError
    );
    try {
      extractAflTradeWorkbookOoxmlEvidence(malformed);
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_OOXML' });
    }
  });

  it('rejects an unsafe relationship that escapes the archive', () => {
    const bytes = zipSync({
      '[Content_Types].xml': xml('<Types/>'),
      '_rels/.rels': xml(
        '<Relationships><Relationship Id="rOffice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      ),
      'xl/workbook.xml': xml(
        '<workbook xmlns:r="relationships"><sheets><sheet name="Trades" r:id="rId1"/></sheets></workbook>'
      ),
      'xl/_rels/workbook.xml.rels': xml(
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="../../../outside.xml"/></Relationships>'
      ),
    });

    expect(() => extractAflTradeWorkbookOoxmlEvidence(bytes)).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_ARCHIVE_PATH' })
    );
  });

  it('rejects entity declarations and inconsistent physical coordinates', () => {
    const entityBytes = zipSync({
      '_rels/.rels': xml(
        '<Relationships><Relationship Id="rOffice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      ),
      'xl/workbook.xml': xml('<!DOCTYPE workbook [<!ENTITY x "unsafe">]><workbook/>'),
      'xl/_rels/workbook.xml.rels': xml('<Relationships/>'),
    });
    expect(() => extractAflTradeWorkbookOoxmlEvidence(entityBytes)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OOXML' })
    );

    const entries = zipSync({
      '[Content_Types].xml': xml(
        '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
      ),
      '_rels/.rels': xml(
        '<Relationships><Relationship Id="rOffice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      ),
      'xl/workbook.xml': xml(
        '<workbook xmlns:r="relationships"><sheets><sheet name="Trades" r:id="rId1"/></sheets></workbook>'
      ),
      'xl/_rels/workbook.xml.rels': xml(
        '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
      ),
      'xl/worksheets/sheet1.xml': xml(
        '<worksheet><sheetData><row r="1"><c r="A2"><v>1</v></c></row></sheetData></worksheet>'
      ),
    });
    expect(() => extractAflTradeWorkbookOoxmlEvidence(entries)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OOXML' })
    );
  });
});
