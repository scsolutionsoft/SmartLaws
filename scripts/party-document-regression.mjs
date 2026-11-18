import { readFileSync } from 'node:fs';

const loadScript = (name, window, App, document) => {
    const source = readFileSync(new URL('../wwwroot/js/' + name, import.meta.url), 'utf8');
    new Function('window', 'App', 'document', 'CourtFormEditor', 'structuredClone', source)(
        window, App, document, window.CourtFormEditor, structuredClone);
};
const tests = readFileSync(new URL('./party-document-regression.js', import.meta.url), 'utf8');
new Function('loadScript', 'report', tests)(loadScript, console.log);
