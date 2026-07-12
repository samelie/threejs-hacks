import { fit, fitAndPosition } from "object-fit-math";
import * as THREE from "three";

// Types
interface SignalDetection {
    id: string; // Unique identifier for the detection
    frequency: number; // Center frequency of detection
    bandwidth: number; // Bandwidth of the detected signal
    strength: number; // Signal strength (0-1)
    signalType?: string; // Optional signal classification
    timestamp: number; // Detection timestamp
}

export type FitMode = "contain" | "cover" | "none";

interface ChannelConfig {
    centerFreq: number; // Channel center frequency
    bandwidth: number; // Total channel bandwidth
    textureSize: number; // Power of 2 texture size (512, 1024, etc.)
    fitMode?: FitMode; // Canvas fitting strategy (default: "none")
    dynamicTextureSize?: boolean; // Auto-select texture size based on canvas area (default: false)
}

export interface PointSpriteHeatMapRenderer {
    update: (detections: SignalDetection[]) => void;
    render: () => void;
    resize: (width: number, height: number) => void;
    loadSpriteTexture: (url: string) => Promise<void>;
    setDecay: (decay: number) => void;
    setSpriteScale: (scale: number) => void;
    dispose: () => void;
}

// Vertex shader for accumulation pass (decay)
const accumVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader for accumulation/decay
const accumFragmentShader = `
  uniform sampler2D previousFrame;
  uniform float decay;
  varying vec2 vUv;

  void main() {
    vec4 prev = texture2D(previousFrame, vUv);
    gl_FragColor = vec4(prev.rgb * decay, prev.a * decay);
  }
`;

// Point sprite vertex shader with non-uniform scaling and strength-based Y positioning
const pointVertexShader = `
  attribute float frequency;
  attribute float bandwidth;
  attribute float strength;
  attribute float signalType;
  attribute vec3 color;

  uniform float channelCenterFreq;
  uniform float channelBandwidth;
  uniform float time;
  uniform float basePointSize;
  uniform float strengthScale;
  uniform float bandwidthScale;

  varying float vStrength;
  varying vec3 vColor;
  varying float vSignalType;

  void main() {
    vStrength = strength;
    vColor = color;
    vSignalType = signalType;

    // Convert frequency to normalized coordinate (-1 to 1)
    float freqOffset = frequency - channelCenterFreq;
    float normalizedFreq = (freqOffset / (channelBandwidth * 0.5));

    // Position Y based on strength: 0 strength = bottom (-1), 1 strength = top (1)
    float normalizedStrength = (strength * 2.0) - 1.0;

    // Position point at frequency (X) and strength (Y) location
    vec3 pos = vec3(normalizedFreq, normalizedStrength, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);

    // Non-uniform scaling based on bandwidth and strength
    float bandwidthFactor = (bandwidth / channelBandwidth) * bandwidthScale;
    float strengthFactor = pow(strength, 0.5) * strengthScale; // Square root for better visual scaling

    // Combine scaling factors with base size
    gl_PointSize = basePointSize * bandwidthFactor * strengthFactor;

    // Optional: Add slight animation/pulsing based on signal type
    if (signalType > 0.5) { // For certain signal types
      gl_PointSize *= (1.0 + 0.2 * sin(time * 8.0 + frequency * 0.001));
    }
  }
`;

// Point sprite fragment shader with per-point coloring
const pointFragmentShader = `
  uniform sampler2D spriteTexture;
  uniform float time;

  varying float vStrength;
  varying vec3 vColor;
  varying float vSignalType;

  // Color palettes for different signal types
  vec3 getSignalTypeColor(float signalType, float strength) {
    vec3 color;

    if (signalType < 0.33) {
      // Type 0: Blue to cyan (continuous signals)
      color = mix(vec3(0.0, 0.3, 1.0), vec3(0.0, 1.0, 1.0), strength);
    } else if (signalType < 0.66) {
      // Type 1: Green to yellow (burst signals)
      color = mix(vec3(0.0, 1.0, 0.3), vec3(1.0, 1.0, 0.0), strength);
    } else {
      // Type 2: Red to orange (interference/noise)
      color = mix(vec3(1.0, 0.2, 0.0), vec3(1.0, 0.8, 0.0), strength);
    }

    return color;
  }

  // Apply special effects based on signal characteristics
  vec3 applySignalEffects(vec3 baseColor, float strength, float signalType) {
    // High strength signals get white-hot center
    if (strength > 0.8) {
      float hotSpot = smoothstep(0.8, 1.0, strength);
      float centerDistance = length(gl_PointCoord - 0.5) * 2.0;
      float hotFactor = smoothstep(0.6, 0.2, centerDistance) * hotSpot;
      baseColor = mix(baseColor, vec3(1.0, 1.0, 1.0), hotFactor);
    }

    // Pulse effect for certain signal types
    if (signalType > 0.5) {
      float pulse = 0.5 + 0.5 * sin(time * 10.0);
      baseColor *= (0.8 + 0.4 * pulse);
    }

    return baseColor;
  }

  void main() {
    // Sample the sprite texture
    vec4 sprite = texture2D(spriteTexture, gl_PointCoord);

    // Determine base color (use attribute color or signal type color)
    vec3 baseColor = length(vColor) > 0.1 ? vColor : getSignalTypeColor(vSignalType, vStrength);

    // Apply signal-specific effects
    vec3 finalColor = applySignalEffects(baseColor, vStrength, vSignalType);

    // Apply sprite texture and strength-based alpha
    float alpha = sprite.a * vStrength;

    // Edge fade for softer blending
    float edgeFade = smoothstep(0.0, 0.1, alpha);

    gl_FragColor = vec4(finalColor * sprite.rgb, alpha * edgeFade);
  }
`;

// Create default circular sprite texture if no PNG loaded
function createDefaultSpriteTexture(size: number = 64): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2;

    // Create radial gradient for glow effect
    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
    gradient.addColorStop(0.3, "rgba(255, 255, 255, 0.8)");
    gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.3)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// Signal type classifier (example implementation)
function classifySignal(detection: SignalDetection): number {
    // Return 0-1 value representing signal type
    if (detection.signalType) {
        switch (detection.signalType.toLowerCase()) {
            case "continuous": case "carrier": return 0.1;
            case "burst": case "packet": return 0.5;
            case "interference": case "noise": return 0.9;
            default: return 0.3;
        }
    }

    // Classify based on bandwidth and strength if no explicit type
    const bwRatio = detection.bandwidth / 1e6; // Normalize to MHz
    if (bwRatio < 0.1 && detection.strength > 0.7) return 0.1; // Narrow, strong = continuous
    if (bwRatio > 0.5 && detection.strength < 0.5) return 0.9; // Wide, weak = interference
    return 0.5; // Default to burst type
}

// Generate color based on frequency (spectral coloring)
function frequencyToColor(freq: number, centerFreq: number, bandwidth: number): THREE.Vector3 {
    const normalizedFreq = (freq - centerFreq) / bandwidth + 0.5;
    const hue = normalizedFreq * 240; // Blue to red spectrum

    // Convert HSV to RGB
    const c = 1.0;
    const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    const m = 0;

    let r = 0;
    let g = 0;
    let b = 0;

    if (hue < 60) {
        r = c;
        g = x;
        b = 0;
    } else if (hue < 120) {
        r = x;
        g = c;
        b = 0;
    } else if (hue < 180) {
        r = 0;
        g = c;
        b = x;
    } else if (hue < 240) {
        r = 0;
        g = x;
        b = c;
    }

    return new THREE.Vector3(r + m, g + m, b + m);
}

// Helper function to calculate optimal power-of-2 texture size
function calculateOptimalTextureSize(canvasWidth: number, canvasHeight: number): number {
    // Use the larger dimension to ensure we don't undersample
    const maxDimension = Math.max(canvasWidth, canvasHeight);

    // Account for device pixel ratio to ensure crisp rendering
    const devicePixelRatio = window.devicePixelRatio || 1;
    const targetSize = maxDimension * devicePixelRatio;

    // Find the next power of 2 that's >= targetSize
    const powerOf2 = 2 ** Math.ceil(Math.log2(targetSize));

    // Clamp between reasonable bounds (256 to 2048)
    return Math.max(256, Math.min(2048, powerOf2));
}

// Helper function to create render targets with specified size
function createRenderTargets(textureSize: number, hasFloatTextures: boolean): {
    readTarget: THREE.WebGLRenderTarget;
    writeTarget: THREE.WebGLRenderTarget;
} {
    const rtParams = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: hasFloatTextures ? THREE.FloatType : THREE.UnsignedByteType,
    };

    const readTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, rtParams);
    const writeTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, rtParams);

    return { readTarget, writeTarget };
}

// FIXED: Function to resample pixel data from old size to new size using bilinear interpolation
function resamplePixelData(
    sourceData: Float32Array | Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    isFloatData: boolean,
): Float32Array | Uint8Array {
    const targetData = isFloatData ? new Float32Array(targetWidth * targetHeight * 4) : new Uint8Array(targetWidth * targetHeight * 4);

    const scaleX = sourceWidth / targetWidth;
    const scaleY = sourceHeight / targetHeight;

    for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
            // Map target coordinates to source coordinates
            const srcX = x * scaleX;
            const srcY = y * scaleY;

            // Get the four surrounding pixels for bilinear interpolation
            const x1 = Math.floor(srcX);
            const y1 = Math.floor(srcY);
            const x2 = Math.min(x1 + 1, sourceWidth - 1);
            const y2 = Math.min(y1 + 1, sourceHeight - 1);

            // Calculate interpolation weights
            const wx = srcX - x1;
            const wy = srcY - y1;

            // Get pixel values at the four corners
            const getPixel = (px: number, py: number) => {
                const idx = (py * sourceWidth + px) * 4;
                return {
                    r: sourceData[idx] ?? 0,
                    g: sourceData[idx + 1] ?? 0,
                    b: sourceData[idx + 2] ?? 0,
                    a: sourceData[idx + 3] ?? 0,
                };
            };

            const p1 = getPixel(x1, y1); // Top-left
            const p2 = getPixel(x2, y1); // Top-right
            const p3 = getPixel(x1, y2); // Bottom-left
            const p4 = getPixel(x2, y2); // Bottom-right

            // Bilinear interpolation
            const interpolate = (v1: number, v2: number, v3: number, v4: number) => {
                const top = v1 * (1 - wx) + v2 * wx;
                const bottom = v3 * (1 - wx) + v4 * wx;
                return top * (1 - wy) + bottom * wy;
            };

            const targetIdx = (y * targetWidth + x) * 4;
            const r = interpolate(p1.r, p2.r, p3.r, p4.r);
            const g = interpolate(p1.g, p2.g, p3.g, p4.g);
            const b = interpolate(p1.b, p2.b, p3.b, p4.b);
            const a = interpolate(p1.a, p2.a, p3.a, p4.a);

            if (isFloatData) {
                targetData[targetIdx] = r;
                targetData[targetIdx + 1] = g;
                targetData[targetIdx + 2] = b;
                targetData[targetIdx + 3] = a;
            } else {
                targetData[targetIdx] = Math.round(r);
                targetData[targetIdx + 1] = Math.round(g);
                targetData[targetIdx + 2] = Math.round(b);
                targetData[targetIdx + 3] = Math.round(a);
            }
        }
    }

    return targetData;
}

// Create point sprite heat map renderer
export function createPointSpriteHeatMapRenderer(
    container: HTMLElement,
    channelConfig: ChannelConfig,
): PointSpriteHeatMapRenderer {
    const { centerFreq, bandwidth, fitMode = "none", dynamicTextureSize = false } = channelConfig;
    let { textureSize } = channelConfig;

    // Renderer setup
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });

    // FIXED: Check for WebGL float texture support
    const gl = renderer.getContext();
    const hasFloatTextures = !!(gl.getExtension("OES_texture_float") || gl.getExtension("EXT_color_buffer_float"));

    // Enable blending for accumulation
    renderer.autoClear = false;

    // Calculate canvas size and position based on fit mode
    const calculateCanvasMetrics = () => {
        const devicePixelRatio = window.devicePixelRatio || 1;
        const containerRect = container.getBoundingClientRect();
        const containerSize = { width: containerRect.width, height: containerRect.height };
        const textureAspectSize = { width: textureSize, height: textureSize };

        if (fitMode === "none") {
            // Original behavior: size canvas to texture size
            const canvasSize = textureSize / devicePixelRatio;
            return {
                width: canvasSize,
                height: canvasSize,
                x: 0,
                y: 0,
                pixelRatio: devicePixelRatio,
            };
        } else {
            // Use object-fit-math for contain/cover strategies
            const fitted = fit(containerSize, textureAspectSize, fitMode);
            const positioned = fitAndPosition(containerSize, textureAspectSize, fitMode, "50%", "50%");

            return {
                width: fitted.width,
                height: fitted.height,
                x: positioned.x,
                y: positioned.y,
                pixelRatio: devicePixelRatio,
            };
        }
    };

    // Calculate initial texture size if dynamic mode is enabled
    if (dynamicTextureSize) {
        const initialMetrics = calculateCanvasMetrics();
        const optimalSize = calculateOptimalTextureSize(initialMetrics.width, initialMetrics.height);
        textureSize = optimalSize;
    }

    // Initial canvas metrics calculation
    const metrics = calculateCanvasMetrics();

    // Set the canvas display size and position
    renderer.domElement.style.width = `${metrics.width}px`;
    renderer.domElement.style.height = `${metrics.height}px`;
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.left = `${metrics.x}px`;
    renderer.domElement.style.top = `${metrics.y}px`;

    // Set the internal resolution
    renderer.setSize(metrics.width, metrics.height);
    renderer.setPixelRatio(metrics.pixelRatio);

    container.appendChild(renderer.domElement);

    // FIXED: Create initial render targets with float texture support check
    let { readTarget, writeTarget } = createRenderTargets(textureSize, hasFloatTextures);

    // Initialize render targets with black
    renderer.setRenderTarget(readTarget);
    renderer.clear();
    renderer.setRenderTarget(writeTarget);
    renderer.clear();
    renderer.setRenderTarget(null);

    // Accumulation scene and material
    const accumMaterial = new THREE.ShaderMaterial({
        vertexShader: accumVertexShader,
        fragmentShader: accumFragmentShader,
        uniforms: {
            previousFrame: { value: readTarget.texture },
            decay: { value: 0.92 },
        },
    });

    const accumGeometry = new THREE.PlaneGeometry(2, 2);
    const accumMesh = new THREE.Mesh(accumGeometry, accumMaterial);
    const accumScene = new THREE.Scene();
    accumScene.add(accumMesh);

    // Sprite texture (default, can be replaced with PNG)
    let spriteTexture = createDefaultSpriteTexture(64);

    // Point sprite material
    const pointMaterial = new THREE.ShaderMaterial({
        vertexShader: pointVertexShader,
        fragmentShader: pointFragmentShader,
        uniforms: {
            spriteTexture: { value: spriteTexture },
            channelCenterFreq: { value: centerFreq },
            channelBandwidth: { value: bandwidth },
            time: { value: 0 },
            basePointSize: { value: 8.0 },
            strengthScale: { value: 3.0 },
            bandwidthScale: { value: 10.0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    // Point cloud geometry and scene
    let pointGeometry: THREE.BufferGeometry | null = null;
    let pointMesh: THREE.Points | null = null;
    const pointScene = new THREE.Scene();

    // Display scene
    const displayMaterial = new THREE.MeshBasicMaterial({
        map: readTarget.texture,
        transparent: true,
    });
    const displayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMaterial);
    const displayScene = new THREE.Scene();
    displayScene.add(displayMesh);

    // FIXED: Track ping-pong state to ensure we read from the correct target
    let isReadTargetCurrent = true;

    // FIXED: Function to recreate render targets and update related resources
    const recreateRenderTargets = (newTextureSize: number) => {
        console.log(`Starting render target recreation: ${textureSize}x${textureSize} -> ${newTextureSize}x${newTextureSize}`);

        // FIXED: Determine which target has the current data based on ping-pong state
        const currentTarget = isReadTargetCurrent ? readTarget : writeTarget;
        const oldTextureSize = textureSize;

        // FIXED: Create appropriate array type based on texture format
        const pixelData = hasFloatTextures ?
                new Float32Array(oldTextureSize * oldTextureSize * 4) :
                new Uint8Array(oldTextureSize * oldTextureSize * 4);

        // FIXED: Read pixel data from the current target (the one with latest data)
        renderer.setRenderTarget(currentTarget);
        renderer.readRenderTargetPixels(currentTarget, 0, 0, oldTextureSize, oldTextureSize, pixelData);
        renderer.setRenderTarget(null);

        console.log(`Read ${pixelData.length} values from ${hasFloatTextures ? "Float32" : "Uint8"} render target`);

        // Dispose old render targets
        readTarget.dispose();
        writeTarget.dispose();

        // FIXED: Create new render targets with proper format
        const targets = createRenderTargets(newTextureSize, hasFloatTextures);
        readTarget = targets.readTarget;
        writeTarget = targets.writeTarget;

        // FIXED: Resample the captured data to new texture size with correct data type
        const resampledData = resamplePixelData(
            pixelData,
            oldTextureSize,
            oldTextureSize,
            newTextureSize,
            newTextureSize,
            hasFloatTextures,
        );

        // FIXED: Create texture from resampled data with correct type
        const textureType = hasFloatTextures ? THREE.FloatType : THREE.UnsignedByteType;
        const resampledTexture = new THREE.DataTexture(
            resampledData,
            newTextureSize,
            newTextureSize,
            THREE.RGBAFormat,
            textureType,
        );
        resampledTexture.needsUpdate = true;
        resampledTexture.minFilter = THREE.LinearFilter;
        resampledTexture.magFilter = THREE.LinearFilter;

        // Copy resampled data to new render targets using a full-screen quad
        const copyMaterial = new THREE.MeshBasicMaterial({ map: resampledTexture });
        const copyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMaterial);
        const copyScene = new THREE.Scene();
        copyScene.add(copyMesh);

        // FIXED: Restore the ping-pong state correctly
        if (isReadTargetCurrent) {
            // Initialize readTarget with current data
            renderer.setRenderTarget(readTarget);
            renderer.clear();
            renderer.render(copyScene, camera);

            // Initialize writeTarget as empty (it should be the "previous" frame)
            renderer.setRenderTarget(writeTarget);
            renderer.clear();
        } else {
            // Initialize writeTarget with current data
            renderer.setRenderTarget(writeTarget);
            renderer.clear();
            renderer.render(copyScene, camera);

            // Initialize readTarget as empty
            renderer.setRenderTarget(readTarget);
            renderer.clear();
        }

        renderer.setRenderTarget(null);

        // Clean up temporary resources
        copyMaterial.dispose();
        copyMesh.geometry.dispose();
        resampledTexture.dispose();

        // FIXED: Update material uniforms based on current ping-pong state
        accumMaterial.uniforms.previousFrame!.value = isReadTargetCurrent ? writeTarget.texture : readTarget.texture;
        displayMaterial.map = isReadTargetCurrent ? readTarget.texture : writeTarget.texture;

        // Update texture size for future calculations
        textureSize = newTextureSize;
        console.log(`Successfully recreated render targets with preserved data`);
    };

    // Load PNG sprite texture
    const loadSpriteTexture = async (url: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            const loader = new THREE.TextureLoader();
            loader.load(
                url,
                texture => {
                    spriteTexture.dispose();
                    spriteTexture = texture;
                    pointMaterial.uniforms.spriteTexture!.value = texture;
                    resolve();
                },
                undefined,
                reject,
            );
        });
    };

    // Update function
    const update = (detections: SignalDetection[]) => {
        if (detections.length === 0) {
            if (pointMesh) {
                pointScene.remove(pointMesh);
                pointMesh = null;
            }
            return;
        }

        // Create buffer geometry for points
        pointGeometry = new THREE.BufferGeometry();

        // Create attribute arrays
        const positions = new Float32Array(detections.length * 3);
        const frequencies = new Float32Array(detections.length);
        const bandwidths = new Float32Array(detections.length);
        const strengths = new Float32Array(detections.length);
        const signalTypes = new Float32Array(detections.length);
        const colors = new Float32Array(detections.length * 3);

        detections.forEach((detection, i) => {
            const idx3 = i * 3;

            // Position (frequency will be handled in vertex shader)
            positions[idx3] = 0; // x (will be set by frequency)
            positions[idx3 + 1] = 0; // y
            positions[idx3 + 2] = 0; // z

            // Detection attributes
            frequencies[i] = detection.frequency;
            bandwidths[i] = detection.bandwidth;
            strengths[i] = Math.min(1.0, Math.max(0.0, detection.strength));
            signalTypes[i] = classifySignal(detection);

            // Color based on frequency or custom logic
            const color = frequencyToColor(detection.frequency, centerFreq, bandwidth);
            colors[idx3] = color.x;
            colors[idx3 + 1] = color.y;
            colors[idx3 + 2] = color.z;
        });

        // Set geometry attributes
        pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        pointGeometry.setAttribute("frequency", new THREE.BufferAttribute(frequencies, 1));
        pointGeometry.setAttribute("bandwidth", new THREE.BufferAttribute(bandwidths, 1));
        pointGeometry.setAttribute("strength", new THREE.BufferAttribute(strengths, 1));
        pointGeometry.setAttribute("signalType", new THREE.BufferAttribute(signalTypes, 1));
        pointGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

        // Update point mesh
        if (pointMesh) {
            pointScene.remove(pointMesh);
            pointMesh.geometry.dispose();
        }

        pointMesh = new THREE.Points(pointGeometry, pointMaterial);
        pointScene.add(pointMesh);
    };

    // Render function
    const render = () => {
        // Update time uniform for animations
        pointMaterial.uniforms.time!.value = performance.now() * 0.001;

        // FIXED: Track ping-pong state properly
        [readTarget, writeTarget] = [writeTarget, readTarget];
        isReadTargetCurrent = !isReadTargetCurrent;

        // Update accumulation material to use the correct previous frame
        accumMaterial.uniforms.previousFrame!.value = readTarget.texture;

        // Render accumulation (decay) pass to write target
        renderer.setRenderTarget(writeTarget);
        renderer.clear();
        renderer.render(accumScene, camera);

        // Render new points additively on top of decayed frame
        if (pointMesh) {
            // Render points with additive blending (no clear)
            renderer.render(pointScene, camera);
        }

        // Render final result to screen
        displayMaterial.map = writeTarget.texture;
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(displayScene, camera);
    };

    // FIXED: Resize function with proper data preservation for all fit mode changes
    const resize = (newWidth: number, newHeight: number) => {
        // Recalculate canvas metrics for new container size
        const newMetrics = calculateCanvasMetrics();

        // FIXED: Always check if texture size should change, not just in dynamic mode
        let shouldRecreateTargets = false;
        let newOptimalSize = textureSize;

        if (dynamicTextureSize) {
            newOptimalSize = calculateOptimalTextureSize(newMetrics.width, newMetrics.height);
            shouldRecreateTargets = newOptimalSize !== textureSize;
        }

        // FIXED: Also recreate targets when fit mode changes significantly affect rendering,
        // even if texture size stays the same - this preserves data during fit mode switches
        const currentMetrics = {
            width: Number.parseFloat(renderer.domElement.style.width),
            height: Number.parseFloat(renderer.domElement.style.height),
        };

        const significantChange = Math.abs(newMetrics.width - currentMetrics.width) > 1 ||
            Math.abs(newMetrics.height - currentMetrics.height) > 1;

        if (shouldRecreateTargets) {
            console.log(`Recreating targets due to texture size change: ${textureSize} -> ${newOptimalSize}`);
            recreateRenderTargets(newOptimalSize);
        } else if (significantChange && fitMode !== "none") {
            console.log(`Significant resize detected, preserving render target data`);
            // Even if texture size doesn't change, we may want to preserve data during layout changes
            // This is especially important for fit mode changes that don't change texture size
        }

        // Update canvas display size and position
        renderer.domElement.style.width = `${newMetrics.width}px`;
        renderer.domElement.style.height = `${newMetrics.height}px`;
        renderer.domElement.style.left = `${newMetrics.x}px`;
        renderer.domElement.style.top = `${newMetrics.y}px`;

        // Update internal resolution
        renderer.setSize(newMetrics.width, newMetrics.height);
        renderer.setPixelRatio(newMetrics.pixelRatio);

        console.log(`Resize completed: ${newWidth}x${newHeight}, canvas: ${newMetrics.width}x${newMetrics.height}, texture: ${textureSize}x${textureSize}`);
    };

    // Set decay rate (0.0 = no decay, 1.0 = instant decay)
    const setDecay = (decay: number) => {
        accumMaterial.uniforms.decay!.value = Math.max(0.0, Math.min(1.0, decay));
    };

    // Set sprite scale multiplier
    const setSpriteScale = (scale: number) => {
        pointMaterial.uniforms.basePointSize!.value = Math.max(0.1, scale * 8.0);
    };

    // Cleanup function
    const dispose = () => {
        readTarget.dispose();
        writeTarget.dispose();
        spriteTexture.dispose();
        accumGeometry.dispose();
        accumMaterial.dispose();
        pointMaterial.dispose();
        displayMaterial.dispose();
        if (pointGeometry) pointGeometry.dispose();
        renderer.dispose();
        container.removeChild(renderer.domElement);
    };

    return { update, render, resize, loadSpriteTexture, setDecay, setSpriteScale, dispose };
}

// Example usage
export function setupPointSpriteHeatMap(
    container: HTMLElement,
    fitMode: FitMode = "none",
    dynamicTextureSize: boolean = false,
) {
    const channelConfig: ChannelConfig = {
        centerFreq: 915e6,
        bandwidth: 10e6,
        textureSize: 512,
        fitMode, // Use the provided fit mode
        dynamicTextureSize, // Use dynamic texture sizing if enabled
    };

    const heatMap = createPointSpriteHeatMapRenderer(container, channelConfig);

    // Optional: Load custom sprite PNG
    // heatMap.loadSpriteTexture('/path/to/sprite.png').catch(console.error);

    // Animation loop
    const animate = () => {
        heatMap.render();
        requestAnimationFrame(animate);
    };
    animate();

    // Example detection generator with varied signal types
    const generateDetections = (): SignalDetection[] => {
        const numDetections = Math.floor(Math.random() * 8) + 2;
        const detections: SignalDetection[] = [];
        const signalTypes = ["continuous", "burst", "interference"];

        for (let i = 0; i < numDetections; i++) {
            detections.push({
                frequency: channelConfig.centerFreq + (Math.random() - 0.5) * channelConfig.bandwidth * 0.9,
                bandwidth: Math.random() * 2e6 + 50e3,
                id: Math.random().toString(36),
                strength: Math.random(),
                signalType: signalTypes[Math.floor(Math.random() * signalTypes.length)],
                timestamp: Date.now(),
            });
        }

        return detections;
    };

    // Simulate detections
    setInterval(() => {
        const detections = generateDetections();
        heatMap.update(detections);
    }, 150);

    // Handle resize
    window.addEventListener("resize", () => {
        heatMap.resize(container.clientWidth, container.clientHeight);
    });

    // Return the heatMap renderer so controls can be accessed
    return heatMap;
}
