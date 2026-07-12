import type { Router } from "vue-router";
import { createRouter, createWebHistory } from "vue-router";
import DynamicTexture from "../pages/DynamicTexture.vue";
import Heatmap from "../pages/Heatmap.vue";
import { Pages } from "./pages";

export const router: Router = createRouter({
    history: createWebHistory(),
    strict: true,
    routes: [
        {
            props: true,
            name: Pages.Home.name,
            path: Pages.Home.path,
            component: Heatmap,
        },
        {
            props: true,
            name: Pages.DynamicTexture.name,
            path: Pages.DynamicTexture.path,
            component: DynamicTexture,
        },
    ],
});
