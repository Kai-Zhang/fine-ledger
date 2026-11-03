import test from 'node:test';
import assert from 'node:assert/strict';
import {TAU,ringLayout,ringHit,ringArc,categoryShare,categoryPlotColors,beginRingGesture,holdRingGesture,moveRingGesture,fineStep} from '../src/reports/donut-model.ts';
const groups=[{id:'large',name:'大类',amount:9990n,children:[{id:'main',name:'普通项',amount:9980n},{id:'tiny1',name:'水',amount:8n},{id:'tiny2',name:'小项',amount:2n}]},{id:'other',name:'其他',amount:10n,children:[{id:'other-child',name:'其他子类',amount:10n}]}];
const coordinate=(r,a)=>({x:150+r*Math.sin(a),y:150-r*Math.cos(a)});
test('the geometric hit map selects 0.08 percent and adjacent 0.02 percent items, radial gaps, and the correct layer',()=>{
 const layout=ringLayout(groups);
 for(const id of ['tiny1','tiny2']){const segment=layout.find(s=>s.id===id),angle=(segment.start+segment.end)/2;for(const r of [111,123,142,151]){const p=coordinate(r,angle);assert.equal(ringHit(layout,p.x,p.y).id,id);}
 const p=coordinate(91,angle);assert.equal(ringHit(layout,p.x,p.y).id,'large');}
 assert.equal(ringHit(layout,150,150),undefined);assert.equal(ringHit(layout,310,150),undefined);
 const a=layout.find(s=>s.id==='tiny1'),p=coordinate(125,a.start);assert.equal(ringHit(layout,p.x,p.y).id,'tiny1');
 const inner=coordinate(91,(a.start+a.end)/2);assert.equal(ringHit(layout,inner.x,inner.y,'child').id,'tiny1');
});
test('ring layout preserves parent child proportions, closes the full circle, and renders a complete single-category ring',()=>{
 const layout=ringLayout(groups),parents=layout.filter(s=>s.layer==='parent');assert.equal(parents.at(-1).end,TAU);
 for(const p of parents){const children=layout.filter(s=>s.layer==='child'&&s.parentId===p.id);assert.equal(children[0].start,p.start);assert.equal(children.at(-1).end,p.end);for(let i=1;i<children.length;i++)assert.equal(children[i-1].end,children[i].start);}
 assert.equal((ringArc(123,0,TAU).match(/ A /g)||[]).length,2);
 assert.deepEqual(ringLayout([]),[]);
});
test('fine selection steps through every neighbor regardless of its angular width, without wrapping or changing ring layers',()=>{
 const rows=ringLayout(groups).filter(s=>s.layer==='child');let g=holdRingGesture(beginRingGesture('child',0,100,100));
 for(let index=0;index<rows.length;index++){g=moveRingGesture(g,100+fineStep*index,500,index,rows.length);assert.equal(g.index,index);assert.equal(g.layer,'child');assert.equal(g.mode,'precision');}
 assert.equal(moveRingGesture(g,-1000,0,0,rows.length).index,0);
 assert.equal(moveRingGesture(g,10000,0,0,rows.length).index,rows.length-1);
});
test('vertical scrolling cancels selection before hold, horizontal dragging scrubs, and a slight jitter remains a tap',()=>{
 const start=beginRingGesture('parent',1,100,100);
 assert.equal(moveRingGesture(start,103,102,0,3).mode,'pending');
 const vertical=moveRingGesture(start,102,120,0,3);assert.equal(vertical.mode,'cancelled');assert.equal(holdRingGesture(vertical).mode,'cancelled');assert.equal(moveRingGesture(vertical,160,120,2,3).mode,'cancelled');
 const horizontal=moveRingGesture(start,120,102,2,3);assert.equal(horizontal.mode,'scrub');assert.equal(horizontal.index,2);assert.equal(holdRingGesture(horizontal).mode,'scrub');
});
test('small percentages remain readable while zero and huge exact amounts never rely on Number money arithmetic',()=>{
 assert.equal(categoryShare(8n,10000n),'0.08%');assert.equal(categoryShare(2n,10000n),'0.02%');assert.equal(categoryShare(1n,100000000n),'<0.01%');assert.equal(categoryShare(1n,3n),'33.3%');assert.equal(categoryShare(0n,100n),'0%');assert.equal(categoryShare(90071992547409930n,900719925474099300n),'10.0%');
});
test('presentation colors are stable under input order and never replace stored category preferences',()=>{
 const categories=Array.from({length:16},(_,i)=>({id:'parent-'+i,name:'父类'+i,kind:'expense',color:'#205B4D'}));categories.push({id:'child',name:'子类',kind:'expense',parentId:'parent-0',color:'#F01234'});
 const before=structuredClone(categories),first=categoryPlotColors(categories),second=categoryPlotColors([...categories].reverse());
 assert.deepEqual([...first].sort(),[...second].sort());assert.equal(new Set(categories.filter(c=>!c.parentId).map(c=>first.get(c.id).light)).size,16);assert.notEqual(first.get('child').light,first.get('parent-0').light);assert.deepEqual(categories,before);
});


test('large sibling sets retain distinct presentation colors without changing their family identity',()=>{
 const categories=[{id:'parent',kind:'expense',name:'大类'},...Array.from({length:40},(_,i)=>({id:'child-'+String(i).padStart(2,'0'),parentId:'parent',kind:'expense',name:'子类'+i}))];
 const palette=categoryPlotColors(categories);
 assert.equal(new Set(categories.slice(1).map(c=>palette.get(c.id).light)).size,40);
 assert.equal(new Set(categories.slice(1).map(c=>palette.get(c.id).dark)).size,40);
});
