import { AntAudio } from '../ant/audio.js';
import { renderDivineSound } from './divine-sound.js';
import { SpatialDialogue } from './spatial-dialogue.js';

export class GodAudio extends AntAudio {
  constructor(){super();this.speech=new SpatialDialogue(this.ctx,this.voice,this.master,this.positioner);this.effects=new Set();this.divineVoices=new Set();this.cueHistory=[];this.lastCue=new Map();this.windGain=this.ctx.createGain();this.windGain.gain.value=0;this.windGain.connect(this.sfx);
    this.wind=this.ctx.createBufferSource();this.wind.buffer=this.brownBuf;this.wind.loop=true;this.wind.connect(this.windGain);this.wind.start();}
  playBuffer(buffer,bus=this.voice,gain=1){
    const source=super.playBuffer(buffer,bus,gain);
    if(bus===this.voice&&buffer===this.dialogue?.buffer){
      this.dialogueSource=source;this.speech.schedule(this.dialogue.line,source.startTime);
      source.onended=()=>{source.disconnect();source.gainNode.disconnect();if(this.dialogueSource===source){this.dialogueSource=null;this.speech.reset();}};
    }
    return source;
  }
  stopSource(source){super.stopSource(source);if(source&&source===this.dialogueSource){this.dialogueSource=null;this.speech.reset();}}
  spatial(camera,fisherman,driver){super.spatial(camera);this.speech.position('fisherman',fisherman);this.speech.position('driver',driver);}
  prepareDivine(){return this.preparing||(this.preparing=Promise.all([renderDivineSound(2.5),renderDivineSound(1.15),renderDivineSound(.42)]).then(([arrival,power,short])=>{this.divineBuffers={arrival,power,short};}));}
  divine(kind){
    if(this.ctx.state==='closed'||!this.divineBuffers)return false;
    const c=this.ctx,t=c.currentTime;if(t-(this.lastCue.get(kind)??-100)<.2)return false;this.lastCue.set(kind,t);
    // The limit covers choir tails as well as attacks. Dragging never retriggers
    // a cue per frame, and repeated taps cannot build an unlimited audio graph.
    while(this.divineVoices.size>=3){const old=this.divineVoices.values().next().value;old.stop();this.divineVoices.delete(old);this.effects.delete(old);}
    const src=c.createBufferSource(),gain=c.createGain(),short=kind==='grasp'||kind==='land';src.buffer=this.divineBuffers[kind==='arrival'?'arrival':short?'short':'power'];
    src.playbackRate.value=({grow:.94,drain:1.04,storm:.88,'fish-rain':1.14})[kind]||1;
    gain.gain.value=short?.5:kind==='arrival'?.92:.78;src.connect(gain).connect(this.sfx);src.godCue=kind;
    this.effects.add(src);this.divineVoices.add(src);this.cueHistory.push({kind,time:t});if(this.cueHistory.length>32)this.cueHistory.shift();
    src.onended=()=>{this.effects.delete(src);this.divineVoices.delete(src);src.disconnect();gain.disconnect();};src.start();return true;
  }
  effect(kind){
    if(this.ctx.state==='closed')return;
    if(['drain','lift','land','grow'].includes(kind))this.divine(kind);
    const settings={drain:[3.5,170,.65],lift:[.65,640,.17],land:[.32,130,.55],grow:[1.6,420,.26],thunder:[2.5,95,1.5],splash:[.3,1500,.12],fish:[.13,220,.14],push:[1.15,180,.24],munch:[.48,1800,.2]};
    const [duration,hz,volume]=settings[kind]||settings.fish,c=this.ctx,t=c.currentTime;
    const src=c.createBufferSource();src.buffer=kind==='splash'||kind==='munch'?this.noiseBuf:this.brownBuf;src.loop=duration>2;
    const filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.setValueAtTime(hz,t);filter.frequency.exponentialRampToValueAtTime(Math.max(40,hz*.3),t+duration);
    const gain=c.createGain();gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(volume,t+.035);gain.gain.exponentialRampToValueAtTime(.001,t+duration);
    src.connect(filter).connect(gain).connect(this.sfx);this.effects.add(src);
    src.onended=()=>{this.effects.delete(src);src.disconnect();filter.disconnect();gain.disconnect();};src.start(t);src.stop(t+duration+.02);
  }
  setWind(value){if(this.ctx.state!=='closed')this.windGain.gain.setTargetAtTime(value*.55,this.ctx.currentTime,.1);}
  resetEffects(){for(const src of this.effects){try{src.stop();}catch{}}this.effects.clear();this.divineVoices.clear();this.lastCue.clear();this.setWind(0);this.flushSfx();}
  destroy(){this.started=false;this.resetEffects();try{this.wind.stop();}catch{}this.ctx.close().catch(()=>{});}
}
