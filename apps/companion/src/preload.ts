import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('porch', {
  state: () => ipcRenderer.invoke('porch:state'),
  pair: (value: unknown) => ipcRenderer.invoke('porch:pair', value),
  project: (value: unknown) => ipcRenderer.invoke('porch:project', value),
  executable: () => ipcRenderer.invoke('porch:executable'),
  install: () => ipcRenderer.invoke('porch:install'),
  signin: () => ipcRenderer.invoke('porch:signin'),
  check: () => ipcRenderer.invoke('porch:check'),
  connect: () => ipcRenderer.invoke('porch:connect'),
  disconnect: () => ipcRenderer.invoke('porch:disconnect'),
  forget: () => ipcRenderer.invoke('porch:forget'),
  loginItem: (enabled: boolean) => ipcRenderer.invoke('porch:login-item', enabled),
  openChat: () => ipcRenderer.invoke('porch:open-chat'),
  onChange: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('porch:changed', listener);
    return () => ipcRenderer.removeListener('porch:changed', listener);
  },
});
