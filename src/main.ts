import {createApp} from "vue";
import {createMemoryHistory, createRouter} from "vue-router";

import "./assets/base.css";
import "./assets/theme.css";
import 'primeicons/primeicons.css'

import App from "./App.vue";
import ExplorerWrapper from "./pages/FileExplorer/ExplorerWrapper.vue";
import FreeCanvas from "./pages/FreeCanvas.vue";
import DocumentWrapper from "./pages/DocumentEditor/DocumentWrapper.vue";

import PrimeVue from 'primevue/config';
import {MyelinPreset} from "./theme.ts";
import {ConfirmationService, ToastService} from "primevue";

const router = createRouter({
    history: createMemoryHistory(),
    routes: [
        {
            path: '/',
            redirect: '/file/Home'
        },
        {
            path: '/file/:path*',
            component: ExplorerWrapper,
            props: true,
        },
        {
            path: '/mcanvas/:path*',
            component: FreeCanvas,
            props: true,
        },
        {
            path: '/mdoc/:path*',
            component: DocumentWrapper,
            props: true,
        }
    ],
});

const app = createApp(App);

app.use(router);
app.use(ConfirmationService);
app.use(ToastService);
app.use(PrimeVue, {
    theme: {preset: MyelinPreset}
});

app.mount("#app");
