// Marks the page as the desktop app so it offers and defaults to Ultra quality (#38).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('bulletTimeDesktop', { platform: process.platform });
