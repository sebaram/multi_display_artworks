import { sampleSmplMotion, type SmplMotionClip } from './smpl';
import type { AvatarPreset, Transform } from './types';

/** One controller per room owner; staging previews never touch it. Times are monotonic milliseconds. */
export class SmplPlayback {
  private clip?: SmplMotionClip;
  private started = 0;
  private elapsed = 0;
  private owner = '';
  private playing = false;
  get state() { return !this.clip ? 'stopped' : this.playing ? 'playing' : 'paused'; }
  apply(clip: SmplMotionClip, now: number) { this.clip = clip; this.elapsed = 0; this.started = now; this.playing = true; }
  play(now: number) { if (this.clip && !this.playing) { this.started = now; this.playing = true; } }
  pause(now: number) { if (this.playing) { this.elapsed += Math.max(0, now - this.started); this.playing = false; } }
  stop() { this.clip = undefined; this.elapsed = 0; this.playing = false; }
  resetOwner(owner: string) { if (owner !== this.owner) { this.stop(); this.owner = owner; } }
  enterXR() { this.stop(); }
  dispose() { this.stop(); }
  sample(preset: AvatarPreset, anchor: Transform, now: number) {
    if (preset.kind !== 'humanoid') this.stop();
    return this.clip ? sampleSmplMotion(this.clip, preset, (this.elapsed + (this.playing ? Math.max(0, now - this.started) : 0)) / 1000, anchor, now) : null;
  }
}
