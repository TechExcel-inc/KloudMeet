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
/** 对齐主窗口右上角的更新下载进度（仅打包环境使用） */
let updateProgressWindow;
/** 更新下载完成后的「立即重启」模态窗 */
let updateReadyPromptWindow;

const UPDATE_PROGRESS_W = 208;
const UPDATE_PROGRESS_H = 44;
const UPDATE_PROGRESS_MARGIN = 10;
/** 相对内容区顶部下移，避开页面内常见顶栏／右上角按钮 */
const UPDATE_PROGRESS_TOP_INSET = 44;

/** @type {{ percent: number } | null} */
let pendingUpdateProgressPayload = null;

/** 避免 download-progress 与 update-downloaded 连续两次 100% 等重复帧 */
let lastUpdaterProgressRounded = -1;

/** 同一次下载只弹一次安装确认（electron-updater 偶发重复事件） */
let updateDownloadedDialogShown = false;

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
  updateProgressWindow.setBounds({
    x: cb.x + cb.width - UPDATE_PROGRESS_W - UPDATE_PROGRESS_MARGIN,
    y: cb.y + UPDATE_PROGRESS_TOP_INSET,
    width: UPDATE_PROGRESS_W,
    height: UPDATE_PROGRESS_H,
  });
}

function destroyUpdateProgressWindow() {
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
    layoutUpdateProgressWindow();
    raiseUpdateProgressWindow();
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
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'update-progress-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  raiseUpdateProgressWindow();

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

function navigateMainToDeepLink(rawUrl) {
  const parsed = parseKloudMeetDeepLink(rawUrl);
  if (!parsed) return;
  const pathRoom = encodeURIComponent(parsed.room);
  const target = `${APP_ORIGIN}/rooms/${pathRoom}${parsed.search}`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.loadURL(target);
  } else {
    pendingDeepLink = rawUrl;
  }
}

function getInitialMainWindowUrl() {
  // In packaged builds, always load the remote server directly.
  const origin = app.isPackaged ? REMOTE_ORIGIN : APP_ORIGIN;

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

  const syncUpdateProgressLayout = () => layoutUpdateProgressWindow();
  mainWindow.on('move', syncUpdateProgressLayout);
  mainWindow.on('resize', syncUpdateProgressLayout);

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

  mainWindow.loadURL(getInitialMainWindowUrl());
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
  appendStartupLog(`standaloneDir=${standaloneDir}`);
  if (!fs.existsSync(serverJs)) {
    throw new Error(`找不到内置服务: ${serverJs}`);
  }

  let stderrBuf = '';
  nextServerProcess = spawn(process.execPath, [serverJs], {
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
    try {
      if (app.isPackaged) {
        await startPackagedNextServer();
      }
    } catch (e) {
      showFatal('Kloud Meet 启动失败', e instanceof Error ? e.message : String(e));
      app.quit();
      return;
    }

    registerKloudMeetProtocol();

    try {
      createWindows();
    } catch (e) {
      showFatal('创建窗口失败', e instanceof Error ? e.message : String(e));
      app.quit();
      return;
    }

    // ── 自动更新 ──────────────────────────────────────────────
    if (app.isPackaged) {
      autoUpdater.logger = {
        info:  (msg) => appendStartupLog(`[updater] ${msg}`),
        warn:  (msg) => appendStartupLog(`[updater][warn] ${msg}`),
        error: (msg) => appendStartupLog(`[updater][error] ${msg}`),
      };

      // NSIS 默认先差分再必要时全量，两阶段各自 0→100%，角标会像跑两遍；关差分只拉整包，进度连续（流量略增）。
      autoUpdater.disableDifferentialDownload = true;

      autoUpdater.on('update-available', (info) => {
        updateDownloadedDialogShown = false;
        // 立刻占住 overlay hide + 弹出进度条，避免点「好的」后全屏 overlay 盖住进度
        ensureUpdateProgressWindow();
        broadcastUpdateDownloadProgress({ percent: 0 });
        appendStartupLog(`[updater] update-available ${info.version}, showing progress chip`);
        showUpdaterMessageBox({
          type: 'info',
          title: '发现新版本',
          message: `Kloud Meet ${info.version} 已发布，正在后台下载…`,
          buttons: ['好的'],
        }).catch(() => {});
      });

      autoUpdater.on('download-progress', (p) => {
        ensureUpdateProgressWindow();
        broadcastUpdateDownloadProgress({ percent: pctFromUpdaterProgress(p) });
      });

      autoUpdater.on('update-downloaded', (info) => {
        if (updateDownloadedDialogShown) return;
        updateDownloadedDialogShown = true;
        // 先占住 update-ready，再关进度条，避免 overlay 中间闪一下
        acquireOverlayHide('update-ready');
        destroyUpdateProgressWindow();
        appendStartupLog(`[updater] update-downloaded ${info.version}, opening install prompt`);
        showUpdateReadyPrompt(info.version)
          .then((install) => {
            if (install) {
              try {
                autoUpdater.quitAndInstall();
              } catch (e) {
                appendStartupLog(`quitAndInstall: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          })
          .catch((e) => {
            appendStartupLog(`showUpdateReadyPrompt: ${e instanceof Error ? e.message : String(e)}`);
          });
      });

      autoUpdater.on('error', (err) => {
        appendStartupLog(`autoUpdater error: ${err.message}`);
        destroyUpdateProgressWindow();
      });

      // 启动后延迟 5 秒检查，避免影响启动速度
      setTimeout(() => autoUpdater.checkForUpdates(), 5000);
    }

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
