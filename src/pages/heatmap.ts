import * as THREE from "three";

// Types
interface SignalDetection {
    frequency: number; // Center frequency of detection
    bandwidth: number; // Bandwidth of the detected signal
    strength: number; // Signal strength (0-1)
    timestamp: number; // Detection timestamp
}

interface ChannelConfig {
    centerFreq: number; // Channel center frequency
    bandwidth: number; // Total channel bandwidth
    textureSize: number; // Power of 2 texture size (512, 1024, etc.)
}

interface HeatMapRenderer {
    update: (detections: SignalDetection[]) => void;
    render: () => void;
    resize: (width: number, height: number) => void;
    setSpriteScale: (scale: number) => void;
    dispose: () => void;
}

// Vertex shader for accumulation pass
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
    // Apply decay to previous frame
    gl_FragColor = vec4(prev.rgb * decay, 1.0);
  }
`;

/*
// Vertex shader for signal sprites
const spriteVertexShader = `
  attribute float frequency;
  attribute float bandwidth;
  attribute float strength;

  uniform float channelCenterFreq;
  uniform float channelBandwidth;
  uniform float textureSize;
  uniform float aspect;
  uniform float spriteScale;

  varying float vStrength;
  varying vec2 vUv;

  void main() {
    vStrength = strength;
    vUv = uv;

    // Convert frequency to normalized coordinate (-1 to 1)
    float freqOffset = frequency - channelCenterFreq;
    float normalizedFreq = (freqOffset / (channelBandwidth * 0.5));

    // Scale sprite size based on bandwidth relative to channel bandwidth
    float bandwidthScale = bandwidth / channelBandwidth;
    float baseSize = max(0.005, bandwidthScale * 0.02); // Much smaller base size
    float finalSize = baseSize * spriteScale; // Apply uniform scaling

    // Position sprite at frequency location
    vec3 pos = position;
    pos.x = normalizedFreq;
    pos.y = 0.0; // Center vertically, could be time-based

    // Scale by final size and apply aspect ratio correction
    pos.xy *= finalSize;
    pos.x *= aspect;

    gl_Position = vec4(pos.xy, 0.0, 1.0);
  }
`;

// Fragment shader for signal sprites with PNG texture
const spriteFragmentShader = `
  uniform sampler2D spriteTexture;
  varying float vStrength;
  varying vec2 vUv;

  void main() {
    vec4 sprite = texture2D(spriteTexture, vUv);

    // Color based on signal strength (black to red)
    // At strength 0: black (0,0,0)
    // At strength 1: red (1,0,0)
    vec3 strengthColor = vec3(vStrength, 0.0, 0.0);

    // Apply strength-based red coloring to the sprite
    // Use the sprite's alpha channel but override the color
    // vec3 finalColor = strengthColor * sprite.a;
    vec3 finalColor = vec3(1.0);
    float alpha = sprite.a * vStrength;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;
*/

// Load PNG sprite texture
function loadSpriteTexture(imagePath: string): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => {
        const loader = new THREE.TextureLoader();
        loader.load(
            imagePath,
            texture => {
                // Configure texture settings for sprites
                texture.generateMipmaps = false;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.wrapS = THREE.ClampToEdgeWrapping;
                texture.wrapT = THREE.ClampToEdgeWrapping;
                resolve(texture);
            },
            undefined,
            error => {
                console.error("Error loading sprite texture:", error);
                reject(error);
            },
        );
    });
}

// Create fallback glow texture if sprite fails to load
function createGlowTexture(size: number): THREE.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2;

    const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)");
    gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.5)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0.0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

// Create signal detection heat map renderer
export async function createSignalHeatMapRenderer(
    container: HTMLElement,
    channelConfig: ChannelConfig,
    _spriteImagePath?: string,
): Promise<HeatMapRenderer> {
    const { textureSize, centerFreq: _centerFreq, bandwidth: _bandwidth } = channelConfig;

    // Scene setup
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });

    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    // Check for WebGL float texture support
    const gl = renderer.getContext();
    const hasFloatTextures = gl.getExtension("OES_texture_float") || gl.getExtension("EXT_color_buffer_float");

    // Ping-pong render targets with fallback
    const rtParams = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: hasFloatTextures ? THREE.FloatType : THREE.UnsignedByteType,
    };

    const readTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, rtParams);
    const writeTarget = new THREE.WebGLRenderTarget(textureSize, textureSize, rtParams);

    // Initialize render targets with a clear color
    renderer.setRenderTarget(readTarget);
    renderer.clear();
    renderer.setRenderTarget(writeTarget);
    renderer.clear();
    renderer.setRenderTarget(null);

    // Accumulation material (for decay)
    const accumMaterial = new THREE.ShaderMaterial({
        vertexShader: accumVertexShader,
        fragmentShader: accumFragmentShader,
        uniforms: {
            previousFrame: { value: readTarget.texture },
            decay: { value: 0.95 }, // Adjust decay rate
        },
    });

    // Full-screen quad for accumulation
    const accumGeometry = new THREE.PlaneGeometry(2, 2);
    const accumMesh = new THREE.Mesh(accumGeometry, accumMaterial);
    const accumScene = new THREE.Scene();
    accumScene.add(accumMesh);

    // Load sprite texture or use fallback
    let _spriteTexture: THREE.Texture;
    try {
        if (_spriteImagePath) {
            _spriteTexture = await loadSpriteTexture(_spriteImagePath);
        } else {
            _spriteTexture = createGlowTexture(64);
        }
    } catch (error) {
        console.warn("Failed to load sprite texture, using fallback:", error);
        _spriteTexture = createGlowTexture(64);
    }

    // Signal sprite material - simplified for debugging
    const spriteMaterial = new THREE.MeshBasicMaterial({
        color: 0xFF0000,
        transparent: true,
        opacity: 0.8,
    });

    // TODO: Re-enable shader material once basic rendering works
    /*
    const spriteMaterial = new THREE.ShaderMaterial({
        vertexShader: spriteVertexShader,
        fragmentShader: spriteFragmentShader,
        uniforms: {
            spriteTexture: { value: spriteTexture },
            channelCenterFreq: { value: centerFreq },
            channelBandwidth: { value: bandwidth },
            textureSize: { value: textureSize },
            aspect: { value: width / height },
            spriteScale: { value: 1.0 }, // Adjustable sprite scale
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    */

    // Signal sprites scene
    const spriteScene = new THREE.Scene();

    // Display material for final render
    const displayMaterial = new THREE.MeshBasicMaterial({
        map: writeTarget.texture,
        transparent: false,
    });
    const displayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMaterial);
    const displayScene = new THREE.Scene();
    displayScene.add(displayMesh);

    // Add some debugging
    console.warn("Heatmap renderer initialized:", {
        containerSize: { width, height },
        textureSize,
        hasFloatTextures,
        webglVersion: renderer.capabilities.isWebGL2 ? 2 : 1,
    });

    // Test quad removed - now using dynamic sprites

    // Update function
    const update = (detections: SignalDetection[]) => {
        console.warn(`Update called with ${detections.length} detections`);
        if (detections.length === 0) return;

        // Simplified: create individual meshes for each detection
        // Clear previous sprites - not needed since we clear all children below

        // Clear all children from sprite scene
        while (spriteScene.children.length > 0) {
            const child = spriteScene.children[0]!;
            spriteScene.remove(child);
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
            }
        }

        // Create individual sprites for each detection
        detections.forEach((detection, i) => {
            const geometry = new THREE.PlaneGeometry(0.2, 0.2); // Larger size for visibility
            const mesh = new THREE.Mesh(geometry, spriteMaterial);

            // Position based on detection index for now (simple test)
            mesh.position.x = (i - detections.length / 2) * 0.3;
            mesh.position.y = Math.sin(detection.strength * Math.PI) * 0.2; // Vary Y based on strength

            spriteScene.add(mesh);
            console.warn(`Added sprite ${i} at position (${mesh.position.x.toFixed(2)}, ${mesh.position.y.toFixed(2)})`);
        });

        console.warn(`Created ${detections.length} individual sprite meshes`);
    };

    // Render function
    const render = () => {
        // Simplified: render sprites directly to screen for debugging
        renderer.setRenderTarget(null);
        renderer.clear();

        // Render sprites directly
        if (spriteScene.children.length > 0) {
            console.warn("Rendering sprite scene with", spriteScene.children.length, "sprites");
            renderer.render(spriteScene, camera);
        } else {
            console.warn("No sprites to render");
        }

        // TODO: Re-enable render target system once sprites work
        /*
        // Ping-pong swap
        [readTarget, writeTarget] = [writeTarget, readTarget];
        accumMaterial.uniforms.previousFrame.value = readTarget.texture;

        // Render accumulation (decay previous frame)
        renderer.setRenderTarget(writeTarget);
        renderer.clear();
        renderer.render(accumScene, camera);

        // Render new sprites on top
        if (spriteMesh && spriteGeometry) {
            renderer.render(spriteScene, camera);
        }

        // Render to screen
        displayMaterial.map = writeTarget.texture;
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(displayScene, camera);
        */
    };

    // Resize function
    const resize = (newWidth: number, newHeight: number) => {
        renderer.setSize(newWidth, newHeight);
        // TODO: Re-enable when using shader material
        // spriteMaterial.uniforms.aspect.value = newWidth / newHeight;
    };

    // Set sprite scale function - disabled for basic material
    const setSpriteScale = (_scale: number) => {
        // TODO: Re-enable when using shader material
        // spriteMaterial.uniforms.spriteScale.value = scale;
        console.warn("Sprite scale not available with basic material");
    };

    // Cleanup function
    const dispose = () => {
        readTarget.dispose();
        writeTarget.dispose();
        _spriteTexture.dispose();
        accumGeometry.dispose();
        accumMaterial.dispose();
        spriteMaterial.dispose();
        displayMaterial.dispose();
        // spriteGeometry cleanup not needed - using individual meshes now
        renderer.dispose();
        container.removeChild(renderer.domElement);
    };

    return { update, render, resize, setSpriteScale, dispose };
}

// Example usage function
export async function setupSignalHeatMap(container: HTMLElement, spriteImagePath?: string) {
    const channelConfig: ChannelConfig = {
        centerFreq: 915e6, // 915 MHz
        bandwidth: 10e6, // 10 MHz channel
        textureSize: 512, // 512x512 texture
    };

    const heatMap = await createSignalHeatMapRenderer(container, channelConfig, spriteImagePath);

    // Animation loop
    const animate = () => {
        heatMap.render();
        requestAnimationFrame(animate);
    };
    animate();

    // Example detection data generator
    const generateDetections = (): SignalDetection[] => {
        const numDetections = Math.floor(Math.random() * 5) + 1;
        const detections: SignalDetection[] = [];

        for (let i = 0; i < numDetections; i++) {
            detections.push({
                frequency: channelConfig.centerFreq + (Math.random() - 0.5) * channelConfig.bandwidth * 0.8,
                bandwidth: Math.random() * 1e6 + 100e3, // 100kHz to 1.1MHz
                strength: Math.random(),
                timestamp: Date.now(),
            });
        }

        return detections;
    };

    // Simulate incoming detections
    setInterval(() => {
        const detections = generateDetections();
        heatMap.update(detections);
    }, 100);

    // Handle resize
    window.addEventListener("resize", () => {
        heatMap.resize(container.clientWidth, container.clientHeight);
    });

    return heatMap;
}
