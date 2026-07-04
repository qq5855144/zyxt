// ==UserScript==
// @name         AIX 智能下载器 (篡改猴版)
// @namespace    https://github.com/qq5855144/zyxt
// @version      9.0.62
// @description  网页图片/视频/音频/文档嗅探下载，支持多平台，适配安卓浏览器
// @author       AIX
// @match        *://*/*
// @grant        GM_download
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_getResourceURL
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function() {
  'use strict';

  // ==================== 全局配置 ====================
  const CONFIG = {
    VERSION: '9.0.62',
    PANEL_WIDTH: 380,
    PANEL_MIN_WIDTH: 320,
    CACHE_KEY: 'aix_sniff_cache',
    SETTINGS_KEY: 'aix_settings',
    MAX_SNIFF_ITEMS: 500
  };

  // ==================== 工具函数 ====================
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return [...(ctx || document).querySelectorAll(sel)]; }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function getDomain(url) {
    try { return new URL(url).hostname; } catch(e) { return ''; }
  }

  function getFileName(url) {
    try {
      const path = new URL(url).pathname;
      const name = path.split('/').pop() || 'download';
      // Decode URI encoded names
      let decoded;
      try { decoded = decodeURIComponent(name); } catch(e) { decoded = name; }
      return decoded.split('?')[0].split('#')[0] || 'download';
    } catch(e) { return 'download'; }
  }

  function getExt(url) {
    const name = getFileName(url);
    const dot = name.lastIndexOf('.');
    return dot > -1 ? name.substring(dot + 1).toLowerCase() : '';
  }

  function debounce(fn, ms) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function isImageUrl(url) {
    const ext = getExt(url);
    return /^(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif|heic|heif)$/i.test(ext) ||
           /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif)(\?|#|$)/i.test(url);
  }

  function isVideoUrl(url) {
    const ext = getExt(url);
    return /^(mp4|webm|mkv|flv|avi|mov|wmv|m3u8|ts|m4v|3gp|ogv|mpg|mpeg)$/i.test(ext) ||
           /\.(mp4|webm|mkv|flv|avi|mov|wmv|m3u8|ts)(\?|#|$)/i.test(url);
  }

  function isAudioUrl(url) {
    const ext = getExt(url);
    return /^(mp3|wav|ogg|flac|aac|m4a|wma|opus|weba)$/i.test(ext) ||
           /\.(mp3|wav|ogg|flac|aac|m4a)(\?|#|$)/i.test(url);
  }

  function isDocUrl(url) {
    const ext = getExt(url);
    return /^(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar|7z|tar|gz|epub|mobi)$/i.test(ext);
  }

  function classifyUrl(url) {
    if (isImageUrl(url)) return 'image';
    if (isVideoUrl(url)) return 'video';
    if (isAudioUrl(url)) return 'audio';
    if (isDocUrl(url)) return 'doc';
    return 'other';
  }

  // ==================== 设置管理 ====================
  let settings = {
    minWidth: 0,
    minHeight: 0,
    maxWidth: 0,
    maxHeight: 0,
    minSize: 0,
    enableImage: true,
    enableVideo: true,
    enableAudio: true,
    enableDoc: true,
    autoSniff: true,
    panelPosition: 'right', // 'right' | 'left'
    namingPattern: '{NAME}.{EXT}',
    filterDomains: [],
    enableDragDownload: false,
    webpToJpg: false
  };

  function loadSettings() {
    try {
      const saved = GM_getValue(CONFIG.SETTINGS_KEY);
      if (saved) settings = Object.assign(settings, JSON.parse(saved));
    } catch(e) { /* use defaults */ }
  }

  function saveSettings() {
    try {
      GM_setValue(CONFIG.SETTINGS_KEY, JSON.stringify(settings));
    } catch(e) { /* silently fail */ }
  }

  // ==================== 资源嗅探器 ====================
  let sniffedItems = [];
  let seenUrls = new Set();

  function sniffFromDOM() {
    const items = [];

    // 图片
    if (settings.enableImage) {
      $$('img').forEach(img => {
        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
        if (src && src.startsWith('http') && !seenUrls.has(src)) {
          seenUrls.add(src);
          items.push({
            url: src,
            title: img.alt || img.title || getFileName(src),
            type: 'image',
            size: 0,
            width: img.naturalWidth || img.width || 0,
            height: img.naturalHeight || img.height || 0
          });
        }
      });
    }

    // 视频
    if (settings.enableVideo) {
      $$('video, video source').forEach(el => {
        const src = el.src || el.getAttribute('src');
        if (src && src.startsWith('http') && !seenUrls.has(src)) {
          seenUrls.add(src);
          items.push({
            url: src,
            title: document.title || getFileName(src),
            type: 'video',
            size: 0,
            poster: el.poster || ''
          });
        }
      });
      // Also check data attributes
      $$('[data-video-url], [data-video-src]').forEach(el => {
        const src = el.getAttribute('data-video-url') || el.getAttribute('data-video-src');
        if (src && src.startsWith('http') && !seenUrls.has(src)) {
          seenUrls.add(src);
          items.push({
            url: src,
            title: document.title || getFileName(src),
            type: 'video',
            size: 0
          });
        }
      });
    }

    // 音频
    if (settings.enableAudio) {
      $$('audio, audio source').forEach(el => {
        const src = el.src || el.getAttribute('src');
        if (src && src.startsWith('http') && !seenUrls.has(src)) {
          seenUrls.add(src);
          items.push({
            url: src,
            title: getFileName(src),
            type: 'audio',
            size: 0
          });
        }
      });
    }

    // 链接
    if (settings.enableDoc) {
      $$('a[href]').forEach(a => {
        const href = a.href;
        if (href && href.startsWith('http') && !seenUrls.has(href)) {
          const type = classifyUrl(href);
          if (type === 'doc') {
            seenUrls.add(href);
            items.push({
              url: href,
              title: a.textContent.trim() || getFileName(href),
              type: 'doc',
              size: 0
            });
          }
        }
      });
    }

    // 过滤
    const filtered = items.filter(item => {
      if (item.type === 'image' && settings.minWidth > 0 && item.width < settings.minWidth) return false;
      if (item.type === 'image' && settings.minHeight > 0 && item.height < settings.minHeight) return false;
      if (settings.minSize > 0 && item.size > 0 && item.size < settings.minSize) return false;
      return true;
    });

    if (filtered.length > 0) {
      sniffedItems = [...sniffedItems, ...filtered].slice(-CONFIG.MAX_SNIFF_ITEMS);
      updatePanel();
    }
  }

  // 拦截 fetch 和 XHR
  function hookNetwork() {
    const origFetch = unsafeWindow.fetch;
    if (origFetch) {
      unsafeWindow.fetch = function(...args) {
        return origFetch.apply(this, args).then(response => {
          const cloned = response.clone();
          const url = typeof args[0] === 'string' ? args[0] : args[0].url;
          processNetworkUrl(url);
          return response;
        });
      };
    }

    const origXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._aix_url = url;
      return origXHROpen.apply(this, arguments);
    };

    const origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('load', () => {
        if (this._aix_url) processNetworkUrl(this._aix_url);
      });
      return origXHRSend.apply(this, arguments);
    };
  }

  function processNetworkUrl(url) {
    if (!url || !url.startsWith('http')) return;
    if (seenUrls.has(url)) return;
    const type = classifyUrl(url);
    if (type === 'other') return;
    const typeEnabled = settings[`enable${type.charAt(0).toUpperCase() + type.slice(1)}`];
    if (!typeEnabled) return;

    seenUrls.add(url);
    sniffedItems.push({
      url: url,
      title: getFileName(url),
      type: type,
      size: 0
    });
    if (sniffedItems.length > CONFIG.MAX_SNIFF_ITEMS) {
      sniffedItems = sniffedItems.slice(-CONFIG.MAX_SNIFF_ITEMS);
    }
    updatePanel();
  }

  // CSS背景图片嗅探
  function sniffBackgroundImages() {
    if (!settings.enableImage) return;
    $$('*').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== 'none') {
        const matches = bg.match(/url\(["']?([^"')]+)["']?\)/g);
        if (matches) {
          matches.forEach(m => {
            const url = m.replace(/url\(["']?/, '').replace(/["']?\)/, '');
            if (url.startsWith('http') && !seenUrls.has(url)) {
              seenUrls.add(url);
              sniffedItems.push({
                url: url,
                title: getFileName(url),
                type: 'image',
                size: 0
              });
            }
          });
        }
      }
    });
  }

  // ==================== 下载模块 ====================
  function downloadItem(item) {
    const filename = generateFileName(item);
    try {
      if (typeof GM_download !== 'undefined') {
        GM_download({
          url: item.url,
          name: filename,
          saveAs: false,
          onerror: function(e) {
            fallbackDownload(item.url, filename);
          }
        });
      } else {
        fallbackDownload(item.url, filename);
      }
    } catch(e) {
      fallbackDownload(item.url, filename);
    }
  }

  function fallbackDownload(url, filename) {
    // 创建隐藏的a标签下载（适用于同源或支持CORS的资源）
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  }

  function downloadAll(type) {
    const items = type === 'all' ? sniffedItems : sniffedItems.filter(i => i.type === type);
    if (items.length === 0) {
      showToast('没有可下载的资源');
      return;
    }
    if (items.length > 20 && !confirm(`确定要下载全部 ${items.length} 个资源吗？`)) return;
    items.forEach((item, idx) => {
      setTimeout(() => downloadItem(item), idx * 300);
    });
    showToast(`开始下载 ${items.length} 个资源`);
  }

  function copyLinks(type) {
    const items = type === 'all' ? sniffedItems : sniffedItems.filter(i => i.type === type);
    const links = items.map(i => i.url).join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(links).then(() => showToast('链接已复制'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = links;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('链接已复制');
    }
  }

  function generateFileName(item) {
    let name = settings.namingPattern;
    const ext = getExt(item.url) || (item.type === 'image' ? 'jpg' : item.type === 'video' ? 'mp4' : '');
    name = name.replace('{NAME}', item.title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 100));
    name = name.replace('{EXT}', ext);
    name = name.replace('{PAGETITLE}', document.title.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 50));
    name = name.replace('{DATE}', Date.now().toString());
    name = name.replace(/\{NO(\d*)\}/g, (_, digits) => {
      const n = digits ? parseInt(digits) : 1;
      return String(sniffedItems.indexOf(item) + 1).padStart(n, '0');
    });
    return name || `download.${ext}`;
  }

  // ==================== UI 模块 ====================
  let panelVisible = false;
  let panelEl = null;
  let currentTab = 'all';
  let sortOrder = 'default';

  function createPanel() {
    if (panelEl) return;

    panelEl = document.createElement('div');
    panelEl.id = 'aix-panel';
    panelEl.innerHTML = `
      <div id="aix-panel-header">
        <div class="aix-panel-title">
          <span class="aix-logo">📥</span>
          <span>AIX 智能下载器</span>
        </div>
        <div class="aix-panel-actions">
          <button id="aix-btn-refresh" title="刷新嗅探">🔄</button>
          <button id="aix-btn-settings" title="设置">⚙️</button>
          <button id="aix-btn-close" title="关闭">✕</button>
        </div>
      </div>
      <div id="aix-panel-tabs">
        <button class="aix-tab active" data-tab="all">全部 <span class="aix-count" id="aix-count-all">0</span></button>
        <button class="aix-tab" data-tab="image">🖼️ <span class="aix-count" id="aix-count-image">0</span></button>
        <button class="aix-tab" data-tab="video">🎬 <span class="aix-count" id="aix-count-video">0</span></button>
        <button class="aix-tab" data-tab="audio">🎵 <span class="aix-count" id="aix-count-audio">0</span></button>
        <button class="aix-tab" data-tab="doc">📄 <span class="aix-count" id="aix-count-doc">0</span></button>
      </div>
      <div id="aix-panel-toolbar">
        <select id="aix-sort">
          <option value="default">默认排序</option>
          <option value="size-desc">大小↓</option>
          <option value="size-asc">大小↑</option>
          <option value="name-asc">名称↑</option>
          <option value="name-desc">名称↓</option>
        </select>
        <button id="aix-btn-download-all" class="aix-btn-sm">⬇ 批量下载</button>
        <button id="aix-btn-copy-all" class="aix-btn-sm">📋 复制链接</button>
      </div>
      <div id="aix-panel-list"></div>
      <div id="aix-panel-footer">
        <span>共 <b id="aix-total-count">0</b> 个资源</span>
        <button id="aix-btn-clear" class="aix-btn-sm">清空列表</button>
      </div>
    `;

    // 设置面板
    const settingsHtml = `
      <div id="aix-settings-panel" style="display:none">
        <div class="aix-settings-header">
          <button id="aix-settings-back" class="aix-btn-sm">← 返回</button>
          <span>设置</span>
        </div>
        <div class="aix-settings-content">
          <div class="aix-setting-group">
            <h4>资源类型</h4>
            <label><input type="checkbox" id="aix-set-image" ${settings.enableImage ? 'checked' : ''}> 图片</label>
            <label><input type="checkbox" id="aix-set-video" ${settings.enableVideo ? 'checked' : ''}> 视频</label>
            <label><input type="checkbox" id="aix-set-audio" ${settings.enableAudio ? 'checked' : ''}> 音频</label>
            <label><input type="checkbox" id="aix-set-doc" ${settings.enableDoc ? 'checked' : ''}> 文档</label>
          </div>
          <div class="aix-setting-group">
            <h4>图片过滤</h4>
            <label>最小宽度: <input type="number" id="aix-set-minw" value="${settings.minWidth}" style="width:70px"> px</label>
            <label>最小高度: <input type="number" id="aix-set-minh" value="${settings.minHeight}" style="width:70px"> px</label>
          </div>
          <div class="aix-setting-group">
            <h4>命名规则</h4>
            <input type="text" id="aix-set-naming" value="${settings.namingPattern.replace(/"/g, '"')}" style="width:100%">
            <small>{NAME}=原名 {EXT}=扩展名 {PAGETITLE}=页面标题 {NO}=序号 {DATE}=时间戳</small>
          </div>
          <div class="aix-setting-group">
            <h4>面板位置</h4>
            <select id="aix-set-position">
              <option value="right" ${settings.panelPosition === 'right' ? 'selected' : ''}>右侧</option>
              <option value="left" ${settings.panelPosition === 'left' ? 'selected' : ''}>左侧</option>
            </select>
          </div>
          <button id="aix-settings-save" class="aix-btn-primary">保存设置</button>
        </div>
      </div>
    `;

    panelEl.insertAdjacentHTML('beforeend', settingsHtml);
    document.body.appendChild(panelEl);

    // 事件绑定
    bindPanelEvents();
  }

  function createFloatingButton() {
    const btn = document.createElement('div');
    btn.id = 'aix-float-btn';
    btn.innerHTML = '📥';
    btn.title = 'AIX 智能下载器';
    document.body.appendChild(btn);

    // 统一使用 click 事件（移动端和桌面端均支持）
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      togglePanel();
    });

    // 可选：长按拖拽（仅在 touch 设备上）
    let startX, startY, startLeft, startTop, moved = false;
    let longPressTimer = null;
    const DRAG_THRESHOLD = 8;

    btn.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startLeft = btn.getBoundingClientRect().left;
      startTop = btn.getBoundingClientRect().top;
      moved = false;
      // 长按 300ms 后启用拖拽模式
      longPressTimer = setTimeout(function() {
        btn.style.transition = 'none';
      }, 300);
    }, {passive: true});

    btn.addEventListener('touchmove', function(e) {
      if (startX === undefined || !longPressTimer) return;
      var dx = e.touches[0].clientX - startX;
      var dy = e.touches[0].clientY - startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        moved = true;
        clearTimeout(longPressTimer);
        btn.style.transition = 'none';
      }
      if (moved) {
        var newLeft = Math.max(5, Math.min(window.innerWidth - 55, startLeft + dx));
        var newTop = Math.max(60, Math.min(window.innerHeight - 55, startTop + dy));
        btn.style.left = newLeft + 'px';
        btn.style.top = newTop + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
        e.preventDefault();
      }
    }, {passive: false});

    btn.addEventListener('touchend', function(e) {
      clearTimeout(longPressTimer);
      btn.style.transition = '';
      startX = undefined;
      // 如果发生了拖动，阻止后续 click
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
      moved = false;
    });
  }

  function togglePanel() {
    if (!panelEl) {
      console.error('[AIX] panel not initialized');
      return;
    }
    panelVisible = !panelVisible;
    if (panelVisible) {
      panelEl.classList.add('aix-visible');
      sniffFromDOM();
      sniffBackgroundImages();
      updatePanel();
    } else {
      panelEl.classList.remove('aix-visible');
    }
  }

  function bindPanelEvents() {
    $('#aix-btn-close').addEventListener('click', () => togglePanel());
    $('#aix-btn-refresh').addEventListener('click', () => {
      sniffFromDOM();
      sniffBackgroundImages();
      updatePanel();
      showToast('列表已刷新');
    });

    // 标签切换
    $$('#aix-panel-tabs .aix-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('#aix-panel-tabs .aix-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;
        renderList();
      });
    });

    // 排序
    $('#aix-sort').addEventListener('change', (e) => {
      sortOrder = e.target.value;
      renderList();
    });

    // 批量操作
    $('#aix-btn-download-all').addEventListener('click', () => downloadAll(currentTab));
    $('#aix-btn-copy-all').addEventListener('click', () => copyLinks(currentTab));
    $('#aix-btn-clear').addEventListener('click', () => {
      sniffedItems = [];
      seenUrls.clear();
      updatePanel();
    });

    // 设置
    $('#aix-btn-settings').addEventListener('click', () => {
      $('#aix-panel-list').style.display = 'none';
      $('#aix-panel-tabs').style.display = 'none';
      $('#aix-panel-toolbar').style.display = 'none';
      $('#aix-panel-footer').style.display = 'none';
      $('#aix-btn-settings').style.display = 'none';
      $('#aix-settings-panel').style.display = '';
    });
    $('#aix-settings-back').addEventListener('click', () => {
      $('#aix-panel-list').style.display = '';
      $('#aix-panel-tabs').style.display = '';
      $('#aix-panel-toolbar').style.display = '';
      $('#aix-panel-footer').style.display = '';
      $('#aix-btn-settings').style.display = '';
      $('#aix-settings-panel').style.display = 'none';
    });
    $('#aix-settings-save').addEventListener('click', () => {
      settings.enableImage = $('#aix-set-image').checked;
      settings.enableVideo = $('#aix-set-video').checked;
      settings.enableAudio = $('#aix-set-audio').checked;
      settings.enableDoc = $('#aix-set-doc').checked;
      settings.minWidth = parseInt($('#aix-set-minw').value) || 0;
      settings.minHeight = parseInt($('#aix-set-minh').value) || 0;
      settings.namingPattern = $('#aix-set-naming').value;
      settings.panelPosition = $('#aix-set-position').value;
      saveSettings();
      applyPanelPosition();
      showToast('设置已保存');
      $('#aix-settings-back').click();
    });
  }

  function updatePanel() {
    if (!panelEl || !panelVisible) return;
    // 更新计数
    const counts = { all: sniffedItems.length, image: 0, video: 0, audio: 0, doc: 0, other: 0 };
    sniffedItems.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
    ['all', 'image', 'video', 'audio', 'doc'].forEach(t => {
      const el = $(`#aix-count-${t}`);
      if (el) el.textContent = counts[t];
    });
    $('#aix-total-count').textContent = sniffedItems.length;
    renderList();
  }

  function getFilteredItems() {
    let items = currentTab === 'all' ? [...sniffedItems] : sniffedItems.filter(i => i.type === currentTab);

    // 排序
    switch(sortOrder) {
      case 'size-desc': items.sort((a, b) => (b.size || 0) - (a.size || 0)); break;
      case 'size-asc': items.sort((a, b) => (a.size || 0) - (b.size || 0)); break;
      case 'name-asc': items.sort((a, b) => a.title.localeCompare(b.title)); break;
      case 'name-desc': items.sort((a, b) => b.title.localeCompare(a.title)); break;
    }

    return items;
  }

  function renderList() {
    if (!panelEl || !panelVisible) return;
    const listEl = $('#aix-panel-list');
    if (!listEl) return;

    const items = getFilteredItems();

    if (items.length === 0) {
      listEl.innerHTML = '<div class="aix-empty">暂无嗅探到的资源<br><small>刷新页面或播放视频后重试</small></div>';
      return;
    }

    let html = '';
    items.forEach((item, idx) => {
      const icon = { image: '🖼️', video: '🎬', audio: '🎵', doc: '📄', other: '📎' }[item.type] || '📎';
      const sizeStr = item.size > 0 ? formatSize(item.size) : '';
      const dimStr = item.width > 0 ? `${item.width}×${item.height}` : '';

      html += `
        <div class="aix-item" data-idx="${idx}" data-url="${escapeHtml(item.url)}">
          ${item.type === 'image' ? `<div class="aix-item-thumb"><img src="${escapeHtml(item.url)}" loading="lazy" onerror="this.style.display='none'"></div>` : ''}
          <div class="aix-item-info">
            <div class="aix-item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title.substring(0, 60))}</div>
            <div class="aix-item-meta">
              <span class="aix-item-type">${icon} ${item.type}</span>
              ${sizeStr ? `<span>${sizeStr}</span>` : ''}
              ${dimStr ? `<span>${dimStr}</span>` : ''}
            </div>
            <div class="aix-item-url">${escapeHtml(item.url.substring(0, 80))}</div>
          </div>
          <div class="aix-item-actions">
            <button class="aix-btn-dl" data-url="${escapeHtml(item.url)}" title="下载">⬇</button>
            <button class="aix-btn-copy" data-url="${escapeHtml(item.url)}" title="复制链接">📋</button>
            <button class="aix-btn-open" data-url="${escapeHtml(item.url)}" title="新窗口打开">🔗</button>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;

    // 绑定按钮事件
    listEl.querySelectorAll('.aix-btn-dl').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.dataset.url;
        const item = sniffedItems.find(i => i.url === url);
        if (item) downloadItem(item);
      });
    });
    listEl.querySelectorAll('.aix-btn-copy').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(btn.dataset.url).then(() => showToast('已复制'));
      });
    });
    listEl.querySelectorAll('.aix-btn-open').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open(btn.dataset.url, '_blank');
      });
    });
  }

  function showToast(msg) {
    let toast = $('#aix-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'aix-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('aix-toast-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('aix-toast-show'), 2000);
  }

  function applyPanelPosition() {
    if (!panelEl) return;
    if (settings.panelPosition === 'left') {
      panelEl.style.right = 'auto';
      panelEl.style.left = '0';
      panelEl.style.transform = panelVisible ? 'translateX(0)' : 'translateX(-100%)';
    } else {
      panelEl.style.left = 'auto';
      panelEl.style.right = '0';
      panelEl.style.transform = panelVisible ? 'translateX(0)' : 'translateX(100%)';
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================== 站点特殊处理 ====================
  function siteBilibili() {
    if (!location.hostname.includes('bilibili.com')) return;
    // 监听B站视频数据
    const checkInterval = setInterval(() => {
      if (unsafeWindow.__INITIAL_STATE__ && unsafeWindow.__INITIAL_STATE__.videoData) {
        clearInterval(checkInterval);
        const vd = unsafeWindow.__INITIAL_STATE__.videoData;
        const pages = vd.pages || [];
        pages.forEach(page => {
          const cid = page.cid;
          // 通过B站API获取视频URL
          const apiUrl = `https://api.bilibili.com/x/player/playurl?avid=${vd.aid}&cid=${cid}&bvid=${vd.bvid}&qn=80&platform=html5`;
          GM_xmlhttpRequest({
            method: 'GET',
            url: apiUrl,
            headers: { 'Referer': 'https://www.bilibili.com' },
            onload: function(resp) {
              try {
                const data = JSON.parse(resp.responseText);
                if (data.data && data.data.durl) {
                  data.data.durl.forEach(d => {
                    if (!seenUrls.has(d.url)) {
                      seenUrls.add(d.url);
                      sniffedItems.push({
                        url: d.url,
                        title: page.part || vd.title || 'bilibili_video',
                        type: 'video',
                        size: d.size || 0
                      });
                    }
                  });
                  updatePanel();
                }
              } catch(e) {}
            }
          });
        });
      }
    }, 1500);

    // 10秒后停止检测
    setTimeout(() => clearInterval(checkInterval), 10000);
  }

  function siteTikTok() {
    if (!location.hostname.includes('tiktok.com')) return;
    // TikTok 通过 DOM 变化检测视频
    const observer = new MutationObserver(debounce(() => {
      $$('video source, video').forEach(el => {
        const src = el.src;
        if (src && src.startsWith('http') && !seenUrls.has(src)) {
          seenUrls.add(src);
          sniffedItems.push({
            url: src,
            title: document.title || 'tiktok_video',
            type: 'video',
            size: 0
          });
          updatePanel();
        }
      });
    }, 500));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ==================== 样式注入 ====================
  function injectStyles() {
    const css = `
      /* 悬浮按钮 */
      #aix-float-btn {
        position: fixed;
        bottom: 120px;
        right: 16px;
        width: 48px;
        height: 48px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        cursor: pointer;
        z-index: 9999998;
        box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
        user-select: none;
        -webkit-tap-highlight-color: transparent;
        transition: transform 0.2s;
      }
      #aix-float-btn:active {
        transform: scale(0.9);
      }

      /* 主面板 */
      #aix-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: ${CONFIG.PANEL_WIDTH}px;
        max-width: 90vw;
        height: 100vh;
        max-height: 100%;
        background: #1a1a2e;
        color: #eee;
        z-index: 9999999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        display: flex;
        flex-direction: column;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        box-shadow: -4px 0 24px rgba(0,0,0,0.5);
        overflow: hidden;
      }
      #aix-panel.aix-visible {
        transform: translateX(0);
      }

      #aix-panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        flex-shrink: 0;
        min-height: 48px;
      }
      .aix-panel-title {
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .aix-logo { margin-right: 6px; }

      .aix-panel-actions button {
        background: rgba(255,255,255,0.15);
        border: none;
        color: #fff;
        width: 30px;
        height: 30px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        margin-left: 4px;
      }

      /* 标签 */
      #aix-panel-tabs {
        display: flex;
        padding: 4px 8px;
        background: #16213e;
        gap: 2px;
        flex-shrink: 0;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .aix-tab {
        flex: 1;
        min-width: 50px;
        padding: 8px 4px;
        background: transparent;
        border: none;
        color: #999;
        font-size: 11px;
        cursor: pointer;
        border-radius: 6px;
        white-space: nowrap;
        transition: all 0.2s;
      }
      .aix-tab.active {
        background: #667eea;
        color: #fff;
      }
      .aix-count {
        background: rgba(0,0,0,0.2);
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 10px;
        margin-left: 2px;
      }

      /* 工具栏 */
      #aix-panel-toolbar {
        display: flex;
        padding: 8px;
        gap: 6px;
        background: #16213e;
        border-bottom: 1px solid #2a2a4a;
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      #aix-sort {
        flex: 1;
        min-width: 70px;
        padding: 5px 8px;
        background: #0f3460;
        color: #eee;
        border: 1px solid #333;
        border-radius: 6px;
        font-size: 11px;
      }
      .aix-btn-sm {
        padding: 5px 10px;
        background: #0f3460;
        color: #eee;
        border: 1px solid #333;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        white-space: nowrap;
      }
      .aix-btn-primary {
        padding: 8px 16px;
        background: #667eea;
        color: #fff;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        width: 100%;
        margin-top: 8px;
      }

      /* 列表 */
      #aix-panel-list {
        flex: 1;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 4px;
      }
      .aix-empty {
        text-align: center;
        padding: 40px 20px;
        color: #666;
      }
      .aix-item {
        display: flex;
        padding: 8px;
        margin: 2px 0;
        background: #16213e;
        border-radius: 8px;
        gap: 8px;
        align-items: flex-start;
      }
      .aix-item-thumb {
        width: 56px;
        height: 56px;
        flex-shrink: 0;
        border-radius: 6px;
        overflow: hidden;
        background: #0f3460;
      }
      .aix-item-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .aix-item-info {
        flex: 1;
        min-width: 0;
      }
      .aix-item-title {
        font-weight: 500;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .aix-item-meta {
        font-size: 10px;
        color: #999;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .aix-item-url {
        font-size: 10px;
        color: #555;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }
      .aix-item-actions {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex-shrink: 0;
      }
      .aix-item-actions button {
        width: 28px;
        height: 28px;
        background: #0f3460;
        border: none;
        color: #eee;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
      }

      /* 底部 */
      #aix-panel-footer {
        display: flex;
        padding: 8px 12px;
        background: #16213e;
        border-top: 1px solid #2a2a4a;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        flex-shrink: 0;
      }

      /* 设置面板 */
      #aix-settings-panel {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }
      .aix-settings-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
        font-size: 15px;
        font-weight: 600;
      }
      .aix-setting-group {
        background: #16213e;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 10px;
      }
      .aix-setting-group h4 {
        margin: 0 0 8px;
        color: #667eea;
        font-size: 13px;
      }
      .aix-setting-group label {
        display: block;
        margin: 6px 0;
        font-size: 12px;
      }
      .aix-setting-group input[type="number"],
      .aix-setting-group input[type="text"],
      .aix-setting-group select {
        padding: 4px 8px;
        background: #0f3460;
        color: #eee;
        border: 1px solid #333;
        border-radius: 4px;
        font-size: 12px;
      }
      .aix-setting-group small {
        display: block;
        color: #666;
        margin-top: 4px;
        font-size: 10px;
      }

      /* Toast */
      #aix-toast {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(0,0,0,0.85);
        color: #fff;
        padding: 10px 20px;
        border-radius: 20px;
        font-size: 13px;
        z-index: 99999999;
        opacity: 0;
        transition: opacity 0.3s, transform 0.3s;
        pointer-events: none;
      }
      #aix-toast.aix-toast-show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* 移动端适配 */
      @media (max-width: 480px) {
        #aix-panel {
          width: 100vw;
          max-width: 100vw;
          border-radius: 16px 16px 0 0;
          top: auto;
          bottom: 0;
          height: 85vh;
          transform: translateY(100%);
          border-radius: 16px 16px 0 0;
        }
        #aix-panel.aix-visible {
          transform: translateY(0);
        }
        #aix-float-btn {
          bottom: 100px;
          right: 12px;
          width: 44px;
          height: 44px;
          font-size: 20px;
        }
      }
    `;
    // 通过原生 <style> 标签注入，避免依赖 GM_addStyle
    const styleEl = document.createElement('style');
    styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  // ==================== 初始化 ====================
  function init() {
    try {
      loadSettings();
      injectStyles();
      createPanel();
      createFloatingButton();
      applyPanelPosition();

      // 初始嗅探
      setTimeout(() => {
        sniffFromDOM();
        sniffBackgroundImages();
        updatePanel();
      }, 1200);

      // 定期嗅探
      setInterval(() => {
        sniffFromDOM();
      }, 5000);

      // DOM变化监听
      const domObserver = new MutationObserver(debounce(() => {
        sniffFromDOM();
      }, 2000));
      domObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src'] });

      // 网络拦截
      try {
        hookNetwork();
      } catch(e) {
        // 某些浏览器可能不允许修改fetch/XHR
      }

      // 站点特殊处理
      try { siteBilibili(); } catch(e) {}
      try { siteTikTok(); } catch(e) {}

      // 键盘快捷键 (Ctrl+Shift+X)
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'X') {
          e.preventDefault();
          togglePanel();
        }
      });

      console.log(`[AIX] 智能下载器 v${CONFIG.VERSION} 已加载 ✅`);
    } catch(e) {
      console.error('[AIX] init error:', e);
    }
  }

  // ==================== 启动 ====================
  // 使用多种策略确保脚本一定执行
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // DOM 已经就绪, 但 body 可能还没完全加载，稍等一下
    setTimeout(init, 300);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
  }
  // 最终兜底：load 事件一定会触发
  window.addEventListener('load', () => {
    if (!panelEl) {
      console.log('[AIX] fallback init via load event');
      init();
    }
  }, {once: true});

})();
