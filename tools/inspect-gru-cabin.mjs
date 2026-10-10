// Inspect the posed skinned vertices in vehicle coordinates, at normal and miniature scale.
import {chromium} from 'playwright';
import fs from 'node:fs';
const base=process.argv[2]||'http://localhost:8080/';
const browser=await chromium.launch({args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:540,height:960}});
await page.goto(base+'fisherman.html?skin=gru');await page.waitForFunction(()=>window.__ready);await page.click('#btn-go');
const report=await page.evaluate(async()=>{
  const T=await import('/vendor/three/three.module.js'),g=__game,rows=[];
  g.reset({intro:false});g.paused=true;
  for(const scale of [1,0.12])for(const pose of ['L_sill','L_pointDown','L_pointOut','L_thumbBack']){
    g.truck.root.scale.setScalar(scale);g.animator.reset();g.animator.time=0;
    g.animator.glances=[];g.animator.lookTarget.set(-0.3,1.64*scale,1.74*scale);g.animator.setArm('L',pose);
    for(let i=0;i<100;i++)g.animator.update(1/60,{speaking:true,speechEnv:0});
    g.scene.updateMatrixWorld(true);
    const inv=g.truck.body.matrixWorld.clone().invert(),p=new T.Vector3();
    const obstacles=['gruDriverDoor','gruPassengerDoor','gruCabinFloor','gruCabinBulkhead','gruFirewall'].map(name=>{
      const m=g.scene.getObjectByName(name);m.geometry.computeBoundingBox();return {name,inv:m.matrixWorld.clone().invert(),box:m.geometry.boundingBox.clone().expandByScalar(-0.002)};
    });
    const parts={};
    for(const name of ['torso','armL','armR','head']){
      const m=g.grandpa.meshes[name],bounds=new T.Box3(),penetrations={};
      for(let i=0;i<m.geometry.attributes.position.count;i++){
        m.getVertexPosition(i,p).applyMatrix4(m.matrixWorld);
        for(const o of obstacles)if(o.box.containsPoint(p.clone().applyMatrix4(o.inv)))penetrations[o.name]=(penetrations[o.name]||0)+1;
        p.applyMatrix4(inv);bounds.expandByPoint(p);
        const rounded=(x,y,x0,y0,w,h,r)=>Math.hypot(x-T.MathUtils.clamp(x,x0+r,x0+w-r),y-T.MathUtils.clamp(y,y0+r,y0+h-r))<r-0.002;
        if(Math.abs(Math.abs(p.z)-0.91)<0.016&&rounded(p.x,p.y,-1.13,1.185,2.16,0.755,0.23)&&!rounded(p.x,p.y,-1.00,1.25,1.87,0.56,0.155))penetrations.windowFrame=(penetrations.windowFrame||0)+1;
      }
      parts[name]={min:bounds.min.toArray(),max:bounds.max.toArray(),penetrations};
    }
    const wrist=g.grandpa.bones.handL.getWorldPosition(p).applyMatrix4(inv).toArray();
    rows.push({scale,pose,parts,wrist,seat:g.grandpa.group.position.toArray()});
  }
  return rows;
});
fs.writeFileSync('check-out/gru/cabin-geometry.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report.map(r=>({scale:r.scale,pose:r.pose,parts:Object.fromEntries(Object.entries(r.parts).map(([n,v])=>[n,v.penetrations])),wrist:r.wrist})),null,2));
const clear=report.every(r=>Object.values(r.parts).every(p=>Object.keys(p.penetrations).length===0));
const invariant=report.filter(r=>r.scale===1).every(a=>{const b=report.find(r=>r.scale===0.12&&r.pose===a.pose);return a.wrist.every((v,i)=>Math.abs(v-b.wrist[i])<1e-6);});
console.log(`No cabin penetrations: ${clear}; scale-invariant arm poses: ${invariant}`);
if(!clear||!invariant)process.exitCode=1;
await browser.close();
