export const WINDOW_RESIZE_EPSILON_PX: number;

export interface WindowResizePlan {
  fromWidth: number;
  toWidth: number;
  direction: 'grow' | 'shrink' | 'none';
  windowResizeTiming: 'before' | 'after' | 'none';
  suppressChaseDuringTween: boolean;
}

export function planWindowResize(fromWidth: number, toWidth: number): WindowResizePlan;
