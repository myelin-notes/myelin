import { createApp } from "vue";
import { ToastService } from "primevue";

import App from "./App.vue";
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';

import "./assets/base.css";
import 'primeicons/primeicons.css'

const app = createApp(App);

app.use(ToastService);
app.use(PrimeVue, {
    theme: {
        preset: Aura
    }
});

app.mount("#app");
