import * as THREE from "three";

export interface NightDropDashParts {
  readonly torso: THREE.Mesh;
  readonly backpack: THREE.Mesh;
  readonly head: THREE.Group;
  readonly hair: THREE.Group;
  readonly jacketTail: THREE.Group;
  readonly leftLeg: THREE.Group;
  readonly rightLeg: THREE.Group;
  readonly leftArm: THREE.Group;
  readonly rightArm: THREE.Group;
}

export function createNightDropDashRig(): THREE.Group {
  const root = new THREE.Group();
  root.name = "dash-authored-proxy";
  root.userData.assetRole = "character.dash";
  root.userData.productionStage = "authored-3d-proxy-v2";

  const black = standard(0x06090e, .58, .16);
  const cloth = standard(0x111d2a, .72, .12);
  const jacket = standard(0x142c3e, .58, .22, 0x09202d, .18);
  const cyan = standard(0x1cc5d7, .34, .46, 0x1cc5d7, 1.6);
  const magenta = standard(0xff2ca8, .32, .52, 0xff2ca8, 1.15);
  const skin = standard(0xaa7054, .82, .02);
  const hairMaterial = standard(0x140d22, .62, .08, 0x2d0f45, .16);
  const white = standard(0xdffbff, .36, .18, 0x8befff, .36);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.38, .72, 6, 12), jacket);
  torso.name = "dash-torso";
  torso.position.y = 1.45;
  torso.castShadow = true;
  root.add(torso);

  const jacketPanel = new THREE.Mesh(new THREE.BoxGeometry(.7, .6, .12), cloth);
  jacketPanel.position.set(0, 1.44, .33);
  jacketPanel.castShadow = true;
  root.add(jacketPanel);

  const jacketZip = new THREE.Mesh(new THREE.BoxGeometry(.035, .48, .025), cyan);
  jacketZip.position.set(.02, 1.46, .402);
  root.add(jacketZip);

  const collarLeft = new THREE.Mesh(new THREE.BoxGeometry(.23, .2, .08), cloth);
  collarLeft.position.set(-.17, 1.78, .36);
  collarLeft.rotation.z = -.45;
  const collarRight = collarLeft.clone();
  collarRight.position.x = .17;
  collarRight.rotation.z = .45;
  root.add(collarLeft, collarRight);

  const head = new THREE.Group();
  head.name = "dash-head";
  head.position.y = 2.16;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(.39, 18, 14), black);
  hood.castShadow = true;
  const face = new THREE.Mesh(new THREE.SphereGeometry(.285, 18, 14), skin);
  face.scale.set(1, 1.05, .7);
  face.position.z = .245;
  face.castShadow = true;
  head.add(hood, face);

  const leftEye = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), white);
  leftEye.scale.set(1.25, .55, .35);
  leftEye.position.set(-.105, .055, .43);
  const rightEye = leftEye.clone();
  rightEye.position.x = .105;
  head.add(leftEye, rightEye);

  const hair = createHair(hairMaterial);
  hair.position.set(0, .2, .02);
  head.add(hair);
  root.add(head);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(.58, .72, .24), black);
  backpack.name = "dash-delivery-pack";
  backpack.position.set(0, 1.49, -.4);
  backpack.castShadow = true;
  root.add(backpack);
  const backpackPanel = new THREE.Mesh(new THREE.BoxGeometry(.4, .44, .04), jacket);
  backpackPanel.position.set(0, 1.49, -.54);
  const backpackLight = new THREE.Mesh(new THREE.BoxGeometry(.29, .055, .04), magenta);
  backpackLight.position.set(0, 1.58, -.57);
  const backpackMark = new THREE.Mesh(new THREE.BoxGeometry(.12, .16, .045), cyan);
  backpackMark.position.set(0, 1.42, -.575);
  root.add(backpackPanel, backpackLight, backpackMark);

  const strapMaterial = standard(0x293745, .68, .2);
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(.075, .68, .055), strapMaterial);
    strap.position.set(side * .25, 1.48, .36);
    strap.rotation.z = side * -.08;
    root.add(strap);
  }

  const leftLeg = createLeg(-1, black, magenta);
  leftLeg.position.set(-.23, .96, 0);
  const rightLeg = createLeg(1, black, cyan);
  rightLeg.position.set(.23, .96, 0);
  const leftArm = createArm(-1, cloth, skin, cyan);
  leftArm.position.set(-.54, 1.79, 0);
  leftArm.rotation.z = -.14;
  const rightArm = createArm(1, cloth, skin, magenta);
  rightArm.position.set(.54, 1.79, 0);
  rightArm.rotation.z = .14;
  root.add(leftLeg, rightLeg, leftArm, rightArm);

  const jacketTail = new THREE.Group();
  jacketTail.name = "dash-jacket-tail";
  jacketTail.position.set(0, 1.18, -.29);
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(.19, .5, 5), cloth);
    tail.position.set(side * .17, -.18, 0);
    tail.rotation.x = -.18;
    tail.castShadow = true;
    jacketTail.add(tail);
  }
  root.add(jacketTail);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(.72, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .48, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .025;
  root.add(shadow);

  root.userData.parts = {
    torso,
    backpack,
    head,
    hair,
    jacketTail,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
  } satisfies NightDropDashParts;
  root.scale.setScalar(.82);
  return root;
}

function createHair(material: THREE.Material): THREE.Group {
  const hair = new THREE.Group();
  const placements = [
    { x: -.24, y: .08, z: .05, scale: .82, tilt: -.62 },
    { x: -.1, y: .18, z: .02, scale: 1.05, tilt: -.32 },
    { x: .06, y: .2, z: 0, scale: 1.12, tilt: .08 },
    { x: .21, y: .13, z: .02, scale: .92, tilt: .42 },
  ];
  placements.forEach(({ x, y, z, scale, tilt }) => {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(.13, .42, 6), material);
    spike.position.set(x, y, z);
    spike.scale.setScalar(scale);
    spike.rotation.z = tilt;
    spike.castShadow = true;
    hair.add(spike);
  });
  return hair;
}

function createLeg(side: number, cloth: THREE.Material, shoeAccent: THREE.Material): THREE.Group {
  const pivot = new THREE.Group();
  const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.16, .68, 5, 10), cloth);
  leg.position.y = -.34;
  leg.castShadow = true;
  const shoe = new THREE.Mesh(new THREE.BoxGeometry(.34, .18, .48), shoeAccent);
  shoe.position.set(0, -.76, .1);
  shoe.rotation.y = side * .035;
  shoe.castShadow = true;
  pivot.add(leg, shoe);
  return pivot;
}

function createArm(side: number, cloth: THREE.Material, skin: THREE.Material, accent: THREE.Material): THREE.Group {
  const pivot = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.12, .58, 5, 10), cloth);
  arm.position.y = -.29;
  arm.castShadow = true;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, .12, 8), accent);
  cuff.position.y = -.61;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(.135, 10, 8), skin);
  hand.position.y = -.72;
  hand.scale.set(1, 1.12, .8);
  pivot.add(arm, cuff, hand);
  pivot.userData.side = side;
  return pivot;
}

function standard(
  color: number,
  roughness: number,
  metalness: number,
  emissive = 0x000000,
  emissiveIntensity = 0,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
}
