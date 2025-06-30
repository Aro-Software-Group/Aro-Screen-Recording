const getElement = (id) => {
    const element = document.getElementById(id);
    if (!element) {
        console.warn(`Element with id '${id}' not found`);
    }
    return element;
};

const startBtn = getElement('startBtn');
const stopBtn = getElement('stopBtn');
const pauseBtn = getElement('pauseBtn');
const resumeBtn = getElement('resumeBtn');
const resolutionSel = getElement('resolution');
const fpsSel = getElement('fps');
const formatSel = getElement('format');
const preview = getElement('preview');
const status = getElement('status');
const downloadLink = getElement('downloadLink');
const downloadList = getElement('download-list');
const historyList = getElement('history-list');
const micCheckbox = getElement('mic');
const recordingTime = getElement('recording-time');
const recordingSize = getElement('recording-size');
const toggleDark = getElement('toggle-dark');
const audioWaveform = getElement('audio-waveform');

let mediaRecorder, recordedChunks = [], stream;
let ffmpegInstance = null;
let captureHistory = [];
let downloadHistory = [];

let timerInterval = null;
let startTimestamp = null;
let pausedAt = 0;
let totalPaused = 0;
let lastSize = 0;
let sizeAcc = 0; // 累積ファイルサイズ

let audioCtx, analyser, waveformSource, waveformAnimId;

class RecordingState {
    constructor() {
        this.reset();
    }

    reset() {
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.stream = null;
        this.timerInterval = null;
        this.startTimestamp = null;
        this.pausedAt = 0;
        this.totalPaused = 0;
        this.lastSize = 0;
        this.sizeAcc = 0;
        this.isRecording = false;
        this.isPaused = false;
        this.audioCtx = null;
        this.analyser = null;
        this.waveformSource = null;
        this.waveformAnimId = null;
    }

    cleanup() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        
        if (this.waveformAnimId) {
            cancelAnimationFrame(this.waveformAnimId);
            this.waveformAnimId = null;
        }
        
        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            this.audioCtx.close().catch(console.warn);
            this.audioCtx = null;
        }
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try {
                this.mediaRecorder.stop();
            } catch (e) {
                console.warn('Error stopping mediaRecorder:', e);
            }
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => {
                try {
                    track.stop();
                } catch (e) {
                    console.warn('Error stopping track:', e);
                }
            });
            this.stream = null;
        }
        
        if (preview) {
            preview.srcObject = null;
        }
    }
}

const appState = new RecordingState();

function updateProgress() {
    if (!appState.startTimestamp) return;
    
    let elapsed = Date.now() - appState.startTimestamp - appState.totalPaused;
    if (mediaRecorder && mediaRecorder.state === 'paused') {
        elapsed = pausedAt - appState.startTimestamp - appState.totalPaused;
    }
    
    const mins = String(Math.floor(elapsed / 60000)).padStart(2, '0');
    const secs = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    
    recordingTime.textContent = `${mins}:${secs}`;
    recordingSize.textContent = `${(sizeAcc / 1024 / 1024).toFixed(2)} MB`;
}

function startTimer() {
    appState.startTimestamp = Date.now();
    appState.totalPaused = 0;
    timerInterval = setInterval(updateProgress, 100); // More frequent updates for smoother display
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    updateProgress();
}

// ダークモード切替
function setDarkMode(on) {
    try {
        if (on) {
            document.body.classList.add('dark');
            localStorage.setItem('aro_dark', '1');
        } else {
            document.body.classList.remove('dark');
            localStorage.setItem('aro_dark', '0');
        }
    } catch (e) {
        console.warn('Error setting dark mode:', e);
    }
}

if (toggleDark) {
    toggleDark.onclick = () => {
        setDarkMode(!document.body.classList.contains('dark'));
    };
}

// Initialize dark mode from localStorage
try {
    if (localStorage.getItem('aro_dark') === '1') {
        setDarkMode(true);
    }
} catch (e) {
    console.warn('Error reading dark mode preference:', e);
}

// --- 大幅な安定化・バグ修正 ---
function resetState() {
    try {
        appState.cleanup();
        appState.reset();
        
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = true;
        if (resumeBtn) resumeBtn.disabled = true;
        
        safeSetStyle(downloadLink, 'display', 'none');
        safeSetTextContent(status, '');
        
        showPauseResume('reset');
        showWaveform(false);
        
        // Reset progress display
        safeSetTextContent(recordingTime, '00:00');
        safeSetTextContent(recordingSize, '0 MB');
        
    } catch (e) {
        console.error('Error resetting state:', e);
        safeSetTextContent(status, 'Error resetting application state');
    }
}

function showPauseResume(state) {
    if (!pauseBtn || !resumeBtn) return;
    
    try {
        switch (state) {
            case 'paused':
                safeSetStyle(pauseBtn, 'display', 'none');
                safeSetStyle(resumeBtn, 'display', '');
                break;
            case 'recording':
                safeSetStyle(pauseBtn, 'display', '');
                safeSetStyle(resumeBtn, 'display', 'none');
                break;
            default:
                safeSetStyle(pauseBtn, 'display', 'none');
                safeSetStyle(resumeBtn, 'display', 'none');
                break;
        }
    } catch (e) {
        console.warn('Error updating pause/resume buttons:', e);
    }
}

async function setupPreview() {
    if (!preview) return;
    
    try {
        if (!preview.srcObject) {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: true, 
                audio: false
            });
            preview.srcObject = displayStream;
            
            // Auto-cleanup when stream ends
            displayStream.getVideoTracks().forEach(track => {
                track.addEventListener('ended', () => {
                    if (preview) {
                        preview.srcObject = null;
                    }
                });
            });
        }
    } catch (e) {
        console.warn('Preview setup failed:', e);
        safeSetTextContent(status, t('status_preview_fail') + e.message);
    }
}

function showWaveform(show) {
    if (!audioWaveform) return;
    
    try {
        safeSetStyle(audioWaveform, 'display', show ? '' : 'none');
        
        if (!show && waveformAnimId) {
            cancelAnimationFrame(waveformAnimId);
            waveformAnimId = null;
        }
    } catch (e) {
        console.warn('Error toggling waveform display:', e);
    }
}

function drawWaveform() {
    if (!analyser || !audioWaveform) return;
    
    try {
        const ctx = audioWaveform.getContext('2d');
        const W = audioWaveform.width = audioWaveform.offsetWidth;
        const H = audioWaveform.height;
        
        ctx.clearRect(0, 0, W, H);
        
        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = document.body.classList.contains('dark') ? '#b6aaff' : '#5a4be7';
        ctx.beginPath();
        
        for (let i = 0; i < bufferLength; i++) {
            const x = i * W / bufferLength;
            const y = (dataArray[i] / 255.0) * H;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        waveformAnimId = requestAnimationFrame(drawWaveform);
    } catch (e) {
        console.warn('Error drawing waveform:', e);
        showWaveform(false);
    }
}

async function setupWaveform(stream) {
    try {
        if (appState.audioCtx && appState.audioCtx.state !== 'closed') {
            await appState.audioCtx.close();
        }
        
        appState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        appState.analyser = appState.audioCtx.createAnalyser();
        appState.analyser.fftSize = 512;
        appState.waveformSource = appState.audioCtx.createMediaStreamSource(stream);
        appState.waveformSource.connect(appState.analyser);
        
        drawWaveform();
    } catch (e) {
        console.warn('Error setting up waveform:', e);
        showWaveform(false);
    }
}

// Enhanced utility functions
function getNowStr() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function safeSetTextContent(element, text) {
    if (element) {
        element.textContent = text;
    }
}

function safeSetStyle(element, property, value) {
    if (element) {
        element.style[property] = value;
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    resetState();
    showPauseResume('reset');
    setupPreview();
});

// Enhanced recording start with better error handling and validation
if (startBtn) {
    startBtn.onclick = async () => {
        try {
            resetState();
            showPauseResume('recording');
            appState.sizeAcc = 0;
            showWaveform(false);
            
            // Validate inputs
            if (!resolutionSel || !fpsSel || !formatSel) {
                throw new Error('Required form elements not found');
            }
            
            const [w, h] = resolutionSel.value.split('x').map(Number);
            const fps = Number(fpsSel.value);
            const format = formatSel.value;
            const useMic = micCheckbox && micCheckbox.checked;
            
            safeSetTextContent(status, t('status_select_screen'));
            
            // Enhanced display media constraints
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    width: { ideal: w, max: w },
                    height: { ideal: h, max: h },
                    frameRate: { ideal: fps, max: fps },
                    resizeMode: 'crop-and-scale',
                    displaySurface: 'monitor'
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            // Enhanced stream management
            appState.stream = displayStream;
            
            displayStream.getVideoTracks().forEach(track => {
                track.addEventListener('ended', () => {
                    console.log('Display stream ended, stopping recording');
                    if (appState.mediaRecorder && appState.mediaRecorder.state === 'recording') {
                        stopBtn.click();
                    }
                });
            });
            
            let audioStream = null;
            if (useMic) {
                try {
                    audioStream = await navigator.mediaDevices.getUserMedia({ 
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }, 
                        video: false 
                    });
                } catch (micError) {
                    console.warn('Microphone access failed:', micError);
                    safeSetTextContent(status, 'Microphone access failed, continuing without mic audio');
                }
            }
            
            // Enhanced audio mixing
            const tracks = [...displayStream.getVideoTracks()];
            const audioTracks = [];
            
            if (displayStream.getAudioTracks().length > 0) {
                audioTracks.push(displayStream.getAudioTracks()[0]);
            }
            if (audioStream && audioStream.getAudioTracks().length > 0) {
                audioTracks.push(audioStream.getAudioTracks()[0]);
            }
            
            audioTracks.forEach(track => tracks.push(track));
            
            const mixedStream = new MediaStream(tracks);
            
            if (preview) {
                preview.srcObject = mixedStream;
            }
            
            appState.recordedChunks = [];
            
            // Enhanced MIME type selection
            const mimeTypes = [
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp8,opus', 
                'video/webm;codecs=h264,opus',
                'video/webm'
            ];
            
            let mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';
            
            // Enhanced bitrate calculation
            let videoBitsPerSecond = calculateOptimalBitrate(w, h, fps);
            
            const recorderOptions = {
                mimeType,
                videoBitsPerSecond,
                audioBitsPerSecond: 192000
            };
            
            appState.mediaRecorder = new MediaRecorder(mixedStream, recorderOptions);
            
            // Enhanced event handlers
            appState.mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) {
                    appState.recordedChunks.push(e.data);
                    appState.sizeAcc += e.data.size;
                    updateProgress();
                }
            };
            
            appState.mediaRecorder.onstop = () => handleStop(format);
            
            appState.mediaRecorder.onerror = (e) => {
                const errorMsg = e.error ? e.error.message : e.message;
                console.error('MediaRecorder error:', errorMsg);
                safeSetTextContent(status, t('status_error_prefix') + errorMsg);
                resetState();
            };
            
            appState.mediaRecorder.onpause = () => {
                appState.pausedAt = Date.now();
                appState.isPaused = true;
                if (pauseBtn) pauseBtn.disabled = true;
                if (resumeBtn) resumeBtn.disabled = false;
                safeSetTextContent(status, t('status_paused'));
                showPauseResume('paused');
            };
            
            appState.mediaRecorder.onresume = () => {
                appState.totalPaused += Date.now() - appState.pausedAt;
                appState.isPaused = false;
                if (pauseBtn) pauseBtn.disabled = false;
                if (resumeBtn) resumeBtn.disabled = true;
                safeSetTextContent(status, t('status_recording'));
                showPauseResume('recording');
            };
            
            // Start recording
            appState.mediaRecorder.start(1000); // Collect data every second
            appState.isRecording = true;
            
            // Update UI
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            if (pauseBtn) pauseBtn.disabled = false;
            if (resumeBtn) resumeBtn.disabled = true;
            
            safeSetTextContent(status, t('status_recording'));
            startTimer();
            
            // Setup audio waveform
            if (audioTracks.length > 0) {
                const audioWaveStream = new MediaStream([audioTracks[0]]);
                await setupWaveform(audioWaveStream);
                showWaveform(true);
            }
            
        } catch (error) {
            console.error('Recording start failed:', error);
            safeSetTextContent(status, t('status_cancelled') + ': ' + error.message);
            resetState();
            showWaveform(false);
        }
    };
}

// Enhanced bitrate calculation function
function calculateOptimalBitrate(width, height, fps) {
    const pixelCount = width * height;
    let baseBitrate;
    
    // Base bitrate based on resolution
    if (pixelCount >= 3840 * 2160) baseBitrate = 25000000; // 4K
    else if (pixelCount >= 2560 * 1440) baseBitrate = 12000000; // QHD
    else if (pixelCount >= 1920 * 1080) baseBitrate = 8000000; // FHD
    else if (pixelCount >= 1280 * 720) baseBitrate = 5000000; // HD
    else baseBitrate = 2500000; // SD
    
    // Adjust for high frame rates
    if (fps >= 240) return Math.max(baseBitrate * 1.8, 28000000);
    if (fps >= 165) return Math.max(baseBitrate * 1.6, 20000000);
    if (fps >= 144) return Math.max(baseBitrate * 1.4, 16000000);
    if (fps >= 120) return Math.max(baseBitrate * 1.2, 12000000);
    if (fps >= 60) return Math.max(baseBitrate * 1.1, baseBitrate);
    
    return baseBitrate;
}

pauseBtn.onclick = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.pause();
    }
};
resumeBtn.onclick = () => {
    if (mediaRecorder && mediaRecorder.state === 'paused') {
        mediaRecorder.resume();
    }
};

stopBtn.onclick = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    } else {
        handleStop(formatSel.value);
    }
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
    }
    preview.srcObject = null;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
    showPauseResume();
    status.textContent = t('status_stop');
    stopTimer();
    showWaveform(false);
};

function addCaptureHistory(recordingUrl, timestamp) {
    captureHistory.unshift({ url: recordingUrl, time: timestamp });
    renderHistory();
}
function addDownloadHistory(downloadUrl, timestamp) {
    downloadHistory.unshift({ url: downloadUrl, time: timestamp });
    renderHistory();
}
function renderHistory() {
    historyList.innerHTML = captureHistory.map(item =>
        `<li><a href="${item.url}" target="_blank">${t('capture_entry').replace('{time}', item.time)}</a></li>`
    ).join('') || `<li>${t('history_none')}</li>`;
    downloadList.innerHTML = downloadHistory.map(item =>
        `<li><a href="${item.url}" download> ${t('download_entry').replace('{time}', item.time)}</a></li>`
    ).join('') || `<li>${t('history_none')}</li>`;
}

async function handleStop(format) {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    let outBlob = blob;
    let outType = 'webm';
    let outExt = 'webm';
    if (format === 'mp4' || format === 'gif' || format === 'ogv') {
        status.textContent = t('status_converting');
        const { createFFmpeg, fetchFile } = FFmpeg;
        if (!ffmpegInstance) ffmpegInstance = createFFmpeg({ log: false });
        if (!ffmpegInstance.isLoaded()) await ffmpegInstance.load();
        ffmpegInstance.FS('writeFile', 'input.webm', await fetchFile(blob));
        let cmd = [];
        if (format === 'mp4') {
            cmd = ['-i', 'input.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', 'out.mp4'];
            outType = 'mp4'; outExt = 'mp4';
        } else if (format === 'gif') {
            cmd = ['-i', 'input.webm', '-vf', 'fps=12,scale=480:-1:flags=lanczos', '-t', '10', 'out.gif'];
            outType = 'gif'; outExt = 'gif';
        } else if (format === 'ogv') {
            cmd = ['-i', 'input.webm', '-c:v', 'libtheora', '-q:v', '7', '-c:a', 'libvorbis', '-q:a', '4', 'out.ogv'];
            outType = 'ogv'; outExt = 'ogv';
        }
        await ffmpegInstance.run(...cmd);
        const data = ffmpegInstance.FS('readFile', `out.${outExt}`);
        outBlob = new Blob([data.buffer], { type: `video/${outType}` });
    }
    const url = URL.createObjectURL(outBlob);
    // プレビュー表示
    preview.srcObject = null;
    preview.src = url;
    preview.load();
    preview.play();
    // ダウンロードリンク
    downloadLink.href = url;
    downloadLink.download = `capture_${getNowStr()}.${outExt}`;
    downloadLink.style.display = '';
    downloadLink.textContent = t('download_link').replace('{type}', outType);
    addCaptureHistory(url, getNowStr());
    status.textContent = t('status_done');
}
downloadLink.addEventListener('click', function() {
    if (downloadLink.href && downloadLink.style.display !== 'none') {
        const now = new Date().toLocaleString();
        addDownloadHistory(downloadLink.href, now);
    }
});

// --- ショートカット ---
document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
    if (e.ctrlKey && e.code === 'KeyR') {
        if (!startBtn.disabled) startBtn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.code === 'KeyS') {
        if (!stopBtn.disabled) stopBtn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.code === 'KeyP') {
        if (!pauseBtn.disabled) pauseBtn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.code === 'KeyE') {
        if (!resumeBtn.disabled) resumeBtn.click();
        e.preventDefault();
    }
    if (e.ctrlKey && e.code === 'KeyD') {
        toggleDark.click();
        e.preventDefault();
    }
});

window.addEventListener('DOMContentLoaded', () => {
    resetState();
    showPauseResume('reset');
});
