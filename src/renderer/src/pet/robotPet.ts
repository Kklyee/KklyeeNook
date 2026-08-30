import { Assets, Container, Sprite, Texture } from "pixi.js";

import headUrl from "../assets/robot/headBase.png";
import bodyUrl from "../assets/robot/body.png";

import armLeftUrl from "../assets/robot/armLeft.png";
import armRightUrl from "../assets/robot/armRight.png";

import legLeftUrl from "../assets/robot/legLeft.png";
import legRightUrl from "../assets/robot/legRight.png";

import eyeLeftUrl from "../assets/robot/eyeLeft.png";
import eyeRightUrl from "../assets/robot/eyeRight.png";
import mouthUrl from "../assets/robot/mouth.png";

import chestRingUrl from "../assets/robot/chestRing.png";
import chestGlowUrl from "../assets/robot/chestGlow.png";

export type PetActivity = "idle" | "thinking" | "working" | "waiting" | "success" | "error";

const LIGHT_COLOR = {
  blue: 0x4da6ff,
  yellow: 0xffc83d,
  green: 0x43d17d,
  red: 0xff5252,
};

export const ROBOT_DESIGN_SIZE = {
  width: 580,
  height: 900,
};

type VisibleBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const VISIBLE_BOUNDS = {
  head: { x: 58, y: 64, width: 1332, height: 942 },
  body: { x: 57, y: 258, width: 972, height: 906 },
  armLeft: { x: 195, y: 156, width: 669, height: 1215 },
  armRight: { x: 172, y: 152, width: 685, height: 1220 },
  legLeft: { x: 207, y: 96, width: 585, height: 1244 },
  legRight: { x: 227, y: 96, width: 598, height: 1244 },
  eyeLeft: { x: 373, y: 367, width: 506, height: 506 },
  eyeRight: { x: 370, y: 366, width: 513, height: 515 },
  mouth: { x: 476, y: 310, width: 822, height: 285 },
  chestRing: { x: 85, y: 65, width: 1080, height: 1074 },
  chestGlow: { x: 156, y: 130, width: 940, height: 939 },
} satisfies Record<string, VisibleBounds>;

const RIG_BASE_Y = -38;
const ARM_BASE_ROTATION = 0.06;

export class RobotPet extends Container {
  private rig = new Container();

  private head = new Container();

  private leftArm = new Container();
  private rightArm = new Container();

  private leftLeg = new Container();
  private rightLeg = new Container();

  private eyeLeft!: Sprite;
  private eyeRight!: Sprite;
  private mouth!: Sprite;

  private chestGlow!: Sprite;

  private activity: PetActivity = "idle";

  private elapsed = 0;

  private blinkTimer = 2000;
  private blinkProgress = -1;

  private eyeLeftBaseScaleY = 1;
  private eyeRightBaseScaleY = 1;

  private constructor() {
    super();
  }

  static async create(): Promise<RobotPet> {
    const pet = new RobotPet();
    await pet.load();
    return pet;
  }

  private async texture(url: string): Promise<Texture> {
    return Assets.load<Texture>(url);
  }

  private async load(): Promise<void> {
    const [
      headTexture,
      bodyTexture,

      armLeftTexture,
      armRightTexture,

      legLeftTexture,
      legRightTexture,

      eyeLeftTexture,
      eyeRightTexture,
      mouthTexture,

      chestRingTexture,
      chestGlowTexture,
    ] = await Promise.all([
      this.texture(headUrl),
      this.texture(bodyUrl),

      this.texture(armLeftUrl),
      this.texture(armRightUrl),

      this.texture(legLeftUrl),
      this.texture(legRightUrl),

      this.texture(eyeLeftUrl),
      this.texture(eyeRightUrl),
      this.texture(mouthUrl),

      this.texture(chestRingUrl),
      this.texture(chestGlowUrl),
    ]);

    const legLeft = new Sprite(legLeftTexture);
    const legRight = new Sprite(legRightTexture);

    this.fitVisibleSize(legLeft, VISIBLE_BOUNDS.legLeft, 132, 300, 0.5, 0.04);
    this.fitVisibleSize(legRight, VISIBLE_BOUNDS.legRight, 132, 300, 0.5, 0.04);

    this.leftLeg.position.set(-84, 170);
    this.rightLeg.position.set(84, 170);

    this.leftLeg.addChild(legLeft);
    this.rightLeg.addChild(legRight);

    const body = new Sprite(bodyTexture);

    this.fitVisibleWidth(body, VISIBLE_BOUNDS.body, 310);

    body.position.set(0, 100);

    const chestRing = new Sprite(chestRingTexture);

    this.fitVisibleWidth(chestRing, VISIBLE_BOUNDS.chestRing, 72);

    chestRing.position.set(0, 70);

    this.chestGlow = new Sprite(chestGlowTexture);

    this.fitVisibleWidth(this.chestGlow, VISIBLE_BOUNDS.chestGlow, 54);

    this.chestGlow.position.set(0, 70);

    // 默认蓝色
    this.chestGlow.tint = LIGHT_COLOR.blue;

    const leftArmSprite = new Sprite(armLeftTexture);
    const rightArmSprite = new Sprite(armRightTexture);

    /*
     * 这里很重要：
     * anchor 靠近肩膀。
     *
     * 后面 rotation 就会围绕肩膀转。
     */

    this.fitVisibleSize(leftArmSprite, VISIBLE_BOUNDS.armLeft, 138, 270, 0.9, 0.18);
    this.fitVisibleSize(rightArmSprite, VISIBLE_BOUNDS.armRight, 138, 270, 0.1, 0.18);

    // 肩部连接端压进身体边缘，由身体轮廓遮住接缝。
    this.leftArm.position.set(-147, 20);
    this.rightArm.position.set(157, 20);

    this.leftArm.rotation = ARM_BASE_ROTATION;
    this.rightArm.rotation = -ARM_BASE_ROTATION;

    this.leftArm.addChild(leftArmSprite);
    this.rightArm.addChild(rightArmSprite);

    const headBase = new Sprite(headTexture);

    this.fitVisibleWidth(headBase, VISIBLE_BOUNDS.head, 500);

    this.head.position.set(0, -196);
    this.head.scale.set(0.94);

    this.head.addChild(headBase);

    this.eyeLeft = new Sprite(eyeLeftTexture);
    this.eyeRight = new Sprite(eyeRightTexture);

    this.fitVisibleWidth(this.eyeLeft, VISIBLE_BOUNDS.eyeLeft, 54);
    this.fitVisibleWidth(this.eyeRight, VISIBLE_BOUNDS.eyeRight, 54);

    this.eyeLeftBaseScaleY = this.eyeLeft.scale.y;
    this.eyeRightBaseScaleY = this.eyeRight.scale.y;

    this.eyeLeft.position.set(-96, 20);
    this.eyeRight.position.set(96, 20);

    this.head.addChild(this.eyeLeft, this.eyeRight);

    this.mouth = new Sprite(mouthTexture);

    this.fitVisibleWidth(this.mouth, VISIBLE_BOUNDS.mouth, 64);

    this.mouth.position.set(0, 72);

    this.head.addChild(this.mouth);

    // =============================
    // Layer order
    // =============================

    /*
     * 腿在最下面
     * 身体覆盖腿和手臂内侧接缝
     * 头最后
     */

    this.rig.addChild(
      this.leftLeg,
      this.rightLeg,

      this.leftArm,
      this.rightArm,

      body,

      chestRing,
      this.chestGlow,

      this.head,
    );

    // 角色内部坐标以可见轮廓中心为原点；页面布局只移动外层 RobotPet。
    this.rig.position.y = RIG_BASE_Y;
    this.addChild(this.rig);
  }

  private fitVisibleWidth(
    sprite: Sprite,
    bounds: VisibleBounds,
    width: number,
    anchorX = 0.5,
    anchorY = 0.5,
  ): void {
    const ratio = width / bounds.width;

    sprite.scale.set(ratio);
    sprite.anchor.set(
      (bounds.x + bounds.width * anchorX) / sprite.texture.width,
      (bounds.y + bounds.height * anchorY) / sprite.texture.height,
    );
  }

  private fitVisibleSize(
    sprite: Sprite,
    bounds: VisibleBounds,
    width: number,
    height: number,
    anchorX = 0.5,
    anchorY = 0.5,
  ): void {
    sprite.scale.set(width / bounds.width, height / bounds.height);
    sprite.anchor.set(
      (bounds.x + bounds.width * anchorX) / sprite.texture.width,
      (bounds.y + bounds.height * anchorY) / sprite.texture.height,
    );
  }

  setActivity(activity: PetActivity): void {
    this.activity = activity;

    switch (activity) {
      case "idle":
      case "thinking":
      case "working":
        this.chestGlow.tint = LIGHT_COLOR.blue;
        break;

      case "waiting":
        this.chestGlow.tint = LIGHT_COLOR.yellow;
        break;

      case "success":
        this.chestGlow.tint = LIGHT_COLOR.green;
        break;

      case "error":
        this.chestGlow.tint = LIGHT_COLOR.red;
        break;
    }
  }

  blink(): void {
    if (this.blinkProgress >= 0) return;

    this.blinkProgress = 0;
  }

  update(deltaMS: number): void {
    this.elapsed += deltaMS;

    /*
     * 每一帧先恢复基础状态，
     * 防止不同 animation 之间状态残留。
     */

    this.head.rotation = 0;

    this.leftArm.rotation = ARM_BASE_ROTATION;
    this.rightArm.rotation = -ARM_BASE_ROTATION;

    /*
     * 所有状态都有一点非常轻微的呼吸。
     */

    this.rig.y = RIG_BASE_Y + Math.sin(this.elapsed / 650) * 3;

    // ============================
    // Blink
    // ============================

    this.updateBlink(deltaMS);

    // ============================
    // Activity animation
    // ============================

    switch (this.activity) {
      case "idle":
        this.animateIdle();
        break;

      case "thinking":
        this.animateThinking();
        break;

      case "working":
        this.animateWorking();
        break;

      case "waiting":
        this.animateWaiting();
        break;

      case "success":
        this.animateSuccess();
        break;

      case "error":
        this.animateError();
        break;
    }
  }

  private updateBlink(deltaMS: number): void {
    if (this.blinkProgress >= 0) {
      this.blinkProgress += deltaMS;

      const duration = 180;
      const t = this.blinkProgress / duration;

      /*
       * 1 → 0.08 → 1
       */

      const scaleY = t < 0.5 ? 1 - t * 1.84 : 0.08 + (t - 0.5) * 1.84;

      this.eyeLeft.scale.y = this.eyeLeftBaseScaleY * Math.max(0.08, scaleY);

      this.eyeRight.scale.y = this.eyeRightBaseScaleY * Math.max(0.08, scaleY);

      if (t >= 1) {
        this.eyeLeft.scale.y = this.eyeLeftBaseScaleY;
        this.eyeRight.scale.y = this.eyeRightBaseScaleY;

        this.blinkProgress = -1;

        this.blinkTimer = 2000 + Math.random() * 3500;
      }

      return;
    }

    this.blinkTimer -= deltaMS;

    if (this.blinkTimer <= 0) {
      this.blink();
    }
  }

  private animateIdle(): void {
    /*
     * 蓝色呼吸灯
     */

    this.chestGlow.alpha = 0.72 + Math.sin(this.elapsed / 500) * 0.18;

    /*
     * 头非常轻微左右摆动
     */

    this.head.rotation = Math.sin(this.elapsed / 1600) * 0.015;
  }

  private animateThinking(): void {
    this.head.rotation = 0.06 + Math.sin(this.elapsed / 700) * 0.015;

    this.chestGlow.alpha = 0.55 + Math.sin(this.elapsed / 320) * 0.3;
  }

  private animateWorking(): void {
    /*
     * 两只手交替动
     */

    const swing = Math.sin(this.elapsed / 170) * 0.08;

    this.leftArm.rotation = ARM_BASE_ROTATION + swing;

    this.rightArm.rotation = -ARM_BASE_ROTATION - swing;

    this.chestGlow.alpha = 0.7 + Math.sin(this.elapsed / 220) * 0.22;
  }

  private animateWaiting(): void {
    /*
     * 黄色慢呼吸
     */

    this.chestGlow.alpha = 0.5 + Math.sin(this.elapsed / 500) * 0.35;

    /*
     * 微微歪头看用户
     */

    this.head.rotation = 0.045;
  }

  private animateSuccess(): void {
    /*
     * 绿色 + 小跳跃
     */

    this.rig.y = RIG_BASE_Y - Math.abs(Math.sin(this.elapsed / 260)) * 12;

    this.leftArm.rotation = ARM_BASE_ROTATION - 0.24;
    this.rightArm.rotation = -ARM_BASE_ROTATION + 0.24;

    this.chestGlow.alpha = 0.85 + Math.sin(this.elapsed / 150) * 0.15;
  }

  private animateError(): void {
    /*
     * 红灯快闪
     */

    this.chestGlow.alpha = Math.sin(this.elapsed / 90) > 0 ? 1 : 0.3;

    /*
     * 摇头
     */

    this.head.rotation = Math.sin(this.elapsed / 80) * 0.07;
  }
}
