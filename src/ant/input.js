export class AntInput {
  constructor(game,canvas) {
    this.game=game;this.keys=new Set();this.pad=document.getElementById('move-pad');this.knob=this.pad.querySelector('.pad-knob');this.reset();
    canvas.addEventListener('pointerdown',e=>{
      if(!game.active)return;
      const r=canvas.getBoundingClientRect();
      if(e.pointerType==='touch'&&e.clientX<r.left+r.width*.38)return;
      canvas.setPointerCapture(e.pointerId);this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};
    });
    canvas.addEventListener('pointermove',e=>{
      if(this.drag?.id!==e.pointerId)return;
      game.look(-(e.clientX-this.drag.x)*.004,-(e.clientY-this.drag.y)*.0035);
      this.drag.x=e.clientX;this.drag.y=e.clientY;
    });
    for(const ev of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(ev,()=>this.drag=null);
    const move=e=>{
      if(this.padPointer!==e.pointerId)return;
      const r=this.pad.getBoundingClientRect();let x=(e.clientX-r.x-r.width/2)/34,y=(e.clientY-r.y-r.height/2)/34;
      const n=Math.max(1,Math.hypot(x,y));x/=n;y/=n;this.stick={x,y};this.knob.style.transform=`translate(${x*28}px,${y*28}px)`;
    };
    this.pad.addEventListener('pointerdown',e=>{if(!game.active)return;e.preventDefault();this.pad.setPointerCapture(e.pointerId);this.padPointer=e.pointerId;move(e);});
    this.pad.addEventListener('pointermove',move);
    for(const ev of ['pointerup','pointercancel','lostpointercapture'])this.pad.addEventListener(ev,()=>this.clearPad());
    addEventListener('keydown',e=>{
      if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&e.target.tagName!=='BUTTON')e.preventDefault();
      if(e.repeat)return;
      if(e.code==='Escape'||e.code==='KeyP')game.paused?game.resume():game.pause();
      if(game.mode==='loading')return;
      if(e.code==='KeyM')game.toggleMute();
      if(e.code==='KeyR')game.restart();
      if(e.code==='KeyH')game.ui.toggleClean();
      if(game.mode==='failed'&&(e.code==='Enter'||e.code==='Space')){game.retry();return;}
      if(!game.active)return;
      this.keys.add(e.code);
      if(e.code==='KeyC')game.recenter();if(e.code==='KeyV')game.lookUp();
    });
    addEventListener('keyup',e=>this.keys.delete(e.code));
    addEventListener('blur',()=>{this.reset();game.pause();});
  }
  get movement() {
    const k=this.keys,x=this.stick.x+Number(k.has('KeyD')||k.has('ArrowRight'))-Number(k.has('KeyA')||k.has('ArrowLeft'));
    const y=this.stick.y+Number(k.has('KeyS')||k.has('ArrowDown'))-Number(k.has('KeyW')||k.has('ArrowUp'));
    const n=Math.max(1,Math.hypot(x,y));return {x:x/n,y:y/n};
  }
  clearPad(){this.padPointer=null;this.stick={x:0,y:0};this.knob.style.transform='';}
  reset(){this.keys.clear();this.clearPad();this.drag=null;}
}
