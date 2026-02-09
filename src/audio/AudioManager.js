import { AUDIO } from '../config.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.initialized = false;

    // Nodes
    this.masterGain = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.windNoise = null;
    this.windGain = null;
    this.windFilter = null;

    // Cooldowns for sound effects
    this.gunSoundTimer = 0;
    this.missileSoundTimer = 0;

    // Betty voice queue
    this.bettyQueue = [];
    this.bettyBusy = false;
    this.bettyCooldowns = {};
  }

  async init() {
    if (this.initialized) return;

    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);

      this.setupEngine();
      this.setupWind();

      this.initialized = true;
    } catch (e) {
      console.warn('Audio initialization failed:', e);
    }
  }

  setupEngine() {
    // Engine: layered oscillators
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = AUDIO.ENGINE_BASE_FREQ;

    // Sub-harmonic for rumble
    this.engineSubOsc = this.ctx.createOscillator();
    this.engineSubOsc.type = 'sine';
    this.engineSubOsc.frequency.value = AUDIO.ENGINE_BASE_FREQ / 2;

    // Filter for body
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineFilter.Q.value = 2;

    // Gain
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.15;

    this.engineSubGain = this.ctx.createGain();
    this.engineSubGain.gain.value = 0.1;

    // Connect
    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineSubOsc.connect(this.engineSubGain);
    this.engineSubGain.connect(this.masterGain);

    this.engineOsc.start();
    this.engineSubOsc.start();
  }

  setupWind() {
    // Wind: filtered white noise
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    this.windNoise = this.ctx.createBufferSource();
    this.windNoise.buffer = noiseBuffer;
    this.windNoise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 800;
    this.windFilter.Q.value = 0.5;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;

    this.windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    this.windNoise.start();
  }

  updateEngine(throttle, speed) {
    if (!this.initialized) return;

    const t = this.ctx.currentTime;

    // Engine pitch follows throttle
    const freq = AUDIO.ENGINE_BASE_FREQ + (AUDIO.ENGINE_MAX_FREQ - AUDIO.ENGINE_BASE_FREQ) * throttle;
    this.engineOsc.frequency.setTargetAtTime(freq, t, 0.1);
    this.engineSubOsc.frequency.setTargetAtTime(freq / 2, t, 0.1);

    // Engine volume
    const vol = 0.08 + throttle * 0.12;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.1);

    // Filter opens with throttle
    this.engineFilter.frequency.setTargetAtTime(300 + throttle * 600, t, 0.1);

    // Wind proportional to speed
    const windVol = Math.min(AUDIO.MAX_WIND_GAIN, speed * AUDIO.WIND_GAIN_FACTOR);
    this.windGain.gain.setTargetAtTime(windVol, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(400 + speed * 2, t, 0.1);
  }

  playGunSound() {
    if (!this.initialized) return;
    if (this.gunSoundTimer > 0) return;
    this.gunSoundTimer = 0.05;

    // Short burst of filtered noise
    const duration = 0.04;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 150 + Math.random() * 50;

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 1;

    osc.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  playMissileSound() {
    if (!this.initialized) return;
    if (this.missileSoundTimer > 0) return;
    this.missileSoundTimer = 1;

    const now = this.ctx.currentTime;
    const duration = 1.5;

    // Whoosh sound
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(2000, now + 0.3);
    osc.frequency.exponentialRampToValueAtTime(800, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 300;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  playExplosionSound(distance = 0) {
    if (!this.initialized) return;

    const now = this.ctx.currentTime;
    const duration = 1.5;
    const volume = Math.max(0.05, 0.4 - distance * 0.0001);

    // Create noise buffer for explosion
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, now);
    filter.frequency.exponentialRampToValueAtTime(100, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    source.start(now);
    source.stop(now + duration);
  }

  playFlareSound() {
    if (!this.initialized) return;

    const now = this.ctx.currentTime;
    const duration = 0.3;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2000, now);
    osc.frequency.exponentialRampToValueAtTime(500, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + duration);
  }

  // "Bitchin' Betty" voice warnings using SpeechSynthesis
  betty(message) {
    const now = Date.now();
    const cooldownKey = message;
    if (this.bettyCooldowns[cooldownKey] && now - this.bettyCooldowns[cooldownKey] < 3000) {
      return; // Don't repeat too often
    }
    this.bettyCooldowns[cooldownKey] = now;

    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 1.3;
      utterance.pitch = 1.2;
      utterance.volume = 0.6;

      // Try to find a female voice
      const voices = speechSynthesis.getVoices();
      const femaleVoice = voices.find(v =>
        v.name.toLowerCase().includes('female') ||
        v.name.toLowerCase().includes('samantha') ||
        v.name.toLowerCase().includes('victoria')
      );
      if (femaleVoice) {
        utterance.voice = femaleVoice;
      }

      speechSynthesis.speak(utterance);
    }
  }

  playLockTone(isLocked) {
    if (!this.initialized) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = isLocked ? 1500 : 800;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.setValueAtTime(0, now + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playSonicBoom() {
    if (!this.initialized) return;

    const now = this.ctx.currentTime;

    // Deep bass thump - the core of the boom
    const bassOsc = this.ctx.createOscillator();
    bassOsc.type = 'sine';
    bassOsc.frequency.setValueAtTime(60, now);
    bassOsc.frequency.exponentialRampToValueAtTime(20, now + 0.6);

    const bassGain = this.ctx.createGain();
    bassGain.gain.setValueAtTime(0.5, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    bassOsc.connect(bassGain);
    bassGain.connect(this.masterGain);
    bassOsc.start(now);
    bassOsc.stop(now + 0.8);

    // Sharp crack - the transient
    const crackDuration = 0.15;
    const crackSize = this.ctx.sampleRate * crackDuration;
    const crackBuffer = this.ctx.createBuffer(1, crackSize, this.ctx.sampleRate);
    const crackData = crackBuffer.getChannelData(0);
    for (let i = 0; i < crackSize; i++) {
      const t = i / crackSize;
      crackData[i] = (Math.random() * 2 - 1) * Math.exp(-t * 20);
    }

    const crackSource = this.ctx.createBufferSource();
    crackSource.buffer = crackBuffer;

    const crackFilter = this.ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.value = 400;
    crackFilter.Q.value = 0.5;

    const crackGain = this.ctx.createGain();
    crackGain.gain.setValueAtTime(0.6, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + crackDuration);

    crackSource.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(this.masterGain);
    crackSource.start(now);
    crackSource.stop(now + crackDuration);

    // Rumble tail
    const rumbleDuration = 1.5;
    const rumbleSize = this.ctx.sampleRate * rumbleDuration;
    const rumbleBuffer = this.ctx.createBuffer(1, rumbleSize, this.ctx.sampleRate);
    const rumbleData = rumbleBuffer.getChannelData(0);
    for (let i = 0; i < rumbleSize; i++) {
      rumbleData[i] = (Math.random() * 2 - 1);
    }

    const rumbleSource = this.ctx.createBufferSource();
    rumbleSource.buffer = rumbleBuffer;

    const rumbleFilter = this.ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.setValueAtTime(200, now);
    rumbleFilter.frequency.exponentialRampToValueAtTime(50, now + rumbleDuration);

    const rumbleGain = this.ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.25, now + 0.05);
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + rumbleDuration);

    rumbleSource.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(this.masterGain);
    rumbleSource.start(now);
    rumbleSource.stop(now + rumbleDuration);
  }

  update(dt) {
    this.gunSoundTimer = Math.max(0, this.gunSoundTimer - dt);
    this.missileSoundTimer = Math.max(0, this.missileSoundTimer - dt);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend();
    }
  }
}
