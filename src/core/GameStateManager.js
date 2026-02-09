export const GameState = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
};

export class GameStateManager {
  constructor() {
    this.state = GameState.MENU;
    this.score = 0;
    this.wave = 0;
    this.enemiesPerWave = 2;
    this.waveTimer = 0;
    this.waveDelay = 5; // seconds between waves
    this.waveAnnounceTimer = 0;
    this.enemiesAlive = 0;
    this.totalKills = 0;

    // UI elements
    this.menuScreen = document.getElementById('menu-screen');
    this.pauseScreen = document.getElementById('pause-screen');
    this.gameoverScreen = document.getElementById('gameover-screen');
    this.hud = document.getElementById('hud');
    this.waveDisplay = document.getElementById('wave-display');
    this.waveText = document.getElementById('wave-text');
    this.scoreValue = document.getElementById('score-value');
    this.gameoverTitle = document.getElementById('gameover-title');
    this.gameoverScore = document.getElementById('gameover-score');

    this.onStartCallback = null;
    this.onRestartCallback = null;
    this.onSpawnWaveCallback = null;

    this.setupUI();
  }

  setupUI() {
    document.getElementById('start-btn').addEventListener('click', () => {
      this.startGame();
    });

    document.getElementById('resume-btn').addEventListener('click', () => {
      this.resume();
    });

    document.getElementById('restart-btn').addEventListener('click', () => {
      this.restart();
    });
  }

  startGame() {
    this.state = GameState.PLAYING;
    this.score = 0;
    this.wave = 0;
    this.totalKills = 0;
    this.waveTimer = 2; // small delay before first wave

    this.menuScreen.classList.add('hidden');
    this.pauseScreen.classList.add('hidden');
    this.gameoverScreen.classList.add('hidden');
    this.hud.classList.remove('hidden');

    if (this.onStartCallback) this.onStartCallback();
  }

  pause() {
    if (this.state !== GameState.PLAYING) return;
    this.state = GameState.PAUSED;
    this.pauseScreen.classList.remove('hidden');
  }

  resume() {
    if (this.state !== GameState.PAUSED) return;
    this.state = GameState.PLAYING;
    this.pauseScreen.classList.add('hidden');
  }

  gameOver(victory = false) {
    this.state = GameState.GAMEOVER;
    this.gameoverTitle.textContent = victory ? 'MISSION COMPLETE' : 'MISSION FAILED';
    this.gameoverScore.textContent = `Score: ${this.score} | Kills: ${this.totalKills}`;
    this.gameoverScreen.classList.remove('hidden');
  }

  restart() {
    this.gameoverScreen.classList.add('hidden');
    this.startGame();
    if (this.onRestartCallback) this.onRestartCallback();
  }

  addScore(points) {
    this.score += points;
    this.scoreValue.textContent = this.score;
  }

  enemyKilled() {
    this.totalKills++;
    this.enemiesAlive--;
    this.addScore(100);
  }

  update(dt) {
    if (this.state !== GameState.PLAYING) return;

    // Update score display
    this.scoreValue.textContent = this.score;

    // Wave announcement timer
    if (this.waveAnnounceTimer > 0) {
      this.waveAnnounceTimer -= dt;
      if (this.waveAnnounceTimer <= 0) {
        this.waveDisplay.classList.add('hidden');
      }
    }

    // Check if we need to spawn next wave
    if (this.enemiesAlive <= 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.spawnWave();
      }
    }
  }

  spawnWave() {
    this.wave++;
    this.enemiesPerWave = Math.min(2 + this.wave, 8);
    this.enemiesAlive = this.enemiesPerWave;
    this.waveTimer = this.waveDelay;

    // Show wave announcement
    this.waveText.textContent = `WAVE ${this.wave}`;
    this.waveDisplay.classList.remove('hidden');
    this.waveAnnounceTimer = 3;

    if (this.onSpawnWaveCallback) {
      this.onSpawnWaveCallback(this.wave, this.enemiesPerWave);
    }
  }

  togglePause() {
    if (this.state === GameState.PLAYING) {
      this.pause();
    } else if (this.state === GameState.PAUSED) {
      this.resume();
    }
  }
}
