<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
    setup() {
        return {};
    },
});
</script>

<template>
    <div class="grid grid-cols-1 grid-rows-[60px, 1fr]">
        <slot name="header" />
        <slot name="body" />
    </div>
</template>
