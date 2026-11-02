
const $ = id => document.getElementById(id);
const defaults = {
 shedW:9,shedD:5,frontBase:2,rearBase:2.45,postSize:150,postWall:5,
 cDepth:180,cFlange:65,cWeb:6,cLip:8,splice:4.5,plateLength:400,plateThickness:8,boltCount:8,
 rafterDepth:140,rafterWidth:65,braceSize:65,fy:250,
 areaLoad:.5,tributary:2.5,modulus:200,
 lift:0,jackA:2.25,jackB:6.75,jackRating:20,
 stage:"existing",concept:"portal",showRoof:true,showBraces:true,showJacks:true,showStress:false
};
const numeric=Object.keys(defaults).filter(k=>typeof defaults[k]==='number');
const state={...defaults,replaced:[],selected:null,tab:'model',view:'iso'};
let THREE,OrbitControls,renderer,camera,controls,scene,model,grid,ground,selectionHelper,raycaster,ready=false;
let selectedObjects=[],sceneItems=[],pointerDown=null,resizeObserver;
const get=id=>state[id], mm=id=>Math.max(.001,state[id]/1000), clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const safe=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
const lengthUnit=n=>safe(n,2)+" m";
const fmt=n=>Number.isFinite(n)?new Intl.NumberFormat('en-AU',{maximumFractionDigits:2}).format(n):'—';
function toast(message){const t=$('toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>t.classList.add('hidden'),3200)}
function validate(){state.shedW=clamp(+state.shedW||9,1,30);state.shedD=clamp(+state.shedD||5,1,20);state.frontBase=clamp(+state.frontBase||2,.5,10);state.rearBase=clamp(+state.rearBase||2.45,.5,10);state.splice=clamp(+state.splice||state.shedW/2,.1,state.shedW-.1);state.postWall=clamp(+state.postWall||5,1,Math.max(1,state.postSize/2-1));state.cLip=clamp(+state.cLip||8,1,Math.max(1,state.cDepth/2-1));state.cWeb=clamp(+state.cWeb||6,1,state.cFlange);state.lift=clamp(+state.lift||0,0,1000);state.jackA=clamp(+state.jackA||0,0,state.shedW);state.jackB=clamp(+state.jackB||0,0,state.shedW);}
function restore(){try{let saved=JSON.parse(localStorage.getItem("shed-studio-v3")||"null");if(saved&&saved.parameters){for(const k of Object.keys(defaults))if(k in saved.parameters)state[k]=saved.parameters[k];state.replaced=Array.isArray(saved.replaced)?saved.replaced.filter(n=>Number.isInteger(n)&&n>=0&&n<8):[];state.tab=saved.tab||"model";state.view=saved.view||"iso";}}catch(e){console.warn("Could not restore draft",e)}validate()}
function persist(){try{localStorage.setItem("shed-studio-v3",JSON.stringify({parameters:Object.fromEntries(Object.keys(defaults).map(k=>[k,state[k]])),replaced:state.replaced,tab:state.tab,view:state.view}))}catch(e){}}
function syncInputs(){for(const id of numeric){const el=$(id);if(el&&document.activeElement!==el)el.value=state[id]}for(const id of ["stage","concept"]){if($(id))$(id).value=state[id]}for(const id of ["showRoof","showBraces","showJacks","showStress"]){if($(id))$(id).checked=!!state[id]}}
function analysis(){let L=state.shedW/3,q=Math.max(0,state.areaLoad)*Math.max(0,state.tributary),reaction=q*L/2,M=q*L*L/8;
 const h=mm('cDepth'),b=mm('cFlange'),tw=mm('cWeb'),tf=mm('cLip'),E=Math.max(1,state.modulus)*1e9;
 const webHeight=Math.max(.0001,h-2*tf);
 const I=tw*Math.pow(webHeight,3)/12+2*(b*Math.pow(tf,3)/12+b*tf*Math.pow(h/2-tf/2,2));
 const deflection=I>0?5*(q*1000)*Math.pow(L,4)/(384*E*I)*1000:NaN;
 const sigma=I>0?M*1000*(h/2)/I/1e6:NaN;
 return {L,q,reaction,M,V:reaction,I,deflection,sigma};
}
const stageLabels={existing:"Existing structure",supports:"Temporary supports",lifting:"Roof raised",replace:"Post replacement",final:"Final raised structure"};
function effectiveLift(){return ['lifting','replace','final'].includes(state.stage)?state.lift/1000:0}
function heightAt(z){return state.frontBase+effectiveLift()+(state.rearBase-state.frontBase)*z/state.shedD}
function renderReadouts(){const a=analysis(),lift=effectiveLift();
 $('projectDimensions').textContent=lengthUnit(state.shedW)+" × "+lengthUnit(state.shedD);
 $('dimensionChip').textContent=lengthUnit(state.shedW)+" × "+lengthUnit(state.shedD);
 $('heightChip').textContent="Eaves "+safe(state.frontBase+lift)+" – "+safe(state.rearBase+lift)+" m";
 $('stageChip').textContent=stageLabels[state.stage];
 $('liftReadout').textContent=state.lift+" mm";
 $('replacedCount').textContent=state.replaced.length+" of 8";
 $('postStageSummary').textContent=state.replaced.length+" posts marked replaced";
 $('metricLoad').textContent=safe(a.q,2);$('metricShear').textContent=safe(a.V,2);$('metricMoment').textContent=safe(a.M,2);
 $('metricDeflection').textContent=safe(a.deflection,2);$('metricStress').textContent=safe(a.sigma,1);$('metricReaction').textContent=safe(a.reaction,2);
 $('analysisSpan').textContent=safe(a.L,2)+" m";$('analysisArea').textContent=safe(state.areaLoad,2)+" kPa";$('analysisTrib').textContent=safe(state.tributary,2)+" m";
 $('sourceStatus').textContent=ready?"3D model ready":"3D engine unavailable";
 $('viewStatus').textContent=state.showStress?"Relative bending colour overlay · isolated beam":"Solid geometry · click a member";
 document.querySelectorAll('[data-stage]').forEach(n=>n.classList.toggle('active',n.dataset.stage===state.stage));
}
function diagram(id,fn,range,left,right){let commands=[];for(let i=0;i<=80;i++){const x=i/80,y=fn(x);commands.push((i?'L':'M')+(24+252*x).toFixed(2)+","+(54-36*y/Math.max(.0000001,range)).toFixed(2))}
 $(id).innerHTML='<line x1="24" y1="54" x2="276" y2="54" stroke="#b0bfcd" stroke-width="1"/><line x1="24" y1="9" x2="24" y2="95" stroke="#e4ebf1"/><path d="'+commands.join(" ")+'" fill="none" stroke="#2478dc" stroke-linejoin="round" stroke-width="2.8"/><text x="24" y="106" font-size="10" fill="#748da3">0 m</text><text x="240" y="106" font-size="10" fill="#748da3">'+safe(right,2)+' m</text><text x="27" y="16" font-size="10" fill="#31638a">'+left+'</text>';
}
function renderDiagrams(){const a=analysis();diagram('shearDiagram',t=>a.V-a.q*a.L*t,Math.max(.0001,a.V),"±"+safe(a.V)+" kN",a.L);diagram('momentDiagram',t=>a.q*a.L*a.L*t*(1-t)/2,Math.max(.0001,a.M),safe(a.M)+" kNm",a.L)}
function tab(name){state.tab=name;document.querySelectorAll('.tab').forEach(x=>x.setAttribute('aria-selected',x.dataset.tab===name?'true':'false'));document.querySelectorAll('[data-panel]').forEach(x=>x.classList.toggle('hidden',x.dataset.panel!==name));persist();if(name==='results')renderDiagrams()}
function readFields(){for(const el of document.querySelectorAll('[data-field]')){const id=el.dataset.field;if(!(id in defaults))continue;el.addEventListener('input',()=>{state[id]=el.type==='checkbox'?el.checked:el.type==='number'||el.type==='range'?Number(el.value):el.value;validate();renderReadouts();renderDiagrams();rebuild();persist()});el.addEventListener('change',()=>{syncInputs();renderReadouts();rebuild()})}}
function box(x,y,z,w,h,d,material,meta){const m=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.001,w),Math.max(.001,h),Math.max(.001,d)),material);m.position.set(x,y,z);m.userData=meta||{};model.add(m);sceneItems.push(m);return m}
function beamBetween(a,b,width,depth,material,meta){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),diff=B.clone().sub(A);let mesh=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.001,width),Math.max(.001,diff.length()),Math.max(.001,depth)),material);mesh.position.copy(A).add(B).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),diff.normalize());mesh.userData=meta||{};model.add(mesh);sceneItems.push(mesh);return mesh}
function makeColor(hex){return new THREE.MeshStandardMaterial({color:hex,metalness:.55,roughness:.52})}
let mats;
function createMaterialSet(){mats={post:makeColor(0x74899a),newPost:makeColor(0x29aa83),beam:makeColor(0x3a88b2),rafter:makeColor(0x5d9bb8),brace:makeColor(0xe4a147),jack:makeColor(0xcb8234),roof:new THREE.MeshStandardMaterial({color:0xaac5d7,metalness:.18,roughness:.6,transparent:true,opacity:.22,side:THREE.DoubleSide,depthWrite:false}),plate:makeColor(0x395c78),bolts:makeColor(0xa2b9c8)}}
function materialForStress(relative){const stops=[[39,121,197],[69,174,172],[225,191,74],[231,133,57],[209,75,68]];const t=clamp(relative,0,.999)*4,i=Math.floor(t),p=t-i,c=stops[i].map((v,k)=>Math.round(v*(1-p)+stops[i+1][k]*p));return makeColor(new THREE.Color('rgb('+c.join(',')+')'))}
function makeChannel(x1,x2,y,z,material,id){if(x2<=x1)return;const L=x2-x1,x=(x1+x2)/2,H=mm('cDepth'),F=mm('cFlange'),tw=mm('cWeb'),tf=mm('cLip');
 const meta={id,kind:'channel',label:z===0?'Front C-channel':'Rear C-channel',length:L};
 box(x,y,z+tw/2,L,H,tw,material,meta);
 box(x,y+H/2-tf/2,z+F/2,L,tf,F,material,meta);
 box(x,y-H/2+tf/2,z+F/2,L,tf,F,material,meta);
}
function makePost(x,z,n,top){let size=mm('postSize'),t=mm('postWall'),inner=Math.max(.001,size-2*t),material=state.replaced.includes(n)?mats.newPost:mats.post,meta={id:'post-'+n,kind:'post',label:(n<4?'Front':'Rear')+' post '+(n%4+1),number:n,height:top};
 const y=top/2;box(x-size/2+t/2,y,z,t,top,size,material,meta);box(x+size/2-t/2,y,z,t,top,size,material,meta);box(x,y,z-size/2+t/2,inner,top,t,material,meta);box(x,y,z+size/2-t/2,inner,top,t,material,meta);
 box(x,.035,z,.26,.07,.26,mats.plate,{id:'base-'+n,kind:'base',label:meta.label+' base plate'});
}
function makeSplice(){let x=state.splice,H=mm('cDepth'),y=heightAt(0),z=-.025,L=mm('plateLength'),T=mm('plateThickness');
 const meta={id:'splice',kind:'splice',label:'Front C-channel centre splice',length:L};
 box(x,y,z,L,H*.64,T,mats.plate,meta);
 const count=Math.round(clamp(state.boltCount,2,24)),columns=Math.ceil(count/2);
 for(let i=0;i<count;i++){let px=x-L*.4+((i%columns)+.5)*L*.8/columns,py=y+(i<columns?-.18:.18)*H;let bolt=new THREE.Mesh(new THREE.SphereGeometry(.009,8,6),mats.bolts);bolt.position.set(px,py,z-T/2-.005);bolt.userData=meta;model.add(bolt);sceneItems.push(bolt)}
}
function makeJack(id,x){x=clamp(x,0,state.shedW);const roof=heightAt(0);const z=-.27,meta={id,kind:'jack',label:id==='jack-a'?'Candidate jack A':'Candidate jack B',height:roof};
 box(x,.08,z,.42,.16,.42,mats.jack,meta);box(x,Math.max(.2,(roof-.15)/2),z,.11,Math.max(.2,roof-.15),.11,mats.brace,meta);
 box(x,roof-.12,z,.35,.08,.35,mats.jack,meta);
 const halo=new THREE.Mesh(new THREE.TorusGeometry(.24,.014,6,32),mats.jack);halo.rotation.x=Math.PI/2;halo.position.set(x,.13,z);halo.userData=meta;model.add(halo);sceneItems.push(halo);
}
function braceBetween(a,b,id){beamBetween(a,b,mm('braceSize'),mm('braceSize'),mats.brace,{id,kind:'brace',label:'Temporary bracing concept'})}
function makeTemporary(){const W=state.shedW,D=state.shedD,L=W/3;
 if(state.concept==='portal'){for(let i=0;i<3;i++){let x=(i+.5)*L;braceBetween([x,0,0],[x,heightAt(0)-.1,0],'temp-front-'+i);braceBetween([x,0,D],[x,heightAt(D)-.1,D],'temp-rear-'+i);braceBetween([x,heightAt(0)-.1,0],[x,heightAt(D)-.1,D],'temp-top-'+i)}}
 else if(state.concept==='cross'){for(let z of [0,D])for(let i=0;i<3;i++){let x=i*L;braceBetween([x,0,z],[x+L,heightAt(z),z],'temp-cross-'+i);braceBetween([x+L,0,z],[x,heightAt(z),z],'temp-cross-alt-'+i)}}
 else if(state.concept==='v'){for(let z of [0,D]){let h=heightAt(z),mid=W/2;braceBetween([0,h,z],[mid,1.2+effectiveLift(),z],'temp-v-left');braceBetween([W,h,z],[mid,1.2+effectiveLift(),z],'temp-v-right');braceBetween([mid,0,z],[mid,1.2+effectiveLift(),z],'temp-v-center')}}
 else for(let i=0;i<3;i++)for(let z of [0,D]){let x=(i+.5)*L;braceBetween([x,0,z],[x,heightAt(z),z],'temp-grid-'+i)}
}
function buildRoof(){if(!state.showRoof)return;const W=state.shedW,D=state.shedD,h0=heightAt(0)+.17,h1=heightAt(D)+.17;
 const geom=new THREE.BufferGeometry();const p=new Float32Array([0,h0,0,W,h0,0,W,h1,D,0,h0,0,W,h1,D,0,h1,D]);geom.setAttribute('position',new THREE.BufferAttribute(p,3));geom.computeVertexNormals();const mesh=new THREE.Mesh(geom,mats.roof);mesh.userData={id:'roof',kind:'roof',label:'Roof surface'};model.add(mesh);sceneItems.push(mesh)}
function makeSteel(){const W=state.shedW,D=state.shedD,L=W/3,H=heightAt;
 for(let z of [0,D]){let y=H(z);if(z===0&&state.showStress){for(let bay=0;bay<3;bay++)for(let n=0;n<12;n++){const x1=bay*L+L*n/12,x2=bay*L+L*(n+1)/12,t=(n+.5)/12,rel=4*t*(1-t);makeChannel(x1,x2,y,z,materialForStress(rel),'frontBeam')}}
 else if(z===0){makeChannel(0,state.splice,y,z,mats.beam,'frontBeam');makeChannel(state.splice,W,y,z,mats.beam,'frontBeam')}
 else makeChannel(0,W,y,z,mats.beam,'rearBeam')}
 for(let i=0;i<4;i++){let x=W*i/3;beamBetween([x,H(0)+.12,0],[x,H(D)+.12,D],mm('rafterWidth'),mm('rafterDepth'),mats.rafter,{id:'rafter-'+i,kind:'rafter',label:'Rafter '+(i+1),length:Math.hypot(D,H(D)-H(0))})}
 for(let row=0;row<2;row++)for(let i=0;i<4;i++){let n=row*4+i,x=W*i/3,z=row?D:0;let original=row?state.rearBase:state.frontBase;
 let top=state.stage==='final'||state.replaced.includes(n)?H(z):original;
 makePost(x,z,n,top)}
 makeSplice();buildRoof();
 const temporary=['supports','lifting','replace'].includes(state.stage);
 if(temporary&&state.showBraces)makeTemporary();
 if(temporary&&state.showJacks){makeJack('jack-a',state.jackA);makeJack('jack-b',state.jackB)}
}
function rebuild(){if(!ready)return;for(const o of sceneItems){if(o.geometry)o.geometry.dispose();if(o.material&&o.material!==mats.post&&o.material!==mats.newPost&&o.material!==mats.beam&&o.material!==mats.rafter&&o.material!==mats.brace&&o.material!==mats.jack&&o.material!==mats.roof&&o.material!==mats.plate&&o.material!==mats.bolts)o.material.dispose()}sceneItems=[];model.clear();makeSteel();highlight();updateInspector()}
function highlight(){if(selectionHelper){scene.remove(selectionHelper);selectionHelper.geometry.dispose();selectionHelper=null}const selected=state.selected;if(!selected)return;let items=sceneItems.filter(o=>o.userData.id===selected);if(!items.length)return;const box3=new THREE.Box3();for(const o of items)box3.expandByObject(o);selectionHelper=new THREE.Box3Helper(box3,0xf0a546);scene.add(selectionHelper)}
function selectedInfo(){const id=state.selected;if(!id)return null;return sceneItems.find(o=>o.userData.id===id)?.userData||null}
function updateInspector(){const info=selectedInfo();$('selectionTitle').textContent=info?info.label:'Nothing selected';$('selectionHint').textContent=info?'Selected on 3D model':'Tap a post, beam, rafter or jack in the 3D view';const target=$('properties');if(!info){target.innerHTML='<div class="inspector-empty"><div class="outline-icon">⌖</div>Tap a steel member to see its measurements and current stage status.</div>';return}
 let props=[];
 if(info.kind==='post'){props=[['Section','SHS '+state.postSize+' × '+state.postSize+' × '+state.postWall+' mm'],['Displayed height',safe(info.height,2)+' m'],['Position',info.number<4?'Front row':'Rear row'],['Replacement',state.replaced.includes(info.number)?'Marked replaced':'Existing']]}
 else if(info.kind==='channel'){props=[['Section','C '+state.cDepth+' × '+state.cFlange+' mm'],['Web',state.cWeb+' mm'],['Flange',state.cLip+' mm'],['Steel grade','Nominal '+state.fy+' MPa'],['Front splice',safe(state.splice,2)+' m from left']]}
 else if(info.kind==='rafter')props=[['Section',state.rafterWidth+' × '+state.rafterDepth+' mm'],['Span',safe(info.length,2)+' m'],['Roof slope',safe((state.rearBase-state.frontBase)/state.shedD*100,1)+'%']];
 else if(info.kind==='jack')props=[['Marker',info.label],['Nominal rating',state.jackRating+' t (user input)'],['Calculated reaction','Not available'],['Status','Unverified position']];
 else if(info.kind==='splice')props=[['Plate length',state.plateLength+' mm'],['Plate thickness',state.plateThickness+' mm'],['Visual bolt count',state.boltCount],['Capacity','Not calculated']];
 else props=[['Type',info.kind],['Status','Concept geometry']];
 target.innerHTML='<div class="inspector-card"><h3>Selected element</h3>'+props.map(([k,v])=>'<dl class="kv"><dt>'+k+'</dt><dd>'+v+'</dd></dl>').join('')+'</div>'+(info.kind==='post'?'<button type="button" class="ghost wide" id="replaceSelected">'+(state.replaced.includes(info.number)?'Mark as existing':'Mark as replaced')+'</button>':'');
 const btn=$('replaceSelected');if(btn)btn.onclick=()=>{let n=info.number;state.replaced=state.replaced.includes(n)?state.replaced.filter(x=>x!==n):[...state.replaced,n].sort();renderReadouts();rebuild();persist();toast('Post '+(n+1)+' updated')};
}
function setSelected(id){state.selected=id;highlight();updateInspector();if(window.innerWidth<=740&&id){$('rightPanel').classList.add('inspector-open');$('inspectorToggle').textContent='Hide inspector'}}
function setView(name){state.view=name;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===name));if(!ready)return;
 const W=state.shedW,D=state.shedD,center=new THREE.Vector3(W/2,(state.frontBase+state.rearBase)/2+effectiveLift(),D/2),dist=Math.max(W,D)*1.8;let o;
 if(name==='front')o=new THREE.Vector3(0,.4,-dist);
 else if(name==='side')o=new THREE.Vector3(dist,.4,0);
 else if(name==='top')o=new THREE.Vector3(.02,dist,.01);
 else o=new THREE.Vector3(dist*.71,dist*.66,-dist*.82);
 controls.target.copy(center);camera.position.copy(center).add(o);camera.lookAt(center);controls.update();persist()}
function pick(event){if(!ready)return;let rect=renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);raycaster.setFromCamera(p,camera);let hits=raycaster.intersectObjects(sceneItems,false).filter(x=>x.object.userData.id);setSelected(hits.length?hits[0].object.userData.id:null)}
function initScene(){const host=$('sceneHost');scene=new THREE.Scene();scene.background=new THREE.Color(0xe7eff6);camera=new THREE.PerspectiveCamera(42,1,.05,180);
 renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'default'});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0xe7eff6);host.appendChild(renderer.domElement);
 controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=2;controls.maxDistance=100;controls.maxPolarAngle=Math.PI*.97;controls.enablePan=true;
 scene.add(new THREE.HemisphereLight(0xffffff,0x8296ad,2.3));let sun=new THREE.DirectionalLight(0xffffff,2.35);sun.position.set(-8,14,-10);scene.add(sun);
 ground=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.MeshStandardMaterial({color:0xf1f5f8,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.10;scene.add(ground);
 grid=new THREE.GridHelper(60,60,0xb8c9d8,0xd9e3eb);grid.position.y=-.09;scene.add(grid);
 model=new THREE.Group();scene.add(model);raycaster=new THREE.Raycaster();createMaterialSet();
 const resize=()=>{let r=host.getBoundingClientRect();let w=Math.max(200,r.width),h=Math.max(200,r.height);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false)};resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);resize();
 renderer.domElement.addEventListener('pointerdown',e=>{pointerDown={x:e.clientX,y:e.clientY,t:Date.now()}});renderer.domElement.addEventListener('pointerup',e=>{if(pointerDown&&Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)<7&&Date.now()-pointerDown.t<650)pick(e);pointerDown=null});
 ready=true;rebuild();setView(state.view);renderReadouts();$('loading').classList.add('hidden');
 const animate=()=>{if(!ready)return;requestAnimationFrame(animate);controls.update();renderer.render(scene,camera)};animate();
}
async function boot3D(){try{const fallback=setTimeout(()=>{if(!ready){$('loading').classList.add('error');$('loadingText').textContent='3D libraries are taking too long to load. Please check connectivity or reload.'}},12000);
 const [three,ctrl]=await Promise.all([import('three'),import('three/addons/controls/OrbitControls.js')]);THREE=three;OrbitControls=ctrl.OrbitControls;clearTimeout(fallback);initScene()}
 catch(e){console.error('3D startup error',e);$('loading').classList.add('error');$('loadingText').textContent='3D could not start: '+(e.message||'network/browser error')+'. The editor and exports remain available.';renderReadouts()}}
function download(name,obj){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function exportProject(){download('shed-studio-model.json',{schema:'shed-studio-v3',description:'Editable parametric geometry and unverified analysis assumptions',exportedAt:new Date().toISOString(),units:{geometry:'m',steelSections:'mm',loads:'kPa',material:'GPa/MPa'},parameters:Object.fromEntries(Object.keys(defaults).map(k=>[k,state[k]])),replaced:state.replaced,isolatedBeamExample:analysis(),limitations:['Concept-only front beam calculations; simply-supported span with uniform roof load','No connected-frame analysis','No jack force calculation or endorsed jack positions','No connections, torsion, foundation, global stability or staged lifting validation'],verification:'NOT ENGINEER-VERIFIED'})}
function importProject(file){const reader=new FileReader();reader.onload=()=>{try{const j=JSON.parse(reader.result);const input=j.parameters||j.measurements||j.values;if(!input)throw Error('No recognised measurements found');for(const k of Object.keys(defaults)){if(k in input&&typeof input[k]===typeof defaults[k])state[k]=input[k]}if(j.replaced)state.replaced=j.replaced.filter(n=>Number.isInteger(n)&&n>=0&&n<8);if(j.replaced_posts)state.replaced=j.replaced_posts;validate();syncInputs();renderReadouts();renderDiagrams();rebuild();setView('iso');persist();toast('Model imported successfully')}catch(e){toast('Could not import: '+e.message)}};reader.readAsText(file)}
function reset(){if(!confirm('Reset dimensions, loads and staged-lift settings to defaults?'))return;Object.assign(state,defaults,{replaced:[],selected:null,stage:'existing'});syncInputs();renderReadouts();renderDiagrams();rebuild();setView('iso');persist();toast('Model reset')}
function events(){readFields();
 document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
 document.querySelectorAll('[data-stage]').forEach(el=>el.addEventListener('click',()=>{state.stage=el.dataset.stage;$('stage').value=state.stage;renderReadouts();rebuild();persist()}));
 $('exportButton').addEventListener('click',exportProject);$('exportSidebar').addEventListener('click',exportProject);
 $('importButton').addEventListener('click',()=>$('fileInput').click());$('fileInput').addEventListener('change',e=>{if(e.target.files?.[0])importProject(e.target.files[0]);e.target.value=''});
 $('resetButton').addEventListener('click',reset);
 $('inspectorToggle').addEventListener('click',()=>{let p=$('rightPanel'),on=p.classList.toggle('inspector-open');$('inspectorToggle').textContent=on?'Hide inspector':'Inspect'});
 $('closeInspector').addEventListener('click',()=>{$('rightPanel').classList.remove('inspector-open');$('inspectorToggle').textContent='Inspect'});
 $('fitButton').addEventListener('click',()=>setView('iso'));
 $('showResultsButton').addEventListener('click',()=>{tab('results');if(window.innerWidth<=740)document.querySelector('.left-panel').scrollIntoView({behavior:'smooth'})});
 $('replacePost').addEventListener('click',()=>{const n=Number($('selectedPost').value);state.replaced=state.replaced.includes(n)?state.replaced.filter(x=>x!==n):[...state.replaced,n].sort();renderReadouts();rebuild();persist();toast('Post '+(n+1)+' '+(state.replaced.includes(n)?'marked replaced':'marked existing'))});
 $('selectedPost').addEventListener('change',e=>setSelected('post-'+e.target.value));
}
restore();syncInputs();renderReadouts();renderDiagrams();tab(state.tab);events();boot3D();
