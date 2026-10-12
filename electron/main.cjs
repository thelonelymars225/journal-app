// Desktop wrapper: serves the built web app from a private app:// origin and
// keeps the journal in a plain JSON file in the app's data folder
// (~/Library/Application Support/Journal/journal.json on a Mac).
const { app, BrowserWindow, protocol, net, shell, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const journalPath = () => path.join(app.getPath('userData'), 'journal.json');

async function loadJournal() {
  for (const file of [journalPath(), `${journalPath()}.bak`]) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`Couldn't read ${file}:`, err);
    }
  }
  return null;
}

// Saves are queued so two writes never overlap. Each one writes a temp file and
// renames it into place, so a crash mid-save can't leave a half-written journal;
// the previous version is kept as journal.json.bak.
let saveQueue = Promise.resolve();
function saveJournal(data) {
  saveQueue = saveQueue.then(async () => {
    const file = journalPath();
    const tmp = `${file}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.copyFile(file, `${file}.bak`).catch(() => {});
    await fs.rename(tmp, file);
  });
  return saveQueue;
}

ipcMain.handle('journal:load', () => loadJournal());
ipcMain.handle('journal:save', (_e, data) => saveJournal(data));
ipcMain.handle('journal:location', () => journalPath());
ipcMain.handle('journal:reveal', async () => {
  await fs.access(journalPath()).then(() => shell.showItemInFolder(journalPath()), () => shell.openPath(app.getPath('userData')));
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    title: 'Journal',
    backgroundColor: '#f7f4ef',
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('app://journal/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
