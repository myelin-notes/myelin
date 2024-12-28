import {createApp} from "vue";
import {createMemoryHistory, createRouter} from "vue-router";

import App from "./App.vue";
import ExplorerWrapper from "./pages/FileExplorer/ExplorerWrapper.vue";

import "./assets/base.css";
import "./assets/theme.css";
import 'primeicons/primeicons.css'
import FreeCanvas from "./pages/FreeCanvas.vue";
import DocumentWrapper from "./pages/DocumentEditor/DocumentWrapper.vue";

const routes = [
    {
        path: '/',
        redirect: '/file/home'
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
];

const router = createRouter({
    history: createMemoryHistory(),
    routes,
});

const app = createApp(App);

app.use(router);
app.mount("#app");
