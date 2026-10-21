const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const APP_PORT = 3201;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;

// In packaged builds, load the remote server directly (no local Next.js needed).
// In dev mode, APP_ORIGIN (local Next.js) is used as usual.
const REMOTE_ORIGIN = 'https://meet.kloud.cn';
/** 打包版文档请求绕过磁盘缓存，避免主窗口停在旧前端 */
const REMOTE_NO_CACHE_HEADERS = 'Cache-Control: no-cache\r\nPragma: no-cache\r\n';
const UPDATE_FEED_FALLBACK = 'https://kloud.cn/kloudmeet-exe';
const UPDATE_CHECK_FIRST_MS = 5000;
const UPDATE_CHECK_PERIOD_MS = 4 * 60 * 60 * 1000;
const UPDATE_CHECK_RETRY_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];

let nextServerProcess;
/** 用户正在退出应用时置 true，避免误弹「内置服务已退出」 */
let isAppQuitting = false;

/** Lazy-load native stack so a failure does not kill the app before any window (packaged builds). */
let nutApi;
function getNutTree() {
  if (!nutApi) {
    const { mouse, Point, Button } = require('@nut-tree-fork/nut-js');
    mouse.config.autoDelayMs = 0;
    mouse.config.mouseSpeed = 3000;
    nutApi = { mouse, Point, Button };
  }
  return nutApi;
}

function startupLogPath() {
  try {
    return path.join(app.getPath('userData'), 'startup.log');
  } catch {
    return path.join(require('os').tmpdir(), 'kloud-meet-startup.log');
  }
}

function appendStartupLog(line) {
  try {
    fs.appendFileSync(startupLogPath(), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* ignore */
  }
}

function showFatal(title, detail) {
  appendStartupLog(`${title}: ${detail}`);
  console.error(title, detail);
  try {
    dialog.showErrorBox(
      title,
      `${detail}\n\n日志: ${startupLogPath()}`,
    );
  } catch {
    /* ignore */
  }
}

let mainWindow;
let overlayWindow;
/** 主窗口顶部居中的更新下载进度（仅打包环境使用） */
let updateProgressWindow;
/** 更新下载完成后的「立即重启」模态窗 */
let updateReadyPromptWindow;
/** @type {ReturnType<typeof setInterval> | null} */
let updateProgressRaiseTimer = null;

const UPDATE_PROGRESS_W = 360;
const UPDATE_PROGRESS_H = 84;
/** 贴在主窗口内容区顶部，避免掉进页面右上角按钮底下 */
const UPDATE_PROGRESS_TOP_INSET = 12;

/** @type {{ percent: number } | null} */
let pendingUpdateProgressPayload = null;

/** 避免 download-progress 与 update-downloaded 连续两次 100% 等重复帧 */
let lastUpdaterProgressRounded = -1;

/** 同一次下载只弹一次安装确认（electron-updater 偶发重复事件） */
let updateDownloadedDialogShown = false;
/** @type {'idle' | 'checking' | 'downloading' | 'ready'} */
let updatePhase = 'idle';
let updateRetryIndex = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let updateCheckTimer = null;
let updateCheckInFlight = false;
/** @type {string | null} */
let updateAnnouncedVersion = null;
/** @type {string | null} */
let updateReadyVersion = null;
/** 安装包已落盘：退出时要先放开单实例锁，否则新进程会被立刻关掉 */
let updateInstallPending = false;
let updateInstallStarted = false;

/**
 * 全屏 annotation overlay 会盖住更新进度条 / 弹窗。
 * 用 reason 集合做引用计数：任一更新 UI 需要时 hide，全部结束后再 show。
 * @type {Set<string>}
 */
const overlayHideReasons = new Set();

function acquireOverlayHide(reason) {
  if (!reason) return;
  overlayHideReasons.add(reason);
  try {
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWindow.hide();
    }
  } catch {
    /* ignore */
  }
}

function releaseOverlayHide(reason) {
  if (!reason) return;
  overlayHideReasons.delete(reason);
  if (overlayHideReasons.size > 0) return;
  try {
    if (overlayWindow && !overlayWindow.isDestroyed() && !overlayWindow.isVisible()) {
      overlayWindow.show();
    }
  } catch {
    /* ignore */
  }
}

function pctFromUpdaterProgress(p) {
  if (p && typeof p.percent === 'number' && !Number.isNaN(p.percent)) {
    return Math.min(100, Math.max(0, p.percent));
  }
  if (p && p.total > 0) {
    return Math.min(100, Math.max(0, (p.transferred / p.total) * 100));
  }
  return 0;
}

function layoutUpdateProgressWindow() {
  if (!updateProgressWindow || updateProgressWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const cb = mainWindow.getContentBounds();
  const width = Math.min(UPDATE_PROGRESS_W, Math.max(260, cb.width - 24));
  updateProgressWindow.setBounds({
    x: Math.round(cb.x + (cb.width - width) / 2),
    y: cb.y + UPDATE_PROGRESS_TOP_INSET,
    width,
    height: UPDATE_PROGRESS_H,
  });
}

function stopUpdateProgressRaiseLoop() {
  if (!updateProgressRaiseTimer) return;
  clearInterval(updateProgressRaiseTimer);
  updateProgressRaiseTimer = null;
}

/** 只抬层级，不改位置，避免把用户拖开的进度条拽回去 */
function pinUpdateProgressAbove() {
  if (overlayHideReasons.has('update-progress')) {
    try {
      if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
        overlayWindow.hide();
      }
    } catch {
      /* ignore */
    }
  }
  const w = updateProgressWindow;
  if (!w || w.isDestroyed()) {
    stopUpdateProgressRaiseLoop();
    return;
  }
  try {
    if (!w.isVisible()) w.showInactive();
  } catch {
    try {
      w.show();
    } catch {
      /* ignore */
    }
  }
  raiseUpdateProgressWindow();
}

function keepUpdateProgressVisible() {
  layoutUpdateProgressWindow();
  pinUpdateProgressAbove();
}

function startUpdateProgressRaiseLoop() {
  if (updateProgressRaiseTimer) return;
  updateProgressRaiseTimer = setInterval(pinUpdateProgressAbove, 800);
}

function destroyUpdateProgressWindow() {
  stopUpdateProgressRaiseLoop();
  if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
    updateProgressWindow.destroy();
  }
  updateProgressWindow = null;
  pendingUpdateProgressPayload = null;
  lastUpdaterProgressRounded = -1;
  releaseOverlayHide('update-progress');
}

function raiseUpdateProgressWindow() {
  const w = updateProgressWindow;
  if (!w || w.isDestroyed()) return;
  try {
    w.setAlwaysOnTop(true, 'screen-saver', 1);
  } catch {
    try {
      w.setAlwaysOnTop(true, 'pop-up-menu', 2);
    } catch {
      try {
        w.setAlwaysOnTop(true);
      } catch {
        /* ignore */
      }
    }
  }
  try {
    w.moveTop();
  } catch {
    /* ignore */
  }
}

function broadcastUpdateDownloadProgress(payload) {
  const rounded = Math.round(payload.percent);
  if (rounded === lastUpdaterProgressRounded) return;
  lastUpdaterProgressRounded = rounded;
  pendingUpdateProgressPayload = payload;
  const w = updateProgressWindow;
  if (!w || w.isDestroyed()) return;
  if (!w.webContents.isLoading()) {
    w.webContents.send('update-download-progress', payload);
  }
}

/**
 * 全屏 alwaysOnTop 的 overlay 会把挂在主窗口上的原生对话框挡在下面；先隐藏 overlay，并用无宿主窗口调用保证提示在最前。
 */
async function showUpdaterMessageBox(options) {
  acquireOverlayHide('update-msgbox');
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      try {
        mainWindow.moveTop();
      } catch {
        /* ignore */
      }
    }
    return await dialog.showMessageBox(null, options);
  } finally {
    releaseOverlayHide('update-msgbox');
  }
}

/**
 * 用主窗口子模态窗代替原生 dialog，避免被全屏 overlay / 层级 挡住或静默失败。
 * @param {string} version
 * @returns {Promise<boolean>} 用户是否选择立即安装
 */
function showUpdateReadyPrompt(version) {
  return new Promise((resolve) => {
    const log = (s) => appendStartupLog(`[update-ready] ${s}`);

    if (!mainWindow || mainWindow.isDestroyed()) {
      log('skip: no mainWindow');
      // 调用方可能已提前 acquire（避免进度条关闭时闪一下）
      releaseOverlayHide('update-ready');
      resolve(false);
      return;
    }

    acquireOverlayHide('update-ready');

    let settled = false;
    /** @type {import('electron').BrowserWindow | null} */
    let promptWinRef = null;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('update-ready-response', onResponse);
      releaseOverlayHide('update-ready');
      const w = promptWinRef;
      promptWinRef = null;
      updateReadyPromptWindow = null;
      if (w && !w.isDestroyed()) {
        try {
          w.destroy();
        } catch {
          /* ignore */
        }
      }
      resolve(Boolean(value));
    };

    const onResponse = (event, install) => {
      const w = promptWinRef;
      if (!w || w.isDestroyed()) return;
      if (event.sender !== w.webContents) return;
      settle(install === true);
    };

    ipcMain.on('update-ready-response', onResponse);

    const PROMPT_W = 420;
    const PROMPT_H = 168;
    const promptWin = new BrowserWindow({
      parent: mainWindow,
      modal: true,
      show: false,
      width: PROMPT_W,
      height: PROMPT_H,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: '更新已就绪',
      webPreferences: {
        preload: path.join(__dirname, 'update-ready-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    promptWinRef = promptWin;
    updateReadyPromptWindow = promptWin;

    const mb = mainWindow.getBounds();
    promptWin.setBounds({
      x: Math.round(mb.x + (mb.width - PROMPT_W) / 2),
      y: Math.round(mb.y + (mb.height - PROMPT_H) / 2),
      width: PROMPT_W,
      height: PROMPT_H,
    });

    promptWin.on('closed', () => {
      promptWinRef = null;
      updateReadyPromptWindow = null;
      if (!settled) {
        ipcMain.removeListener('update-ready-response', onResponse);
        releaseOverlayHide('update-ready');
        settled = true;
        resolve(false);
      }
    });

    promptWin.webContents.once('did-finish-load', () => {
      try {
        promptWin.show();
        promptWin.focus();
      } catch (e) {
        log(`show/focus: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    const vq = encodeURIComponent(String(version || ''));
    promptWin
      .loadFile(path.join(__dirname, 'update-ready.html'), { query: { v: vq } })
      .catch((e) => {
        log(`loadFile: ${e.message}`);
        settle(false);
      });
  });
}

function ensureUpdateProgressWindow() {
  acquireOverlayHide('update-progress');

  if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
    keepUpdateProgressVisible();
    startUpdateProgressRaiseLoop();
    return updateProgressWindow;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    // 已 acquire，失败时必须释放，否则 overlay 会一直藏着
    releaseOverlayHide('update-progress');
    return null;
  }

  updateProgressWindow = new BrowserWindow({
    width: UPDATE_PROGRESS_W,
    height: UPDATE_PROGRESS_H,
    frame: false,
    transparent: false,
    backgroundColor: '#0f172a',
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    focusable: false,
    alwaysOnTop: true,
    // Windows 上挂到主窗口，会议页 focus / moveTop 也盖不住进度条
    parent: process.platform === 'win32' ? mainWindow : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'update-progress-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    updateProgressWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    /* ignore */
  }
  raiseUpdateProgressWindow();
  startUpdateProgressRaiseLoop();

  updateProgressWindow.webContents.once('did-finish-load', () => {
    if (!updateProgressWindow || updateProgressWindow.isDestroyed()) return;
    layoutUpdateProgressWindow();
    try {
      updateProgressWindow.showInactive();
    } catch {
      try {
        updateProgressWindow.show();
      } catch {
        /* ignore */
      }
    }
    raiseUpdateProgressWindow();
    if (pendingUpdateProgressPayload) {
      updateProgressWindow.webContents.send('update-download-progress', pendingUpdateProgressPayload);
    }
  });

  updateProgressWindow.on('closed', () => {
    updateProgressWindow = null;
    releaseOverlayHide('update-progress');
  });

  updateProgressWindow.loadFile(path.join(__dirname, 'update-progress.html')).catch((e) => {
    appendStartupLog(`[updater] progress loadFile failed: ${e.message}`);
    try {
      if (updateProgressWindow && !updateProgressWindow.isDestroyed()) {
        updateProgressWindow.destroy();
      }
    } catch {
      /* ignore */
    }
    updateProgressWindow = null;
    releaseOverlayHide('update-progress');
  });
  layoutUpdateProgressWindow();
  return updateProgressWindow;
}

function formatUpdaterArgs(args) {
  return args
    .map((item) => {
      if (item instanceof Error) return item.stack || item.message;
      if (typeof item === 'string') return item;
      try {
        return JSON.stringify(item);
      } catch {
        return String(item);
      }
    })
    .join(' ');
}

function getUpdateFeedUrl() {
  try {
    const pkg = require('./package.json');
    const publish = pkg.build && pkg.build.publish;
    if (publish && typeof publish.url === 'string' && publish.url.trim()) {
      return publish.url.trim();
    }
  } catch (e) {
    appendStartupLog(`[updater] read feed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return UPDATE_FEED_FALLBACK;
}

function clearUpdateCheckTimer() {
  if (!updateCheckTimer) return;
  clearTimeout(updateCheckTimer);
  updateCheckTimer = null;
}

function scheduleUpdateCheck(delayMs) {
  clearUpdateCheckTimer();
  updateCheckTimer = setTimeout(() => {
    updateCheckTimer = null;
    runUpdateCheck();
  }, delayMs);
}

function nextUpdateRetryDelay() {
  const delay = UPDATE_CHECK_RETRY_MS[Math.min(updateRetryIndex, UPDATE_CHECK_RETRY_MS.length - 1)];
  updateRetryIndex += 1;
  return delay;
}

function runUpdateCheck() {
  if (!app.isPackaged || isAppQuitting) return;
  if (updateCheckInFlight || updatePhase === 'downloading') return;
  updateCheckInFlight = true;
  if (updatePhase !== 'ready') updatePhase = 'checking';
  appendStartupLog('[updater] checkForUpdates');
  autoUpdater
    .checkForUpdates()
    .catch((err) => {
      appendStartupLog(
        `[updater] check rejected: ${err instanceof Error ? err.message : String(err)}`,
      );
    })
    .finally(() => {
      updateCheckInFlight = false;
    });
}

/**
 * 立刻重启安装。静默退出安装仍交给 autoInstallOnAppQuit（不强制拉起）。
 */
function installDownloadedUpdate() {
  if (updateInstallStarted) return;
  updateInstallStarted = true;
  updateInstallPending = true;
  isAppQuitting = true;
  clearUpdateCheckTimer();
  appendStartupLog('[updater] quitAndInstall');
  try {
    app.releaseSingleInstanceLock();
  } catch (e) {
    appendStartupLog(
      `[updater] releaseSingleInstanceLock: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    autoUpdater.quitAndInstall(false, true);
  } catch (e) {
    updateInstallStarted = false;
    appendStartupLog(`quitAndInstall: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function prepareQuitForPendingUpdate() {
  if (!updateInstallPending) return;
  isAppQuitting = true;
  clearUpdateCheckTimer();
  try {
    app.releaseSingleInstanceLock();
  } catch (e) {
    appendStartupLog(
      `[updater] releaseSingleInstanceLock: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.logger = {
    info: (...args) => appendStartupLog(`[updater] ${formatUpdaterArgs(args)}`),
    warn: (...args) => appendStartupLog(`[updater][warn] ${formatUpdaterArgs(args)}`),
    error: (...args) => appendStartupLog(`[updater][error] ${formatUpdaterArgs(args)}`),
    debug: (...args) => appendStartupLog(`[updater][debug] ${formatUpdaterArgs(args)}`),
  };

  const feedUrl = getUpdateFeedUrl();
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    appendStartupLog(`[updater] feed ${feedUrl}`);
  } catch (e) {
    appendStartupLog(`[updater] setFeedURL: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 先于 electron-updater 自己的 before-quit，避免新进程抢锁失败后直接退出
  app.prependListener('before-quit', prepareQuitForPendingUpdate);

  autoUpdater.on('update-not-available', () => {
    if (updatePhase !== 'ready') updatePhase = 'idle';
    updateRetryIndex = 0;
    appendStartupLog('[updater] already latest');
    scheduleUpdateCheck(UPDATE_CHECK_PERIOD_MS);
  });

  autoUpdater.on('update-available', (info) => {
    const version = info && info.version ? String(info.version) : '';
    updatePhase = 'downloading';
    clearUpdateCheckTimer();
    const firstAnnounce = updateAnnouncedVersion !== version;
    if (firstAnnounce) {
      updateAnnouncedVersion = version;
      updateDownloadedDialogShown = false;
      lastUpdaterProgressRounded = -1;
    }
    ensureUpdateProgressWindow();
    broadcastUpdateDownloadProgress({ percent: 0 });
    appendStartupLog(`[updater] update-available ${version}`);
    if (!firstAnnounce) return;
    showUpdaterMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `Kloud Meet ${version} 已发布，正在后台下载。进度在窗口顶部。`,
      buttons: ['好的'],
    })
      .catch(() => {})
      .finally(() => {
        if (updatePhase === 'downloading') ensureUpdateProgressWindow();
      });
  });

  autoUpdater.on('download-progress', (p) => {
    updatePhase = 'downloading';
    ensureUpdateProgressWindow();
    broadcastUpdateDownloadProgress({ percent: pctFromUpdaterProgress(p) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const version = info && info.version ? String(info.version) : '';
    updatePhase = 'ready';
    updateInstallPending = true;
    updateRetryIndex = 0;
    appendStartupLog(`[updater] update-downloaded ${version}`);
    scheduleUpdateCheck(UPDATE_CHECK_PERIOD_MS);
    if (updateDownloadedDialogShown && updateReadyVersion === version) return;
    updateDownloadedDialogShown = true;
    updateReadyVersion = version;
    acquireOverlayHide('update-ready');
    destroyUpdateProgressWindow();
    showUpdateReadyPrompt(version)
      .then((install) => {
        if (install) {
          installDownloadedUpdate();
          return;
        }
        appendStartupLog('[updater] user postponed install; will install on quit');
      })
      .catch((e) => {
        appendStartupLog(`showUpdateReadyPrompt: ${e instanceof Error ? e.message : String(e)}`);
      });
  });

  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    appendStartupLog(`autoUpdater error: ${message}`);
    if (isAppQuitting) return;
    if (updatePhase === 'downloading') destroyUpdateProgressWindow();
    if (updatePhase !== 'ready') updatePhase = 'idle';
    const delay = nextUpdateRetryDelay();
    appendStartupLog(`[updater] retry in ${Math.round(delay / 1000)}s`);
    scheduleUpdateCheck(delay);
  });

  scheduleUpdateCheck(UPDATE_CHECK_FIRST_MS);
}

/** 打包版启动时清掉 HTTP 缓存，否则 Chromium 可能一直用上次的页面 */
async function clearHttpCacheForLatestCode() {
  const started = Date.now();
  try {
    await session.defaultSession.clearCache();
    appendStartupLog(`[updater] http cache cleared in ${Date.now() - started}ms`);
  } catch (e) {
    appendStartupLog(
      `[updater] clearCache failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** @type {string | null} */
let pendingDeepLink = null;

function parseKloudMeetDeepLink(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'kloudmeet:') return null;
    if (u.hostname !== 'join') return null;
    const seg = (u.pathname || '').replace(/^\//, '');
    if (!seg) return null;
    const room = decodeURIComponent(seg);
    return { room, search: u.search || '' };
  } catch {
    return null;
  }
}

function getAppPageOrigin() {
  return app.isPackaged ? REMOTE_ORIGIN : APP_ORIGIN;
}

function loadMainContents(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const remote = typeof url === 'string' && url.startsWith('https://');
  const pending = remote
    ? mainWindow.loadURL(url, { extraHeaders: REMOTE_NO_CACHE_HEADERS })
    : mainWindow.loadURL(url);
  pending.catch((err) => {
    appendStartupLog(`loadURL failed ${url}: ${err instanceof Error ? err.message : String(err)}`);
  });
}

function navigateMainToDeepLink(rawUrl) {
  const parsed = parseKloudMeetDeepLink(rawUrl);
  if (!parsed) return;
  const pathRoom = encodeURIComponent(parsed.room);
  const target = `${getAppPageOrigin()}/rooms/${pathRoom}${parsed.search}`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    loadMainContents(target);
  } else {
    pendingDeepLink = rawUrl;
  }
}

function getInitialMainWindowUrl() {
  const origin = getAppPageOrigin();

  if (pendingDeepLink) {
    const raw = pendingDeepLink;
    pendingDeepLink = null;
    const p = parseKloudMeetDeepLink(raw);
    if (p) return `${origin}/rooms/${encodeURIComponent(p.room)}${p.search}`;
  }
  const argvDeep = getDeepLinkFromArgv(process.argv);
  if (argvDeep) {
    const p = parseKloudMeetDeepLink(argvDeep);
    if (p) return `${origin}/rooms/${encodeURIComponent(p.room)}${p.search}`;
  }
  return origin;
}

function getDeepLinkFromArgv(argv) {
  const hit = argv.find((a) => typeof a === 'string' && a.startsWith('kloudmeet:'));
  return hit || null;
}

function registerKloudMeetProtocol() {
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('kloudmeet', process.execPath, [path.resolve(process.argv[1])]);
      }
    } else {
      app.setAsDefaultProtocolClient('kloudmeet');
    }
  } catch (e) {
    console.warn('setAsDefaultProtocolClient kloudmeet:', e);
  }
}

let sessionAndIpcHandlersInstalled = false;

/**
 * Active screen/window share target for overlay + remote-control mapping.
 * @type {{ sourceId: string, displayId?: number, x: number, y: number, width: number, height: number, scaleFactor: number, kind: 'screen' | 'window' } | null}
 */
let currentShareTarget = null;

function primaryDisplayBoundsFallback() {
  const { screen } = require('electron');
  const b = screen.getPrimaryDisplay().bounds;
  return {
    sourceId: 'primary',
    displayId: screen.getPrimaryDisplay().id,
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    scaleFactor: screen.getPrimaryDisplay().scaleFactor || 1,
    kind: 'screen',
  };
}

/**
 * Resolve desktopCapturer source → physical bounds on the virtual desktop.
 * Screen sources: match display_id. Window sources: fall back to primary (v1).
 */
function resolveShareTargetFromSource(source) {
  const { screen } = require('electron');
  const primary = primaryDisplayBoundsFallback();
  if (!source) return primary;

  const sourceId = String(source.id || '');
  const isScreen = sourceId.startsWith('screen:');
  const displayIdRaw = source.display_id;
  const displayId =
    displayIdRaw !== undefined && displayIdRaw !== null && displayIdRaw !== ''
      ? Number(displayIdRaw)
      : undefined;

  if (isScreen) {
    const displays = screen.getAllDisplays();
    let matched =
      displayId !== undefined && !Number.isNaN(displayId)
        ? displays.find((d) => d.id === displayId)
        : null;
    // Some Electron builds encode display index in screen:N:0
    if (!matched) {
      const m = /^screen:(\d+)/.exec(sourceId);
      if (m) {
        const idx = Number(m[1]);
        if (!Number.isNaN(idx) && displays[idx]) matched = displays[idx];
      }
    }
    if (!matched && displays.length === 1) matched = displays[0];
    if (matched) {
      return {
        sourceId,
        displayId: matched.id,
        x: matched.bounds.x,
        y: matched.bounds.y,
        width: matched.bounds.width,
        height: matched.bounds.height,
        scaleFactor: matched.scaleFactor || 1,
        kind: 'screen',
      };
    }
  }

  // Window share: v1 falls back to primary (RC precision limited)
  return {
    sourceId,
    displayId: primary.displayId,
    x: primary.x,
    y: primary.y,
    width: primary.width,
    height: primary.height,
    scaleFactor: primary.scaleFactor,
    kind: isScreen ? 'screen' : 'window',
  };
}

function applyOverlayToShareTarget(target) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const t = target || primaryDisplayBoundsFallback();
  try {
    overlayWindow.setBounds({
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
    });
  } catch (e) {
    console.warn('overlay setBounds failed:', e);
  }
}

function setCurrentShareTarget(source) {
  currentShareTarget = resolveShareTargetFromSource(source);
  applyOverlayToShareTarget(currentShareTarget);
  return currentShareTarget;
}

function clearCurrentShareTarget() {
  currentShareTarget = null;
  applyOverlayToShareTarget(primaryDisplayBoundsFallback());
}

function installSessionAndIpcOnce() {
  if (sessionAndIpcHandlersInstalled) return;
  sessionAndIpcHandlersInstalled = true;

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      let handled = false;
      const template = sources.map((source) => ({
        label: source.name,
        click: () => {
          handled = true;
          setCurrentShareTarget(source);
          callback({ video: source, audio: 'loopback' });
        },
      }));

      template.push({ type: 'separator' });
      template.push({
        label: 'Cancel',
        click: () => {
          handled = true;
          clearCurrentShareTarget();
          callback();
        },
      });

      const menu = Menu.buildFromTemplate(template);
      const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      if (win) menu.popup({ window: win });

      menu.once('menu-will-close', () => {
        setTimeout(() => {
          if (!handled) {
            handled = true;
            clearCurrentShareTarget();
            callback();
          }
        }, 100);
      });
    }).catch((err) => {
      console.error(err);
      clearCurrentShareTarget();
      callback();
    });
  });

  ipcMain.handle('get-share-target-bounds', () => {
    return currentShareTarget || primaryDisplayBoundsFallback();
  });

  ipcMain.handle('clear-share-target', () => {
    clearCurrentShareTarget();
    return true;
  });

  ipcMain.on('draw-message', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('draw-message', data);
    }
  });

  ipcMain.on('remote-control-message', async (event, data) => {
    try {
      const { mouse, Point, Button } = getNutTree();

      let targetX, targetY;

      // Map content-normalized 0-1 coords onto the active share target bounds
      // (secondary monitor when sharing that screen; primary fallback otherwise).
      const bounds = currentShareTarget || primaryDisplayBoundsFallback();
      const w = bounds.width;
      const h = bounds.height;
      const originX = bounds.x;
      const originY = bounds.y;

      if (data.absX !== undefined && data.absY !== undefined) {
        targetX = Math.round(data.absX);
        targetY = Math.round(data.absY);
      } else {
        targetX = Math.round(originX + (data.x || 0) * w);
        targetY = Math.round(originY + (data.y || 0) * h);
      }

      if (data.type === 'mousemove') {
        await mouse.setPosition(new Point(targetX, targetY));
      } else if (data.type === 'mousedown') {
        const btn = data.button === 2 ? Button.RIGHT : Button.LEFT;
        await mouse.setPosition(new Point(targetX, targetY));
        await mouse.pressButton(btn);
      } else if (data.type === 'mouseup') {
        const btn = data.button === 2 ? Button.RIGHT : Button.LEFT;
        await mouse.setPosition(new Point(targetX, targetY));
        await mouse.releaseButton(btn);
      } else if (data.type === 'dblclick') {
        await mouse.setPosition(new Point(targetX, targetY));
        await mouse.pressButton(Button.LEFT);
        await mouse.releaseButton(Button.LEFT);
        await new Promise((r) => setTimeout(r, 30));
        await mouse.pressButton(Button.LEFT);
        await mouse.releaseButton(Button.LEFT);
      }
    } catch (err) {
      console.error('Remote control error:', err);
    }
  });

}

function createWindows() {
  installSessionAndIpcOnce();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const { width, height } = require('electron').screen.getPrimaryDisplay().bounds;

  overlayWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'pop-up-menu', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  const syncUpdateProgressLayout = () => {
    layoutUpdateProgressWindow();
    raiseUpdateProgressWindow();
  };
  mainWindow.on('move', syncUpdateProgressLayout);
  mainWindow.on('resize', syncUpdateProgressLayout);
  mainWindow.on('focus', syncUpdateProgressLayout);
  mainWindow.on('restore', syncUpdateProgressLayout);

  mainWindow.on('close', () => {
    // 关主窗口 = 退出应用：清掉所有附属窗 + 本地 Next，避免 KloudMeet.exe 残留占 3201
    isAppQuitting = true;
    destroyAllAuxiliaryWindows();
    killNextServerProcess();
    if (process.platform !== 'darwin') {
      setImmediate(() => {
        try {
          app.quit();
        } catch {
          /* ignore */
        }
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  loadMainContents(getInitialMainWindowUrl());
  overlayWindow.loadURL(`${APP_ORIGIN}/overlay.html`);

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    showFatal('页面加载失败', `${code} ${desc}\n${url}`);
  });
}

/**
 * 关掉进度条 / 更新提示 / 标注 overlay，避免关主窗口后仍有 BrowserWindow 拖住进程。
 */
function destroyAllAuxiliaryWindows() {
  destroyUpdateProgressWindow();
  if (updateReadyPromptWindow && !updateReadyPromptWindow.isDestroyed()) {
    try {
      updateReadyPromptWindow.destroy();
    } catch {
      /* ignore */
    }
  }
  updateReadyPromptWindow = null;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try {
      overlayWindow.destroy();
    } catch {
      /* ignore */
    }
  }
  overlayWindow = null;
}

/**
 * 结束内置 Next（ELECTRON_RUN_AS_NODE 子进程在任务管理器里也叫 KloudMeet）。
 * Windows 用 taskkill /T /F 清进程树，避免只杀父进程后 3201 仍被占。
 */
function killNextServerProcess() {
  const child = nextServerProcess;
  nextServerProcess = null;
  if (!child) return;

  const pid = child.pid;
  appendStartupLog(`killNextServerProcess pid=${pid}`);

  try {
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      });
      return;
    }
  } catch (e) {
    appendStartupLog(`taskkill: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    if (!child.killed) child.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }, 1500);
}

function waitForHttpReady(port, timeoutMs = 90000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function ping() {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Next server did not respond on port ${port} within ${timeoutMs}ms`));
        } else {
          setTimeout(ping, 400);
        }
      });
    }
    ping();
  });
}

async function startPackagedNextServer() {
  const standaloneDir = path.join(process.resourcesPath, 'standalone');
  const serverJs = path.join(standaloneDir, 'server.js');
  const runner = path.join(standaloneDir, 'run-next-with-funasr.cjs');
  appendStartupLog(`standaloneDir=${standaloneDir}`);
  if (!fs.existsSync(serverJs) || !fs.existsSync(runner)) {
    throw new Error(`找不到内置服务: ${serverJs} / ${runner}`);
  }

  let stderrBuf = '';
  nextServerProcess = spawn(process.execPath, [runner, 'standalone'], {
    cwd: standaloneDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(APP_PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  nextServerProcess.stdout.on('data', (d) => {
    const s = d.toString();
    appendStartupLog(`[stdout] ${s.trim()}`);
  });
  nextServerProcess.stderr.on('data', (d) => {
    const s = d.toString();
    stderrBuf += s;
    appendStartupLog(`[stderr] ${s.trim()}`);
  });

  nextServerProcess.on('error', (err) => {
    appendStartupLog(`spawn error: ${err.message}`);
  });

  let earlyExitHandler;
  const earlyExit = new Promise((_, reject) => {
    earlyExitHandler = (code) => {
      if (code !== 0 && code !== null) {
        reject(
          new Error(
            `Next 进程已退出（代码 ${code}）。常见原因：3201 端口被占用、或 standalone 目录不完整。\n${stderrBuf.slice(-4000)}`,
          ),
        );
      }
    };
    nextServerProcess.once('exit', earlyExitHandler);
  });

  try {
    await Promise.race([waitForHttpReady(APP_PORT), earlyExit]);
  } catch (e) {
    throw new Error(`${e.message}\n--- stderr ---\n${stderrBuf.slice(-4000)}`);
  } finally {
    if (earlyExitHandler) {
      nextServerProcess.removeListener('exit', earlyExitHandler);
    }
  }

  nextServerProcess.on('exit', (code) => {
    appendStartupLog(`Next process exit code=${code}`);
    if (isAppQuitting) return;
    if (code != null && code !== 0) {
      showFatal('内置网页服务已退出', `退出码 ${code}\n${stderrBuf.slice(-2000)}`);
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const url = getDeepLinkFromArgv(commandLine);
    const hasMain = mainWindow && !mainWindow.isDestroyed();
    if (!hasMain) {
      try {
        createWindows();
      } catch (e) {
        appendStartupLog(`second-instance createWindows: ${e}`);
        return;
      }
    }
    if (url) navigateMainToDeepLink(url);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      navigateMainToDeepLink(url);
    } else {
      pendingDeepLink = url;
    }
  });

  app.whenReady().then(async () => {
    const cachePromise = app.isPackaged ? clearHttpCacheForLatestCode() : Promise.resolve();
    try {
      if (app.isPackaged) {
        await startPackagedNextServer();
      }
    } catch (e) {
      showFatal('Kloud Meet 启动失败', e instanceof Error ? e.message : String(e));
      app.quit();
      return;
    }
    await cachePromise;

    registerKloudMeetProtocol();

    try {
      createWindows();
    } catch (e) {
      showFatal('创建窗口失败', e instanceof Error ? e.message : String(e));
      app.quit();
      return;
    }

    // ── 自动更新（仅打包版；开发模式连本地 Next，不查安装包） ──
    setupAutoUpdater();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindows();
    });
  });
}

process.on('uncaughtException', (err) => {
  showFatal('未捕获异常', err.stack || err.message);
});

app.on('before-quit', () => {
  isAppQuitting = true;
  clearUpdateCheckTimer();
  destroyAllAuxiliaryWindows();
  killNextServerProcess();
});

app.on('will-quit', () => {
  isAppQuitting = true;
  killNextServerProcess();
});

app.on('window-all-closed', () => {
  isAppQuitting = true;
  killNextServerProcess();
  // Windows / Linux：无窗口即退出；macOS 保持常驻（菜单栏）
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
