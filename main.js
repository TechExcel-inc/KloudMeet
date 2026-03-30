const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');

const APP_PORT = 3201;
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;

// In packaged builds, load the remote server directly (no local Next.js needed).
// In dev mode, APP_ORIGIN (local Next.js) is used as usual.
const REMOTE_ORIGIN = 'https://meet.kloud.cn';

let nextServerProcess;

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

function installSessionAndIpcOnce() {
  if (sessionAndIpcHandlersInstalled) return;
  sessionAndIpcHandlersInstalled = true;

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      let handled = false;
      const template = sources.map(source => ({
        label: source.name,
        click: () => {
          handled = true;
          callback({ video: source, audio: 'loopback' });
        },
      }));

      template.push({ type: 'separator' });
      template.push({
        label: 'Cancel',
        click: () => {
          handled = true;
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
            callback();
          }
        }, 100);
      });
    }).catch((err) => {
      console.error(err);
      callback();
    });
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

      if (data.absX !== undefined && data.absY !== undefined) {
        // New protocol: controller sends absolute screen coordinates directly
        targetX = Math.round(data.absX);
        targetY = Math.round(data.absY);
      } else {
        // Legacy fallback: normalized 0-1 mapped to primary display
        const { width: w, height: h } = require('electron').screen.getPrimaryDisplay().bounds;
        targetX = Math.round(data.x * w);
        targetY = Math.round(data.y * h);
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

  mainWindow.on('close', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.destroy();
      overlayWindow = null;
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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindows();
    });
  });
}

process.on('uncaughtException', (err) => {
  showFatal('未捕获异常', err.stack || err.message);
});

app.on('before-quit', () => {
  if (nextServerProcess && !nextServerProcess.killed) {
    nextServerProcess.kill();
    nextServerProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
