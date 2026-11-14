/** game-radar v2 — popup 挂载入口 */
import { render } from 'preact';
import { Popup } from './Popup.jsx';

const root = document.getElementById('gr2-root');
if (root) render(<Popup />, root);
