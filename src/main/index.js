import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Tail of the bridge's stderr, kept around so a startup failure can be shown in the UI. */
const STDERR_HISTORY = 20;

let mainWindow = null;
let bridgeChild = null;

/** What the renderer needs to reach the bridge, mirrored to it on every change. */
let bridgeInfo = { status: 'starting', port: null, error: null, pythonPath: null };

function pythonProjectDir() {
  return path.join(app.getAppPath(), 'python');
}

function defaultInterpreter() {
  const venv = path.join(pythonProjectDir(), '.venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
}

function selectedInterpreter() {
  return readSettings().pythonPath || defaultInterpreter();
}

function setBridgeInfo(patch) {
  bridgeInfo = { ...bridgeInfo, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('grappy:bridge-changed', bridgeInfo);
  }
}

function stopBridge() {
  if (!bridgeChild) {
    return;
  }
  const child = bridgeChild;
  bridgeChild = null;
  child.removeAllListeners();
  child.kill();
}

function startBridge() {
  stopBridge();

  const pythonPath = selectedInterpreter();
  const cwd = pythonProjectDir();
  setBridgeInfo({ status: 'starting', port: null, error: null, pythonPath });

  if (!fs.existsSync(pythonPath)) {
    setBridgeInfo({
      status: 'error',
      error: `Python interpreter not found: ${pythonPath}. Run "poetry install" in ./python, or pick an interpreter from the File menu.`,
    });
    return;
  }

  let child;
  try {
    child = spawn(pythonPath, ['-m', 'grappy_bridge.server'], {
      cwd,
      // PYTHONPATH lets an interpreter that never installed the project still import it.
      env: { ...process.env, PYTHONPATH: cwd, PYTHONUNBUFFERED: '1' },
      // Nothing is ever written to the bridge's stdin. It stays open purely so the bridge
      // can notice, through EOF, that this process is gone and shut its kernel down even
      // when Electron is killed without running its own cleanup.
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    setBridgeInfo({ status: 'error', error: `Could not start the bridge: ${error.message}` });
    return;
  }

  bridgeChild = child;
  const stderrTail = [];

  let sawPort = false;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    if (!sawPort) {
      try {
        const { port } = JSON.parse(line);
        if (typeof port === 'number') {
          sawPort = true;
          setBridgeInfo({ status: 'running', port, error: null });
          return;
        }
      } catch {
        // Not the handshake line; fall through and treat it as ordinary output.
      }
    }
    console.log('[bridge]', line);
  });

  readline.createInterface({ input: child.stderr }).on('line', (line) => {
    stderrTail.push(line);
    if (stderrTail.length > STDERR_HISTORY) {
      stderrTail.shift();
    }
    console.error('[bridge]', line);
  });

  child.on('error', (error) => {
    if (bridgeChild === child) {
      setBridgeInfo({ status: 'error', error: `Could not start the bridge: ${error.message}` });
    }
  });

  child.on('exit', (code, signal) => {
    if (bridgeChild !== child) {
      return;
    }
    bridgeChild = null;
    const reason = stderrTail.join('\n') || `exited with code ${code ?? signal}`;
    setBridgeInfo({ status: 'error', port: null, error: `The bridge stopped: ${reason}` });
  });
}

async function selectInterpreter() {
  const filters =
    process.platform === 'win32'
      ? [{ name: 'Executables', extensions: ['exe'] }]
      : [{ name: 'All files', extensions: ['*'] }];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Python Interpreter',
    defaultPath: path.dirname(selectedInterpreter()),
    properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
    filters,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const pythonPath = result.filePaths[0];
  writeSettings({ ...readSettings(), pythonPath });
  startBridge();
  return pythonPath;
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Select Python Interpreter…', click: () => selectInterpreter() },
        {
          label: 'Use Bundled Interpreter',
          click: () => {
            const settings = readSettings();
            delete settings.pythonPath;
            writeSettings(settings);
            startBridge();
          },
        },
        { type: 'separator' },
        { label: 'Restart Kernel Bridge', click: () => startBridge() },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  if (process.platform === 'darwin') {
    template.unshift({ role: 'appMenu' });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(dirname, '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('grappy:get-bridge-info', () => bridgeInfo);
  ipcMain.handle('grappy:select-interpreter', () => selectInterpreter());
  ipcMain.handle('grappy:restart-bridge', () => {
    startBridge();
    return bridgeInfo;
  });

  buildMenu();
  createWindow();
  startBridge();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', stopBridge);
app.on('will-quit', stopBridge);
