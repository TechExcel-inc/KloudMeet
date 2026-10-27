const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu, dialog, shell, globalShortcut } = require('electron');
const crypto = require('crypto');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// The package is still named livekit-meet, and Electron shows that name until a page sets its own
// title (window title, "Quit …" in the Mac app menu). Show Kloud Meet instead, but keep the data
// folder named after the package so people stay signed in and keep their settings.
const userDataDir = app.getPath('userData');
app.setName('Kloud Meet');
app.setPath('userData', userDataDir);

const APP_PORT = 3201;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;

// In packaged builds, load the remote server directly (no local Next.js needed).
// In dev mode, APP_ORIGIN (local Next.js) is used as usual.
const REMOTE_ORIGIN = testOriginOverride() || 'https://meet.kloud.cn';

/**
 * Test builds: KLOUDMEET_APP_ORIGIN=http://localhost:3210 points the packaged app at a local or
 * staging server (https, or http on localhost only). Unset in normal use.
 */
function testOriginOverride() {
  const raw = process.env.KLOUDMEET_APP_ORIGIN;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin;
  } catch {
    /* ignore */
  }
  return null;
}
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
    const { mouse, keyboard, Point, Button, Key } = require('@nut-tree-fork/nut-js');
    mouse.config.autoDelayMs = 0;
    mouse.config.mouseSpeed = 3000;
    keyboard.config.autoDelayMs = 0;
    nutApi = { mouse, keyboard, Point, Button, Key };
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
 * macOS: a window can only float over another app's full-screen Space while this app is a UI
 * element — no Dock icon, no menu bar, so no ⌘Q or ⌘Tab either. Be one only while a share is
 * on (its annotation overlay and the remote-control bar must stay visible) and a normal app the
 * rest of the time; an update download is not worth losing the Dock for. The windows set their
 * full-screen collection behaviour with skipTransformProcessType, so creating them changes nothing.
 * @type {Set<string>}
 */
const floatingReasons = new Set();
const DOCK_TOGGLE_SETTLE_MS = 1100;
/** @type {ReturnType<typeof setTimeout> | null} */
let dockReconcileTimer = null;

function setFloatingReason(reason, on) {
  if (process.platform !== 'darwin' || !app.dock) return;
  if (on) floatingReasons.add(reason);
  else floatingReasons.delete(reason);
  reconcileDock();
}

function reconcileDock() {
  if (process.platform !== 'darwin' || !app.dock) return;
  const wantHidden = floatingReasons.size > 0 && !isAppQuitting;
  if (wantHidden === !app.dock.isVisible()) return;
  if (wantHidden) {
    app.dock.hide();
    refloatWindows();
  } else {
    app.dock.show().catch(() => {});
  }
  // Electron ignores a hide within a second of a show; check again once that has passed.
  if (dockReconcileTimer) clearTimeout(dockReconcileTimer);
  dockReconcileTimer = setTimeout(() => {
    dockReconcileTimer = null;
    const hidden = !app.dock.isVisible();
    if (hidden !== (floatingReasons.size > 0 && !isAppQuitting)) reconcileDock();
  }, DOCK_TOGGLE_SETTLE_MS);
}

/** Visible on every Space, including full-screen ones, without touching the Dock. */
function floatOnAllSpaces(win) {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
}

/** Electron hides the Dock before setting full-screen behaviour; do the same once hidden. */
function refloatWindows() {
  for (const win of [overlayWindow, rcBarWindow, updateProgressWindow, miniWindow]) {
    if (!win || win.isDestroyed()) continue;
    try {
      floatOnAllSpaces(win);
    } catch {
      /* ignore */
    }
  }
}

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
    floatOnAllSpaces(updateProgressWindow);
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

/**
 * Google sign-in for the desktop app, the way Claude's desktop app does it: Google refuses
 * sign-in inside embedded windows, so the app opens the system browser and gets back a
 * one-time code via kloudmeet://auth?code=…, which it redeems with a PKCE verifier only it knows.
 */
const GOOGLE_SIGN_IN_TTL_MS = 15 * 60 * 1000;
/** @type {{ verifier: string, startedAt: number } | null} */
let pendingGoogleSignIn = null;

function isGoogleSignInStart(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.origin === getAppPageOrigin() && u.pathname === '/api/auth/google';
  } catch {
    return false;
  }
}

function startGoogleSignInInBrowser(rawUrl) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  pendingGoogleSignIn = { verifier, startedAt: Date.now() };

  const params = new URLSearchParams({ desktop: challenge });
  try {
    const next = new URL(rawUrl).searchParams.get('next');
    if (next) params.set('next', next);
  } catch {
    /* no next */
  }
  shell.openExternal(`${getAppPageOrigin()}/api/auth/google?${params.toString()}`).catch((e) => {
    appendStartupLog(`openExternal google sign-in failed: ${e instanceof Error ? e.message : String(e)}`);
  });
}

function parseAuthDeepLink(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'kloudmeet:' || u.hostname !== 'auth') return null;
    const code = u.searchParams.get('code');
    return code ? { code } : null;
  } catch {
    return null;
  }
}

async function completeGoogleSignIn(code) {
  const origin = getAppPageOrigin();
  const pending = pendingGoogleSignIn;
  pendingGoogleSignIn = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  const fail = (message) => loadMainContents(`${origin}/?${new URLSearchParams({ error: message }).toString()}`);

  if (!pending || Date.now() - pending.startedAt > GOOGLE_SIGN_IN_TTL_MS) {
    fail('Google sign-in expired. Please try again.');
    return;
  }
  try {
    const res = await fetch(`${origin}/api/auth/desktop/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier: pending.verifier }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || typeof data.token !== 'string') {
      fail((data && data.error) || 'Google sign-in failed. Please try again.');
      return;
    }
    const params = new URLSearchParams({ sso_token: data.token });
    if (typeof data.next === 'string' && data.next) params.set('next', data.next);
    loadMainContents(`${origin}/?${params.toString()}`);
  } catch (e) {
    appendStartupLog(`google sign-in exchange failed: ${e instanceof Error ? e.message : String(e)}`);
    fail('Network error. Please try again.');
  }
}

/** Routes any kloudmeet:// link: auth hand-off, else meeting join. */
function handleDeepLink(rawUrl) {
  const auth = parseAuthDeepLink(rawUrl);
  if (!auth) {
    navigateMainToDeepLink(rawUrl);
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    void reopenMainWindow().then(() => {
      if (mainWindow && !mainWindow.isDestroyed()) void completeGoogleSignIn(auth.code);
      else appendStartupLog('auth deep link: no window to sign in');
    });
    return;
  }
  void completeGoogleSignIn(auth.code);
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
  // Before the capture starts, or macOS lets viewers see the bar (see ensureRcBarWindow)
  ensureRcBarWindow();
  applyOverlayToShareTarget(currentShareTarget);
  setFloatingReason('share', true);
  appendStartupLog(`[share] start ${currentShareTarget.kind} ${currentShareTarget.width}x${currentShareTarget.height}`);
  return currentShareTarget;
}

function clearCurrentShareTarget() {
  if (currentShareTarget) appendStartupLog('[share] stop');
  currentShareTarget = null;
  applyOverlayToShareTarget(primaryDisplayBoundsFallback());
  setFloatingReason('share', false);
}

/**
 * A shared screen has been seen to freeze on macOS (the picture stops while the share stays on).
 * Log what the system does during a share so the next report says what happened at that moment.
 */
function watchShareInterruptions() {
  const { screen, powerMonitor } = require('electron');
  const note = (what) => {
    if (currentShareTarget) appendStartupLog(`[share] ${what}`);
  };
  screen.on('display-added', () => note('display added'));
  screen.on('display-removed', () => note('display removed'));
  screen.on('display-metrics-changed', (_e, _display, changed) => note(`display changed: ${changed.join(',')}`));
  for (const event of ['suspend', 'resume', 'lock-screen', 'unlock-screen']) {
    powerMonitor.on(event, () => note(event));
  }
}

function installSessionAndIpcOnce() {
  if (sessionAndIpcHandlersInstalled) return;
  sessionAndIpcHandlersInstalled = true;
  watchShareInterruptions();
  installMiniWindowIpc();

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

  ipcMain.on('remote-control-session', (event, session) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    setRemoteControlSession(session);
  });

  ipcMain.on('remote-control-request', (event, request) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    setRemoteControlRequest(request);
  });

  ipcMain.on('rc-bar-answer', (event, allow) => {
    if (!rcBarWindow || rcBarWindow.isDestroyed() || event.sender !== rcBarWindow.webContents) return;
    if (!rcRequest) return;
    setRemoteControlRequest(null);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('remote-control-answer', allow === true);
  });

  ipcMain.on('rc-bar-accessibility', (event) => {
    if (!rcBarWindow || rcBarWindow.isDestroyed() || event.sender !== rcBarWindow.webContents) return;
    openAccessibilitySettings();
  });

  ipcMain.on('rc-bar-stop', (event) => {
    if (!rcBarWindow || rcBarWindow.isDestroyed() || event.sender !== rcBarWindow.webContents) return;
    stopRemoteControlFromPresenter('bar');
  });

  ipcMain.on('remote-control-message', async (event, data) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    // Only while control is granted (older pages: mouse only, as before), and not while the
    // presenter is using their own mouse.
    if (!remoteInput.acceptRemoteInput(rcSession, data, Date.now())) return;
    const limiter = rcLimiters[remoteInput.limiterFor(data.type)];
    if (!limiter || !limiter()) return;

    // Events still queued when control stops are dropped, not executed.
    const generation = rcGeneration;
    rcQueue = rcQueue
      .then(() => (generation === rcGeneration ? executeRemoteInput(data) : undefined))
      .catch((err) => {
        console.error('Remote control error:', err);
      });
  });

}

/* ── Remote control (presenter side) ─────────────────────────────────────── */

const remoteInput = require('./remote-input');

/** protocol: the meeting page reports sessions; active: someone is in control right now. */
const rcSession = { protocol: false, active: false, controllerName: '', pausedUntil: 0 };
const rcLimiters = {
  pointer: remoteInput.createRateLimiter(150, 1000),
  wheel: remoteInput.createRateLimiter(60, 1000),
  key: remoteInput.createRateLimiter(30, 1000),
  text: remoteInput.createRateLimiter(20, 1000),
};
/** Execute one event at a time, in order. */
let rcQueue = Promise.resolve();
/** Bumped whenever control ends, so queued events from the old session are skipped. */
let rcGeneration = 0;
const rcPressedButtons = new Set();
let rcLastInjected = null;
let rcLastInjectAt = 0;
let rcLocalWatch = null;
let rcLastSeen = null;
let rcBarWindow = null;

function rcTarget(data) {
  // Map content-normalized 0-1 coords onto the active share target bounds
  // (secondary monitor when sharing that screen; primary fallback otherwise), never outside it.
  const bounds = currentShareTarget || primaryDisplayBoundsFallback();
  return remoteInput.toScreenPoint(data, bounds, !rcSession.protocol);
}

async function rcMoveTo(mouse, Point, target) {
  rcLastInjected = target;
  rcLastInjectAt = Date.now();
  await mouse.setPosition(new Point(target.x, target.y));
  rcLastInjectAt = Date.now();
}

async function executeRemoteInput(data) {
  const { mouse, keyboard, Point, Button, Key } = getNutTree();

  if (data.type === 'key') {
    const keys = remoteInput.toNutKeys({ key: data.key, mods: data.mods }, process.platform, Key);
    if (!keys) return;
    await keyboard.pressKey(...keys);
    await keyboard.releaseKey(...keys.slice().reverse());
    return;
  }
  if (data.type === 'text') {
    const text = remoteInput.sanitizeText(data.text);
    if (text) await keyboard.type(text);
    return;
  }

  const target = rcTarget(data);
  if (data.type === 'mousemove') {
    await rcMoveTo(mouse, Point, target);
  } else if (data.type === 'mousedown') {
    const btn = data.button === 2 ? Button.RIGHT : Button.LEFT;
    await rcMoveTo(mouse, Point, target);
    await mouse.pressButton(btn);
    rcPressedButtons.add(btn);
  } else if (data.type === 'mouseup') {
    const btn = data.button === 2 ? Button.RIGHT : Button.LEFT;
    await rcMoveTo(mouse, Point, target);
    await mouse.releaseButton(btn);
    rcPressedButtons.delete(btn);
  } else if (data.type === 'dblclick') {
    await rcMoveTo(mouse, Point, target);
    await mouse.pressButton(Button.LEFT);
    await mouse.releaseButton(Button.LEFT);
    await new Promise((r) => setTimeout(r, 30));
    await mouse.pressButton(Button.LEFT);
    await mouse.releaseButton(Button.LEFT);
  } else if (data.type === 'wheel') {
    const { down, right } = remoteInput.wheelSteps(data.dx, data.dy, process.platform);
    if (!down && !right) return;
    await rcMoveTo(mouse, Point, target);
    if (down > 0) await mouse.scrollDown(down);
    else if (down < 0) await mouse.scrollUp(-down);
    if (right > 0) await mouse.scrollRight(right);
    else if (right < 0) await mouse.scrollLeft(-right);
  }
}

/**
 * macOS drops injected input silently unless this app has Accessibility. Checked when a session
 * starts (asking macOS to show its prompt once); the bar says so and links to the setting.
 */
let rcNeedsAccessibility = false;
/** @type {ReturnType<typeof setInterval> | null} */
let rcAccessibilityPoll = null;

function checkAccessibilityForRemoteControl(prompt) {
  if (process.platform !== 'darwin') return true;
  const { systemPreferences } = require('electron');
  const trusted = systemPreferences.isTrustedAccessibilityClient(!!prompt);
  rcNeedsAccessibility = !trusted;
  if (!trusted) {
    appendStartupLog('[remote-control] Accessibility is off: input will not reach other apps');
    // Turned on in System Settings mid-session: clear the notice as soon as it takes effect.
    if (!rcAccessibilityPoll) {
      rcAccessibilityPoll = setInterval(() => {
        if (!rcSession.active || systemPreferences.isTrustedAccessibilityClient(false)) {
          stopAccessibilityPoll();
          rcNeedsAccessibility = false;
          sendRcBarState();
        }
      }, 2000);
    }
  }
  return trusted;
}

function stopAccessibilityPoll() {
  if (rcAccessibilityPoll) clearInterval(rcAccessibilityPoll);
  rcAccessibilityPoll = null;
}

function openAccessibilitySettings() {
  shell
    .openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    .catch(() => {});
}

function setRemoteControlSession(session) {
  rcSession.protocol = true;
  const active = !!(session && session.active);
  const name = session && typeof session.controllerName === 'string' ? session.controllerName.slice(0, 80) : '';
  const wasActive = rcSession.active;
  rcSession.active = active;
  rcSession.controllerName = active ? name : '';
  rcSession.pausedUntil = 0;
  if (active) {
    if (!wasActive) {
      try {
        globalShortcut.register(remoteInput.STOP_SHORTCUT, () => stopRemoteControlFromPresenter('shortcut'));
      } catch (e) {
        console.warn('remote-control stop shortcut not registered:', e);
      }
      startLocalMouseWatch();
      checkAccessibilityForRemoteControl(true);
    }
    setFloatingReason('remote-control', true);
    showRcBar();
  } else if (wasActive) {
    endRemoteControlLocally();
  }
}

/** Release anything the controller left pressed and drop the banner + shortcut. */
function endRemoteControlLocally() {
  rcGeneration += 1;
  rcSession.active = false;
  stopAccessibilityPoll();
  rcSession.controllerName = '';
  try {
    globalShortcut.unregister(remoteInput.STOP_SHORTCUT);
  } catch {
    /* ignore */
  }
  stopLocalMouseWatch();
  if (rcRequest) sendRcBarState();
  else hideRcBar();
  setFloatingReason('remote-control', false);
  // Runs after an event that is mid-execution, so a button it just pressed is released too.
  rcQueue = rcQueue
    .then(async () => {
      const pressed = Array.from(rcPressedButtons);
      rcPressedButtons.clear();
      if (!pressed.length) return;
      const { mouse } = getNutTree();
      for (const btn of pressed) await mouse.releaseButton(btn);
    })
    .catch(() => {});
}

/** Presenter pressed the shortcut or the bar's Stop: stop executing at once, then tell the page. */
function stopRemoteControlFromPresenter(reason) {
  if (!rcSession.active) return;
  endRemoteControlLocally();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('remote-control-stopped', reason);
  }
}

/**
 * The presenter's own mouse wins: when the cursor moves without us moving it, remote input
 * pauses until the presenter has kept still for a moment.
 */
function startLocalMouseWatch() {
  stopLocalMouseWatch();
  rcLastSeen = null;
  rcLocalWatch = setInterval(async () => {
    if (!rcSession.active) return;
    try {
      const { mouse } = getNutTree();
      const pos = await mouse.getPosition();
      const prev = rcLastSeen;
      rcLastSeen = { x: pos.x, y: pos.y };
      if (!prev || Date.now() - rcLastInjectAt < 250) return;
      const nearInjected = rcLastInjected && Math.hypot(pos.x - rcLastInjected.x, pos.y - rcLastInjected.y) < 4;
      if (Math.hypot(pos.x - prev.x, pos.y - prev.y) > 4 && !nearInjected) {
        const wasPaused = Date.now() < rcSession.pausedUntil;
        rcSession.pausedUntil = Date.now() + 1500;
        if (!wasPaused) sendRcBarState();
      } else if (rcSession.pausedUntil && Date.now() >= rcSession.pausedUntil) {
        rcSession.pausedUntil = 0;
        sendRcBarState();
      }
    } catch {
      /* ignore */
    }
  }, 120);
}

function stopLocalMouseWatch() {
  if (rcLocalWatch) clearInterval(rcLocalWatch);
  rcLocalWatch = null;
}

/*
 * Floating bar on the shared screen: who is in control + Stop, or a waiting control request
 * with Allow / Deny (the meeting window is usually behind the app being shared).
 * Hidden from the capture.
 */
const RC_BAR_WIDTH = 540;
const RC_BAR_HEIGHT = 52;

/** @type {{ name: string } | null} */
let rcRequest = null;

function rcBarNeeded() {
  return rcSession.active || !!rcRequest;
}

function sendRcBarState() {
  if (!rcBarWindow || rcBarWindow.isDestroyed()) return;
  rcBarWindow.webContents.send('rc-bar-state', {
    name: rcSession.controllerName,
    paused: Date.now() < rcSession.pausedUntil,
    shortcut: process.platform === 'darwin' ? '⌃⌥S' : remoteInput.STOP_SHORTCUT.replace('Control', 'Ctrl'),
    request: !rcSession.active && rcRequest ? { name: rcRequest.name } : null,
    needsAccessibility: rcSession.active && rcNeedsAccessibility,
  });
}

function setRemoteControlRequest(request) {
  const name = request && typeof request.name === 'string' ? request.name.slice(0, 80) : '';
  rcRequest = request ? { name } : null;
  if (rcBarNeeded()) showRcBar();
  else hideRcBar();
}

function rcBarBounds() {
  const bounds = currentShareTarget || primaryDisplayBoundsFallback();
  return {
    x: Math.round(bounds.x + (bounds.width - RC_BAR_WIDTH) / 2),
    y: Math.round(bounds.y + 14),
    width: RC_BAR_WIDTH,
    height: RC_BAR_HEIGHT,
  };
}

/**
 * Creates the (hidden) bar window if it is missing. macOS keeps a content-protected window out of
 * a screen capture only if the window already existed when the capture started; one created
 * mid-share is captured anyway. So a share creates it up front, before the capture begins.
 */
function ensureRcBarWindow() {
  if (rcBarWindow && !rcBarWindow.isDestroyed()) return;
  rcBarWindow = new BrowserWindow({
    ...rcBarBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    acceptFirstMouse: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'rc-bar-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  rcBarWindow.setAlwaysOnTop(true, 'screen-saver', 2);
  floatOnAllSpaces(rcBarWindow);
  // Viewers see the shared screen, not the presenter's controls.
  rcBarWindow.setContentProtection(true);
  rcBarWindow.on('closed', () => {
    rcBarWindow = null;
  });
  rcBarWindow.webContents.on('did-finish-load', sendRcBarState);
  rcBarWindow.once('ready-to-show', () => {
    if (rcBarNeeded() && rcBarWindow && !rcBarWindow.isDestroyed()) rcBarWindow.showInactive();
  });
  rcBarWindow.loadFile(path.join(__dirname, 'rc-bar.html')).catch((e) => {
    console.warn('rc-bar load failed:', e);
  });
}

function showRcBar() {
  if (!rcBarWindow || rcBarWindow.isDestroyed()) {
    // ready-to-show shows it once loaded
    ensureRcBarWindow();
    return;
  }
  rcBarWindow.setBounds(rcBarBounds());
  if (!rcBarWindow.isVisible()) rcBarWindow.showInactive();
  sendRcBarState();
}

function hideRcBar() {
  if (rcBarWindow && !rcBarWindow.isDestroyed()) rcBarWindow.hide();
}

/*
 * Meeting mini window. The meeting page opens it with window.open('about:blank', MINI_WINDOW_NAME)
 * and renders into it the same panel the browser shows in Document Picture-in-Picture. It stays out
 * of screen captures: viewers see the shared screen, not the presenter's meeting. macOS honours
 * that only for a window that already existed when the capture started, so the page opens it hidden
 * as the meeting starts and from then on only shows and hides it; it goes when the page leaves.
 */
const MINI_WINDOW_NAME = 'kloud-meet-mini';
const MINI_WINDOW_MARGIN = 16;
/** @type {BrowserWindow | null} */
let miniWindow = null;
/** The page is done with it (left the meeting); otherwise closing it only hides it */
let miniWindowMayClose = false;
/** Placed once in the corner; after that it stays wherever the user drags it */
let miniWindowPlaced = false;

function miniWindowOptions() {
  return {
    width: 240,
    height: 60,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    title: 'Kloud Meet',
  };
}

function miniWindowWorkArea() {
  const { screen } = require('electron');
  const ref = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : null;
  const display = ref ? screen.getDisplayMatching(ref) : screen.getPrimaryDisplay();
  return display.workArea;
}

/** Bottom-right corner of the screen the meeting is on */
function placeMiniWindow(win) {
  const area = miniWindowWorkArea();
  const { width, height } = win.getBounds();
  win.setBounds({
    x: Math.round(area.x + area.width - width - MINI_WINDOW_MARGIN),
    y: Math.round(area.y + area.height - height - MINI_WINDOW_MARGIN),
    width,
    height,
  });
  miniWindowPlaced = true;
}

/** New size keeping the bottom-right corner where it is, so the pill grows upward into the panel */
function resizeMiniWindow(width, height) {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const w = Math.round(Math.min(Math.max(width, 120), 800));
  const h = Math.round(Math.min(Math.max(height, 40), 900));
  const b = miniWindow.getBounds();
  const area = miniWindowWorkArea();
  const x = Math.min(Math.max(b.x + b.width - w, area.x), area.x + area.width - w);
  const y = Math.min(Math.max(b.y + b.height - h, area.y), area.y + area.height - h);
  miniWindow.setBounds({ x, y, width: w, height: h });
}

function setupMiniWindow(win) {
  if (miniWindow && miniWindow !== win && !miniWindow.isDestroyed()) {
    miniWindowMayClose = true;
    miniWindow.destroy();
  }
  miniWindow = win;
  miniWindowMayClose = false;
  miniWindowPlaced = false;
  // Viewers see the shared screen, not the presenter's meeting
  win.setContentProtection(true);
  win.setAlwaysOnTop(true, 'floating');
  floatOnAllSpaces(win);
  win.on('close', (event) => {
    if (miniWindowMayClose || isAppQuitting) return;
    // ⌘W and the like hide it; the page decides when it really goes
    event.preventDefault();
    win.hide();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mini-window-hidden');
  });
  win.on('closed', () => {
    if (miniWindow === win) miniWindow = null;
  });
}

function destroyMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindowMayClose = true;
    try {
      miniWindow.destroy();
    } catch {
      /* ignore */
    }
  }
  miniWindow = null;
}

function installMiniWindowIpc() {
  ipcMain.on('mini-window', (event, action) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
    const win = miniWindow && !miniWindow.isDestroyed() ? miniWindow : null;
    if (action === 'show' && win) {
      if (!miniWindowPlaced) placeMiniWindow(win);
      // Without taking focus from whatever the presenter is showing
      if (!win.isVisible()) win.showInactive();
    } else if (action === 'hide' && win) {
      win.hide();
    } else if (action === 'dispose') {
      miniWindowMayClose = true;
    } else if (action === 'focus-main') {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
    }
  });
  ipcMain.on('mini-window-size', (event, size) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
    const width = Number(size && size.width);
    const height = Number(size && size.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    resizeMiniWindow(width, height);
  });
}

function createWindows() {
  installSessionAndIpcOnce();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Kloud Meet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The meeting's mini window (see setupMiniWindow); other window.open calls behave as before
  mainWindow.webContents.setWindowOpenHandler(({ frameName, url }) => {
    if (frameName === MINI_WINDOW_NAME && (url === 'about:blank' || url === '')) {
      return { action: 'allow', overrideBrowserWindowOptions: miniWindowOptions() };
    }
    return { action: 'allow' };
  });
  mainWindow.webContents.on('did-create-window', (win, details) => {
    if (details.frameName === MINI_WINDOW_NAME) setupMiniWindow(win);
  });

  // "Continue with Google" → system browser (Google blocks sign-in in embedded windows).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isGoogleSignInStart(url)) return;
    event.preventDefault();
    startGoogleSignInInBrowser(url);
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
  floatOnAllSpaces(overlayWindow);
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
    if (currentShareTarget) clearCurrentShareTarget();
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

  // A reload or navigation drops the meeting page without telling us the session ended.
  const meetingPageGone = () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
    rcRequest = null;
    endRemoteControlLocally();
    if (currentShareTarget) clearCurrentShareTarget();
  };
  mainWindow.webContents.on('did-navigate', meetingPageGone);
  mainWindow.webContents.on('render-process-gone', meetingPageGone);
  // Leaving the room inside the page (no reload) ends any share too.
  mainWindow.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return; // LiveDoc / Design iframes route on their own
    try {
      if (!new URL(url).pathname.startsWith('/rooms/')) meetingPageGone();
    } catch {
      /* ignore */
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
  rcRequest = null;
  endRemoteControlLocally();
  if (rcBarWindow && !rcBarWindow.isDestroyed()) {
    try {
      rcBarWindow.destroy();
    } catch {
      /* ignore */
    }
  }
  rcBarWindow = null;
  destroyMiniWindow();
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

/** @type {Promise<void> | null} */
let reopenInFlight = null;

/** Resolves once nothing answers on the port (the previous local server has exited), or after ~4 s. */
function waitForPortFree(port, timeoutMs = 4000) {
  const net = require('net');
  const started = Date.now();
  return new Promise((resolve) => {
    const probe = () => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) resolve();
        else setTimeout(probe, 150);
      });
      socket.once('error', () => resolve());
    };
    probe();
  });
}

/**
 * The main window is gone (closed on macOS) and something needs it again — a Dock click, a
 * deep link, a second launch: local server first, then the windows.
 */
function reopenMainWindow() {
  if (reopenInFlight) return reopenInFlight;
  reopenInFlight = (async () => {
    isAppQuitting = false;
    try {
      if (app.isPackaged && !nextServerProcess) {
        await waitForPortFree(APP_PORT);
        await startPackagedNextServer();
      }
      if (BrowserWindow.getAllWindows().length === 0) createWindows();
    } catch (e) {
      showFatal('Kloud Meet 启动失败', e instanceof Error ? e.message : String(e));
    }
  })().finally(() => {
    reopenInFlight = null;
  });
  return reopenInFlight;
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
      void reopenMainWindow().then(() => {
        if (url) handleDeepLink(url);
      });
      return;
    }
    if (url) handleDeepLink(url);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (parseAuthDeepLink(url)) {
      // A hand-off only makes sense for a sign-in this running app started.
      if (app.isReady()) handleDeepLink(url);
      return;
    }
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

    // macOS keeps the app in the Dock after its window closes; closing stopped the local server
    // the overlay pages come from, so start it again before reopening.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void reopenMainWindow();
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
