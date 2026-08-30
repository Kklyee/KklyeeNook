// Pet component implementation goes here.
import "pixi.js/unsafe-eval";

import { useEffect, useRef } from "react";

import { Application, Assets } from "pixi.js";

import { PetActivity, ROBOT_DESIGN_SIZE, RobotPet } from "./robotPet";

type Props = {
  activity?: PetActivity;
};

export function PixiPetCanvas({ activity = "idle" }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  const petRef = useRef<RobotPet | null>(null);

  const activityRef = useRef<PetActivity>(activity);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) return;

    const hostElement: HTMLDivElement = host;

    let destroyed = false;
    let initialized = false;
    let pet: RobotPet | null = null;

    const app = new Application();

    let resizeObserver: ResizeObserver | undefined;

    const tick = (ticker: { deltaMS: number }): void => {
      pet?.update(ticker.deltaMS);
    };

    async function start(): Promise<void> {
      try {
        await app.init({
          resizeTo: hostElement,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio, 2),
        });

        initialized = true;

        if (destroyed) {
          app.destroy({ removeView: true }, { children: true });
          return;
        }

        app.canvas.style.display = "block";
        hostElement.appendChild(app.canvas);

        Assets.setPreferences({
          preferWorkers: false,
          preferCreateImageBitmap: false,
        });

        pet = await RobotPet.create();

        if (destroyed) {
          pet.destroy({ children: true });
          return;
        }

        petRef.current = pet;
        pet.setActivity(activityRef.current);
        app.stage.addChild(pet);

        /*
         * Canvas 尺寸变化时
         * 自动调整机器人大小和位置
         */

        const layout = (): void => {
          if (!pet) return;

          const width = hostElement.clientWidth;
          const height = hostElement.clientHeight;
          if (width <= 0 || height <= 0) {
            return;
          }

          pet.scale.set(
            Math.min(width / ROBOT_DESIGN_SIZE.width, height / ROBOT_DESIGN_SIZE.height) * 0.4,
          );
          pet.position.set(width / 2, height / 2);
        };

        layout();

        resizeObserver = new ResizeObserver(layout);

        resizeObserver.observe(hostElement);

        /*
         * Pixi animation loop
         */

        app.ticker.add(tick);
      } catch (error) {
        if (!destroyed) {
          console.error("Failed to create robot pet", error);
        }
      }
    }

    start();

    return () => {
      destroyed = true;

      resizeObserver?.disconnect();

      petRef.current = null;

      if (initialized) {
        app.ticker.remove(tick);
        app.destroy({ removeView: true }, { children: true });
      }
    };
  }, []);

  useEffect(() => {
    activityRef.current = activity;
    petRef.current?.setActivity(activity);
  }, [activity]);

  return (
    <div
      ref={hostRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
    />
  );
}
