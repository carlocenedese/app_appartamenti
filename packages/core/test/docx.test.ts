import { describe, expect, it } from 'vitest';
import { docxPlaceholders, fillDocx, readZip } from '../src/docx';
import { zipStored } from '../src/zip';
import { docx, inflateRaw, wordPart, zipDeflated } from './helpers/docx';

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const entry = (zip: Uint8Array, path: string) => {
  const found = readZip(zip, inflateRaw).find((e) => e.path === path);
  if (found === undefined) throw new Error(`no ${path}`);
  return decode(found.data);
};
const filled = (result: ReturnType<typeof fillDocx>) => {
  if (result.status !== 'ok') throw new Error(result.reason);
  return result.bytes;
};

describe('readZip', () => {
  it('reads deflated and stored entries in order', () => {
    const zip = zipDeflated([
      { path: 'a.xml', data: '<a>uno</a>' },
      { path: 'b.bin', data: new Uint8Array([0, 1, 2]), stored: true },
    ]);
    const entries = readZip(zip, inflateRaw);
    expect(entries.map((e) => e.path)).toEqual(['a.xml', 'b.bin']);
    expect(decode(entries[0]?.data ?? new Uint8Array())).toBe('<a>uno</a>');
    expect([...(entries[1]?.data ?? [])]).toEqual([0, 1, 2]);
  });

  it('reads what zipStored writes', () => {
    const data = new TextEncoder().encode('x');
    expect(readZip(zipStored([{ path: 'x', data }]), inflateRaw)).toEqual([{ path: 'x', data }]);
  });

  it('refuses a wrong CRC, an encrypted entry, bytes that are not a zip', () => {
    expect(() =>
      readZip(zipDeflated([{ path: 'a', data: 'x' }], { badCrc: true }), inflateRaw),
    ).toThrow(RangeError);
    expect(() =>
      readZip(zipDeflated([{ path: 'a', data: 'x' }], { flags: 1 }), inflateRaw),
    ).toThrow(RangeError);
    expect(() => readZip(new TextEncoder().encode('non uno zip'), inflateRaw)).toThrow(RangeError);
    expect(() => readZip(new Uint8Array(), inflateRaw)).toThrow(RangeError);
  });

  it('refuses an inflate that gives a different size', () => {
    const zip = zipDeflated([{ path: 'a', data: 'abc' }]);
    expect(() => readZip(zip, () => new Uint8Array(1))).toThrow(RangeError);
  });
});

describe('docxPlaceholders', () => {
  it('lists the placeholders of body, header and footer once, sorted, even split across runs', () => {
    const template = docx([['Caro {{inqui', 'lino', '}}, '], ['{{posto}} e {{inquilino}}']], {
      header: '{{appartamento}}',
      footer: '{{data_documento}}',
    });
    expect(docxPlaceholders(template, inflateRaw)).toEqual({
      status: 'ok',
      fields: ['appartamento', 'data_documento', 'inquilino', 'posto'],
    });
  });

  it('refuses a placeholder name that is not lowercase letters, digits and _', () => {
    expect(docxPlaceholders(docx([['{{Nome}}']]), inflateRaw)).toEqual({
      status: 'refused',
      reason: 'bad-placeholder',
      fields: [],
    });
  });

  it('does not join a placeholder across two paragraphs', () => {
    expect(docxPlaceholders(docx([['{{inqui'], ['lino}}']]), inflateRaw)).toMatchObject({
      status: 'refused',
      reason: 'unclosed-placeholder',
    });
  });

  it('refuses a template without word/document.xml or not a zip', () => {
    const noBody = zipDeflated([{ path: 'a.xml', data: '<a/>' }]);
    expect(docxPlaceholders(noBody, inflateRaw)).toMatchObject({ reason: 'bad-template' });
    expect(docxPlaceholders(new Uint8Array(4), inflateRaw)).toMatchObject({
      reason: 'bad-template',
    });
  });
});

describe('fillDocx', () => {
  it('fills a placeholder split across three runs in the first run and empties the others', () => {
    const template = docx([['Caro {{inqui', 'lino', '}}, benvenuto']]);
    const xml = entry(
      filled(fillDocx(template, { inquilino: 'Mario Bianchi' }, inflateRaw)),
      'word/document.xml',
    );
    expect(xml).toContain('<w:t xml:space="preserve">Caro Mario Bianchi</w:t>');
    expect(xml).toContain('<w:t xml:space="preserve"></w:t>');
    expect(xml).toContain('<w:t xml:space="preserve">, benvenuto</w:t>');
    expect(xml).not.toContain('{{');
  });

  it('fills header and footer, escapes XML, turns a line break into w:br', () => {
    const template = docx([['{{stato_locali}}']], { header: '{{appartamento}}', footer: 'x' });
    const bytes = filled(
      fillDocx(
        template,
        { stato_locali: 'buono & <pulito>\nchiavi: 2', appartamento: 'Casa A' },
        inflateRaw,
      ),
    );
    expect(entry(bytes, 'word/header1.xml')).toContain('>Casa A</w:t>');
    expect(entry(bytes, 'word/document.xml')).toContain(
      'buono &amp; &lt;pulito&gt;</w:t><w:br/><w:t xml:space="preserve">chiavi: 2',
    );
    expect(entry(bytes, 'word/footer1.xml')).toBe(wordPart([['x']], 'w:ftr'));
  });

  it('decodes entities in the template text and leaves other entries untouched', () => {
    const template = docx([['A &amp; {{posto}}']]);
    const bytes = filled(fillDocx(template, { posto: '1' }, inflateRaw));
    expect(entry(bytes, 'word/document.xml')).toContain('>A &amp; 1</w:t>');
    expect(entry(bytes, '[Content_Types].xml')).toBe('<Types/>');
    expect(readZip(bytes, inflateRaw).map((e) => e.path)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
    ]);
  });

  it('gives the same bytes twice and ignores values with no placeholder', () => {
    const template = docx([['{{posto}}']]);
    const a = filled(fillDocx(template, { posto: '1', altro: 'x' }, inflateRaw));
    const b = filled(fillDocx(template, { posto: '1', altro: 'x' }, inflateRaw));
    expect(a).toEqual(b);
  });

  it('refuses missing values with the field names, sorted', () => {
    expect(fillDocx(docx([['{{b}} {{a}} {{c}}']]), { c: '' }, inflateRaw)).toEqual({
      status: 'refused',
      reason: 'missing-fields',
      fields: ['a', 'b'],
    });
  });

  it('refuses a value XML does not allow, with the field name', () => {
    expect(fillDocx(docx([['{{a}}']]), { a: 'x\u0001' }, inflateRaw)).toEqual({
      status: 'refused',
      reason: 'bad-value',
      fields: ['a'],
    });
  });

  it('refuses an unclosed placeholder and a value that would leave one', () => {
    expect(fillDocx(docx([['{{a']]), {}, inflateRaw)).toMatchObject({
      reason: 'unclosed-placeholder',
    });
    expect(fillDocx(docx([['{{a}}']]), { a: '{{b}}' }, inflateRaw)).toEqual({
      status: 'refused',
      reason: 'bad-value',
      fields: ['a'],
    });
  });

  it('refuses a template with an entry path the zip writer does not accept', () => {
    const template = zipDeflated([
      { path: 'word/document.xml', data: wordPart([['x']]) },
      { path: 'media/foto è.png', data: 'x' },
    ]);
    expect(fillDocx(template, {}, inflateRaw)).toMatchObject({ reason: 'bad-template' });
  });

  it('keeps w:t attributes out of the match and handles empty w:t', () => {
    const xml = wordPart([]).replace(
      '<w:body></w:body>',
      '<w:body><w:p><w:r><w:t xml:space="preserve">{{a</w:t></w:r><w:r><w:t/></w:r><w:r><w:t>}}</w:t></w:r></w:p></w:body>',
    );
    const template = zipDeflated([{ path: 'word/document.xml', data: xml }]);
    const out = entry(filled(fillDocx(template, { a: 'ok' }, inflateRaw)), 'word/document.xml');
    expect(out).toContain('>ok</w:t>');
    expect(out).not.toContain('{{');
  });
});
