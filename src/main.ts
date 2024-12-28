import {createApp} from "vue";
import {createMemoryHistory, createRouter} from "vue-router";

import App from "./App.vue";
import FileExplorer from "./pages/FileExplorer/FileExplorer.vue";
import FreeCanvas from "./pages/FreeCanvas.vue";

import "./assets/base.css";
import "./assets/theme.css";
import 'primeicons/primeicons.css'

const routes = [
    {path: '/', redirect: '/file/'},
    {path: '/file/:path*', component: FileExplorer, props: true },
    {path: '/file/:path*/canvas', component: FreeCanvas},
];

const router = createRouter({
    history: createMemoryHistory(),
    routes,
});

const app = createApp(App);

app.use(router);
app.mount("#app");
