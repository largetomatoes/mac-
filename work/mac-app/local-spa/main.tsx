import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../../../app/page';
import '../../../app/globals.css';
import '../../../components/desktop-polish.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><Home /></React.StrictMode>);
