import { createApp } from "vue";
import App from "./App.vue";
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import {Button, Toast, ToastService} from "primevue";

const app = createApp(App);

app.use(ToastService);
app.use(PrimeVue, {
    theme: {
        preset: Aura
    }
});

app.component("Button", Button);
app.component("Toast", Toast);

app.mount("#app");
