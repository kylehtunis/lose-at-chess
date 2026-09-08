import { mount } from 'svelte';
import 'cm-chessboard/assets/chessboard.css';
import './app.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
