const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const sync=require('../docs/transcript-sync.js');
const site=path.resolve(__dirname,'../docs');
const sandbox={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(site,'data.js'),'utf8'),sandbox);
const data=sandbox.window.IELTS_DATA;
const cueFile=path.join(site,'audio-cues.js');
if(fs.existsSync(cueFile))vm.runInNewContext(fs.readFileSync(cueFile,'utf8'),sandbox);

test('every playable entry has exact cues bound to its actual audio bytes and original English',()=>{
 const recordings=sandbox.window.IELTS_AUDIO_CUES;
 assert.ok(recordings,'recorded sentence cues are missing');
 const referenced=new Set();
 for(const key of ['masters','topics','part1','part3']){
  for(const item of data[key]){
   const recording=recordings[item.audio];
   assert.ok(recording,`${key}/${item.id}`);
   referenced.add(item.audio);
   const paragraphs=item.script||item.questions.flatMap(q=>[q.q,q.a]);
   const english=sync.splitTranscript(paragraphs);
   const timeline=sync.createTimeline(english,recording.duration,recording);
   assert.equal(timeline.length,english.length,item.id);
   for(let index=1;index<timeline.length;index++){
    assert.equal(sync.findActiveSegment(timeline,timeline[index].start-0.000001),index-1,item.id);
    assert.equal(sync.findActiveSegment(timeline,timeline[index].start),index,item.id);
    assert.ok(Math.abs(timeline[index].start*22050-Math.round(timeline[index].start*22050))<0.00001,item.id);
   }
   const audio=fs.readFileSync(path.join(site,item.audio));
   assert.equal(crypto.createHash('sha256').update(audio).digest('hex'),recording.sha256,item.id);
  }
 }
 assert.equal(Object.keys(recordings).length,referenced.size);
});
