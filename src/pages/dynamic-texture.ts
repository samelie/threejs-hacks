import * as THREE from "three";

// Types for better type safety
interface TextureSize {
    width: number;
    height: number;
}

export interface SceneState {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    currentTexture: THREE.DataTexture;
    currentTextureSize: TextureSize;
    canvas: HTMLCanvasElement;
    textCanvas: HTMLCanvasElement;
    textContext: CanvasRenderingContext2D;
    container: HTMLElement;
    resizeObserver: ResizeObserver;
    dispose: () => void;
}

// Power of two texture sizes to choose from
const TEXTURE_SIZES = [512, 1024, 2048] as const;
type TextureSizeValue = typeof TEXTURE_SIZES[number];

/**
 * Get the optimal texture size based on container dimensions
 */
function getOptimalTextureSize(containerWidth: number, containerHeight: number): TextureSizeValue {
    const maxDimension = Math.min(containerWidth, containerHeight);

    // Find the smallest power-of-two size that can accommodate the container
    for (const size of TEXTURE_SIZES) {
        if (size >= maxDimension) {
            return size;
        }
    }

    // Fallback to largest size if container is very large
    return TEXTURE_SIZES.at(-1) ?? 2048;
}

/**
 * Create initial text content for the texture
 */
function createInitialTextContent(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, size: number): void {
    canvas.width = size;
    canvas.height = size;

    // Clear the canvas with dark background
    context.fillStyle = "#1a1a1a";
    context.fillRect(0, 0, size, size);

    // Draw grid pattern for better visualization
    context.strokeStyle = "#333333";
    context.lineWidth = 1;
    const gridSize = size / 8;

    for (let i = 0; i <= 8; i++) {
        const pos = i * gridSize;
        context.beginPath();
        context.moveTo(pos, 0);
        context.lineTo(pos, size);
        context.stroke();

        context.beginPath();
        context.moveTo(0, pos);
        context.lineTo(size, pos);
        context.stroke();
    }

    // Add initial text at random position in top-left area
    addRandomText(context, size, true);
}

/**
 * Add text at a random position in the top-left quadrant
 */
function addRandomText(context: CanvasRenderingContext2D, size: number, isInitial: boolean = false): void {
    const fontSize = Math.max(size / 25, 12);
    context.font = `${fontSize}px Arial, sans-serif`;
    context.fillStyle = isInitial ? "#ffffff" : `hsl(${Math.random() * 360}, 70%, 70%)`;
    context.textAlign = "left";
    context.textBaseline = "top";

    // Random position in top-left area (first third of width and height)
    const maxX = size;
    const maxY = size;
    const x = Math.random() * (maxX - fontSize * 6); // Leave space for text
    const y = Math.random() * (maxY - fontSize * 3); // Leave space for text

    const timestamp = new Date().toLocaleTimeString();
    const sizeText = `${size}x${size}`;

    if (isInitial) {
        context.fillText(`Init: ${sizeText}`, x, y);
        context.fillText(`Time: ${timestamp}`, x, y + fontSize + 2);
        context.fillText(`DPR: ${window.devicePixelRatio.toFixed(2)}`, x, y + (fontSize + 2) * 2);
    } else {
        context.fillText(`→ ${sizeText}`, x, y);
        context.fillText(`${timestamp}`, x, y + fontSize + 2);
    }
}

/**
 * Create a data texture from canvas content
 */
function createDataTextureFromCanvas(canvas: HTMLCanvasElement): THREE.DataTexture {
    const context = canvas.getContext("2d")!;
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

    const texture = new THREE.DataTexture(
        imageData.data,
        canvas.width,
        canvas.height,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
    );

    texture.needsUpdate = true;
    texture.flipY = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    return texture;
}

/**
 * Copy existing texture content to new canvas and add new text
 */
function copyTextureAndAddContent(
    existingTexture: THREE.DataTexture,
    targetCanvas: HTMLCanvasElement,
    targetContext: CanvasRenderingContext2D,
    targetSize: number,
): void {
    // Set target canvas size
    targetCanvas.width = targetSize;
    targetCanvas.height = targetSize;

    // Clear target canvas with dark background
    targetContext.fillStyle = "#1a1a1a";
    targetContext.fillRect(0, 0, targetSize, targetSize);

    // Get existing texture data and dimensions
    const existingData = existingTexture.image.data as Uint8Array;
    const existingWidth = existingTexture.image.width;
    const existingHeight = existingTexture.image.height;

    // Create ImageData for the target size
    const targetImageData = targetContext.createImageData(targetSize, targetSize);
    const targetData = targetImageData.data;

    // Copy and scale existing texture data to new size
    for (let y = 0; y < targetSize; y++) {
        for (let x = 0; x < targetSize; x++) {
            // Map target coordinates to source coordinates
            const sourceX = Math.floor((x / targetSize) * existingWidth);
            const sourceY = Math.floor((y / targetSize) * existingHeight);

            // Calculate pixel indices
            const sourceIndex = (sourceY * existingWidth + sourceX) * 4;
            const targetIndex = (y * targetSize + x) * 4;

            // Copy RGBA values
            targetData[targetIndex] = existingData[sourceIndex] ?? 0; // R
            targetData[targetIndex + 1] = existingData[sourceIndex + 1] ?? 0; // G
            targetData[targetIndex + 2] = existingData[sourceIndex + 2] ?? 0; // B
            targetData[targetIndex + 3] = existingData[sourceIndex + 3] ?? 0; // A
        }
    }

    // Put the scaled existing content onto the canvas
    targetContext.putImageData(targetImageData, 0, 0);

    // Add new text at random position
    addRandomText(targetContext, targetSize, false);
}

/**
 * Update canvas size and position with object-fit behavior
 */
function updateCanvasSize(
    canvas: HTMLCanvasElement,
    container: HTMLElement,
    camera: THREE.OrthographicCamera,
    renderer: THREE.WebGLRenderer,
): void {
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    const devicePixelRatio = window.devicePixelRatio;

    // Calculate canvas size with object-fit contain behavior
    const aspect = 1; // Our texture is square
    const containerAspect = containerWidth / containerHeight;

    let canvasWidth: number;
    let canvasHeight: number;

    if (containerAspect > aspect) {
    // Container is wider than texture aspect ratio
        canvasHeight = containerHeight;
        canvasWidth = containerHeight * aspect;
    } else {
    // Container is taller than texture aspect ratio
        canvasWidth = containerWidth;
        canvasHeight = containerWidth / aspect;
    }

    // Set canvas display size
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    // Center the canvas
    canvas.style.position = "absolute";
    canvas.style.left = "50%";
    canvas.style.top = "50%";
    canvas.style.transform = "translate(-50%, -50%)";

    // Set canvas buffer size accounting for device pixel ratio
    const bufferWidth = Math.floor(canvasWidth * devicePixelRatio);
    const bufferHeight = Math.floor(canvasHeight * devicePixelRatio);

    canvas.width = bufferWidth;
    canvas.height = bufferHeight;

    // Update Three.js renderer and camera
    renderer.setSize(bufferWidth, bufferHeight, false);

    const halfWidth = 1;
    const halfHeight = 1;
    camera.left = -halfWidth;
    camera.right = halfWidth;
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.updateProjectionMatrix();
}

/**
 * Handle resize events and texture updates
 */
function handleResize(state: SceneState): void {
    const containerRect = state.container.getBoundingClientRect();
    const optimalSize = getOptimalTextureSize(containerRect.width, containerRect.height);

    // Update canvas size first
    updateCanvasSize(state.canvas, state.container, state.camera, state.renderer);

    // Check if we need to change texture size
    if (optimalSize !== state.currentTextureSize.width) {
        const oldTexture = state.currentTexture;

        // Copy existing texture and add new content
        copyTextureAndAddContent(oldTexture, state.textCanvas, state.textContext, optimalSize);

        // Create new texture from updated canvas
        const newTexture = createDataTextureFromCanvas(state.textCanvas);

        // Update material
        state.material.map = newTexture;
        state.material.needsUpdate = true;

        // Clean up old texture
        oldTexture.dispose();

        // Update state
        state.currentTexture = newTexture;
        state.currentTextureSize = { width: optimalSize, height: optimalSize };

        console.warn(`Texture resized to ${optimalSize}x${optimalSize} with accumulated content`);
    }

    // Render the scene
    state.renderer.render(state.scene, state.camera);
}

/**
 * Setup the dynamic texture Three.js scene
 */
export function setupDyanmicTexture(container: HTMLElement): SceneState {
    // Get initial container size
    const containerRect = container.getBoundingClientRect();
    const initialTextureSize = getOptimalTextureSize(containerRect.width, containerRect.height);

    // Create text canvas for generating texture content
    const textCanvas = document.createElement("canvas");
    const textContext = textCanvas.getContext("2d")!;

    // Create initial texture content
    createInitialTextContent(textCanvas, textContext, initialTextureSize);

    // Create initial data texture
    const texture = createDataTextureFromCanvas(textCanvas);

    // Create Three.js scene
    const scene = new THREE.Scene();

    // Create orthographic camera for 2D rendering
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    camera.position.z = 1;

    // Create WebGL renderer
    const canvas = document.createElement("canvas");
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);

    // Add canvas to container
    container.appendChild(canvas);

    // Create material and mesh
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Create state object
    const state: SceneState = {
        scene,
        camera,
        renderer,
        mesh,
        material,
        currentTexture: texture,
        currentTextureSize: { width: initialTextureSize, height: initialTextureSize },
        canvas,
        textCanvas,
        textContext,
        container,
        resizeObserver: new ResizeObserver(() => handleResize(state)),
        dispose: () => {
            state.resizeObserver.disconnect();
            state.currentTexture.dispose();
            state.material.dispose();
            geometry.dispose();
            renderer.dispose();
            if (canvas.parentElement) {
                canvas.parentElement.removeChild(canvas);
            }
        },
    };

    // Initial setup
    updateCanvasSize(canvas, container, camera, renderer);

    // Start observing container size changes
    state.resizeObserver.observe(container);

    // Initial render
    renderer.render(scene, camera);

    return state;
}
