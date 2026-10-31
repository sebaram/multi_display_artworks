// External YouTube iframe API contract fixture; application HTTP/Socket.IO stay real.
window.__youtubePlayers = [];
window.YT = { Player: class {
  constructor(holder, options) {
    this.options = options; this.position = 0; this.state = 2; this.rate = 1; this.sampled = performance.now(); this.destroyed = false;
    this.frame = document.createElement('iframe'); this.frame.title = 'External YouTube API fixture'; this.frame.srcdoc = '<p>External player fixture</p>'; holder.replaceWith(this.frame);
    window.__youtubePlayers.push(this);
    setTimeout(() => options.events.onReady({ target: this }), 0);
  }
  getCurrentTime() { return this.position + (this.state === 1 ? (performance.now() - this.sampled) / 1000 * this.rate : 0); }
  getDuration() { return 120; }
  getPlayerState() { return this.state; }
  getPlaybackRate() { return this.rate; }
  seekTo(value) { this.position = value; this.sampled = performance.now(); }
  playVideo() { this.position = this.getCurrentTime(); this.sampled = performance.now(); this.state = 1; }
  pauseVideo() { this.position = this.getCurrentTime(); this.state = 2; }
  setPlaybackRate(value) { this.position = this.getCurrentTime(); this.sampled = performance.now(); this.rate = value; }
  mute() {} unMute() {}
  destroy() { this.destroyed = true; this.frame.remove(); }
} };
window.onYouTubeIframeAPIReady();
