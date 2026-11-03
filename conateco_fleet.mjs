/** Fleet visibility is about navigation, never booking authorization.
 * PARTITE/CHIUSA voyages must not crowd out active and expected vessels.
 * A direct ship/voyage search still searches all rows, including departed ones.
 */
function normalize(text){
  return String(text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9]/g,'');
}
export function isDepartedConateco(row){
  return String(row?.category??'').toUpperCase()==='PARTITE'
    ||String(row?.vessel_status??'').toUpperCase()==='CHI'
    ||String(row?.acceptance_icon??'').toUpperCase()==='CHIUSA';
}
export function selectConatecoFleet(rows,{query='',showDeparted=false}={}){
  if(!Array.isArray(rows))return {rows:[],archivedCount:0,activeCount:0,searching:false};
  const normalized=normalize(query);
  const archivedCount=rows.filter(isDepartedConateco).length;
  const activeCount=rows.length-archivedCount;
  const searching=normalized.length>0;
  const selection=rows.map((row,index)=>({row,index}))
    .filter(({row})=>(showDeparted||searching||!isDepartedConateco(row))
      &&(!normalized||normalize(row?.vessel).includes(normalized)||normalize(row?.voyage).includes(normalized)));
  return {rows:selection,archivedCount,activeCount,searching};
}
