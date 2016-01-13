import {NeovimElement} from 'neovim-component';
import {remote, shell} from 'electron';
import {join} from 'path';
import {readdirSync} from 'fs';
import {RPCValue} from 'promised-neovim-client';

const app = remote.require('app');

class ComponentLoader {
    initially_loaded: boolean;
    component_paths: string[];
    nyaovim_plugin_paths: string[];

    constructor() {
        this.initially_loaded = false;
        this.component_paths = [];
    }

    loadComponent(path: string) {
        const link = document.createElement('link') as HTMLLinkElement;
        link.rel = 'import';
        link.href = path;
        document.head.appendChild(link);
        this.component_paths.push(path);
    }

    loadPluginDir(dir: string) {
        const nyaovim_plugin_dir = join(dir, 'nyaovim-plugin');
        try {
            for (const entry of readdirSync(nyaovim_plugin_dir)) {
                if (entry.endsWith('.html')) {
                    this.loadComponent(join(nyaovim_plugin_dir, entry));
                } else if (entry.endsWith('.js')) {
                    require(join(nyaovim_plugin_dir, entry));
                }
            }
            this.nyaovim_plugin_paths.push(dir);
        } catch (err) {
            // 'nyaovim-plugin' doesn't exist
        }
    }

    loadFromRTP(runtimepaths: string[]) {
        for (const rtp of runtimepaths) {
            this.loadPluginDir(rtp);
        }
    }
}

const component_loader = new ComponentLoader();
const ThisBrowserWindow = remote.getCurrentWindow();

Polymer({
    is: 'nyaovim-app',

    properties: {
        argv: {
            type: Array,
            value: function() {
                // Note: First and second arguments are related to Electron
                const a = remote.process.argv.slice(2);
                a.push('--cmd', `let\ g:nyaovim_version="${app.getVersion()}"`);
                // XXX:
                // Swap files are disabled because it shows message window on start up but frontend can't detect it.
                a.push('-n');
                return a;
            },
        },
        editor: Object,
    },

    ready: function() {
        const element = document.getElementById('nyaovim-editor') as NeovimElement;
        const editor = element.editor;
        editor.on('quit', () => ThisBrowserWindow.close());
        this.editor = editor;

        editor.store.on('beep', () => shell.beep());
        editor.store.on('title-changed', () => {
            document.title = editor.store.title;
        });

        editor.on('process-attached', () => {
            const client = editor.getClient();

            client.listRuntimePaths()
                  .then((rtp: string[]) => {
                      component_loader.loadFromRTP(rtp);
                      component_loader.initially_loaded = true;
                  });

            client.subscribe('nyaovim:edit-start');
            client.command(`set rtp+=${join(__dirname, '..', 'runtime').replace(' ', '\ ')} | runtime plugin/nyaovim.vim`);

            client.on('notification', (method: string, args: RPCValue[]) => {
                switch (method) {
                case 'nyaovim:load-path':
                    component_loader.loadComponent(args[0] as string);
                    break;
                case 'nyaovim:load-plugin-dir':
                    component_loader.loadPluginDir(args[0] as string);
                    break;
                case 'nyaovim:edit-start':
                    const file_path = args[0] as string;
                    ThisBrowserWindow.setRepresentedFilename(file_path);
                    app.addRecentDocument(file_path);
                    break;
                default:
                    break;
                }
            });
            client.subscribe('nyaovim:load-path');
            client.subscribe('nyaovim:load-plugin-dir');

            element.addEventListener('drop', e => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) {
                    client.command('edit! ' + f.path);
                }
            });

            app.on('open-file', (e: Event, p: string) => {
                e.preventDefault();
                client.command('edit! ' + p);
            });
        });

        element.addEventListener('dragover', e => e.preventDefault());

        window.addEventListener('keydown', e => {
            if (e.keyCode === 0x1b && !editor.store.focused) {
                // Note: Global shortcut to make focus back to screen
                editor.focus();
            }
        });
    },

    attached: function() {
        // XXX:
        // Temporary fix.  Resize browser window to fit to content
        const [win_width, win_height] = ThisBrowserWindow.getContentSize();
        const body_width = document.body.scrollWidth;
        const body_height = document.body.scrollHeight;
        if (win_width !== body_width || win_height !== body_height) {
            ThisBrowserWindow.setContentSize(body_width, body_height);
        }
    },

    // TODO: Remove all listeners on detached
});
