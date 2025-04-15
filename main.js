const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const resolutionSel = document.getElementById('resolution');
const fpsSel = document.getElementById('fps');
const formatSel = document.getElementById('format');
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const downloadLink = document.getElementById('downloadLink');
const downloadList = document.getElementById('download-list');
const historyList = document.getElementById('history-list');
const micCheckbox = document.getElementById('mic');
const recordingTime = document.getElementById('recording-time');
const recordingSize = document.getElementById('recording-size');
const toggleDark = document.getElementById('toggle-dark');
const audioWaveform = document.getElementById('audio-waveform');

let mediaRecorder, recordedChunks = [], stream;
let captureHistory = [];
let downloadHistory = [];

let timerInterval = null;
let startTimestamp = null;
let pausedAt = 0;
let totalPaused = 0;
let lastSize = 0;
let sizeAcc = 0; // 累積ファイルサイズ

let audioCtx, analyser, waveformSource, waveformAnimId;

function updateProgress() {
    if (!startTimestamp) return;
    let elapsed = Date.now() - startTimestamp - totalPaused;
    if (mediaRecorder && mediaRecorder.state === 'paused') {
        elapsed = pausedAt - startTimestamp - totalPaused;
    }
    const mins = String(Math.floor(elapsed / 60000)).padStart(2, '0');
    const secs = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    recordingTime.textContent = `${mins}:${secs}`;
    // ファイルサイズは累積値を表示
    recordingSize.textContent = `${(sizeAcc / 1024 / 1024).toFixed(2)} MB`;
}

function startTimer() {
    startTimestamp = Date.now();
    totalPaused = 0;
    timerInterval = setInterval(updateProgress, 1000); // 1秒ごとに
}
function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    updateProgress();
}

// ダークモード切替
function setDarkMode(on) {
    if (on) {
        document.body.classList.add('dark');
        localStorage.setItem('aro_dark', '1');
    } else {
        document.body.classList.remove('dark');
        localStorage.setItem('aro_dark', '0');
    }
}
toggleDark.onclick = () => {
    setDarkMode(!document.body.classList.contains('dark'));
};
if (localStorage.getItem('aro_dark') === '1') setDarkMode(true);

// --- 大幅な安定化・バグ修正 ---
function resetState() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    startTimestamp = null;
    pausedAt = 0;
    totalPaused = 0;
    lastSize = 0;
    sizeAcc = 0;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) {}
    }
    mediaRecorder = null;
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    preview && (preview.srcObject = null);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    pauseBtn.disabled = true;
    resumeBtn.disabled = true;
    downloadLink.style.display = 'none';
    status.textContent = '';
    showPauseResume('reset');
    showWaveform(false);
}
window.addEventListener('DOMContentLoaded', () => {
    resetState();
    showPauseResume('reset');
});

function showPauseResume(state) {
    if (!pauseBtn || !resumeBtn) return;
    if (state === 'paused') {
        pauseBtn.style.display = 'none';
        resumeBtn.style.display = '';
    } else if (state === 'recording') {
        pauseBtn.style.display = '';
        resumeBtn.style.display = 'none';
    } else {
        pauseBtn.style.display = 'none';
        resumeBtn.style.display = 'none';
    }
}

async function setupPreview() {
    try {
        // プレビュー用: 常時画面キャプチャを取得（録画関係なく）
        if (!preview) return;
        if (!preview.srcObject) {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({video:true, audio:false});
            preview.srcObject = displayStream;
        }
    } catch (e) {
        status && (status.textContent = 'プレビュー取得に失敗: ' + e.message);
    }
}
setupPreview();

function showWaveform(show) {
    audioWaveform.style.display = show ? '' : 'none';
    if (!show && waveformAnimId) {
        cancelAnimationFrame(waveformAnimId);
        waveformAnimId = null;
    }
}

function drawWaveform() {
    if (!analyser) return;
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
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    waveformAnimId = requestAnimationFrame(drawWaveform);
}

async function setupWaveform(stream) {
    if (audioCtx) {
        audioCtx.close();
        audioCtx = null;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    waveformSource = audioCtx.createMediaStreamSource(stream);
    waveformSource.connect(analyser);
    drawWaveform();
}

startBtn.onclick = async () => {
    resetState();
    showPauseResume('recording');
    sizeAcc = 0;
    showWaveform(false);
    const [w, h] = resolutionSel.value.split('x').map(Number);
    const fps = Number(fpsSel.value);
    const format = formatSel.value;
    const useMic = micCheckbox && micCheckbox.checked;
    status.textContent = '録画する画面・ウィンドウ・タブを選択してください';
    try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                width: w, height: h,
                frameRate: { ideal: fps, max: fps },
                resizeMode: 'none',
                colorSpace: 'rec2020',
            },
            audio: true
        });
        let audioStream = null;
        if (useMic) {
            try {
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            } catch (e) {}
        }
        // videoのみdisplayStreamから、audioはdisplayStreamとaudioStreamをミックス
        const tracks = [...displayStream.getVideoTracks()];
        const audioTracks = [];
        if (displayStream.getAudioTracks().length > 0) audioTracks.push(displayStream.getAudioTracks()[0]);
        if (audioStream && audioStream.getAudioTracks().length > 0) audioTracks.push(audioStream.getAudioTracks()[0]);
        if (audioTracks.length > 0) {
            audioTracks.forEach(track => tracks.push(track));
        }
        const mixedStream = new MediaStream(tracks);
        preview.srcObject = mixedStream;
        recordedChunks = [];
        let mimeType = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
        }
        // 画質・fpsに応じてビットレート自動調整
        let videoBitsPerSecond = 4000000;
        if (w * h >= 3840 * 2160) videoBitsPerSecond = 25000000; // 4K
        else if (w * h >= 2560 * 1440) videoBitsPerSecond = 12000000; // QHD
        else if (w * h >= 1920 * 1080) videoBitsPerSecond = 8000000; // FHD
        else if (w * h >= 1280 * 720) videoBitsPerSecond = 5000000; // HD
        if (fps >= 120) videoBitsPerSecond = Math.max(videoBitsPerSecond, 12000000);
        if (fps >= 144) videoBitsPerSecond = Math.max(videoBitsPerSecond, 16000000);
        if (fps >= 165) videoBitsPerSecond = Math.max(videoBitsPerSecond, 20000000);
        if (fps >= 240) videoBitsPerSecond = Math.max(videoBitsPerSecond, 28000000);
        mediaRecorder = new MediaRecorder(mixedStream, {
            mimeType,
            videoBitsPerSecond,
            audioBitsPerSecond: 192000
        });
        mediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) {
                recordedChunks.push(e.data);
                sizeAcc += e.data.size;
            }
            updateProgress();
        };
        // onstopはここで一度だけ
        mediaRecorder.onstop = () => handleStop(formatSel.value);
        mediaRecorder.onerror = e => {
            status.textContent = '録画エラー: ' + (e.error ? e.error.message : e.message);
        };
        mediaRecorder.onpause = () => {
            pausedAt = Date.now();
            pauseBtn.disabled = true;
            resumeBtn.disabled = false;
            status.textContent = '一時停止中...';
            showPauseResume('paused');
        };
        mediaRecorder.onresume = () => {
            totalPaused += Date.now() - pausedAt;
            pauseBtn.disabled = false;
            resumeBtn.disabled = true;
            status.textContent = '録画中...';
            showPauseResume('recording');
        };
        mediaRecorder.start();
        startBtn.disabled = true;
        stopBtn.disabled = false;
        pauseBtn.disabled = false;
        resumeBtn.disabled = true;
        status.textContent = '録画中...';
        startTimer();
        // 音声波形セットアップ
        if (audioTracks.length > 0) {
            const audioWaveStream = new MediaStream([audioTracks[0]]);
            await setupWaveform(audioWaveStream);
            showWaveform(true);
        }
    } catch (e) {
        status.textContent = '録画開始がキャンセルされました';
        resetState();
        showWaveform(false);
    }
};

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
    status.textContent = '録画停止中...';
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
        `<li><a href="${item.url}" target="_blank">${item.time} の録画</a></li>`
    ).join('') || '<li>履歴なし</li>';
    downloadList.innerHTML = downloadHistory.map(item =>
        `<li><a href="${item.url}" download> ${item.time} にダウンロード</a></li>`
    ).join('') || '<li>履歴なし</li>';
}

async function handleStop(format) {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    let outBlob = blob;
    let outType = 'webm';
    let outExt = 'webm';
    if (format === 'mp4' || format === 'gif' || format === 'ogv') {
        status.textContent = '変換中...（少々お待ちください）';
        const { createFFmpeg, fetchFile } = FFmpeg;
        const ffmpeg = createFFmpeg({ log: false });
        if (!ffmpeg.isLoaded()) await ffmpeg.load();
        ffmpeg.FS('writeFile', 'input.webm', await fetchFile(blob));
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
        await ffmpeg.run(...cmd);
        const data = ffmpeg.FS('readFile', `out.${outExt}`);
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
    downloadLink.textContent = `動画をダウンロード(${outType})`;
    addCaptureHistory(url, getNowStr());
    status.textContent = '録画完了！ダウンロードできます';
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
