import { CLIP_ACTIONS } from '../driver/script.js';

// One original recording and one audio clock. Checkpoints never rewind this track.
export class AntConversation {
  constructor({audio,clips,ui,onAction}){Object.assign(this,{audio,clips,ui,onAction});this.epoch=0;this.reset();}
  reset(){
    this.epoch++;if(this.clip)this.audio.stopSource(this.clip.src);
    this.clip=null;this.state='idle';this.played={};this.actions=[];this.cueKey=null;this.ui.setSubtitle(null);this.audio.setDucked(false);
  }
  begin(delay=0){this.reset();this.delay=delay;this.state='opening';}
  get elapsed(){return this.clip?Math.max(0,this.audio.ctx.currentTime-this.clip.start):0;}
  get cue(){return this.clip?.line.cues.find(c=>this.elapsed>=c.t0&&this.elapsed<c.t1);}
  get speaker(){return this.state==='done'?null:this.cue?.speaker||(this.clip&&this.elapsed>20?'driver':null);}
  get speakerEnv(){
    if(!this.clip||this.state==='done')return 0;
    const i=this.elapsed*50,a=Math.floor(i),env=this.clip.line.env;
    return (env[a]||0)*(1-(i-a))+(env[a+1]||0)*(i-a);
  }
  update(dt){
    if(this.state==='opening'){
      this.delay-=dt;if(this.delay>0)return;
      const {line,buffer}=this.clips.ant_argument,src=this.audio.playBuffer(buffer,this.audio.voice,1);
      this.clip={id:'ant_argument',line,src,start:src.startTime};this.played.ant_argument=true;this.state='playing';this.audio.setDucked(true);
      this.actions=Object.entries(CLIP_ACTIONS).flatMap(([id,actions])=>actions.map(a=>[a[0]+({d_who:0,d_state:4,d_name:13.41})[id],...a.slice(1)])).sort((a,b)=>a[0]-b[0]);
    }
    if(this.state!=='playing')return;
    while(this.actions.length&&this.actions[0][0]<=this.elapsed){const [,who,action,arg,extra]=this.actions.shift();this.onAction(who,action,arg,extra);}
    const cue=this.cue,key=cue?cue.t0+cue.text:'';
    if(key!==this.cueKey){this.cueKey=key;this.ui.setSubtitle(cue?{who:cue.speaker,text:cue.text}:null);}
    if(this.elapsed>=this.clip.line.duration){this.state='done';this.ui.setSubtitle(null);this.audio.setDucked(false);}
  }
}
