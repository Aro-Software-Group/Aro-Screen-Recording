const translations = {
  ja: {
    title: 'Aro Screen Recording 2.0',
    changelog: '更新履歴',
    language: '言語:',
    resolution_label: '解像度 (アスペクト比):',
    fps_label: 'FPS:',
    format_label: '形式:',
    mic_label: 'マイク音声:',
    mic_enabled: '有効',
    start_btn: '録画開始',
    pause_btn: '一時停止',
    resume_btn: '再開',
    stop_btn: '録画停止',
    capture_history: 'キャプチャー履歴',
    download_history: 'ダウンロード履歴',
    download_link: '動画をダウンロード({type})',
    status_select_screen: '録画する画面・ウィンドウ・タブを選択してください',
    status_recording: '録画中...',
    status_paused: '一時停止中...',
    status_stop: '録画停止中...',
    status_done: '録画完了！ダウンロードできます',
    status_error_prefix: '録画エラー: ',
    status_preview_fail: 'プレビュー取得に失敗: ',
    status_cancelled: '録画開始がキャンセルされました',
    status_converting: '変換中...（少々お待ちください）',
    history_none: '履歴なし',
    capture_entry: '{time} の録画',
    download_entry: '{time} にダウンロード',
    changelog_title: '更新履歴',
    back_home: '戻る'
  },
  en: {
    title: 'Aro Screen Recording 2.0',
    changelog: 'Changelog',
    language: 'Language:',
    resolution_label: 'Resolution (aspect ratio):',
    fps_label: 'FPS:',
    format_label: 'Format:',
    mic_label: 'Microphone:',
    mic_enabled: 'enabled',
    start_btn: 'Start Recording',
    pause_btn: 'Pause',
    resume_btn: 'Resume',
    stop_btn: 'Stop Recording',
    capture_history: 'Capture History',
    download_history: 'Download History',
    download_link: 'Download ({type})',
    status_select_screen: 'Select the screen, window or tab to record',
    status_recording: 'Recording...',
    status_paused: 'Paused...',
    status_stop: 'Stopping...',
    status_done: 'Recording finished! You can download it',
    status_error_prefix: 'Recording error: ',
    status_preview_fail: 'Failed to get preview: ',
    status_cancelled: 'Recording was cancelled',
    status_converting: 'Converting... please wait',
    history_none: 'No history',
    capture_entry: 'Recorded on {time}',
    download_entry: 'Downloaded on {time}',
    changelog_title: 'Changelog',
    back_home: 'Back'
  },
  zh: {
    title: 'Aro Screen Recording 2.0',
    changelog: '更新日志',
    language: '语言:',
    resolution_label: '分辨率 (纵横比):',
    fps_label: '帧率:',
    format_label: '格式:',
    mic_label: '麦克风音频:',
    mic_enabled: '启用',
    start_btn: '开始录制',
    pause_btn: '暂停',
    resume_btn: '继续',
    stop_btn: '停止录制',
    capture_history: '捕获记录',
    download_history: '下载记录',
    download_link: '下载 ({type})',
    status_select_screen: '请选择要录制的屏幕、窗口或标签页',
    status_recording: '录制中...',
    status_paused: '已暂停...',
    status_stop: '正在停止...',
    status_done: '录制完成！可以下载',
    status_error_prefix: '录制错误: ',
    status_preview_fail: '获取预览失败: ',
    status_cancelled: '已取消录制',
    status_converting: '转换中... 请稍候',
    history_none: '无记录',
    capture_entry: '{time} 的录制',
    download_entry: '{time} 下载',
    changelog_title: '更新日志',
    back_home: '返回'
  }
};
let currentLang = localStorage.getItem('aro_lang') || 'ja';
function applyLanguage(lang){
  currentLang = lang;
  localStorage.setItem('aro_lang', lang);
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const key=el.getAttribute('data-i18n');
    const txt=translations[lang][key];
    if(txt) el.textContent=txt;
  });
}
function t(key){
  return translations[currentLang][key] || translations['ja'][key] || key;
}
window.addEventListener('DOMContentLoaded',()=>{
  applyLanguage(currentLang);
  const sel=document.getElementById('language');
  if(sel){
    sel.value=currentLang;
    sel.addEventListener('change',e=>applyLanguage(e.target.value));
  }
});
