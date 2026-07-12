<script lang="ts">
import { defineComponent, onMounted, ref } from "vue";
// import { startScene } from './boids';
import { startScene } from "./spectrogram";

export default defineComponent({
    components: {},
    setup() {
        const el = ref();
        let scene;
        onMounted(() => {
            scene = startScene(el.value, { direction: "up" });
        });

        // Add a function to handle the button click
        const handleClick = () => {
            scene.startSpectrogram();
        };

        return {
            el,
            handleClick,
        };
    },
});
</script>

<template>
    <div class="relative w-full h-full">
        <button @click="handleClick">
            Click me
        </button>
        <canvas ref="el" width="4096" height="4096" />
    </div>
</template>
