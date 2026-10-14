import * as THREE from 'three';
import { V } from './common.js';

export class GodInput {
  constructor(game){
    this.g=game;this.abort=new AbortController();this.ray=new THREE.Raycaster();this.pointer=null;const signal=this.abort.signal,c=game.canvas;
    c.addEventListener('pointerdown',e=>this.down(e),{signal});
    const plugTarget=document.getElementById('target-plug');
    plugTarget.addEventListener('pointerdown',e=>this.down(e,'plug'),{signal});
    plugTarget.addEventListener('click',e=>{if(e.detail===0)this.armPlug();},{signal});
    window.addEventListener('pointermove',e=>this.move(e),{signal});
    window.addEventListener('pointerup',e=>this.end(e,false),{signal});
    window.addEventListener('pointercancel',e=>this.end(e,true),{signal});
    c.addEventListener('lostpointercapture',e=>this.end(e,true),{signal});
    window.addEventListener('blur',()=>this.clear(true),{signal});
    c.addEventListener('contextmenu',e=>e.preventDefault(),{signal});
    window.addEventListener('keydown',e=>{
      if(e.target.matches('input,textarea,select')||e.target.isContentEditable)return;
      if(e.code==='Escape'){if(game.mode==='intro')game.skipIntro();else this.clear(true);}
      if(e.code==='KeyR')game.reset();
      if(game.mode!=='play')return;
      if(e.code==='Digit1')game.power('plug');if(e.code==='Digit2')this.armTruck();if(e.code==='Digit3')game.power('ant');if(e.code==='Digit4')game.power('weather');
      if(game.lake.state==='gripped'&&e.code==='ArrowUp'){e.preventDefault();game.lake.pullTo(game.lake.requestedPull+.24);}
      if(game.vehicle.held&&e.code.startsWith('Arrow')){e.preventDefault();const p=game.vehicle.target.clone(),d=.45;if(e.code==='ArrowLeft')p.x-=d;if(e.code==='ArrowRight')p.x+=d;if(e.code==='ArrowUp')p.z-=d;if(e.code==='ArrowDown')p.z+=d;game.vehicle.move(p);}
      if(e.code==='Enter'&&game.vehicle.held){e.preventDefault();this.clear(true);}
    },{signal});
  }
  rayAt(x,y){const r=this.g.canvas.getBoundingClientRect();this.ray.setFromCamera({x:(x-r.left)/r.width*2-1,y:1-(y-r.top)/r.height*2},this.g.camera);return this.ray;}
  ground(x,y){
    const ray=this.rayAt(x,y).ray,p=V();let height=0;
    // Solve the same lake-bed surface used for placement and falling fish.
    for(let i=0;i<5;i++){const t=(height-ray.origin.y)/ray.direction.y;p.copy(ray.origin).addScaledVector(ray.direction,Math.max(0,t));height=this.g.lake.height(p.x,p.z);}
    return p.setY(0);
  }
  hit(x,y){
    const g=this.g,ray=this.rayAt(x,y);
    if(ray.intersectObject(g.truck.root,true).length)return 'truck';
    if(g.lake.state==='full'&&ray.intersectObject(g.lake.plug,true).length)return 'plug';
    if(ray.intersectObject(g.giant.ant.root,true).length)return 'ant';
    // Tiny ant and plug remain comfortable finger targets at either aspect ratio.
    for(const [kind,point] of [['ant',g.giant.position],['plug',g.lake.plug.position]]){const p=g.project(point);if(Math.hypot(p.x-x,p.y-y)<28)return kind;}
    return null;
  }
  down(e,forcedKind=null){
    if(e.button!==0||this.pointer!==null||this.g.mode!=='play'||this.g.paused)return;
    const armed=this.g.vehicle.held,kind=forcedKind||(armed?'truck':this.g.lake.state==='gripped'?'plug':this.hit(e.clientX,e.clientY));if(!kind)return;
    if(kind==='truck'&&!this.g.vehicle.begin())return;
    if(kind==='plug'&&!this.g.lake.grab())return;
    e.preventDefault();this.g.audio.unlock();this.pointer=e.pointerId;this.kind=kind;this.start={x:e.clientX,y:e.clientY};
    this.startPull=this.g.lake.requestedPull;
    this.offset=armed?V():this.g.vehicle.root.position.clone().setY(0).sub(this.ground(e.clientX,e.clientY));
    try{this.g.canvas.setPointerCapture(e.pointerId);}catch{}
    if(kind==='truck'&&armed)this.g.vehicle.move(this.ground(e.clientX,e.clientY));
  }
  move(e){if(e.pointerId!==this.pointer)return;if(e.cancelable)e.preventDefault();if(this.kind==='truck')this.g.vehicle.move(this.ground(e.clientX,e.clientY).add(this.offset));
    else if(this.kind==='plug')this.g.lake.pullTo(this.startPull+(this.start.y-e.clientY)/Math.min(80,this.g.size.h*.105));}
  end(e,cancelled){if(e.pointerId!==this.pointer)return;const kind=this.kind,start=this.start,short=Math.hypot(e.clientX-start.x,e.clientY-start.y)<12;
    // A tap just puts the hand on the ring. An unfinished/cancelled pull reseats
    // it, while a completed pull has already handed off to the draining state.
    const completed=kind==='plug'&&!cancelled&&this.g.lake.requestedPull>=.99;
    this.clear(kind==='truck'||kind==='plug'&&!completed&&(cancelled||!short));
    if(!cancelled&&kind==='ant'&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<55)this.g.power(kind);}
  armPlug(){if(this.g.mode!=='play'||this.g.paused)return false;this.clear(true);return this.g.lake.grab();}
  armTruck(){if(this.g.mode!=='play')return;if(this.g.vehicle.held){this.clear(true);return;}this.clear(true);if(this.g.vehicle.begin())this.g.notice('Tap a clear spot, or drag the pickup. Arrow keys + Enter also work.',4);}
  clear(place=false){const id=this.pointer;this.pointer=null;this.kind=null;if(place){this.g.vehicle?.release();this.g.lake?.release();}if(id!==null&&this.g.canvas.hasPointerCapture(id))this.g.canvas.releasePointerCapture(id);}
  destroy(){this.clear(false);this.abort.abort();}
}
