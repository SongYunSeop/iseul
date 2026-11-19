import test from 'node:test';
import assert from 'node:assert/strict';
import { contextAt, locate } from '../src/quote.js';

const page = '첫 문단입니다. 데이터는 중요하다. 둘째 문단에서도 데이터를 본다. 마지막 문단, 데이터 끝.';
const quoteOf = (all, start, text) => contextAt(all, start, start + text.length);
const at = (all, quote) => locate(all, quote)?.start ?? -1;
const second = page.indexOf('데이터', page.indexOf('데이터') + 1);

test('a quote taken from a repeated word finds the same occurrence again', () => {
  const quote = quoteOf(page, second, '데이터');
  assert.equal(quote.index, 1);
  assert.deepEqual(locate(page, quote), { start: second, end: second + 3 });
});

test('surrounding text wins over the remembered index after edits above the passage', () => {
  const quote = quoteOf(page, second, '데이터');
  const edited = '데이터 이야기를 새로 넣었다. ' + page; // a new occurrence before it shifts the index
  assert.equal(at(edited, quote), edited.indexOf('둘째 문단에서도 데이터') + '둘째 문단에서도 '.length);
});

test('a passage whose surroundings were edited away is not marked elsewhere, even on the only copy left', () => {
  const quote = quoteOf(page, second, '데이터');
  assert.equal(at(page.replace('둘째 문단에서도 데이터를 본다. ', ''), quote), -1);
  assert.equal(at('전혀 다른 글에 데이터가 하나.', quote), -1);
});

test('a passage whose context changed on one side is still found; gone text is -1', () => {
  const quote = quoteOf(page, page.indexOf('중요하다'), '중요하다');
  const edited = page.replace('데이터는 중요하다', '정말 중요하다');
  assert.equal(at(edited, quote), edited.indexOf('중요하다'));
  assert.equal(at(page.replace('중요하다', '하찮다'), quote), -1);
});

test('a passage at the very start whose sentence was deleted is not matched to a later repeat', () => {
  const all = '데이터는 중요하다. 둘째 문단에서도 데이터를 본다. 마지막 문단, 데이터 끝.';
  const quote = quoteOf(all, 0, '데이터'); // empty prefix
  assert.equal(at(all, quote), 0);
  assert.equal(at(all.replace('데이터는 중요하다. ', ''), quote), -1);
});

test('whitespace never decides: trimmed and collapsed when quoting, ignored when finding', () => {
  const html = '첫 문단\n\n<p>셋째 문단은\n      줄바꿈과 들여쓰기가 있다.</p>\n둘째';
  const start = html.indexOf('셋째'), end = html.indexOf('</p>') + 5; // a triple click takes the trailing newline
  const quote = contextAt(html, start, end);
  assert.equal(quote.text, '셋째 문단은 줄바꿈과 들여쓰기가 있다.</p>');
  const minified = html.replace(/\s+/g, ' ').replace('> ', '>');
  assert.deepEqual(locate(minified, quote), { start: minified.indexOf('셋째'), end: minified.indexOf('</p>') + 4 });
});

test('context is clipped at the edges of the text and emoji stay whole', () => {
  const all = '🙂 시작';
  const quote = quoteOf(all, 0, '🙂');
  assert.equal(quote.prefix, '');
  assert.equal(quote.suffix, ' 시작');
  assert.equal(at(all, quote), 0);
});
