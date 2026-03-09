// UI Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const lcdTrackName = document.getElementById('lcd-track-name');
const lcdTrackContainer = document.querySelector('.lcd-track-container');
const loadStatus = document.getElementById('load-status');

function setTrackName(name) {
    lcdTrackName.textContent = name;
    
    // 무조건 스크롤되도록 marquee 클래스 항상 부여 (재생 중에만 애니메이션 트리거됨)
    lcdTrackName.classList.remove('marquee');
    lcdTrackName.classList.remove('playing');
    void lcdTrackName.offsetWidth; // force reflow
    lcdTrackName.classList.add('marquee');
}
const timeDisplay = document.getElementById('time-display');
const totalTimeSpan = document.getElementById('total-time');
const seekBar = document.getElementById('seek-bar');

const playBtn = document.getElementById('play-btn');
const stopBtn = document.getElementById('stop-btn');
const recordBtn = document.getElementById('record-btn');
const saveBtn = document.getElementById('save-btn');

const prevBtn = document.getElementById('prev-btn');
const pauseBtn = document.getElementById('pause-btn');
const nextBtn = document.getElementById('next-btn');

const windowHeader = document.getElementById('window-header');
const draggableWindow = document.getElementById('draggable-window');

const pitchUp = document.getElementById('pitch-up');
const pitchDown = document.getElementById('pitch-down');
const pitchValue = document.getElementById('pitch-value');

const tempoUp = document.getElementById('tempo-up');
const tempoDown = document.getElementById('tempo-down');
const tempoValue = document.getElementById('tempo-value');

const syncToggle = document.getElementById('sync-toggle');
const tapBtn = document.getElementById('tap-btn');
const tapBpmDisplay = document.getElementById('tap-bpm-display');
const bpmValue = document.getElementById('bpm-value');

const playlistContent = document.getElementById('playlist-content');
const plAddBtn = document.getElementById('pl-add-btn');
const plRemBtn = document.getElementById('pl-rem-btn');

const customAlert = document.getElementById('custom-alert');
const alertMessage = document.getElementById('alert-message');
const alertOkBtn = document.getElementById('alert-ok-btn');

function showCustomAlert(msg) {
    alertMessage.innerHTML = msg.replace(/\n/g, '<br>');
    customAlert.style.display = 'block';
}

alertOkBtn.addEventListener('click', () => {
    customAlert.style.display = 'none';
});

// State
let player = null;
let audioBuffer = null;
let destination = null;
let analyser = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let isSynced = false; 
let currentPitch = 0;
let currentTempo = 1.0;
let animationId = null;

let playbackOffset = 0;
let startTime = 0;
let isSeeking = false;
let currentFileSize = 0;
let isCancelled = false; // To track if export was cancelled

let originalBPM = 0;
let tapTimes = [];
let bpmCalculated = false;
let bpmWorker = null;

let playlist = [];
let currentPlaylistIndex = -1;
let selectedPlaylistIndex = -1;

// Initialize Audio Context
let isUnmuteInitialized = false;
async function initAudio() {
    if (Tone.context.state !== 'running') {
        await Tone.start();
    }

    // 모바일(iOS 등) 환경에서 무음 모드일 때 스피커로 소리가 나지 않는 문제 해결
    if (navigator.audioSession) {
        navigator.audioSession.type = 'playback';
    }
    if (window.unmute && Tone.context.rawContext && !isUnmuteInitialized) {
        unmute(Tone.context.rawContext, true, false);
        isUnmuteInitialized = true;
    }
}

// Event Listeners
dropZone.addEventListener('click', () => fileInput.click());
plAddBtn.addEventListener('click', () => fileInput.click());

prevBtn.addEventListener('click', () => {
    if (currentPlaylistIndex > 0) {
        loadPlaylistItem(currentPlaylistIndex - 1).then(() => {
            setTimeout(() => playBtn.click(), 50);
        });
    }
});

nextBtn.addEventListener('click', () => {
    if (currentPlaylistIndex < playlist.length - 1) {
        loadPlaylistItem(currentPlaylistIndex + 1).then(() => {
            setTimeout(() => playBtn.click(), 50);
        });
    }
});

plRemBtn.addEventListener('click', () => {
    if (currentPlaylistIndex !== -1 && playlist.length > 0) {
        playlist.splice(currentPlaylistIndex, 1);
        if (playlist.length === 0) {
            currentPlaylistIndex = -1;
            renderPlaylist();
            setTrackName('NO FILE LOADED');
            loadStatus.textContent = 'READY';
            loadStatus.classList.remove('loaded');
            if (player) {
                player.stop();
                player.dispose();
                player = null;
            }
            disableControls();
            resetPlaybackUI();
            audioBuffer = null;
        } else {
            currentPlaylistIndex = Math.min(currentPlaylistIndex, playlist.length - 1);
            loadPlaylistItem(currentPlaylistIndex);
        }
    }
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        for (let i = 0; i < e.target.files.length; i++) {
            handleFile(e.target.files[i]);
        }
    }
    fileInput.value = ''; // reset
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
            handleFile(e.dataTransfer.files[i]);
        }
    }
});

const playlistContainer = document.querySelector('.winamp-playlist');
playlistContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    playlistContainer.style.opacity = '0.7';
});
playlistContainer.addEventListener('dragleave', () => playlistContainer.style.opacity = '1');
playlistContainer.addEventListener('drop', (e) => {
    e.preventDefault();
    playlistContainer.style.opacity = '1';
    if (e.dataTransfer.files.length > 0) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
            handleFile(e.dataTransfer.files[i]);
        }
    }
});

function handleFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.m4a') || name.endsWith('.mp4')) {
        showCustomAlert('M4A 파일은 브라우저 호환성 문제로 완벽히 지원하지 않습니다.<br><br><span style="color: white;">지원 포맷: MP3, WAV, FLAC, OGG, AAC</span>');
        return;
    }

    const isAudioType = file.type.startsWith('audio/');
    const isAllowedExt = name.match(/\.(aac|wav|mp3|ogg|flac)$/);
    
    if (!isAudioType && !isAllowedExt) {
        showCustomAlert('지원하지 않는 파일 형식입니다.<br><br><span style="color: white;">지원 포맷: MP3, WAV, FLAC, OGG, AAC</span>');
        return;
    }
    playlist.push(file);
    renderPlaylist();
    if (currentPlaylistIndex === -1 || playlist.length === 1) {
        loadPlaylistItem(0);
    }
}

function renderPlaylist() {
    playlistContent.innerHTML = '';
    playlist.forEach((f, index) => {
        const div = document.createElement('div');
        div.className = 'pl-item';
        
        const isPlaying = player && player.state === 'started';
        if (index === currentPlaylistIndex && isPlaying) div.classList.add('playing');
        if (index === selectedPlaylistIndex) div.classList.add('selected');
        
        div.textContent = `${index + 1}. ${f.name}`;
        div.title = f.name;
        
        div.onclick = () => {
             selectedPlaylistIndex = index;
             renderPlaylist();
        };

        div.ondblclick = () => {
             selectedPlaylistIndex = index;
             if (currentPlaylistIndex !== index) {
                 loadPlaylistItem(index).then(() => {
                     setTimeout(() => { if(!playBtn.disabled) playBtn.click() }, 50);
                 });
             } else {
                 if (player) {
                     if (player.state === 'started') {
                         stopBtn.click();
                     }
                     setTimeout(() => { if(!playBtn.disabled) playBtn.click() }, 50);
                 }
             }
        };
        playlistContent.appendChild(div);
    });
}

async function loadPlaylistItem(index) {
    if (index < 0 || index >= playlist.length) return;
    
    // Stop current playback
    if (player && player.state === 'started') {
        player.stop();
        cancelAnimationFrame(animationId);
    }

    currentPlaylistIndex = index;
    renderPlaylist();
    const file = playlist[index];

    currentFileSize = file.size;
    setTrackName('LOADING...');
    loadStatus.textContent = 'READY';
    loadStatus.classList.add('loaded'); // Make READY green/visible
    loadStatus.classList.remove('playing-status');
    disableControls();

    try {
        await initAudio();
        
        // Reset Pitch and Tempo for new song
        currentPitch = 0;
        currentTempo = 1.0;
        applyPitchAndTempo();
        
        const arrayBuffer = await file.arrayBuffer();
        const nativeBuffer = await Tone.context.decodeAudioData(arrayBuffer);
        audioBuffer = new Tone.ToneAudioBuffer(nativeBuffer);
        
        setupPlayer();
        displayAudioInfo();
        
        bpmCalculated = false;
        originalBPM = 0;
        updateBPMDisplay();
        tapBpmDisplay.textContent = '--';
        
        setTrackName(file.name.toUpperCase());
        loadStatus.textContent = 'READY';
        loadStatus.classList.add('loaded');
        enableControls();
        resetPlaybackUI();
        
        // Auto-play the next song if it was triggered automatically (maybe later)
    } catch (error) {
        console.error('Error loading audio:', error);
        setTrackName('ERROR: UNSUPPORTED FORMAT');
        loadStatus.textContent = 'ERROR';
        showCustomAlert(file.name + ' 파일을 브라우저 화면에서 읽을 수 없습니다.<br><br>손상된 파일이거나 지원되지 않는 코덱입니다.<br><span style="color: white;">지원 포맷: MP3, WAV, FLAC, OGG, AAC</span><br>플레이리스트에서 자동 제외됩니다.');
        
        // Remove the failed file & jump to next or reset
        playlist.splice(index, 1);
        if (playlist.length === 0) {
            currentPlaylistIndex = -1;
            renderPlaylist();
            setTrackName('NO FILE LOADED');
            loadStatus.textContent = 'READY';
        } else {
            currentPlaylistIndex = Math.min(index, playlist.length - 1);
            loadPlaylistItem(currentPlaylistIndex);
        }
    }
}

function displayAudioInfo() {
    if (!audioBuffer) return;
    
    // Sample Rate
    const sr = audioBuffer.sampleRate;
    document.querySelector('.sample-rate').textContent = `${(sr / 1000).toFixed(1)} kHz`;
    
    // Bitrate
    const duration = audioBuffer.duration;
    const bitrate = Math.round((currentFileSize * 8) / duration / 1000);
    document.querySelector('.bitrate').textContent = `${bitrate} kbps`;
}

function setupPlayer() {
    if (player) {
        player.stop();
        player.dispose();
    }
    
    if (analyser) {
        analyser.dispose();
    }

    analyser = new Tone.Analyser("fft", 64);
    
    if (isSynced) {
        player = new Tone.Player({
            url: audioBuffer,
            loop: false,
            playbackRate: currentTempo
        }).connect(analyser).toDestination();
    } else {
        player = new Tone.GrainPlayer({
            url: audioBuffer,
            loop: false,
            overlap: 0.1,
            grainSize: 0.2,
            detune: currentPitch * 100,
            playbackRate: currentTempo
        }).connect(analyser).toDestination();
    }

    destination = Tone.context.createMediaStreamDestination();
    player.connect(destination);

    player.onstop = () => {
        // onstop은 순수 UI 정리만 담당. 자동 다음 곡 진행은 autoAdvance()가 처리.
        if (!isRecording && !isSeeking) {
            updateStatusUI(false);
            cancelAnimationFrame(animationId);
        }
    };

    applyPitchAndTempo();
}

function applyPitchAndTempo() {
    if (!player) return;
    
    if (isSynced) {
        currentTempo = Math.pow(2, currentPitch / 12);
        player.playbackRate = currentTempo;
    } else {
        if (player.detune !== undefined) {
             player.detune = currentPitch * 100;
        }
        player.playbackRate = currentTempo;
    }
    
    pitchValue.textContent = `${currentPitch > 0 ? '+' : ''}${currentPitch}`;
    tempoValue.textContent = `${currentTempo.toFixed(2)}`;
    updateBPMDisplay();
}

function updateBPMDisplay() {
    if (!originalBPM) {
        bpmValue.textContent = '--';
        return;
    }
    const displayedBpm = Math.round(originalBPM * currentTempo);
    if (displayedBpm < 40 || displayedBpm > 250) {
        bpmValue.textContent = '--';
    } else {
        bpmValue.textContent = displayedBpm;
    }
}

function updatePitch(delta) {
    if (!player) return;
    // Snap to nearest integer if it was a float from direct input, then add delta
    currentPitch = Math.round(currentPitch) + delta;
    currentPitch = Math.max(-24, Math.min(24, currentPitch));
    
    if (player.state === 'started') {
        playbackOffset += (Tone.context.currentTime - startTime) * currentTempo;
        startTime = Tone.context.currentTime;
    }
    
    applyPitchAndTempo();
}

function updateTempo(delta) {
    if (!player) return;
    if (isSynced) return; 
    
    if (player.state === 'started') {
        playbackOffset += (Tone.context.currentTime - startTime) * currentTempo;
        startTime = Tone.context.currentTime;
    }
    
    // Snap to nearest 0.1 if it was a custom float from direct input, then add delta
    // Use toFixed to avoid floating point precision errors like 1.33 -> 1.2
    let snapped = Math.round(currentTempo * 10) / 10;
    currentTempo = parseFloat((snapped + delta).toFixed(2));
    currentTempo = Math.max(0.5, Math.min(2.0, currentTempo));
    applyPitchAndTempo();
}

// Control Listeners
pitchUp.addEventListener('click', () => updatePitch(1));
pitchDown.addEventListener('click', () => updatePitch(-1));
tempoUp.addEventListener('click', () => updateTempo(0.1));
tempoDown.addEventListener('click', () => updateTempo(-0.1));

syncToggle.addEventListener('click', () => {
    isSynced = !isSynced;
    syncToggle.classList.toggle('active', isSynced);
    
    const wasPlaying = player && player.state === 'started';
    if (wasPlaying) {
         playbackOffset += (Tone.context.currentTime - startTime) * currentTempo;
         player.stop();
    }
    
    setupPlayer();
    
    if (wasPlaying) {
         player.start(0, playbackOffset);
         startTime = Tone.context.currentTime;
         if (!animationId) startUpdateLoop();
    }
});

syncToggle.classList.toggle('active', isSynced);

pauseBtn.addEventListener('click', () => {
    if (player && player.state === 'started') {
        playbackOffset += (Tone.context.currentTime - startTime) * currentTempo;
        player.stop();
        updateStatusUI(false);
        cancelAnimationFrame(animationId);
    }
});

tapBtn.addEventListener('click', () => {
    const now = performance.now();
    tapTimes.push(now);
    if (tapTimes.length > 4) {
        tapTimes.shift();
    }
    if (tapTimes.length >= 2) {
        let totalInterval = 0;
        for (let i = 1; i < tapTimes.length; i++) {
            totalInterval += (tapTimes[i] - tapTimes[i - 1]);
        }
        const avgInterval = totalInterval / (tapTimes.length - 1);
        let bpm = Math.round(60000 / avgInterval);
        
        if (bpm >= 40 && bpm <= 250) {
             tapBpmDisplay.textContent = bpm;
        }
    }
});

// If more than 2 seconds since last tap, reset the tap buffer to avoid wild averages
setInterval(() => {
    if (tapTimes.length > 0 && (performance.now() - tapTimes[tapTimes.length - 1]) > 2000) {
        tapTimes = [];
    }
}, 1000);

function detectBPMBackground(buffer) {
    if (bpmWorker) {
        bpmWorker.terminate();
    }
    
    bpmValue.textContent = '...';
    
    const workerBlob = new Blob([`
        self.onmessage = function(e) {
            const rawData = e.data.channelData;
            const originalSampleRate = e.data.sampleRate;
            
            // 1. 다운샘플링 적용 (11,025Hz): 분석 데이터 양 축소
            const targetSampleRate = 11025;
            const ratio = originalSampleRate / targetSampleRate;
            const downsampledLength = Math.floor(rawData.length / ratio);
            let downsampled = new Float32Array(downsampledLength);
            
            for (let i = 0; i < downsampledLength; i++) {
                let start = Math.floor(i * ratio);
                let end = Math.floor((i + 1) * ratio);
                let sum = 0;
                let count = end - start;
                for (let j = start; j < end; j++) {
                    sum += rawData[j];
                }
                downsampled[i] = count > 0 ? sum / count : 0;
            }

            // 2. 에너지 기반 Onset 검출: 에너지가 급격히 변하는 지점 추출
            const windowSize = 256; 
            const hopSize = 32;     // 겹침 구간을 늘려 정밀한 1 BPM 단위 오차까지 계산 가능하게 함
            const envelopeLength = Math.floor((downsampled.length - windowSize) / hopSize);
            let energyEnvelope = new Float32Array(envelopeLength);
            
            for (let i = 0; i < envelopeLength; i++) {
                let energy = 0;
                let offset = i * hopSize;
                for (let j = 0; j < windowSize; j++) {
                    let sample = downsampled[offset + j];
                    energy += sample * sample; // 소리 진폭의 제곱 = 에너지
                }
                energyEnvelope[i] = energy;
            }
            
            // 에너지의 미분(차분)을 통해 타격(Onset) 순간 파악
            let onsets = new Float32Array(envelopeLength);
            for (let i = 1; i < envelopeLength; i++) {
                let diff = energyEnvelope[i] - energyEnvelope[i-1];
                onsets[i] = diff > 0 ? diff : 0; 
            }
            
            // 3. 자기 상관(Autocorrelation) 알고리즘: 소리 패턴이 겹치는 주기 검출
            const envSampleRate = targetSampleRate / hopSize; // 약 344.53 Hz
            const minBpm = 60;
            const maxBpm = 180;
            
            const minLag = Math.floor(envSampleRate * (60 / maxBpm));
            const maxLag = Math.floor(envSampleRate * (60 / minBpm));
            
            let autocorr = new Float32Array(maxLag + 1);
            
            for (let lag = minLag; lag <= maxLag; lag++) {
                let sum = 0;
                let count = onsets.length - lag;
                for (let i = 0; i < count; i++) {
                    sum += onsets[i] * onsets[i + lag];
                }
                autocorr[lag] = sum / count; // 뒤로 갈수록 겹치는 구간이 짧아지는 것 보정
            }
            
            let maxCorr = 0;
            let bestLag = 0;
            let sumCorr = 0;
            
            for (let lag = minLag; lag <= maxLag; lag++) {
                sumCorr += autocorr[lag];
                if (autocorr[lag] > maxCorr) {
                    maxCorr = autocorr[lag];
                    bestLag = lag;
                }
            }
            
            // 신뢰도 평가: 일반 백색소음이나 비정형 데이터에서는 피크가 약함
            let meanCorr = sumCorr / (maxLag - minLag + 1);
            if (maxCorr < meanCorr * 1.5) {
                self.postMessage({ bpm: 0 }); // 비트가 없거나 너무 불분명함
                return;
            }
            
            // Lag를 BPM으로 변환
            let detectedBPM = 0;
            if (bestLag > 0) {
                detectedBPM = 60 / (bestLag / envSampleRate);
                
                // DJ 표준 템포 범위(70~160)에 맞게 옥타브 보정
                if (detectedBPM < 70) detectedBPM *= 2;
                if (detectedBPM > 180) detectedBPM /= 2;
                
                detectedBPM = Math.round(detectedBPM);
            }
            
            // 4. 메인 스레드로 결과 반환 (UI 프리징 없음)
            self.postMessage({ bpm: detectedBPM });
        };
    `], { type: 'application/javascript' });

    bpmWorker = new Worker(URL.createObjectURL(workerBlob));
    
    bpmWorker.onmessage = function(e) {
        let bpm = e.data.bpm;
        originalBPM = bpm > 0 ? bpm : 0;
        updateBPMDisplay();
    };

    // Analyze a 60-second chunk of the audio for high accuracy. 
    // We skip the first 15 seconds (intro) if the song is long enough.
    const analyzeDuration = 60;
    const startOffset = buffer.duration > 120 ? 30 : (buffer.duration > 45 ? 15 : 0);
    const actualAnalyzeLength = Math.min(analyzeDuration, buffer.duration - startOffset);
    
    if (actualAnalyzeLength < 2) {
        originalBPM = 0;
        updateBPMDisplay();
        return;
    }
    
    const startSample = Math.floor(startOffset * buffer.sampleRate);
    const lengthSamples = Math.floor(actualAnalyzeLength * buffer.sampleRate);
    
    // Pass copied buffer slice to the worker to completely free UI thread
    const channelData = buffer.getChannelData(0).slice(startSample, startSample + lengthSamples);
    
    bpmWorker.postMessage({ 
        channelData: channelData,
        sampleRate: buffer.sampleRate
    });
}

playBtn.addEventListener('click', async () => {
    await initAudio();
    if (!player) return;

    if (player.state !== 'started') {
        if (playbackOffset >= (audioBuffer ? audioBuffer.duration : 0)) playbackOffset = 0;
        
        if (!bpmCalculated && audioBuffer) {
            detectBPMBackground(audioBuffer);
            bpmCalculated = true;
        }
        
        try {
            player.start(0, playbackOffset);
            startTime = Tone.context.currentTime;
            updateStatusUI(true);
            startUpdateLoop();
        } catch(e) {
            console.error("Playback Error:", e);
            setTrackName("FORMAT ERROR");
        }
    }
});

stopBtn.addEventListener('click', () => {
    if (player) {
        player.stop();
        playbackOffset = 0;
        updateStatusUI(false);
        cancelAnimationFrame(animationId);
        resetPlaybackUI();
    }
});

/**
 * 곡이 자연스럽게 끝났을 때 호출.
 * 다음 곡이 있으면 자동 로드 후 재생, 없으면 마지막 곡으로 정지.
 */
function autoAdvance() {
    if (isRecording || isSeeking) return;

    cancelAnimationFrame(animationId);
    animationId = null;

    if (player) {
        player.stop();
    }

    playbackOffset = 0;
    updateStatusUI(false);
    resetPlaybackUI();

    if (currentPlaylistIndex < playlist.length - 1) {
        // 다음 곡이 있으면 자동 재생
        loadPlaylistItem(currentPlaylistIndex + 1).then(() => {
            // 로드 완료 후 짧은 딜레이를 두고 재생 (오디오 컨텍스트 안정화)
            setTimeout(() => {
                if (player && !playBtn.disabled) {
                    player.start(0, 0);
                    startTime = Tone.context.currentTime;
                    playbackOffset = 0;
                    updateStatusUI(true);
                    startUpdateLoop();
                }
            }, 100);
        });
    }
    // 마지막 곡이면 자연스럽게 정지 (UI는 이미 resetPlaybackUI로 처리됨)
}


const handleSeekStart = () => {
    isSeeking = true;
};

const handleSeekEnd = () => {
    if (isSeeking && player && audioBuffer) {
        const time = (seekBar.value / 100) * audioBuffer.duration;
        playbackOffset = time;
        
        if (player.state === 'started') {
            player.stop(); 
            player.start(0, playbackOffset);
            startTime = Tone.context.currentTime; 
            startUpdateLoop(); // unconditionally restart to prevent dead loop
        } else {
            updateTimeDisplay(playbackOffset);
        }
        isSeeking = false; 
    }
};

const handleSeekInput = () => {
    if (player && audioBuffer) {
        const time = (seekBar.value / 100) * audioBuffer.duration;
        updateTimeDisplay(time);
    }
};

seekBar.addEventListener('mousedown', handleSeekStart);
seekBar.addEventListener('touchstart', handleSeekStart, {passive: true});
document.addEventListener('mouseup', handleSeekEnd);
document.addEventListener('touchend', handleSeekEnd);
seekBar.addEventListener('input', handleSeekInput);

// Visualizer setup
function ensureVisualizerBars() {
    const container = document.querySelector('.viz-container');
    while (container.children.length < 32) {
        const bar = document.createElement('div');
        bar.className = 'viz-bar';
        container.appendChild(bar);
    }
}

function startUpdateLoop() {
    if (animationId) cancelAnimationFrame(animationId);
    
    ensureVisualizerBars();
    const bars = document.querySelectorAll('.viz-bar');

    function update() {
        if (player && player.state === 'started') {
            let currentSeconds = playbackOffset + (Tone.context.currentTime - startTime) * currentTempo;
            
            if (currentSeconds >= audioBuffer.duration) {
                autoAdvance();
                return;
            }

            if (!isSeeking) {
                 seekBar.value = (currentSeconds / audioBuffer.duration) * 100;
                 updateTimeDisplay(currentSeconds);
            }
            
            if (analyser) {
                const values = analyser.getValue();
                bars.forEach((bar, i) => {
                    if (i < values.length) {
                        const db = values[i];
                        const height = Math.max(2, (db + 100) * 1.5); 
                        bar.style.height = `${Math.min(100, height)}%`;
                    }
                });
            }
        }
        
        // Keep loop alive as long as player is active or we are seeking
        if (player && (player.state === 'started' || isSeeking)) {
            animationId = requestAnimationFrame(update);
        } else {
            animationId = null;
        }
    }
    animationId = requestAnimationFrame(update);
}

function updateTimeDisplay(seconds) {
    if (isNaN(seconds)) seconds = 0;
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    
    let totalMins = 0;
    let totalSecs = 0;
    if (audioBuffer && !isNaN(audioBuffer.duration)) {
        totalMins = Math.floor(audioBuffer.duration / 60);
        totalSecs = Math.floor(audioBuffer.duration % 60);
    }
    
    timeDisplay.innerHTML = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} <span id="total-time">/ ${totalMins.toString().padStart(2, '0')}:${totalSecs.toString().padStart(2, '0')}</span>`;
}

function resetPlaybackUI() {
    seekBar.value = 0;
    playbackOffset = 0;
    updateTimeDisplay(0);
    document.querySelectorAll('.viz-bar').forEach(bar => bar.style.height = '2px');
}

function updateStatusUI(isPlaying) {
    if (playBtn) playBtn.classList.toggle('playing', isPlaying);
    if (pauseBtn) pauseBtn.classList.toggle('active', !isPlaying && playbackOffset > 0);
    
    if (isPlaying) {
        lcdTrackName.classList.add('playing');
        loadStatus.textContent = 'PLAYING';
        loadStatus.classList.add('loaded', 'playing-status');
    } else {
        lcdTrackName.classList.remove('playing');
        if (playlist.length > 0 && audioBuffer) {
            if (playbackOffset > 0) {
                loadStatus.textContent = 'PAUSED';
            } else {
                loadStatus.textContent = 'READY';
            }
            loadStatus.classList.add('loaded');
            loadStatus.classList.remove('playing-status');
        } else {
            loadStatus.textContent = 'READY';
            loadStatus.classList.remove('loaded', 'playing-status');
        }
    }
    renderPlaylist();
}

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    const tagName = document.activeElement.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea') return;
    
    if (e.code === 'Space') {
        e.preventDefault();
        // 플레이어가 이미 실행 중이면 일시정지, 아니면 재생
        if (player && player.state === 'started') {
            pauseBtn.click();
        } else {
            playBtn.click();
        }
    } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        if (playlist.length > 0) {
            if (selectedPlaylistIndex > 0) {
                selectedPlaylistIndex--;
            } else {
                selectedPlaylistIndex = playlist.length - 1;
            }
            renderPlaylist();
            const items = document.querySelectorAll('.pl-item');
            if (items[selectedPlaylistIndex]) {
                items[selectedPlaylistIndex].scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }
        }
    } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        if (playlist.length > 0) {
            if (selectedPlaylistIndex < playlist.length - 1) {
                selectedPlaylistIndex++;
            } else {
                selectedPlaylistIndex = 0;
            }
            renderPlaylist();
            const items = document.querySelectorAll('.pl-item');
            if (items[selectedPlaylistIndex]) {
                items[selectedPlaylistIndex].scrollIntoView({ behavior: 'auto', block: 'nearest' });
            }
        }
    } else if (e.code === 'Enter') {
        e.preventDefault();
        if (selectedPlaylistIndex >= 0 && selectedPlaylistIndex < playlist.length) {
             if (currentPlaylistIndex !== selectedPlaylistIndex) {
                 loadPlaylistItem(selectedPlaylistIndex).then(() => {
                     setTimeout(() => { if(!playBtn.disabled) playBtn.click() }, 50);
                 });
             } else {
                 if (player) {
                     if (player.state === 'started') {
                         stopBtn.click();
                     }
                     setTimeout(() => { if(!playBtn.disabled) playBtn.click() }, 50);
                 } else {
                     setTimeout(() => { if(!playBtn.disabled) playBtn.click() }, 50);
                 }
             }
        }
    }
});

// Utility: Format Date for filenames
function getFormattedDateStamp() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

// Recording Logic
recordBtn.addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
});

async function startRecording() {
    await initAudio();
    if (!player) return;

    recordedChunks = [];
    let options = { mimeType: 'audio/webm;codecs=opus' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) options = {};

    mediaRecorder = new MediaRecorder(destination.stream, options);
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: 'audio/webm' });
        recordBtn.textContent = 'CONVERT...';
        recordBtn.disabled = true;
        saveBtn.disabled = true;

        try {
            isCancelled = false; // 레코딩 변환 시작 시점에 리셋
            const arrayBuffer = await blob.arrayBuffer();
            const webmAudioBuffer = await Tone.context.decodeAudioData(arrayBuffer);
            
            // Replaced missing synchronous call with async helper
            const result = await encodeAudioBufferToMp3(webmAudioBuffer, 'RECORD RECORDING');
            if (!result) throw new Error('Encoding cancelled or failed');

            const url = URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `muzikboi_recorded_${getFormattedDateStamp()}.${result.ext}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch(e) {
            console.error("Error converting webm to mp3", e);
            showCustomAlert("Error converting recorded audio to MP3.");
        }

        recordBtn.textContent = 'RECORD';
        recordBtn.classList.remove('recording');
        enableControls();
    };

    mediaRecorder.start();
    isRecording = true;
    recordBtn.textContent = 'STOP REC';
    recordBtn.classList.add('recording');

    if (player.state !== 'started') {
        player.start(0, playbackOffset);
        startTime = Tone.context.currentTime;
        updateStatusUI(true);
        startUpdateLoop();
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    isRecording = false;
    recordBtn.textContent = 'RECORD';
    recordBtn.classList.remove('recording');
    player.stop();
    updateStatusUI(false);
}

// ── MP3 Encoder (lamejs Web Worker) ─────────────────────────────────────────
// lamejs를 Blob Worker 내에서 실행하여 메인 스레드 비차단 MP3 인코딩.
// importScripts 방식이므로 CORS/COEP 헤더 불필요, 브라우저 환경에서 안정적으로 작동.
let currentWorker = null;

const mp3WorkerCode = `
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js');

    self.onmessage = function(e) {
        const { leftChannel, rightChannel, sampleRate, numChannels } = e.data;
        const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, 192);
        const mp3Data = [];
        const sampleBlockSize = 1152;

        const leftInt16  = new Int16Array(leftChannel.length);
        const rightInt16 = numChannels === 2 ? new Int16Array(rightChannel.length) : null;

        for (let i = 0; i < leftChannel.length; i++) {
            leftInt16[i] = Math.max(-32768, Math.min(32767, leftChannel[i] * 32767.5));
            if (rightInt16) rightInt16[i] = Math.max(-32768, Math.min(32767, rightChannel[i] * 32767.5));
        }

        for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
            const leftChunk  = leftInt16.subarray(i, i + sampleBlockSize);
            let mp3buf;
            if (numChannels === 2) {
                const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
                mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
            } else {
                mp3buf = mp3encoder.encodeBuffer(leftChunk);
            }
            if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
            if (i % (sampleBlockSize * 10) === 0) {
                self.postMessage({ type: 'progress', value: Math.round((i / leftInt16.length) * 100) });
            }
        }

        const flushBuf = mp3encoder.flush();
        if (flushBuf.length > 0) mp3Data.push(new Int8Array(flushBuf));

        const transferList = mp3Data.map(chunk => chunk.buffer);
        self.postMessage({ type: 'done', data: mp3Data }, transferList);
    };
`;

const mp3WorkerBlob = new Blob([mp3WorkerCode], { type: 'application/javascript' });

const processingOverlay = document.getElementById('processing-overlay');
const processingPctText = document.getElementById('processing-pct');
const progressBarFill   = document.getElementById('progress-bar-fill');
const cancelProcessBtn   = document.getElementById('cancel-process-btn');
const cancelProcessBtnUi = document.getElementById('cancel-process-btn-ui');

const cancelExport = () => {
    isCancelled = true;
    if (currentWorker) {
        currentWorker.terminate();
        currentWorker = null;
    }
    if (processingOverlay) processingOverlay.style.display = 'none';
    finishSaving();
};

if (cancelProcessBtn) cancelProcessBtn.onclick = cancelExport;
if (cancelProcessBtnUi) cancelProcessBtnUi.onclick = cancelExport;

/**
 * Float32 AudioBuffer → PCM WAV Uint8Array (즉각적, 항상 성공)
 * ToneAudioBuffer 및 native AudioBuffer 모두 지원. MP3 실패 시 폴백에 사용.
 */
function audioBufferToWavBytes(buffer) {
    const nativeBuf = (buffer && typeof buffer.get === 'function') ? buffer.get() : buffer;
    const numCh = nativeBuf.numberOfChannels;
    const sr    = nativeBuf.sampleRate;
    const len   = nativeBuf.length;
    const dataSize = len * numCh * 2;
    const ab = new ArrayBuffer(44 + dataSize);
    const v  = new DataView(ab);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

    str(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true);
    str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * numCh * 2, true); v.setUint16(32, numCh * 2, true);
    v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, dataSize, true);

    const chs = Array.from({ length: numCh }, (_, c) => nativeBuf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
        for (let c = 0; c < numCh; c++) {
            const s = Math.max(-1, Math.min(1, chs[c][i]));
            v.setInt16(off, s < 0 ? s * 32768 : s * 32767, true);
            off += 2;
        }
    }
    return new Uint8Array(ab);
}

/**
 * lamejs Worker 기반 MP3 인코딩.
 * 실패 시 WAV로 자동 폴백.
 * 반환: { blob: Blob, ext: 'mp3'|'wav' } 또는 null (취소)
 */
async function encodeAudioBufferToMp3(audioBuffer, taskName = 'AUDIO') {
    // isCancelled는 여기서 리셋하지 않음 — 호출부(saveBtn, recordBtn)에서 관리

    if (processingOverlay) {
        processingOverlay.style.display = 'flex';
        if (progressBarFill) progressBarFill.style.width = '0%';
        if (processingPctText) processingPctText.textContent = '0%';
        const label = document.querySelector('.processing-text');
        if (label) label.textContent = `ENCODING ${taskName}...`;
    }

    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
    if (isCancelled) return null;

    return new Promise((resolve) => {
        try {
            // ToneAudioBuffer → 네이티브 AudioBuffer 언랩
            const nativeBuf = (audioBuffer && typeof audioBuffer.get === 'function')
                ? audioBuffer.get() : audioBuffer;

            // Transferable로 zero-copy 전송
            const numChannels = nativeBuf.numberOfChannels;
            const leftBuffer  = nativeBuf.getChannelData(0).slice().buffer;
            const rightBuffer = numChannels === 2 ? nativeBuf.getChannelData(1).slice().buffer : null;

            const workerUrl = URL.createObjectURL(mp3WorkerBlob);
            currentWorker = new Worker(workerUrl);
            URL.revokeObjectURL(workerUrl);

            const transferList = [leftBuffer];
            if (rightBuffer) transferList.push(rightBuffer);

            currentWorker.postMessage({
                leftChannel:  new Float32Array(leftBuffer),
                rightChannel: rightBuffer ? new Float32Array(rightBuffer) : null,
                sampleRate:   nativeBuf.sampleRate,
                numChannels
            }, transferList);

            currentWorker.onmessage = (e) => {
                if (isCancelled) return;
                if (e.data.type === 'progress') {
                    if (processingPctText) processingPctText.textContent = e.data.value + '%';
                    if (progressBarFill) progressBarFill.style.width = e.data.value + '%';
                } else if (e.data.type === 'done') {
                    const mp3Blob = new Blob(e.data.data, { type: 'audio/mp3' });
                    if (processingOverlay) processingOverlay.style.display = 'none';
                    currentWorker.terminate();
                    currentWorker = null;
                    resolve({ blob: mp3Blob, ext: 'mp3' });
                }
            };

            currentWorker.onerror = (err) => {
                console.warn('[Encoder] lamejs Worker failed, falling back to WAV:', err);
                currentWorker?.terminate();
                currentWorker = null;
                if (processingOverlay) processingOverlay.style.display = 'none';
                if (isCancelled) { resolve(null); return; }
                // WAV 폴백
                const wavBytes = audioBufferToWavBytes(audioBuffer);
                resolve({ blob: new Blob([wavBytes], { type: 'audio/wav' }), ext: 'wav' });
            };
        } catch (err) {
            console.warn('[Encoder] Setup failed, falling back to WAV:', err);
            if (processingOverlay) processingOverlay.style.display = 'none';
            if (isCancelled) { resolve(null); return; }
            const wavBytes = audioBufferToWavBytes(audioBuffer);
            resolve({ blob: new Blob([wavBytes], { type: 'audio/wav' }), ext: 'wav' });
        }
    });
}


// Save Full Logic
saveBtn.addEventListener('click', async () => {
    if (!audioBuffer) return;

    isCancelled = false; // 저장 시작 시점에만 리셋 (인코딩 함수 내부에서 리셋하면 취소가 무력화됨)

    // 재생 중이면 현재 위치 저장 후 일시정지
    if (player && player.state === 'started') {
        playbackOffset += (Tone.context.currentTime - startTime) * currentTempo;
        player.stop();
        updateStatusUI(false);
        cancelAnimationFrame(animationId);
    }

    saveBtn.textContent = 'RENDERING...';
    saveBtn.classList.add('processing');
    disableControls();
    
    // Show the processing overlay during Tone.Offline since it BLOCKS the event loop 
    // effectively making it feel like a browser freeeze.
    if (processingOverlay) {
        processingOverlay.style.display = 'flex';
        processingPctText.textContent = '...';
        if (progressBarFill) progressBarFill.style.width = '0%';
        document.querySelector('.processing-text').textContent = 'RENDERING AUDIO GRAPH...';
    }

    // Yield to UI thread so overlay can show before heavy Offline render starts
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

    try {
        const finalDuration = audioBuffer.duration / currentTempo;
        const renderedBuffer = await Tone.Offline(async () => {
            let tempPlayer;
            if (isSynced) {
                 tempPlayer = new Tone.Player({
                     url: audioBuffer,
                     loop: false,
                     playbackRate: currentTempo
                 }).toDestination();
            } else {
                 tempPlayer = new Tone.GrainPlayer({
                     url: audioBuffer,
                     loop: false,
                     overlap: 0.1,
                     grainSize: 0.2,
                     detune: currentPitch * 100,
                     playbackRate: currentTempo
                 }).toDestination();
            }
            tempPlayer.start(0);
        }, finalDuration);

        // Tone.Offline 완료 직후 취소 여부 재확인 (렌더링 중 취소된 경우)
        if (isCancelled) { finishSaving(); return; }

        // UI Feedback: Rendering done, moving to encoding
        document.querySelector('.processing-text').textContent = 'ENCODING TO MP3...';
        
        // Pass the rendered Buffer to our async helper
        const result = await encodeAudioBufferToMp3(renderedBuffer, 'FULL TRACK');
        if (!result || isCancelled) { finishSaving(); return; }

        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'muzikboi_full_' + getFormattedDateStamp() + '.' + result.ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        
        finishSaving();
    } catch(err) {
        console.error(err);
        showCustomAlert("Render failed.");
        finishSaving();
    } finally {
        if (processingOverlay) processingOverlay.style.display = 'none';
    }
});

function finishSaving() {
    saveBtn.textContent = 'SAVE FULL';
    saveBtn.classList.remove('processing');
    enableControls();
}

function enableControls() {
    playBtn.disabled = false;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    pitchUp.disabled = false;
    pitchDown.disabled = false;
    tempoUp.disabled = false;
    tempoDown.disabled = false;
    recordBtn.disabled = false;
    saveBtn.disabled = false;
    seekBar.disabled = false;
}

function disableControls() {
    playBtn.disabled = true;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    pitchUp.disabled = true;
    pitchDown.disabled = true;
    tempoUp.disabled = true;
    tempoDown.disabled = true;
    recordBtn.disabled = true;
    saveBtn.disabled = true;
    seekBar.disabled = true;
}

// Draggable Window Logic
let isDragging = false;
let offsetX = 0, offsetY = 0;

windowHeader.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - draggableWindow.getBoundingClientRect().left;
    offsetY = e.clientY - draggableWindow.getBoundingClientRect().top;
    
    if (getComputedStyle(draggableWindow).position !== 'absolute') {
        draggableWindow.style.position = 'absolute';
        draggableWindow.style.left = `${draggableWindow.getBoundingClientRect().left}px`;
        draggableWindow.style.top = `${draggableWindow.getBoundingClientRect().top}px`;
    }
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    draggableWindow.style.left = `${e.clientX - offsetX}px`;
    draggableWindow.style.top = `${e.clientY - offsetY}px`;
});

document.addEventListener('mouseup', () => {
    isDragging = false;
});

// ── Sample Songs Auto-Loading ────────────────────────────────────────────────
async function loadSamples() {
    const sampleFiles = [
        { url: 'samples/sample01.mp3', name: 'SampleSong_01' },
        { url: 'samples/sample02.mp3', name: 'SampleSong_02' },
        { url: 'samples/sample03.mp3', name: 'SampleSong_03' },
        { url: 'samples/sample04.mp3', name: 'SampleSong_04' },
        { url: 'samples/sample05.mp3', name: 'SampleSong_05' }
    ];

    for (const s of sampleFiles) {
        try {
            const resp = await fetch(s.url);
            if (!resp.ok) continue;
            const blob = await resp.blob();
            const file = new File([blob], s.name + '.mp3', { type: 'audio/mpeg' });
            
            playlist.push(file);
            renderPlaylist();

            // 첫 번째 곡이 로드되면 화면에 Ready 상태로 표시
            if (playlist.length === 1) {
                loadPlaylistItem(0);
            }
        } catch (e) {
            console.error('Failed to load sample:', s.name, e);
        }
    }
}

// 초기화 시 실행
window.addEventListener('load', loadSamples);