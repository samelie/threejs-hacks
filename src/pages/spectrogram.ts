import * as THREE from "three";

export function startScene(canvas: HTMLCanvasElement, options: Record<string, unknown> = {}) {
    // In the defaultOptions object at the beginning:
    const defaultOptions = {
        direction: "down", // Can be 'down', 'up', 'left', or 'right'
        colorScale: new THREE.Vector3(1.0, 0.5, 0.2),
        dataSource: "auto", // Can be 'audio', 'video', or 'auto' (prefers video if available)
    };

    // Merge with user options
    const config = { ...defaultOptions, ...options };

    // Constants for the spectrogram
    const FFT_SIZE = 4096;
    const TEXTURE_HEIGHT = 4096;
    const TEXTURE_WIDTH = FFT_SIZE;

    let updateTextureFromVideo: (() => void) | null = null;

    // Three.js components
    let scene: THREE.Scene;
    let camera: THREE.OrthographicCamera;
    let renderer: THREE.WebGLRenderer;
    let quadMesh: THREE.Mesh;

    // Audio components
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let fftData: Uint8Array<ArrayBuffer>;

    // Ping-pong render targets and materials
    let renderTargetA: THREE.WebGLRenderTarget;
    let renderTargetB: THREE.WebGLRenderTarget;
    let currentRenderTarget: THREE.WebGLRenderTarget;
    let previousRenderTarget: THREE.WebGLRenderTarget;
    let pingPongMaterial: THREE.ShaderMaterial;
    let displayMaterial: THREE.ShaderMaterial;

    // Scenes for rendering
    let pingPongScene: THREE.Scene;
    let pingPongCamera: THREE.OrthographicCamera;

    // Data texture for new FFT row
    let fftRowTexture: THREE.DataTexture;

    // Initialize the scene, camera, renderer and geometry
    function initGraphics() {
    // Create renderer
        renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
        });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);

        // Create the main scene for display
        scene = new THREE.Scene();

        // Create orthographic camera for the main display
        const aspect = canvas.clientWidth / canvas.clientHeight;
        camera = new THREE.OrthographicCamera(
            -0.5 * aspect,
            0.5 * aspect,
            0.5,
            -0.5,
            0.1,
            1000,
        );
        camera.position.z = 2;

        // Create ping-pong scene and camera (will be used for off-screen rendering)
        pingPongScene = new THREE.Scene();
        pingPongCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 1000);
        pingPongCamera.position.z = 1;

        // Initialize render targets
        initRenderTargets();

        // Initialize the FFT row texture
        initFFTRowTexture();

        // Create ping-pong material for scrolling the spectrogram
        pingPongMaterial = new THREE.ShaderMaterial({
            defines: getShaderDefines(),
            uniforms: {
                previousFrame: { value: null },
                newFFTRow: { value: null },
                textureSize: { value: new THREE.Vector2(TEXTURE_WIDTH, TEXTURE_HEIGHT) },
            },
            vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: `
        uniform sampler2D previousFrame;
        uniform sampler2D newFFTRow;
        uniform vec2 textureSize;
        varying vec2 vUv;

        void main() {
          // Calculate pixel coordinates
          vec2 pixelCoord = vUv * textureSize;
          vec2 sourceUv = vUv;
          bool isNewDataPosition = false;

          #ifdef DIRECTION_DOWN
            // If this is the first row (top row), use new FFT data
            if (pixelCoord.y < 1.0) {
              isNewDataPosition = true;
            } else {
              // For all other rows, sample from the previous frame but shifted down by one pixel
              sourceUv = vec2(vUv.x, (pixelCoord.y - 1.0) / textureSize.y);
            }
          #endif

          #ifdef DIRECTION_UP
            // If this is the last row (bottom row), use new FFT data
            if (pixelCoord.y > textureSize.y - 1.0) {
              isNewDataPosition = true;
            } else {
              // For all other rows, sample from the previous frame but shifted up by one pixel
              sourceUv = vec2(vUv.x, (pixelCoord.y + 1.0) / textureSize.y);
            }
          #endif

          #ifdef DIRECTION_RIGHT
            // If this is the first column (left edge), use new FFT data
            if (pixelCoord.x < 1.0) {
              isNewDataPosition = true;
            } else {
              // For all other columns, sample from the previous frame but shifted right by one pixel
              sourceUv = vec2((pixelCoord.x - 1.0) / textureSize.x, vUv.y);
            }
          #endif

          #ifdef DIRECTION_LEFT
            // If this is the last column (right edge), use new FFT data
            if (pixelCoord.x > textureSize.x - 1.0) {
              isNewDataPosition = true;
            } else {
              // For all other columns, sample from the previous frame but shifted left by one pixel
              sourceUv = vec2((pixelCoord.x + 1.0) / textureSize.x, vUv.y);
            }
          #endif

          if (isNewDataPosition) {
            // For horizontal directions, we need to swap x and y in the texture lookup
            #if defined(DIRECTION_LEFT) || defined(DIRECTION_RIGHT)
              float intensity = texture2D(newFFTRow, vec2(vUv.y, 0.5)).r;
            #else
              float intensity = texture2D(newFFTRow, vec2(vUv.x, 0.5)).r;
            #endif

            gl_FragColor = vec4(intensity, 0.0, 0.0, 1.0);
          } else {
            gl_FragColor = texture2D(previousFrame, sourceUv);
          }
        }
      `,
        });

        // Create display material for the final rendering to screen
        displayMaterial = new THREE.ShaderMaterial({
            uniforms: {
                spectrogramTexture: { value: null },
                colorScale: { value: config.colorScale },
            },
            vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
            fragmentShader: `
        uniform sampler2D spectrogramTexture;
        uniform vec3 colorScale;
        varying vec2 vUv;

        void main() {
          float intensity = texture2D(spectrogramTexture, vUv).r;

          // Apply color mapping based on intensity
          vec3 color = vec3(
            colorScale.x * intensity,
            colorScale.y * intensity * intensity,
            colorScale.z * intensity * intensity * intensity
          );

          gl_FragColor = vec4(color, 1.0);
        }
      `,
        });

        // Create a quad for the ping-pong scene
        const pingPongQuad = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            pingPongMaterial,
        );
        pingPongScene.add(pingPongQuad);

        // Create a quad for the main scene (display)
        quadMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            displayMaterial,
        );

        // For horizontal waterfall directions, rotate the quad
        if (config.direction === "left" || config.direction === "right") {
            quadMesh.rotation.z = Math.PI / 2;
        }

        scene.add(quadMesh);
    }

    // Create shader defines based on the direction
    function getShaderDefines() {
        switch (config.direction) {
            case "up":
                return { DIRECTION_UP: "" };
            case "left":
                return { DIRECTION_LEFT: "" };
            case "right":
                return { DIRECTION_RIGHT: "" };
            case "down":
            default:
                return { DIRECTION_DOWN: "" };
        }
    }

    // Initialize the ping-pong render targets
    function initRenderTargets() {
        const options = {
            format: THREE.RGBAFormat,
            type: THREE.FloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            generateMipmaps: false,
        };

        renderTargetA = new THREE.WebGLRenderTarget(TEXTURE_WIDTH, TEXTURE_HEIGHT, options);
        renderTargetB = new THREE.WebGLRenderTarget(TEXTURE_WIDTH, TEXTURE_HEIGHT, options);

        // Initialize both render targets with black
        clearRenderTarget(renderTargetA);
        clearRenderTarget(renderTargetB);

        // Set initial targets
        currentRenderTarget = renderTargetA;
        previousRenderTarget = renderTargetB;
    }

    // Clear a render target to black
    function clearRenderTarget(target: THREE.WebGLRenderTarget) {
        const oldTarget = renderer.getRenderTarget();
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.setRenderTarget(oldTarget);
    }

    // Initialize the FFT row texture
    function initFFTRowTexture() {
    // Create a data texture for the FFT row
        const data = new Float32Array(TEXTURE_WIDTH * 4);

        fftRowTexture = new THREE.DataTexture(
            data,
            TEXTURE_WIDTH,
            1,
            THREE.RGBAFormat,
            THREE.FloatType,
        );

        fftRowTexture.needsUpdate = true;
    }

    // Update the FFT row texture with current audio data
    function updateFFTRowTexture() {
        if (!analyser) return;

        // Get frequency data from the analyzer
        analyser.getByteFrequencyData(fftData);

        // Update the texture with normalized FFT data (0.0 - 1.0)
        const data = fftRowTexture.image.data as Float32Array;
        for (let i = 0; i < TEXTURE_WIDTH; i++) {
            const normalizedValue = (fftData[i] ?? 0) / 255.0;
            const pixelIndex = i * 4;

            data[pixelIndex] = normalizedValue; // R
            data[pixelIndex + 1] = 0; // G
            data[pixelIndex + 2] = 0; // B
            data[pixelIndex + 3] = 1; // A
        }

        fftRowTexture.needsUpdate = true;
    }

    // Swap the ping-pong render targets
    function swapRenderTargets() {
        const temp = currentRenderTarget;
        currentRenderTarget = previousRenderTarget;
        previousRenderTarget = temp;
    }

    // Initialize audio processing
    async function initAudio() {
        try {
            audioContext = new AudioContext();

            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Create analyzer
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = FFT_SIZE * 2; // fftSize must be 2x the desired frequency bin count
            analyser.smoothingTimeConstant = 0.7;
            source.connect(analyser);

            // Create buffer for FFT data
            fftData = new Uint8Array(analyser.frequencyBinCount);

            return true;
        } catch (error) {
            console.error("Error initializing audio:", error);
            return false;
        }
    }

    // Handle window resize
    function handleResize() {
        if (!renderer || !camera) return;

        // Update renderer and camera
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const aspect = width / height;

        renderer.setSize(width, height);

        camera.left = -0.5 * aspect;
        camera.right = 0.5 * aspect;
        camera.updateProjectionMatrix();
    }

    function animate() {
        requestAnimationFrame(animate);

        // Update texture data from either audio or video
        if (updateTextureFromVideo) {
            // Use video data if available
            updateTextureFromVideo();
        } else if (analyser) {
            // Fall back to audio data
            updateFFTRowTexture();
        }

        // Set uniforms for the ping-pong material
        pingPongMaterial.uniforms.previousFrame!.value = previousRenderTarget.texture;
        pingPongMaterial.uniforms.newFFTRow!.value = fftRowTexture;

        // Render to the current render target
        renderer.setRenderTarget(currentRenderTarget);
        renderer.render(pingPongScene, pingPongCamera);

        // Set the current render target as the texture for the display
        displayMaterial.uniforms.spectrogramTexture!.value = currentRenderTarget.texture;

        // Swap render targets for the next frame
        swapRenderTargets();

        // Render the final result to the screen
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
    }
    function dispose() {
        if (audioContext) {
            audioContext.close();
        }

        // Clean up video elements if they exist
        const videoElements = document.querySelectorAll("video");
        videoElements.forEach(video => {
            // Stop tracks on stream if it exists
            if (video.srcObject instanceof MediaStream) {
                const stream = video.srcObject;
                stream.getTracks().forEach(track => track.stop());
            }
            // Remove the element
            if (video.parentNode) {
                video.parentNode.removeChild(video);
            }
        });

        if (renderer) {
            renderTargetA.dispose();
            renderTargetB.dispose();
            fftRowTexture.dispose();
            renderer.dispose();
        }

        // Remove event listener
        window.removeEventListener("resize", handleResize);
    }

    async function startSpectrogram() {
        initGraphics();

        // Initialize both audio and video sources
        await initAudio();

        // Initialize video source regardless of audio status
        updateTextureFromVideo = await initVideoSource(fftRowTexture, TEXTURE_WIDTH);

        // Add resize listener
        window.addEventListener("resize", handleResize);
        handleResize();

        // Start animation loop
        animate();

        // Return success if either audio or video initialized successfully
        return updateTextureFromVideo !== null;
    }

    return {
        startSpectrogram,
        dispose,
    };
}

// Function to use webcam video as an alternative data source
async function initVideoSource(fftRowTexture: THREE.DataTexture, textureWidth: number) {
    // Create hidden video element
    const video = document.createElement("video");
    video.autoplay = true;
    video.muted = true;
    video.style.display = "none";
    document.body.appendChild(video);

    // Create offscreen canvas matching the FFT width
    const canvas = document.createElement("canvas");
    canvas.width = textureWidth;
    canvas.height = 240; // Reasonable height for webcam aspect ratio
    const ctx = canvas.getContext("2d");

    if (!ctx) {
        console.error("Could not get 2D context from canvas");
        return null;
    }

    try {
    // Get webcam access
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;

        // Wait for video to be ready
        await new Promise<void>(resolve => {
            video.onloadedmetadata = () => {
                video.play();
                resolve();
            };
        });

        // Function to update the texture with video data
        // ctx is guaranteed non-null here (checked above with early return)
        const context = ctx;
        function updateTextureFromVideo() {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                // Draw the current video frame to the canvas
                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Get the middle row of pixels (or any row you want to sample)
                const rowY = Math.floor(canvas.height / 2);
                const imageData = context.getImageData(0, rowY, textureWidth, 1);
                const pixels = imageData.data;

                // Update the texture with the pixel data
                const data = fftRowTexture.image.data as Float32Array;
                for (let i = 0; i < textureWidth; i++) {
                    const pixelIndex = i * 4;
                    // Convert RGB to intensity (simple average or use luminance formula)
                    // Luminance formula: 0.299*R + 0.587*G + 0.114*B
                    const r = (pixels[pixelIndex] ?? 0) / 255;
                    const g = (pixels[pixelIndex + 1] ?? 0) / 255;
                    const b = (pixels[pixelIndex + 2] ?? 0) / 255;
                    const intensity = 0.299 * r + 0.587 * g + 0.114 * b;

                    data[pixelIndex] = intensity; // R
                    data[pixelIndex + 1] = 0; // G
                    data[pixelIndex + 2] = 0; // B
                    data[pixelIndex + 3] = 1; // A
                }

                fftRowTexture.needsUpdate = true;
            }
        }

        return updateTextureFromVideo;
    } catch (error) {
        console.error("Error initializing video:", error);
        return null;
    }
}
