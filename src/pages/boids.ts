import { AdditiveBlending, BufferAttribute, BufferGeometry, PerspectiveCamera, Points, PointsMaterial, Scene, Vector2, WebGLRenderer } from "three";
import { GPUComputationRenderer } from "three/examples/jsm/Addons.js";

export function startScene(el: HTMLElement) {
    let camera: PerspectiveCamera;
    let scene: Scene;
    let renderer: WebGLRenderer;
    let gpuCompute: GPUComputationRenderer;
    let points: Points;
    let positionVariable: ReturnType<GPUComputationRenderer["addVariable"]>;
    let velocityVariable: ReturnType<GPUComputationRenderer["addVariable"]>;

    const BOID_COUNT = 1000;
    const BOUNDS = 800;

    // Boid parameters
    const separation = 20.0;
    const alignment = 1.0;
    const cohesion = 1.0;
    const boundaryForce = 0.15;

    const positionShader = `
      uniform float time;
      uniform float delta;

      void main() {
          vec2 position = texture2D(texturePosition, uv).xy;
          vec2 velocity = texture2D(textureVelocity, uv).xy;

          position += velocity * delta;

          gl_FragColor = vec4(position, 0.0, 1.0);
      }
  `;

    const velocityShader = `
      uniform float time;
      uniform float delta;
      uniform float separation;
      uniform float alignment;
      uniform float cohesion;
      uniform float boundaryForce;
      uniform vec2 bounds;

      void main() {
          vec2 position = texture2D(texturePosition, uv).xy;
          vec2 velocity = texture2D(textureVelocity, uv).xy;

          vec2 separationForce = vec2(0.0);
          vec2 alignmentForce = vec2(0.0);
          vec2 cohesionForce = vec2(0.0);

          vec2 centerOfMass = vec2(0.0);
          vec2 averageVelocity = vec2(0.0);
          float neighborCount = 0.0;

          // Sample nearby boids
          for(float y = 0.0; y < 1.0; y += 0.1) {
              for(float x = 0.0; x < 1.0; x += 0.1) {
                  vec2 neighborPos = texture2D(texturePosition, vec2(x, y)).xy;
                  vec2 neighborVel = texture2D(textureVelocity, vec2(x, y)).xy;

                  float dist = distance(position, neighborPos);

                  if(dist > 0.0 && dist < 50.0) {
                      // Separation
                      vec2 diff = position - neighborPos;
                      separationForce += normalize(diff) / dist;

                      // Alignment
                      averageVelocity += neighborVel;

                      // Cohesion
                      centerOfMass += neighborPos;

                      neighborCount += 1.0;
                  }
              }
          }

          if(neighborCount > 0.0) {
              separationForce *= separation;

              averageVelocity /= neighborCount;
              alignmentForce = (averageVelocity - velocity) * alignment;

              centerOfMass /= neighborCount;
              cohesionForce = (centerOfMass - position) * cohesion;
          }

          // Boundary forces
          vec2 boundaryForces = vec2(0.0);
          if(abs(position.x) > bounds.x) {
              boundaryForces.x = -sign(position.x) * boundaryForce;
          }
          if(abs(position.y) > bounds.y) {
              boundaryForces.y = -sign(position.y) * boundaryForce;
          }

          // Update velocity
          velocity += separationForce + alignmentForce + cohesionForce + boundaryForces;

          // Limit velocity
          float speedLimit = 200.0;
          float speed = length(velocity);
          if(speed > speedLimit) {
              velocity = normalize(velocity) * speedLimit;
          }

          gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
  `;

    init();
    animate();

    function init() {
        camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 1, 3000);
        camera.position.z = 1400;

        scene = new Scene();

        renderer = new WebGLRenderer();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);
        el.appendChild(renderer.domElement);

        // Initialize GPGPU
        gpuCompute = new GPUComputationRenderer(64, 64, renderer);

        // Create textures
        const positionTexture = gpuCompute.createTexture();
        const velocityTexture = gpuCompute.createTexture();

        // Initialize textures with random positions and velocities
        const positionArray = positionTexture.image.data as Float32Array;
        const velocityArray = velocityTexture.image.data as Float32Array;

        for (let i = 0; i < positionArray.length; i += 4) {
            // Random position within bounds
            positionArray[i] = Math.random() * BOUNDS * 2 - BOUNDS;
            positionArray[i + 1] = Math.random() * BOUNDS * 2 - BOUNDS;

            // Random initial velocity
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 50 + 50;
            velocityArray[i] = Math.cos(angle) * speed;
            velocityArray[i + 1] = Math.sin(angle) * speed;
        }

        // Add compute shaders
        positionVariable = gpuCompute.addVariable("texturePosition", positionShader, positionTexture);
        velocityVariable = gpuCompute.addVariable("textureVelocity", velocityShader, velocityTexture);

        // Add variable dependencies
        gpuCompute.setVariableDependencies(positionVariable, [positionVariable, velocityVariable]);
        gpuCompute.setVariableDependencies(velocityVariable, [positionVariable, velocityVariable]);

        // Add uniforms
        const positionUniforms = positionVariable.material.uniforms;
        positionUniforms.time = { value: 0.0 };
        positionUniforms.delta = { value: 0.0 };

        const velocityUniforms = velocityVariable.material.uniforms;
        velocityUniforms.time = { value: 0.0 };
        velocityUniforms.delta = { value: 0.0 };
        velocityUniforms.separation = { value: separation };
        velocityUniforms.alignment = { value: alignment };
        velocityUniforms.cohesion = { value: cohesion };
        velocityUniforms.boundaryForce = { value: boundaryForce };
        velocityUniforms.bounds = { value: new Vector2(BOUNDS, BOUNDS) };

        // Initialize compute renderer
        const error = gpuCompute.init();
        if (error !== null) {
            console.error(error);
        }

        // Create boid geometry
        const geometry = new BufferGeometry();
        const positions = new Float32Array(BOID_COUNT * 3);
        const colors = new Float32Array(BOID_COUNT * 3);

        for (let i = 0; i < BOID_COUNT; i++) {
            positions[i * 3] = Math.random() * BOUNDS * 2 - BOUNDS;
            positions[i * 3 + 1] = Math.random() * BOUNDS * 2 - BOUNDS;
            positions[i * 3 + 2] = 0;

            colors[i * 3] = Math.random();
            colors[i * 3 + 1] = Math.random();
            colors[i * 3 + 2] = Math.random();
        }

        geometry.setAttribute("position", new BufferAttribute(positions, 3));
        geometry.setAttribute("color", new BufferAttribute(colors, 3));

        // Create material
        const material = new PointsMaterial({
            size: 5,
            vertexColors: true,
            blending: AdditiveBlending,
            transparent: true,
        });

        // Create points
        points = new Points(geometry, material);
        scene.add(points);

        window.addEventListener("resize", onWindowResize, false);
    }

    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    let lastTime = 0;

    function animate() {
        requestAnimationFrame(animate);

        const time = performance.now() * 0.001;
        const delta = Math.min(time - lastTime, 0.1);
        lastTime = time;

        // Update GPGPU computation
        positionVariable.material.uniforms.time!.value = time;
        positionVariable.material.uniforms.delta!.value = delta;
        velocityVariable.material.uniforms.time!.value = time;
        velocityVariable.material.uniforms.delta!.value = delta;

        gpuCompute.compute();

        // Update positions
        const positionAttr = points.geometry.attributes.position!;
        const positions = positionAttr.array;
        const positionTarget = gpuCompute.getCurrentRenderTarget(positionVariable);

        const width = 64; // This should be defined elsewhere
        for (let i = 0; i < BOID_COUNT; i++) {
            const x = i % width;
            const y = Math.floor(i / width);
            const pixelData = new Float32Array(4);
            renderer.readRenderTargetPixels(
                positionTarget,
                x,
                y,
                1,
                1,
                pixelData,
            );

            positions[i * 3] = pixelData[0]!;
            positions[i * 3 + 1] = pixelData[1]!;
        }

        positionAttr.needsUpdate = true;

        renderer.render(scene, camera);
    }
}
