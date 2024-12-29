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
import ConfirmationService from 'primevue/confirmationservice';
import {MyelinPreset} from "./theme.ts";

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
            path: '/canvas/:path*',
            component: FreeCanvas,
            props: true,
        },
        {
            path: '/document/:path*',
            component: DocumentWrapper,
            props: true,
        }
    ],
});

const app = createApp(App);

app.use(router);
app.use(ConfirmationService);
app.use(PrimeVue, {
    theme: {preset: MyelinPreset}
});

app.mount("#app");
