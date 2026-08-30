import 'pixi.js/unsafe-eval';

import { useEffect, useRef } from 'react';
import { Application, Assets } from 'pixi.js';
import { PetActivity, ROBOT_DESIGN_SIZE, RobotPet } from './robotPet';

type Props = { activity?: PetActivity };

const PET_WINDOW_SIZE = { width: 320, height: 420 };

export function PixiPetCanvas({ activity = 'idle' }: Props): React.JSX.Element {
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

    const tick = (ticker: { deltaMS: number }): void => {
      pet?.update(ticker.deltaMS);
    };

    async function start(): Promise<void> {
      try {
        await app.init({
          width: PET_WINDOW_SIZE.width,
          height: PET_WINDOW_SIZE.height,
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

        app.canvas.style.display = 'block';
        app.canvas.style.width = '100%';
        app.canvas.style.height = '100%';
        hostElement.appendChild(app.canvas);

        Assets.setPreferences({ preferWorkers: false, preferCreateImageBitmap: false });

        pet = await RobotPet.create();

        if (destroyed) {
          pet.destroy({ children: true });
          return;
        }

        petRef.current = pet;
        pet.setActivity(activityRef.current);
        app.stage.addChild(pet);

        pet.scale.set(
          Math.min(
            PET_WINDOW_SIZE.width / ROBOT_DESIGN_SIZE.width,
            PET_WINDOW_SIZE.height / ROBOT_DESIGN_SIZE.height,
          ) * 0.8,
        );
        pet.position.set(PET_WINDOW_SIZE.width / 2, PET_WINDOW_SIZE.height / 2);

        /*
         * Pixi animation loop
         */

        app.ticker.add(tick);
      } catch (error) {
        if (!destroyed) {
          console.error('Failed to create robot pet', error);
        }
      }
    }

    start();

    return () => {
      destroyed = true;
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
      style={{ width: '100%', height: '100%', overflow: 'hidden', background: 'transparent' }}
    />
  );
}
