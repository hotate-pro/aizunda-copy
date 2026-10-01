import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";

const canvas = document.getElementById("canvas");

class AvatarController {
  constructor() {
    this.vrm = null;
    this.plan = null;
    this.startedAt = 0;
    this.duration = 1;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeaf1df);

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
    this.camera.position.set(0, 1.1, 3.6);
    this.camera.lookAt(0, 0.95, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa98c, 2));

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(2, 3, 2);
    this.scene.add(key);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.1, 64),
      new THREE.MeshStandardMaterial({
        color: 0xd7e2c7,
        roughness: 1
      })
    );

    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    this.scene.add(ground);

    this.loader = new GLTFLoader();
    this.loader.register(
      (parser) => new VRMLoaderPlugin(parser)
    );

    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.last = performance.now();

    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async load(file) {
    const buffer = await file.arrayBuffer();

    const gltf = await new Promise((resolve, reject) => {
      this.loader.parse(
        buffer,
        "",
        resolve,
        reject
      );
    });

    const next = gltf.userData.vrm;

    if (!next) {
      throw new Error("VRMとして読み込めませんでした");
    }

    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
    }

    this.vrm = next;
    this.vrm.scene.rotation.y = Math.PI;
    this.vrm.scene.position.set(0, -1, 0);

    this.vrm.scene.traverse(
      (object) => {
        object.frustumCulled = false;
      }
    );

    this.scene.add(this.vrm.scene);
  }

  apply(plan) {
    this.plan = plan || null;
    this.startedAt = performance.now();
    this.duration = Math.max(
      250,
      Number(plan?.durationMs || 1200)
    );

    if (!this.vrm) {
      return;
    }

    const manager = this.vrm.expressionManager;

    if (manager && plan?.emotion) {
      for (const [name, value] of Object.entries(plan.emotion)) {
        try {
          manager.setValue(
            name,
            THREE.MathUtils.clamp(value, 0, 1)
          );
        } catch {
          // Not every VRM has every expression preset.
        }
      }
    }
  }

  update() {
    if (!this.vrm || !this.plan?.keyframes) {
      return;
    }

    const time = Math.min(
      1,
      (performance.now() - this.startedAt) / this.duration
    );

    const frames = this.plan.keyframes;
    let a = frames[0];
    let b = frames[frames.length - 1];

    for (let i = 0; i < frames.length - 1; i += 1) {
      if (
        time >= frames[i].t &&
        time <= frames[i + 1].t
      ) {
        a = frames[i];
        b = frames[i + 1];
        break;
      }
    }

    const span = Math.max(0.0001, b.t - a.t);
    const local = THREE.MathUtils.smoothstep(
      (time - a.t) / span,
      0,
      1
    );

    if (!this.vrm.humanoid) {
      return;
    }

    const boneNames = [
      "head",
      "chest",
      "leftUpperArm",
      "rightUpperArm"
    ];

    for (const name of boneNames) {
      const bone =
        this.vrm.humanoid.getNormalizedBoneNode(name);

      if (!bone) {
        continue;
      }

      const av = a.bones?.[name] || [0, 0, 0];
      const bv = b.bones?.[name] || av;

      const rx = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(av[0], bv[0], local),
        -0.9,
        0.9
      );

      const ry = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(av[1], bv[1], local),
        -0.9,
        0.9
      );

      const rz = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(av[2], bv[2], local),
        -0.9,
        0.9
      );

      bone.rotation.x = rx;
      bone.rotation.y = ry;
      bone.rotation.z = rz;
    }

    if (time >= 1) {
      this.plan = null;
    }
  }

  frame(time) {
    const dt = (time - this.last) / 1000;
    this.last = time;

    this.update();

    if (this.vrm) {
      this.vrm.update(dt);

      if (!this.plan && this.vrm.humanoid) {
        const head =
          this.vrm.humanoid.getNormalizedBoneNode("head");

        if (head) {
          head.rotation.z =
            Math.sin(time / 2100) * 0.035;
        }
      }
    }

    this.renderer.render(
      this.scene,
      this.camera
    );

    requestAnimationFrame((t) => this.frame(t));
  }
}

export const avatar = new AvatarController();
