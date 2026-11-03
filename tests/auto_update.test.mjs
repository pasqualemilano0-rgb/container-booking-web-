import test from 'node:test';
import assert from 'node:assert/strict';
import {newerVersion,safeToInstall} from '../auto-update.mjs';
test('updates only to newer versions',()=>{
 assert.equal(newerVersion('0.27','0.26'),true);
 assert.equal(newerVersion('0.27','0.27'),false);
 assert.equal(newerVersion('0.26','0.27'),false);
 assert.equal(newerVersion('1.0','0.99'),true);
});
test('never auto-reload during editing, open results or scroll',()=>{
 const s={visible:true,editing:false,resultsOpen:false,scrollY:0};
 assert.equal(safeToInstall(s),true);
 assert.equal(safeToInstall({...s,editing:true}),false);
 assert.equal(safeToInstall({...s,resultsOpen:true}),false);
 assert.equal(safeToInstall({...s,scrollY:200}),false);
 assert.equal(safeToInstall({...s,visible:false}),false);
});

test('version parser does not accept equal or lower release number',()=>{
  for(const [newV,oldV] of [['0.1','0.1'],['0.1','0.2'],['0.8','1.0'],['0.0','0.27']]){
    assert.equal(newerVersion(newV,oldV),false,`${newV} vs ${oldV}`);
  }
});
