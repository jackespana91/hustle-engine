import * as THREE from "three";

export type NightDropClampPose = "authority" | "scanner" | "defeated";

const CLAMP_POSE_URLS: Readonly<Record<NightDropClampPose, string>> = {
  authority: "/assets/night-drop/characters/clamp/authority.png",
  scanner: "/assets/night-drop/characters/clamp/scanner.png",
  defeated: "/assets/night-drop/characters/clamp/defeated.png",
};

/**
 * Event-driven 2.5D presentation for Clamp.
 *
 * The supplied production art is preserved as a camera-facing character card
 * inside the physical Three.js world. A compact proxy remains available until
 * those textures are ready, so a slow connection never removes the threat.
 */
export class NightDropClampActor {
  readonly root = new THREE.Group();
  readonly ready: Promise<void>;
  private readonly spriteMaterial = new THREE.SpriteMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    alphaTest: .025,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly sprite = new THREE.Sprite(this.spriteMaterial);
  private readonly proxy = createClampProxy();
  private readonly alertLight = new THREE.PointLight(0xff234d, 0, 11, 2);
  private readonly textures = new Map<NightDropClampPose, THREE.Texture>();
  private pose: NightDropClampPose = "authority";
  private disposed = false;

  constructor() {
    this.root.name = "clamp-actor";
    this.root.userData.assetRole = "character.clamp";

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 28),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: .52,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.2, .7, 1);
    shadow.position.y = .025;

    this.sprite.name = "clamp-production-sprite";
    this.sprite.center.set(.5, 0);
    this.sprite.scale.set(3.35, 6.7, 1);
    this.sprite.position.set(0, .04, 0);
    this.sprite.renderOrder = 8;
    this.proxy.scale.setScalar(.96);
    this.alertLight.position.set(0, 2.7, .8);
    this.root.add(shadow, this.proxy, this.sprite, this.alertLight);
    this.ready = this.loadProductionTextures();
  }

  setPose(pose: NightDropClampPose): void {
    this.pose = pose;
    const texture = this.textures.get(pose);
    if (texture) this.spriteMaterial.map = texture;
    this.spriteMaterial.needsUpdate = true;
  }

  update(elapsedMs: number, active: boolean, escaped: boolean): void {
    this.setPose(escaped ? "defeated" : active ? "scanner" : "authority");
    const pulse = active ? .5 + Math.sin(elapsedMs * .016) * .5 : 0;
    const breathe = 1 + Math.sin(elapsedMs * .0045) * .012;
    this.sprite.scale.set(3.35 * breathe, 6.7 * breathe, 1);
    this.sprite.position.y = .04 + (active ? Math.sin(elapsedMs * .011) * .035 : 0);
    this.alertLight.intensity = active ? 7 + pulse * 7 : escaped ? 1.5 : 2.5;
    this.proxy.rotation.z = active ? Math.sin(elapsedMs * .012) * .02 : 0;
  }

  dispose(): void {
    this.disposed = true;
    this.textures.forEach((texture) => texture.dispose());
    this.textures.clear();
    this.spriteMaterial.dispose();
  }

  private async loadProductionTextures(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const results = await Promise.allSettled(
      (Object.entries(CLAMP_POSE_URLS) as [NightDropClampPose, string][]).map(async ([pose, url]) => {
        const texture = await loader.loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        return [pose, texture] as const;
      }),
    );
    if (this.disposed) {
      results.forEach((result) => {
        if (result.status === "fulfilled") result.value[1].dispose();
      });
      return;
    }
    results.forEach((result) => {
      if (result.status === "fulfilled") this.textures.set(...result.value);
    });
    const texture = this.textures.get(this.pose) ?? this.textures.get("authority");
    if (!texture) return;
    this.spriteMaterial.map = texture;
    this.spriteMaterial.opacity = 1;
    this.spriteMaterial.needsUpdate = true;
    this.proxy.visible = false;
  }
}

function createClampProxy(): THREE.Group {
  const root = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({
    color: 0x81963c,
    roughness: .72,
    emissive: 0x28330e,
    emissiveIntensity: .25,
  });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xe8dfc8, roughness: .8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xa56f50, roughness: .82 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(.78, 18, 12), coat);
  body.scale.set(1, 1.25, .72);
  body.position.y = 1.45;
  const shirtPanel = new THREE.Mesh(new THREE.BoxGeometry(.52, .85, .14), shirt);
  shirtPanel.position.set(0, 1.5, .58);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.34, 16, 12), skin);
  head.position.y = 2.65;
  root.add(body, shirtPanel, head);
  root.scale.setScalar(1.12);
  return root;
}
