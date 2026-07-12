<script lang="ts">
import type { SceneState } from "./dynamic-texture";
import { defineComponent, onMounted, onUnmounted, ref } from "vue";
import { setupDyanmicTexture } from "./dynamic-texture";

export default defineComponent({
    components: {},
    setup() {
        const el = ref<HTMLElement>();
        let scene: SceneState;

        onMounted(async () => {
            if (el.value) {
                try {
                    scene = setupDyanmicTexture(el.value);
                } catch (error) {
                    console.error("Failed to initialize dynamic texture:", error);
                }
            }
        });

        onUnmounted(() => {
            if (scene) {
                scene.dispose();
            }
        });

        return {
            el,
        };
    },
});
</script>

<template>
    <div ref="el" class="relative w-full h-screen bg-black" />
</template>
