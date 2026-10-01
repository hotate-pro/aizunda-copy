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
    this.cameraTargetY = 0.8;

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

    const width = Math.max(
      1,
      rect.width
    );
    const height = Math.max(
      1,
      rect.height
    );

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

    // VRMs do not all use the same origin.
    // Fit the model from its real bounding box
    // instead of applying a fixed -1m Y offset.
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

    this.fitModelToGround();
    this.fitCamera();

    return this.vrm;
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

    // Ground is at y = -1.
    // Move the actual lowest mesh point to the ground.
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
      Math.max(size.y, 1);

    this.cameraTargetY =
      center.y + height * 0.03;

    const fov =
      THREE.MathUtils.degToRad(
        this.camera.fov
      );

    const visibleHeight =
      Math.max(
        height * 1.12,
        0.5
      );

    const distance =
      visibleHeight /
      (2 * Math.tan(fov / 2));

    this.camera.position.set(
      0,
      this.cameraTargetY,
      Math.max(
        2.2,
        distance
      )
    );

    this.camera.lookAt(
      0,
      this.cameraTargetY,
      0
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

    if (!this.vrm) {
      return;
    }

    const manager =
      this.vrm.expressionManager;

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
          // VRM expression presets differ by model.
        }
      }
    }
  }

  resetPose() {
    this.plan = null;

    if (!this.vrm?.humanoid) {
      return;
    }

    for (
      const name of [
        "head",
        "chest",
        "leftUpperArm",
        "rightUpperArm"
      ]
    ) {
      const bone =
        this.vrm.humanoid
          .getNormalizedBoneNode(
            name
          );

      if (bone) {
        bone.rotation.set(
          0,
          0,
          0
        );
      }
    }
  }

  update() {
    if (
      !this.vrm ||
      !this.plan?.keyframes
    ) {
      return;
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
        b =
          frames[i + 1];
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

    if (!this.vrm.humanoid) {
      return;
    }

    const boneNames = [
      "head",
      "chest",
      "leftUpperArm",
      "rightUpperArm"
    ];

    for (
      const name of boneNames
    ) {
      const bone =
        this.vrm.humanoid
          .getNormalizedBoneNode(
            name
          );

      if (!bone) {
        continue;
      }

      const av =
        a.bones?.[name] ||
        [0, 0, 0];

      const bv =
        b.bones?.[name] ||
        av;

      const rx =
        THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(
            av[0],
            bv[0],
            local
          ),
          -0.9,
          0.9
        );

      const ry =
        THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(
            av[1],
            bv[1],
            local
          ),
          -0.9,
          0.9
        );

      const rz =
        THREE.MathUtils.clamp(
          THREE.MathUtils.lerp(
            av[2],
            bv[2],
            local
          ),
          -0.9,
          0.9
        );

      bone.rotation.set(
        rx,
        ry,
        rz
      );
    }

    if (time >= 1) {
      this.plan = null;
    }
  }

  frame(time) {
    const dt =
      (time - this.last) / 1000;

    this.last = time;

    this.update();

    if (this.vrm) {
      this.vrm.update(dt);

      if (
        !this.plan &&
        this.vrm.humanoid
      ) {
        const head =
          this.vrm.humanoid
            .getNormalizedBoneNode(
              "head"
            );

        if (head) {
          head.rotation.z =
            Math.sin(
              time / 2100
            ) * 0.035;
        }
      }
    }

    this.renderer.render(
      this.scene,
      this.camera
    );

    requestAnimationFrame(
      (next) =>
        this.frame(next)
    );
  }
}

export const avatar =
  new AvatarController();
