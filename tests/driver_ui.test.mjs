import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class FakeNode {
  constructor(value=''){
    this.value=value;
    this.checked=false;
    this.hidden=false;
    this.disabled=false;
    this.textContent='';
    this.firstChild={textContent:''};
    this.dataset={};
    this.attributes={};
    this.children=[];
    this.handlers=new Map();
    this.open=false;
    this.clickCount=0;
    this.scrollCount=0;
  }
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  querySelectorAll(selector){
    return selector==='button[data-open-terminal]'?this.children:[];
  }
  addEventListener(type,cb){
    const a=this.handlers.get(type)||[];a.push(cb);this.handlers.set(type,a);
  }
  dispatchEvent(event){
    for(const fn of this.handlers.get(event.type)||[])fn(event);
  }
  click(){
    this.clickCount++;
    this.dispatchEvent({type:'click',target:this});
  }
  contains(node){for(let cur=node;cur;cur=cur.parentElement){if(cur===this)return true;}return false;}
  closest(selector){return selector==='button[data-open-terminal]' ? this : null;}
  scrollIntoView(){this.scrollCount++;}
}
function buildMock(){
  const portNapoli=new FakeNode('napoli');portNapoli.checked=true;
  const portSalerno=new FakeNode('salerno');
  const terminalCnt=new FakeNode('cnt');terminalCnt.checked=true;
  const terminalTfg=new FakeNode('tfg');
  const ids=Object.fromEntries([
    'napoli-booking-details','napoli-advanced','sct-filter','sct-search-btn',
    'sct-vessel-results','napoli-shortcuts','cnt-fleet','tfg-fleet',
    'napoli-terminal-switch','search-btn','sct-vessel-list',
    'sct-vessel-count','tfg-reload','cnt-reload'
  ].map(id=>[id,new FakeNode()]));
  ids['tfg-fleet'].hidden=true;
  ids['search-btn'].firstChild={textContent:''};
  ids['sct-vessel-count'].textContent='0 viaggi';
  ids['sct-vessel-list'].querySelectorAll=()=>[];
  for(const terminal of ['cnt','tfg']){
    const button=new FakeNode();
    button.dataset.openTerminal=terminal;
    button.parentElement=ids['napoli-shortcuts'];
    ids['napoli-shortcuts'].children.push(button);
  }
  const portRadios=[portNapoli,portSalerno],termRadios=[terminalCnt,terminalTfg];
  // Radio browser: checking TFG automatically unchecks CNT and vice versa.
  let selectedTerminal='cnt';
  for(const node of termRadios){
    const value=node.value;
    Object.defineProperty(node,'checked',{
      get(){return selectedTerminal===value;},
      set(v){if(v)selectedTerminal=value;else if(selectedTerminal===value)selectedTerminal=null;}
    });
  }
  const document={
    getElementById:id=>ids[id],
    querySelectorAll:selector=>
      selector==='input[name="port"]'?portRadios:
      selector==='input[name="napoli-terminal"]'?termRadios:[],
    querySelector:selector=>{
      if(selector==='input[name="port"]:checked')return portRadios.find(x=>x.checked)||null;
      if(selector==='input[name="napoli-terminal"]:checked')return termRadios.find(x=>x.checked)||null;
      const m=selector.match(/^input\[name="napoli-terminal"\]\[value="(cnt|tfg)"\]$/);
      return m?termRadios.find(x=>x.value===m[1]):null;
    }
  };
  const browser={requestAnimationFrame:fn=>fn(),matchMedia:()=>({matches:true})};
  const FakeEvent=class{constructor(type){this.type=type;}};
  vm.runInNewContext(fs.readFileSync('driver-ui.mjs','utf8'),{
    document,window:browser,Event:FakeEvent
  },{timeout:2000});
  return {ids,portNapoli,portSalerno,terminalCnt,terminalTfg};
}
test('CNT selected at startup hides TFG panel',()=>{
  const {ids}=buildMock();
  assert.equal(ids['cnt-fleet'].hidden,false);
  assert.equal(ids['tfg-fleet'].hidden,true);
  assert.equal(ids['napoli-terminal-switch'].hidden,true);
  assert.equal(ids['napoli-shortcuts'].children[0].getAttribute('aria-pressed'),'true');
  assert.equal(ids['napoli-shortcuts'].children[1].getAttribute('aria-pressed'),'false');
});
test('switching CNT -> TFG -> CNT always changes displayed fleet',()=>{
  const m=buildMock();
  m.terminalCnt.checked=false;m.terminalTfg.checked=true;
  m.terminalTfg.dispatchEvent({type:'change'});
  assert.equal(m.ids['cnt-fleet'].hidden,true);
  assert.equal(m.ids['tfg-fleet'].hidden,false);
  assert.equal(m.ids['napoli-shortcuts'].children[1].getAttribute('aria-pressed'),'true');
  m.terminalTfg.checked=false;m.terminalCnt.checked=true;
  m.terminalCnt.dispatchEvent({type:'change'});
  assert.equal(m.ids['cnt-fleet'].hidden,false);
  assert.equal(m.ids['tfg-fleet'].hidden,true);
});
test('top shortcut synchronizes panels even when app.js handlers are absent',()=>{
  const m=buildMock();
  const btn=new FakeNode();btn.dataset.openTerminal='tfg';btn.parentElement=m.ids['napoli-shortcuts'];
  m.ids['napoli-shortcuts'].dispatchEvent({type:'click',target:btn});
  assert.equal(m.terminalTfg.checked,true);
  assert.equal(m.ids['cnt-fleet'].hidden,true);
  assert.equal(m.ids['tfg-fleet'].hidden,false);
  assert.equal(m.ids['tfg-reload'].clickCount,0); // app.js handles change
});
test('switch to Salerno hides both Napoli fleet panels',()=>{
  const m=buildMock();
  m.portNapoli.checked=false;m.portSalerno.checked=true;
  m.portSalerno.dispatchEvent({type:'change'});
  assert.equal(m.ids['cnt-fleet'].hidden,true);
  assert.equal(m.ids['tfg-fleet'].hidden,true);
});

test('reopening already selected TFG triggers a fresh read',()=>{
 const m=buildMock();m.terminalCnt.checked=false;m.terminalTfg.checked=true;
 const btn=new FakeNode();btn.dataset.openTerminal='tfg';btn.parentElement=m.ids['napoli-shortcuts'];
 m.ids['napoli-shortcuts'].dispatchEvent({type:'click',target:btn});
 assert.equal(m.ids['tfg-reload'].clickCount,1);
});

test('reopening already selected CNT refreshes its data automatically',()=>{
 const m=buildMock();
 const button=m.ids['napoli-shortcuts'].children[0];
 m.ids['napoli-shortcuts'].dispatchEvent({type:'click',target:button});
 assert.equal(m.ids['cnt-reload'].clickCount,1);
 assert.equal(m.ids['tfg-reload'].clickCount,0);
});
