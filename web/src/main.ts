import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { requestPersistence } from './lib/db/db';

void requestPersistence();

export default mount(App, { target: document.getElementById('app')! });
