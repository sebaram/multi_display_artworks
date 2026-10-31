type Input = { distance: number; visible: boolean; device: { mobile: boolean; xr: boolean }; quality: number };
type Detail = { meshLevel: 'full' | 'low' | 'hidden'; poseApplyHz: number; expressionHz: number };
const thresholds = (input: Input) => {
  const scale = (input.device.mobile || input.device.xr ? .8 : 1) * [1,.8,.6][Math.max(0,Math.min(2,Math.round(input.quality || 0)))];
  return [10 * scale, 25 * scale];
};
const detailAt = (tier: number, visible: boolean): Detail => !visible
  ? {meshLevel:'hidden',poseApplyHz:0,expressionHz:0}
  : {meshLevel:tier === 2 ? 'low':'full',poseApplyHz:[30,15,5][tier],expressionHz:[15,5,0][tier]};
export function avatarDetail(input: Input): Detail {
  const [near,far]=thresholds(input);
  return detailAt(input.distance < near ? 0 : input.distance < far ? 1 : 2,input.visible);
}
/** Per-observer display state only. Owner input/IK never passes through here. */
export function createAvatarDetailState() {
  let tier = -1, hidden = true, poseAt = -Infinity, expressionAt = -Infinity;
  return { update(input: Input, time: number) {
    const [near,far]=thresholds(input), previous=tier;
    if(tier < 0) tier=input.distance < near ? 0 : input.distance < far ? 1 : 2;
    else {
      if(tier===0 && input.distance > near*1.2) tier=1;
      if(tier===1 && input.distance < near*.8) tier=0;
      if(tier<2 && input.distance > far*1.2) tier=2;
      if(tier===2 && input.distance < far*.8) tier=input.distance < near*.8 ? 0 : 1;
    }
    const detail=detailAt(tier,input.visible), force=hidden || tier!==previous;
    const applyPose=input.visible && (force || time-poseAt >= 1000/detail.poseApplyHz);
    const expression=input.visible && detail.expressionHz>0 && (force || time-expressionAt >= 1000/detail.expressionHz);
    if(applyPose) poseAt=time;
    if(expression) expressionAt=time;
    hidden=!input.visible;
    return {detail,applyPose,expression};
  }};
}
