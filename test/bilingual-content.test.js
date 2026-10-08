const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const helper = require('../docs/bilingual.js');
const sync = require('../docs/transcript-sync.js');
const sandbox = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../docs/data.js'),'utf8'),sandbox);
const data = sandbox.window.IELTS_DATA;
const bilingualPath = path.join(__dirname,'../docs/bilingual-data.js');
if (fs.existsSync(bilingualPath)) vm.runInNewContext(fs.readFileSync(bilingualPath,'utf8'),sandbox);

test('every Part 2 answer and shared story has a complete aligned bilingual manuscript', () => {
  const bilingual = sandbox.window.IELTS_BILINGUAL;
  assert.ok(bilingual, 'the bilingual manuscripts are missing');
  const items = [...data.masters,...data.topics];
  assert.equal(Object.keys(bilingual).length, items.length);
  for (const item of items) {
    const entry = bilingual[item.id];
    assert.ok(helper.validArticle(item,entry),item.id);
    const indexedEnglish = [];
    const html = helper.renderArticle(entry,text=>{
      indexedEnglish.push(text);
      return `<span data-transcript-index="${indexedEnglish.length-1}">${text}</span>`;
    });
    assert.deepEqual(indexedEnglish, sync.splitTranscript(Array.from(item.script)).map(s=>s.text),item.id);
    assert.equal((html.match(/<blockquote\b/g)||[]).length,indexedEnglish.length,item.id);
    assert.equal((html.match(/<hr\b/g)||[]).length,item.script.length-1,item.id);
    assert.equal((html.match(/class="memory-tip"/g)||[]).length,1,item.id);
  }
});
