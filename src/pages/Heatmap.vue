<script lang="ts">
import type { FitMode, PointSpriteHeatMapRenderer } from "./heatmap-points-fixed";
import { defineComponent, onMounted, onUnmounted, ref } from "vue";
import { setupPointSpriteHeatMap } from "./heatmap-points-fixed";

export default defineComponent({
    components: {},
    setup() {
        const el = ref<HTMLElement>();
        let scene: PointSpriteHeatMapRenderer;
        let currentScale = 1.0;
        let currentDecay = 0.92;
        let currentFitMode: FitMode = "none";
        let dynamicTextureSize = false;

        const handleKeyPress = (event: KeyboardEvent) => {
            if (!scene) return;

            switch (event.key) {
                case "+":
                case "=":
                    currentScale = Math.min(5.0, currentScale + 0.1);
                    scene.setSpriteScale(currentScale);
                    console.warn(`Sprite scale: ${currentScale.toFixed(1)}`);
                    break;
                case "-":
                    currentScale = Math.max(0.1, currentScale - 0.1);
                    scene.setSpriteScale(currentScale);
                    console.warn(`Sprite scale: ${currentScale.toFixed(1)}`);
                    break;
                case "d":
                case "D":
                    currentDecay = Math.max(0.8, currentDecay - 0.02);
                    scene.setDecay(currentDecay);
                    console.warn(`Decay rate: ${currentDecay.toFixed(3)} (slower decay)`);
                    break;
                case "f":
                case "F":
                    currentDecay = Math.min(0.99, currentDecay + 0.02);
                    scene.setDecay(currentDecay);
                    console.warn(`Decay rate: ${currentDecay.toFixed(3)} (faster decay)`);
                    break;
                case "c":
                case "C":
                    // Cycle through fit modes: none -> contain -> cover -> none
                    if (currentFitMode === "none") {
                        currentFitMode = "contain";
                    } else if (currentFitMode === "contain") {
                        currentFitMode = "cover";
                    } else {
                        currentFitMode = "none";
                    }
                    console.warn(`Fit mode: ${currentFitMode}`);
                    // Recreate the scene with new fit mode
                    if (el.value) {
                        scene.dispose();
                        scene = setupPointSpriteHeatMap(el.value, currentFitMode, dynamicTextureSize);
                    }
                    break;
                case "t":
                case "T":
                    // Toggle dynamic texture sizing
                    dynamicTextureSize = !dynamicTextureSize;
                    console.warn(`Dynamic texture sizing: ${dynamicTextureSize ? "enabled" : "disabled"}`);
                    // Recreate the scene with new setting
                    if (el.value) {
                        scene.dispose();
                        scene = setupPointSpriteHeatMap(el.value, currentFitMode, dynamicTextureSize);
                    }
                    break;
            }
        };

        onMounted(async () => {
            if (el.value) {
                try {
                    scene = setupPointSpriteHeatMap(el.value, currentFitMode, dynamicTextureSize);
                    window.addEventListener("keydown", handleKeyPress);
                } catch (error) {
                    console.error("Failed to initialize simple test:", error);
                }
            }
        });

        onUnmounted(() => {
            window.removeEventListener("keydown", handleKeyPress);
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
    <div ref="el" class="relative w-full h-screen bg-black">
        <div class="absolute top-4 left-4 text-white text-sm opacity-75 z-10">
            <div>Controls:</div>
            <div>+/- : Scale sprites</div>
            <div>D/F : Decay rate</div>
            <div>C : Cycle fit mode (none/contain/cover)</div>
            <div>T : Toggle dynamic texture sizing</div>
        </div>
    </div>
</template>
