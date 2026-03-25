const { app, BrowserWindow, ipcMain, desktopCapturer, session, Menu } = require('electron');
const path = require('path');
const { mouse, Point, Button } = require('@nut-tree-fork/nut-js');

// Fast movement without delay to avoid massive queuing of mouse events
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 3000;

let mainWindow;
let overlayWindow;

function createWindows() {
  // Allow getDisplayMedia() to work in Electron with a source picker
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      let handled = false;
      const template = sources.map(source => ({
        label: source.name,
        click: () => {
          handled = true;
          callback({ video: source, audio: 'loopback' });
        }
      }));

      template.push({ type: 'separator' });
      template.push({
        label: 'Cancel',
        click: () => {
          handled = true;
          callback(); // Resolves getting display media with failure/cancellation
        }
      });

      const menu = Menu.buildFromTemplate(template);
      menu.popup({ window: mainWindow });

      menu.once('menu-will-close', () => {
        setTimeout(() => {
          if (!handled) {
            handled = true;
            callback();
          }
        }, 100);
      });
    }).catch(err => {
      console.error(err);
      callback();
    });
  });

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
    focusable: false, // Prevents stealing the app's focus, which breaks Cmd+Tab on Mac
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 'pop-up-menu' floats over full screen apps without breaking the macOS application switcher
  overlayWindow.setAlwaysOnTop(true, 'pop-up-menu', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Enable click-through so user can interact with their actual desktop
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // Load the Next.js app in the main window
  mainWindow.loadURL('http://localhost:3201');

  // Load the transparent canvas HTML in the overlay window
  // The public folder in Next.js serves static files directly!
  overlayWindow.loadURL('http://localhost:3201/overlay.html');

  // IPC Bridge: When Main Window sends a draw command, forward it to Overlay
  ipcMain.on('draw-message', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('draw-message', data);
    }
  });

  // IPC Bridge: Remote Control Simulation
  ipcMain.on('remote-control-message', async (event, data) => {
    try {
      const { width, height } = require('electron').screen.getPrimaryDisplay().bounds;
      const targetX = Math.round(data.x * width);
      const targetY = Math.round(data.y * height);
      
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
      }
    } catch (err) {
      console.error('Remote control error:', err);
    }
  });
}

app.whenReady().then(() => {
  createWindows();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
