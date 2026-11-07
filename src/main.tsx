import { createRoot } from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import { App } from './App';

// No StrictMode: its double-mounted effects would end and restart note editing sessions.
createRoot(document.getElementById('root')!).render(<App />);
