import { defineConfig } from 'vite';
export default defineConfig({root:'apps/web',build:{outDir:'../../dist/web',emptyOutDir:true},server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:3001',ws:true}}}});
