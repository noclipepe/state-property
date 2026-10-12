import { AudioEngine } from '../audio/audio.js';
import { V } from './layout.js';

export class AntAudio extends AudioEngine {
  constructor() {
    super();
    this.voice.disconnect();this.positioner=this.ctx.createPanner();
    this.positioner.panningModel='HRTF';this.positioner.distanceModel='inverse';
    this.positioner.refDistance=5;this.positioner.rolloffFactor=.12;
    this.voice.connect(this.positioner).connect(this.master);
  }
  spatial(camera,position) {
    const t=this.ctx.currentTime,listener=this.ctx.listener,d=camera.getWorldDirection(V()),u=V(0,1,0).applyQuaternion(camera.quaternion);
    const set=(node,prefix,p)=>{
      if(node[prefix+'X'])for(const axis of ['X','Y','Z'])node[prefix+axis].setTargetAtTime(p[axis.toLowerCase()],t,.045);
    };
    if(listener.positionX){set(listener,'position',camera.position);set(listener,'forward',d);set(listener,'up',u);}
    else {listener.setPosition(...camera.position.toArray());listener.setOrientation(d.x,d.y,d.z,u.x,u.y,u.z);}
    if(position) {if(this.positioner.positionX)set(this.positioner,'position',position);else this.positioner.setPosition(...position.toArray());}
  }
  rustle(){this.whoosh(.24,.075);}
}
