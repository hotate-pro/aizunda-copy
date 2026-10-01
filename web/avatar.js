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

    this.rest = new Map();
    this.blinkTimer = 0;
    this.blinkUntil = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true
    });

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.outputColorSpace =
      THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background =
      new THREE.Color(0xeaf1df);

    this.camera = new THREE.PerspectiveCamera(
      28,
      1,
      0.05,
      100
    );

    this.scene.add(
      new THREE.HemisphereLight(
        0xffffff,
        0x9aa98c,
        2
      )
    );

    const key =
      new THREE.DirectionalLight(
        0xffffff,
        2.1
      );
    key.position.set(2, 3, 2);
    this.scene.add(key);

    const ground =
      new THREE.Mesh(
        new THREE.CircleGeometry(
          2.1,
          64
        ),
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
      (parser) =>
        new VRMLoaderPlugin(parser)
    );

    this.resize();

    window.addEventListener(
      "resize",
      () => {
        this.resize();

        if (this.vrm) {
          this.fitCamera();
        }
      }
    );

    this.last = performance.now();

    requestAnimationFrame(
      (time) => this.frame(time)
    );
  }

  resize() {
    const rect =
      canvas.getBoundingClientRect();

    const width =
      Math.max(1, rect.width);
    const height =
      Math.max(1, rect.height);

    this.renderer.setSize(
      width,
      height,
      false
    );

    this.camera.aspect =
      width / height;

    this.camera.updateProjectionMatrix();
  }

  async load(file) {
    const buffer =
      await file.arrayBuffer();

    const gltf =
      await new Promise(
        (resolve, reject) => {
          this.loader.parse(
            buffer,
            "",
            resolve,
            reject
          );
        }
      );

    const next =
      gltf.userData.vrm;

    if (!next) {
      throw new Error(
        "VRMとして読み込めませんでした"
      );
    }

    if (this.vrm) {
      this.scene.remove(
        this.vrm.scene
      );
    }

    this.vrm = next;
    this.vrm.scene.rotation.y =
      Math.PI;
    this.vrm.scene.position.set(
      0,
      0,
      0
    );

    this.vrm.scene.traverse(
      (object) => {
        object.frustumCulled = false;
      }
    );

    this.scene.add(
      this.vrm.scene
    );

    this.captureRestPose();
    this.fitModelToGround();
    this.fitCamera();

    return this.vrm;
  }

  captureRestPose() {
    this.rest.clear();

    if (!this.vrm?.humanoid) {
      return;
    }

    for (const name of [
      "hips",
      "chest",
      "head",
      "leftUpperArm",
      "rightUpperArm",
      "leftLowerArm",
      "rightLowerArm"
    ]) {
      const bone =
        this.vrm.humanoid
          .getNormalizedBoneNode(
            name
          );

      if (bone) {
        this.rest.set(
          name,
          bone.quaternion.clone()
        );
      }
    }
  }

  fitModelToGround() {
    if (!this.vrm) {
      return;
    }

    const box =
      new THREE.Box3().setFromObject(
        this.vrm.scene
      );

    if (!Number.isFinite(box.min.y)) {
      return;
    }

    this.vrm.scene.position.y +=
      -1 - box.min.y;
  }

  fitCamera() {
    if (!this.vrm) {
      return;
    }

    const box =
      new THREE.Box3().setFromObject(
        this.vrm.scene
      );

    const size =
      new THREE.Vector3();
    const center =
      new THREE.Vector3();

    box.getSize(size);
    box.getCenter(center);

    const height =
      Math.max(1, size.y);

    const targetY =
      center.y + height * 0.02;

    const fov =
      THREE.MathUtils.degToRad(
        this.camera.fov
      );

    const distance =
      Math.max(
        2.2,
        (height * 1.10) /
          (2 * Math.tan(fov / 2))
      );

    this.camera.position.set(
      0,
      targetY,
      distance
    );

    this.camera.lookAt(
      0,
      targetY,
      0
    );
  }

  setBoneOffset(
    name,
    x,
    y,
    z
  ) {
    const bone =
      this.vrm?.humanoid
        ?.getNormalizedBoneNode(
          name
        );

    if (!bone) {
      return;
    }

    const rest =
      this.rest.get(name);

    if (rest) {
      bone.quaternion.copy(rest);
    }

    bone.rotation.x +=
      THREE.MathUtils.clamp(
        x,
        -0.9,
        0.9
      );

    bone.rotation.y +=
      THREE.MathUtils.clamp(
        y,
        -0.9,
        0.9
      );

    bone.rotation.z +=
      THREE.MathUtils.clamp(
        z,
        -0.9,
        0.9
      );
  }

  apply(plan) {
    this.plan =
      plan || null;

    this.startedAt =
      performance.now();

    this.duration =
      Math.max(
        250,
        Number(
          plan?.durationMs ||
          1200
        )
      );

    const manager =
      this.vrm?.expressionManager;

    if (
      manager &&
      plan?.emotion
    ) {
      for (
        const [name, value]
        of Object.entries(
          plan.emotion
        )
      ) {
        try {
          manager.setValue(
            name,
            THREE.MathUtils.clamp(
              value,
              0,
              1
            )
          );
        } catch {
          // VRM expression presets are optional.
        }
      }
    }
  }

  applyIdle(time, dt) {
    if (!this.vrm?.humanoid) {
      return;
    }

    const breathing =
      Math.sin(time / 850) * 0.025;

    const sway =
      Math.sin(time / 1700) * 0.018;

    const nod =
      Math.sin(time / 2300) * 0.018;

    this.setBoneOffset(
      "hips",
      breathing * 0.12,
      0,
      sway * 0.7
    );

    this.setBoneOffset(
      "chest",
      -breathing * 0.35,
      0,
      sway
    );

    this.setBoneOffset(
      "head",
      nod,
      sway * 0.4,
      -sway * 0.55
    );

    this.setBoneOffset(
      "leftUpperArm",
      0,
      0,
      Math.sin(time / 1500) * 0.025
    );

    this.setBoneOffset(
      "rightUpperArm",
      0,
      0,
      -Math.sin(time / 1500) * 0.025
    );

    this.updateBlink(time);
  }

  updateBlink(time) {
    const manager =
      this.vrm?.expressionManager;

    if (!manager) {
      return;
    }

    if (
      time > this.blinkTimer
    ) {
      this.blinkTimer =
        time +
        2800 +
        Math.random() * 2600;
      this.blinkUntil =
        time + 130;
    }

    const closing =
      time < this.blinkUntil
        ? 1
        : 0;

    const presets = [
      "blink",
      "Blink",
      "happyBlink"
    ];

    for (const preset of presets) {
      try {
        manager.setValue(
          preset,
          closing
        );
      } catch {
        // Expression is optional.
      }
    }
  }

  applyPlan() {
    if (
      !this.vrm?.humanoid ||
      !this.plan?.keyframes
    ) {
      return false;
    }

    const time =
      Math.min(
        1,
        (performance.now() -
          this.startedAt) /
          this.duration
      );

    const frames =
      this.plan.keyframes;

    let a = frames[0];
    let b =
      frames[
        frames.length - 1
      ];

    for (
      let i = 0;
      i < frames.length - 1;
      i += 1
    ) {
      if (
        time >= frames[i].t &&
        time <=
          frames[i + 1].t
      ) {
        a = frames[i];
        b = frames[i + 1];
        break;
      }
    }

    const span =
      Math.max(
        0.0001,
        b.t - a.t
      );

    const local =
      THREE.MathUtils.smoothstep(
        (time - a.t) /
          span,
        0,
        1
      );

    for (const name of [
      "head",
      "chest",
      "leftUpperArm",
      "rightUpperArm"
    ]) {
      const av =
        a.bones?.[name] ||
        [0, 0, 0];

      const bv =
        b.bones?.[name] ||
        av;

      this.setBoneOffset(
        name,
        THREE.MathUtils.lerp(
          av[0],
          bv[0],
          local
        ),
        THREE.MathUtils.lerp(
          av[1],
          bv[1],
          local
        ),
        THREE.MathUtils.lerp(
          av[2],
          bv[2],
          local
        )
      );
    }

    if (time >= 1) {
      this.plan = null;
      return false;
    }

    return true;
  }

  resetPose() {
    this.plan = null;

    for (
      const [name, quaternion]
      of this.rest
    ) {
      const bone =
        this.vrm?.humanoid
          ?.getNormalizedBoneNode(
            name
          );

      if (bone) {
        bone.quaternion.copy(
          quaternion
        );
      }
    }
  }

  frame(time) {
    const dt =
      (time - this.last) / 1000;

    this.last = time;

    const performing =
      this.applyPlan();

    if (!performing) {
      this.applyIdle(time, dt);
    }

    if (this.vrm) {
      this.vrm.update(
        Math.max(0, dt)
      );
    }

    this.renderer.render(
      this.scene,
      this.camera
    );

    requestAnimationFrame(
      (next) => this.frame(next)
    );
  }
}

export const avatar =
  new AvatarController();
