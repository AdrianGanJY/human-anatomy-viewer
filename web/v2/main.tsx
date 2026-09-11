/** The /v2/ entry. Separate from `web/main.tsx` by design: v1 and v2 share the engine, the
 *  codec and the dictionaries, and share NO page module and NO stylesheet — so nothing shipped
 *  here can change what `/` renders. */
import {createRoot} from 'react-dom/client';
import V2 from '../../app/v2/page';
import '../../app/v2/v2.css';
import '../../app/v2/shell/shell.css';
createRoot(document.getElementById('root')!).render(<V2/>);
