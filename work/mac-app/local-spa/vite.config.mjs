import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
export default defineConfig({ root: here, plugins: [react()], resolve: { alias: { '@': projectRoot } }, css: { postcss: { plugins: [tailwindcss()] } }, build: { outDir: path.join(here, 'dist'), emptyOutDir: true } });
