import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { requestPersistence } from './lib/db/db';
import { setupPWA } from './lib/pwa';

void requestPersistence();
setupPWA();

export default mount(App, { target: document.getElementById('app')! });
