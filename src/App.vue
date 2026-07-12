<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";

import Layout from "./system/Layout.vue";
</script>

<template>
    <div class="absolute w-screen min-h-screen h-full overflow-hidden">
        <Layout class="min-h-full h-full relative">
            <template #header>
                <nav class="bg-gray-800 text-white p-4">
                    <div class="flex space-x-4">
                        <RouterLink to="/" class="hover:text-gray-300 transition-colors">
                            Heatmap
                        </RouterLink>
                        <RouterLink to="/dynamic-texture" class="hover:text-gray-300 transition-colors">
                            Dynamic Texture
                        </RouterLink>
                    </div>
                </nav>
            </template>
            <template #body>
                <RouterView />
            </template>
        </Layout>
    </div>
</template>

<style scoped></style>
