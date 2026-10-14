// The original argument is one continuous recording. Route its verified speaker
// cues to two fixed world emitters, keeping its timing, pauses and full duration.
export class SpatialDialogue {
  constructor(ctx,input,output,driverPanner){
    this.ctx=ctx;this.speakers={};input.disconnect();driverPanner.disconnect();
    for(const who of ['driver','fisherman']){
      const gain=ctx.createGain(),panner=who==='driver'?driverPanner:ctx.createPanner();
      panner.panningModel='HRTF';panner.distanceModel='inverse';
      panner.refDistance=5;panner.rolloffFactor=.1;
      input.connect(gain).connect(panner).connect(output);this.speakers[who]={gain,panner};
    }
    this.reset();
  }
  reset(){
    const t=this.ctx.currentTime;
    for(const [who,{gain}] of Object.entries(this.speakers)){
      gain.gain.cancelScheduledValues(0);gain.gain.setValueAtTime(who==='driver'?1:0,t);
    }
  }
  schedule(line,start){
    this.reset();const cues=line.cues,windows=[];
    for(let i=0;i<cues.length;i++){
      const cue=cues[i];if(cue.speaker!=='fisherman')continue;
      // Put the short crossfades in the gaps, without cutting syllables or
      // moving the emitter itself across the scene between replies.
      const from=cue.t0-Math.min(.04,Math.max(0,cue.t0-(cues[i-1]?.t1??0))/2);
      const to=cue.t1+Math.min(.04,Math.max(0,(cues[i+1]?.t0??line.duration)-cue.t1)/2);
      const previous=windows.at(-1);
      if(previous&&from-previous[1]<.02)previous[1]=to;else windows.push([from,to]);
    }
    const driver=this.speakers.driver.gain.gain,fisher=this.speakers.fisherman.gain.gain;
    for(const [from,to] of windows){
      for(const [time,value] of [[from,1],[to,0]]){
        const t=Math.max(this.ctx.currentTime,start+time-.006);
        driver.setValueAtTime(value,t);driver.linearRampToValueAtTime(1-value,t+.012);
        fisher.setValueAtTime(1-value,t);fisher.linearRampToValueAtTime(value,t+.012);
      }
    }
  }
  position(who,point){
    const p=this.speakers[who].panner,t=this.ctx.currentTime;
    if(p.positionX)for(const axis of ['X','Y','Z'])p['position'+axis].setTargetAtTime(point[axis.toLowerCase()],t,.045);
    else p.setPosition(point.x,point.y,point.z);
  }
}
